/**
 * Record 1080p + 480p demo loop with tight track framing.
 *
 * Clip content: already-framed start → derail → re-rail → return near start pose.
 * Playwright recordVideo is video-only (Web Audio does not land in the webm);
 * audio limitation is logged to last-record.json and console.
 *
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
import { loopCloseState } from "../js/app/demo-loop.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "recordings");
const docsDir = join(root, "docs");
const baseUrlArg = process.argv[2] || "http://127.0.0.1:8765/";
const WIDTH = 1920;
const HEIGHT = 1080;
/** Safety cap for the whole run */
const MAX_MS = 90_000;
/** After re-rail, ignore start-pose matches for this long (leave the re-rail mouth) */
const POST_RERAIL_GRACE_MS = 2_500;
/** Must get this far from start after re-rail before a return counts (full loop) */
const LOOP_AWAY_DIST = 140;
/** How close (px) to the start pose counts as loop close */
const LOOP_POS_TOL = 40;
/** Optional heading match (radians); loose so we catch either direction */
const LOOP_ANG_TOL = 0.85;
/** Hard minimum on-rails time after re-rail even if already near start */
const POST_RERAIL_MIN_MS = 6_000;
/** World pad around demoCrop for camera fit + screen crop (keep stubs, stay tight) */
const FRAME_PAD = 18;
const FULL_SPEED = 280;
const BUST = `rec=${Date.now()}`;

/**
 * Playwright recordVideo cannot capture Web Audio / page synth.
 * Documented for every run so we never pretend audio is present.
 */
const AUDIO_NOTE =
  "AUDIO: Playwright headless recordVideo is video-only; Web Audio motor/SFX " +
  "are not mixed into the capture. Shipped MP4s are silent by design in this env.";

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
  return { minX: 120, minY: 40, maxX: 960, maxY: 780 };
}

function evenDim(n) {
  const v = Math.max(2, Math.floor(n));
  return v % 2 ? v - 1 : v;
}

