/**
 * Record 1080p demo (cleaned track, framed to demo crop), then 480p loop.
 * Always cache-busts so wall-follow / layout fixes are in the capture.
 * Usage: node scripts/record-demo.mjs [baseUrl]
 */
import { chromium } from "playwright";
import {
  mkdirSync,
  unlinkSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "recordings");
const baseUrlArg = process.argv[2] || "http://127.0.0.1:8765/";
const WIDTH = 1920;
const HEIGHT = 1080;
const MAX_MS = 90_000;
const POST_RERAIL_MS = 2800;
const BUST = `rec=${Date.now()}`;

mkdirSync(outDir, { recursive: true });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function withBust(url) {
  const u = new URL(url);
  u.searchParams.set("rec", String(Date.now()));
  // force entry module cache bust via index already has ?v= ; add extra
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
    // avoid reusing any browser profile cache
    args: ["--disable-http-cache"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    // fresh storage each run
    storageState: undefined,
    recordVideo: {
      dir: outDir,
      size: { width: WIDTH, height: HEIGHT },
    },
  });
  const page = await context.newPage();

  // Disable HTTP cache at CDP level (module graphs without ?v=)
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });

  // Blow out any local autosave so only the cleaned default loads
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {
      /* ignore */
    }
  });

  // Hard reload with cache disabled so train.js wall fix is guaranteed
  await page.reload({ waitUntil: "networkidle" });

  // Verify physics module is the fixed one
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
  await sleep(500);

  // Full speed for demo capture (max slider = 280)
  const FULL_SPEED = 280;
  await page.evaluate((sp) => {
    const d = window.__plarailDemo;
    d.setSidebarCollapsed(true);
    d.setRecordChrome(true);
    // apply full speed via slider + train
    const slider = document.getElementById("speed");
    if (slider) {
      slider.value = String(sp);
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, FULL_SPEED);
  await sleep(350);
  await page.evaluate((c) => {
    window.__plarailDemo.fitWorldRect(c, 8);
  }, crop);
  await sleep(200);

  const map = await page.evaluate((c) => {
    const d = window.__plarailDemo;
    d.fitWorldRect(c, 8);
    const v = d.getView();
    const canvas = document.getElementById("stage");
    const r = canvas.getBoundingClientRect();
    const x1 = r.x + (c.minX - v.camX);
    const y1 = r.y + (c.minY - v.camY);
    const x2 = r.x + (c.maxX - v.camX);
    const y2 = r.y + (c.maxY - v.camY);
    return {
      x1,
      y1,
      x2,
      y2,
      view: v,
      canvas: { x: r.x, y: r.y, w: r.width, h: r.height },
      speed: window.__plarailDemo.getView && undefined,
    };
  }, crop);
  const recSpeed = await page.evaluate(() => {
    // train speed not exposed — read slider
    return Number(document.getElementById("speed")?.value || 0);
  });
  console.log("Screen map", map, "record speed", recSpeed);

  const started = await page.evaluate(() => window.__plarailDemo.start());
  if (!started) throw new Error("Failed to start train via __plarailDemo.start()");
  await sleep(250);

  const t0 = Date.now();
  let sawOff = false;
  let sawRerail = false;
  let last = "";

  while (Date.now() - t0 < MAX_MS) {
    const mode = await page.evaluate(
      () => window.__plarailDemo?.getMode?.() || ""
    );
    const badge = (
      await page.locator("#mode-badge").innerText().catch(() => mode)
    ).trim();
    const label = badge || mode;
    if (label !== last) {
      console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);
      last = label;
    }
    if (!sawOff && (mode === "off_rail" || /Off rails/i.test(label))) {
      sawOff = true;
      console.log("→ derailed");
    }
    if (sawOff && (mode === "on_rail" || /On rails/i.test(label))) {
      sawRerail = true;
      console.log("→ re-railed");
      break;
    }
    if (mode === "stopped" || /Stopped/i.test(label)) {
      console.warn("Stopped at edge before re-rail");
      await sleep(1200);
      break;
    }
    await sleep(100);
  }

  if (sawRerail) await sleep(POST_RERAIL_MS);
  else await sleep(1500);

  const video = page.video();
  await page.close();
  const webmPath = await video.path();
  await context.close();
  await browser.close();
  console.log("Raw:", webmPath);

  let cx = Math.max(0, Math.floor(map.x1));
  let cy = Math.max(0, Math.floor(map.y1));
  let cw = Math.min(WIDTH - cx, Math.ceil(map.x2 - map.x1));
  let ch = Math.min(HEIGHT - cy, Math.ceil(map.y2 - map.y1));
  if (cw % 2) cw -= 1;
  if (ch % 2) ch -= 1;
  console.log("ffmpeg crop", { cx, cy, cw, ch });

  const raw1080 = join(outDir, "_raw-1080p.mp4");
  const out1080 = join(outDir, "plarail-meme-demo-1080p.mp4");
  const out480 = join(outDir, "plarail-meme-demo-480p.mp4");

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

  runFfmpeg([
    "-i",
    raw1080,
    "-vf",
    `crop=${cw}:${ch}:${cx}:${cy},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xe8e4dc,setsar=1`,
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

  try {
    unlinkSync(webmPath);
  } catch {
    /* ignore */
  }
  try {
    unlinkSync(raw1080);
  } catch {
    /* ignore */
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
        out1080,
        out480,
      },
      null,
      2
    ) + "\n"
  );

  console.log("Wrote", out1080);
  console.log("Wrote", out480);
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
