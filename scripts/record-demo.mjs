/**
 * Record 1080p demo (cleaned track, framed to demo crop), then 480p loop.
 * Setup (load / center / chrome) is trimmed out so the clip starts already framed.
 * Usage: node scripts/record-demo.mjs [baseUrl]
 */
import { chromium } from "playwright";
import {
  mkdirSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "recordings");
const docsDir = join(root, "docs");
const baseUrlArg = process.argv[2] || "http://127.0.0.1:8765/";
const WIDTH = 1920;
const HEIGHT = 1080;
/** Hard cap while waiting for derail + re-rail */
const MAX_MS = 90_000;
/** Keep rolling after re-rail so the loop is visible (was 2.8s — too short) */
const POST_RERAIL_MS = 14_000;
/** Minimum content length after the train starts (regardless of re-rail timing) */
const MIN_RUN_MS = 28_000;
/** World pad for camera fit — large enough that stubs/ends stay inside the frame */
const FRAME_PAD = 72;
const BUST = `rec=${Date.now()}`;

mkdirSync(outDir, { recursive: true });
mkdirSync(docsDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withBust(url) {
  const u = new URL(url);
  u.searchParams.set("rec", String(Date.now()));
  return u.toString();
}

function runFfmpeg(args) {
  const r = spawnSync("ffmpeg", ["-y", ...args], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout);
    throw new Error(`ffmpeg failed (${r.status})`);
  }
}

function loadCrop() {
  const layout = JSON.parse(
    readFileSync(join(root, "layouts/real-meme-track.json"), "utf8")
  );
  if (layout.demoCrop) return layout.demoCrop;
  try {
    return JSON.parse(readFileSync(join(outDir, "demo-crop.json"), "utf8"));
  } catch {
    return { minX: 80, minY: 20, maxX: 990, maxY: 790 };
  }
}