async function main() {
  const crop = loadCrop();
  const baseUrl = withBust(baseUrlArg);
  console.log("Recording from", baseUrl, `${WIDTH}x${HEIGHT}`);
  console.log("World crop", crop, "FRAME_PAD", FRAME_PAD);
  console.log(AUDIO_NOTE);

  const browser = await chromium.launch({
    headless: true,
    args: ["--disable-http-cache"],
  });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    deviceScaleFactor: 1,
    storageState: undefined,
    // Video only — no audio stream available from Web Audio via recordVideo
    recordVideo: {
      dir: outDir,
      size: { width: WIDTH, height: HEIGHT },
    },
  });
  const page = await context.newPage();
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
    const bust = Date.now();
    const [trainJs, offRailJs] = await Promise.all([
      fetch(`./js/train.js?${bust}`).then((r) => r.text()),
      fetch(`./js/train/off-rail.js?${bust}`).then((r) => r.text()),
    ]);
    return {
      hasPreferLock: trainJs.includes("offRailPreferAng") || offRailJs.includes("offRailPreferAng"),
      hasDeepestWall: offRailJs.includes("deepestWallHit"),
      hasSlideDir: offRailJs.includes("wallSlideDir"),
      hasFixedDs: trainJs.includes("OFF_RAIL_DS") || offRailJs.includes("OFF_RAIL_DS"),
      hasGetTrainPose: typeof window.__plarailDemo?.getTrainPose === "function",
    };
  });
  console.log("Module check", buildInfo);
  if (!buildInfo.hasPreferLock || !buildInfo.hasDeepestWall || !buildInfo.hasFixedDs) {
    throw new Error("Recording env loaded stale train modules — aborting");
  }
  if (
    !(await page.evaluate(() => typeof window.__plarailDemo?.start === "function"))
  ) {
    throw new Error("__plarailDemo.start missing");
  }

  // The old meme button was removed when built-in layouts moved to the
  // dropdown. Explicitly load the real track so recording does not depend on
  // whatever a stale localStorage layout happened to restore.
  await page.selectOption("#track-select", "real-meme");
  await page.click("#btn-load-track");
  await sleep(600);

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

  // Fit tight to demoCrop so track fills the viewport height as much as possible
  for (let i = 0; i < 2; i++) {
    await page.evaluate(
      ({ c, pad }) => {
        window.__plarailDemo.fitWorldRect(c, pad);
      },
      { c: crop, pad: FRAME_PAD }
    );
    await sleep(280);
  }

  const map = await page.evaluate(
    ({ c, pad }) => {
      const d = window.__plarailDemo;
      d.fitWorldRect(c, pad);
      const v = d.getView();
      const canvas = document.getElementById("stage");
      const r = canvas.getBoundingClientRect();
      // Screen rect of padded world crop (for ffmpeg crop → fill 1080p)
      const x1 = r.x + (c.minX - pad - v.camX) * (v.scale || 1);
      const y1 = r.y + (c.minY - pad - v.camY) * (v.scale || 1);
      const x2 = r.x + (c.maxX + pad - v.camX) * (v.scale || 1);
      const y2 = r.y + (c.maxY + pad - v.camY) * (v.scale || 1);
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

  // Content starts after framing (trim setup pan from export)
  const contentStartMs = Date.now() - videoT0;
  const trimSs = Math.max(0, (contentStartMs - 60) / 1000);
  console.log(
    `Content starts at ~${trimSs.toFixed(2)}s (setup ${contentStartMs}ms)`
  );

  const started = await page.evaluate(() => window.__plarailDemo.start());
  if (!started) throw new Error("Failed to start train via __plarailDemo.start()");
  await sleep(250);

  const startPose = await page.evaluate(() =>
    window.__plarailDemo.getTrainPose?.()
  );
  console.log("Start pose", startPose);

  const runT0 = Date.now();
  let sawOff = false;
  let sawRerail = false;
  let last = "";
  let rerailAt = 0;
  let loopClosed = false;
  let stopReason = "max_ms";
  /** After re-rail, train must leave start before a return counts */
  let sawAwayAfterRerail = false;

  while (Date.now() - runT0 < MAX_MS) {
    const snap = await page.evaluate(() => ({
      mode: window.__plarailDemo?.getMode?.() || "",
      pose: window.__plarailDemo?.getTrainPose?.() || null,
      badge: document.getElementById("mode-badge")?.innerText || "",
    }));
    const mode = snap.mode;
    const label = (snap.badge || mode).trim();
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
      sawAwayAfterRerail = false;
      console.log("→ re-railed; waiting for leave-then-return to start pose");
    }
    if (sawRerail && mode === "on_rail" && snap.pose && startPose) {
      const after = Date.now() - rerailAt;
      const d = Math.hypot(snap.pose.x - startPose.x, snap.pose.y - startPose.y);
      const st = loopCloseState({
        pose: snap.pose,
        start: startPose,
        afterRerailMs: after,
        sawAwayAfterRerail,
        graceMs: POST_RERAIL_GRACE_MS,
        minMs: POST_RERAIL_MIN_MS,
        awayDist: LOOP_AWAY_DIST,
        posTol: LOOP_POS_TOL,
        angTol: LOOP_ANG_TOL,
      });
      if (st.away && !sawAwayAfterRerail) {
        sawAwayAfterRerail = true;
        console.log(`→ left start after re-rail (d=${d.toFixed(0)}px)`);
      }
      sawAwayAfterRerail = st.away;
      if (st.close) {
        loopClosed = true;
        stopReason = "loop_start_pose";
        console.log(
          `→ loop closed near start (d=${d.toFixed(1)}px) after ${(after / 1000).toFixed(1)}s post-rerail`
        );
        await sleep(250);
        break;
      }
    }
    if (mode === "stopped" || /Stopped/i.test(label)) {
      console.warn("Stopped at edge");
      stopReason = "stopped_edge";
      await sleep(800);
      break;
    }
    await sleep(80);
  }

  const runMs = Date.now() - runT0;
  console.log(
    `Run length ${(runMs / 1000).toFixed(1)}s off=${sawOff} rerail=${sawRerail} loop=${loopClosed} reason=${stopReason}`
  );

  const video = page.video();
  await page.close();
  const webmPath = await video.path();
  await context.close();
  await browser.close();
  console.log("Raw:", webmPath);

  // Tight crop of track region → scale into 1920x1080 with beige letterbox
  let cx = Math.max(0, Math.floor(map.x1));
  let cy = Math.max(0, Math.floor(map.y1));
  let cw = Math.min(WIDTH - cx, Math.ceil(map.x2 - map.x1));
  let ch = Math.min(HEIGHT - cy, Math.ceil(map.y2 - map.y1));
  cw = evenDim(cw);
  ch = evenDim(ch);
  // Clamp crop fully inside frame
  if (cx + cw > WIDTH) cx = Math.max(0, WIDTH - cw);
  if (cy + ch > HEIGHT) cy = Math.max(0, HEIGHT - ch);
  console.log("ffmpeg crop", { cx, cy, cw, ch, trimSs });

  const raw1080 = join(outDir, "_raw-1080p.mp4");
  const out1080 = join(outDir, "plarail-meme-demo-1080p.mp4");
  const out480 = join(outDir, "plarail-meme-demo-480p.mp4");
  const shotPath = join(docsDir, "demo-screenshot.jpg");

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

  const vf = `crop=${cw}:${ch}:${cx}:${cy},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0xe8e4dc,setsar=1`;

  runFfmpeg([
    "-ss",
    String(trimSs.toFixed(3)),
    "-i",
    raw1080,
    "-vf",
    vf,
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

  // Screenshot from early on-rails framed frame (same crop as video)
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
    if (Number.isFinite(dur) && dur > 0.5) {
      const stillT = Math.min(1.5, Math.max(0.4, dur * 0.06));
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
      console.log("Screenshot from framed frame @", stillT.toFixed(2), "s");
    }
  } catch (e) {
    console.warn("Screenshot extract failed", e.message);
  }

  for (const p of [webmPath, raw1080]) {
    try {
      unlinkSync(p);
    } catch {
      /* ignore */
    }
  }

  const meta = {
    crop,
    map,
    sawOff,
    sawRerail,
    loopClosed,
    stopReason,
    startPose,
    buildInfo,
    bust: BUST,
    trimSs,
    runMs,
    framePad: FRAME_PAD,
    loopPosTol: LOOP_POS_TOL,
    postRerailGraceMs: POST_RERAIL_GRACE_MS,
    fullSpeed: FULL_SPEED,
    audio: {
      included: false,
      note: AUDIO_NOTE,
    },
    out1080,
    out480,
    shotPath,
  };
  writeFileSync(join(outDir, "last-record.json"), JSON.stringify(meta, null, 2) + "\n");

  console.log("Wrote", out1080);
  console.log("Wrote", out480);
  console.log("Wrote", shotPath);
  console.log(AUDIO_NOTE);
  if (sawOff && sawRerail && loopClosed) {
    console.log("SUCCESS: derail + re-rail + loop-to-start");
  } else if (sawOff && sawRerail) {
    console.log(
      `PARTIAL_LOOP: derail+rerail but stopReason=${stopReason} (clip still usable)`
    );
  } else {
    console.log(`PARTIAL: off=${sawOff} rerail=${sawRerail} loop=${loopClosed}`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