async function main() {
  const crop = loadCrop();
  const baseUrl = withBust(baseUrlArg);
  console.log("Recording from", baseUrl, `${WIDTH}x${HEIGHT}`);
  console.log("World crop", crop);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-http-cache"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    storageState: undefined,
    recordVideo: {
      dir: outDir,
      size: { width: WIDTH, height: HEIGHT },
    },
  });
  const page = await context.newPage();
  /** Wall-clock when Playwright starts capturing this page (≈ video t=0) */
  const videoT0 = Date.now();

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });

  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  await page.reload({ waitUntil: "networkidle" });

  const buildInfo = await page.evaluate(async () => {
    const r = await fetch(`./js/train.js?${Date.now()}`);
    const text = await r.text();
    return {
      hasPreferLock: text.includes("offRailPreferAng"),
      hasDeepestWall: text.includes("deepestWallHit"),
      hasSlideDir: text.includes("wallSlideDir"),
      hasFixedDs: text.includes("OFF_RAIL_DS"),
    };
  });
  console.log("Module check", buildInfo);
  if (!buildInfo.hasPreferLock || !buildInfo.hasDeepestWall) {
    throw new Error("Recording env loaded stale train.js — aborting");
  }

  if (
    !(await page.evaluate(() => typeof window.__plarailDemo?.start === "function"))
  ) {
    throw new Error("__plarailDemo.start missing");
  }

  await page.click("#btn-meme");
  await sleep(600);

  const FULL_SPEED = 280;
  await page.evaluate((sp) => {
    const d = window.__plarailDemo;
    d.setSidebarCollapsed(true);
    d.setRecordChrome(true);
    const slider = document.getElementById("speed");
    if (slider) {
      slider.value = String(sp);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, FULL_SPEED);
  await sleep(400);

  // Frame once, settle layout/resize, frame again so first exported frame is stable
  await page.evaluate(
    ({ c, pad }) => {
      window.__plarailDemo.fitWorldRect(c, pad);
    },
    { c: crop, pad: FRAME_PAD }
  );
  await sleep(350);
  await page.evaluate(
    ({ c, pad }) => {
      window.__plarailDemo.fitWorldRect(c, pad);
    },
    { c: crop, pad: FRAME_PAD }
  );
  await sleep(250);

  const map = await page.evaluate(
    ({ c, pad }) => {
      const d = window.__plarailDemo;
      d.fitWorldRect(c, pad);
      const v = d.getView();
      const canvas = document.getElementById("stage");
      const r = canvas.getBoundingClientRect();
      const x1 = r.x + (c.minX - pad - v.camX);
      const y1 = r.y + (c.minY - pad - v.camY);
      const x2 = r.x + (c.maxX + pad - v.camX);
      const y2 = r.y + (c.maxY + pad - v.camY);
      return {
        x1,
        y1,
        x2,
        y2,
        view: v,
        canvas: { x: r.x, y: r.y, w: r.width, h: r.height },
      };
    },
    { c: crop, pad: FRAME_PAD }
  );
  const recSpeed = await page.evaluate(() =>
    Number(document.getElementById("speed")?.value || 0)
  );
  console.log("Screen map", map, "record speed", recSpeed);

  // Centered full-track still for README (before motion, after framing)
  const shotPath = join(docsDir, "demo-screenshot.jpg");
  await page.screenshot({
    path: shotPath,
    type: "jpeg",
    quality: 88,
    fullPage: false,
  });
  console.log("Screenshot", shotPath);

  // Everything before this is setup; trim it from the export
  const contentStartMs = Date.now() - videoT0;
  // Small cushion so the first frame is fully painted after fit
  const trimSs = Math.max(0, (contentStartMs - 80) / 1000);
  console.log(
    `Content starts at ~${trimSs.toFixed(2)}s (setup ${contentStartMs}ms)`
  );

  const started = await page.evaluate(() => window.__plarailDemo.start());
  if (!started) throw new Error("Failed to start train via __plarailDemo.start()");
  await sleep(200);

  const runT0 = Date.now();
  let sawOff = false;
  let sawRerail = false;
  let last = "";
  let rerailAt = 0;

  while (Date.now() - runT0 < MAX_MS) {
    const mode = await page.evaluate(
      () => window.__plarailDemo?.getMode?.() || ""
    );
    const badge = (
      await page.locator("#mode-badge").innerText().catch(() => mode)
    ).trim();
    const label = badge || mode;
    if (label !== last) {
      console.log(`[${((Date.now() - runT0) / 1000).toFixed(1)}s] ${label}`);
      last = label;
    }
    if (!sawOff && (mode === "off_rail" || /Off rails/i.test(label))) {
      sawOff = true;
      console.log("→ derailed");
    }
    if (
      sawOff &&
      !sawRerail &&
      (mode === "on_rail" || /On rails/i.test(label))
    ) {
      sawRerail = true;
      rerailAt = Date.now();
      console.log("→ re-railed");
    }
    // After re-rail: hold long enough for the loop; also enforce min run length
    if (sawRerail) {
      const afterRerail = Date.now() - rerailAt;
      const runLen = Date.now() - runT0;
      if (afterRerail >= POST_RERAIL_MS && runLen >= MIN_RUN_MS) break;
    }
    if (mode === "stopped" || /Stopped/i.test(label)) {
      console.warn("Stopped at edge before re-rail");
      await sleep(2000);
      break;
    }
    await sleep(100);
  }

  if (!sawRerail) {
    // Partial run: still pad so the clip isn't a stub
    const remain = Math.max(0, MIN_RUN_MS - (Date.now() - runT0));
    if (remain > 0) await sleep(remain);
  }

  const runMs = Date.now() - runT0;
  console.log(
    `Run length ${(runMs / 1000).toFixed(1)}s off=${sawOff} rerail=${sawRerail}`
  );

  const video = page.video();
  await page.close();
  const webmPath = await video.path();
  await context.close();
  await browser.close();
  console.log("Raw:", webmPath);

  // Always export the full viewport: fitWorldRect already centers the track.
  // A second tight crop was clipping stubs and looking off-center on GitHub.
  const useFullFrame = true;
  console.log("ffmpeg export full frame, trimSs=", trimSs);

  const raw1080 = join(outDir, "_raw-1080p.mp4");
  const trimmed = join(outDir, "_trimmed-1080p.mp4");
  const out1080 = join(outDir, "plarail-meme-demo-1080p.mp4");
  const out480 = join(outDir, "plarail-meme-demo-480p.mp4");

  // Decode webm → mp4 first (more reliable seek)
  runFfmpeg([
    "-i",
    webmPath,
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-an",
    raw1080,
  ]);

  // Drop setup so frame 0 is already centered; scale to exact 1080p
  runFfmpeg([
    "-ss",
    String(trimSs.toFixed(3)),
    "-i",
    raw1080,
    "-vf",
    "scale=1920:1080:flags=lanczos,setsar=1",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    out1080,
  ]);

  runFfmpeg([
    "-i",
    out1080,
    "-vf",
    "scale=854:480:flags=lanczos",
    "-r",
    "12",
    "-c:v",
    "libx264",
    "-preset",
    "slow",
    "-crf",
    "32",
    "-pix_fmt",
    "yuv420p",
    "-profile:v",
    "baseline",
    "-level",
    "3.0",
    "-movflags",
    "+faststart",
    "-an",
    out480,
  ]);

  // Also pull a mid-run frame into screenshot if full-page shot is empty/odd
  // Prefer the framed still we already took; re-export a clean JPEG via ffmpeg
  // from t≈1.5s of final video as a second opinion only if needed.
  try {
    const probe = spawnSync(
      "ffprobe",
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        out1080,
      ],
      { encoding: "utf8" }
    );
    const dur = parseFloat((probe.stdout || "").trim());
    console.log("Final 1080p duration", dur, "s");
    if (Number.isFinite(dur) && dur > 2) {
      // Early on-rails frame for README: full track + train, already centered
      const stillT = Math.min(2.0, Math.max(0.8, dur * 0.08));
      const midShot = join(outDir, "_mid-screenshot.jpg");
      runFfmpeg([
        "-ss",
        String(stillT.toFixed(2)),
        "-i",
        out1080,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        midShot,
      ]);
      copyFileSync(midShot, shotPath);
      try {
        unlinkSync(midShot);
      } catch {
        /* ignore */
      }
      console.log("Updated screenshot from on-rails frame @", stillT.toFixed(2), "s");
    }
  } catch (e) {
    console.warn("Screenshot mid-frame skipped", e.message);
  }

  for (const p of [webmPath, raw1080, trimmed]) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }

  writeFileSync(
    join(outDir, "last-record.json"),
    JSON.stringify(
      {
        crop,
        map,
        sawOff,
        sawRerail,
        buildInfo,
        bust: BUST,
        trimSs,
        runMs,
        postRerailMs: POST_RERAIL_MS,
        minRunMs: MIN_RUN_MS,
        framePad: FRAME_PAD,
        useFullFrame,
        out1080,
        out480,
        shotPath,
      },
      null,
      2
    ) + "\n"
  );

  console.log("Wrote", out1080);
  console.log("Wrote", out480);
  console.log("Wrote", shotPath);
  console.log(
    sawOff && sawRerail
      ? "SUCCESS: derail + re-rail"
      : `PARTIAL: off=${sawOff} rerail=${sawRerail}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
