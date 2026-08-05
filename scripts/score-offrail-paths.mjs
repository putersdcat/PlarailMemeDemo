/**
 * Score off-rail wall-follow across speeds against the center-slider path.
 *
 * 1) Run at OFF_RAIL_REF_SPEED (140) until derail → capture pose + off-rail path.
 * 2) For every speed, teleport to that same derail pose and simulate off-rail only.
 * 3) Score mean nearest-point distance to the reference off-rail polyline.
 *
 * Usage: node scripts/score-offrail-paths.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createBoard, loadBoard, rebuild, closestPathPoint } from "../js/track.js";
import {
  createTrain,
  placeTrainOnPath,
  startTrain,
  updateTrain,
  TrainMode,
  OFF_RAIL_REF_SPEED,
  OFF_RAIL_DS,
} from "../js/train.js";
import { angleDiff } from "../js/geometry.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const layout = JSON.parse(
  readFileSync(join(root, "layouts/real-meme-track.json"), "utf8")
);

const SPEEDS = [60, 100, 140, 180, 220, 280];
const DT = 1 / 60;
const MAX_ON = 60 * 60;
const MAX_OFF = 60 * 45;
const BOUNDS = { minX: -800, minY: -800, maxX: 3000, maxY: 3000 };

function makeBoard() {
  const board = createBoard();
  loadBoard(board, layout);
  rebuild(board);
  return board;
}

function seatFromLayout(train, board) {
  const t = layout.train || { x: 232, y: 546, ang: 0.785 };
  const hit = closestPathPoint(board, t.x, t.y, 120);
  if (!hit) throw new Error("no path near train start");
  let dir = 1;
  if (typeof t.ang === "number") {
    const d1 = angleDiff(t.ang, hit.ang);
    const d2 = angleDiff(t.ang, hit.ang + Math.PI);
    dir = d1 <= d2 ? 1 : -1;
  }
  placeTrainOnPath(train, hit, { dir });
}

/** Drive until first derail; return { train snapshot fields } + path after. */
function runToDerail(board, speed) {
  const train = createTrain();
  seatFromLayout(train, board);
  train.speed = speed;
  startTrain(train);
  for (let i = 0; i < MAX_ON; i++) {
    updateTrain(train, board, DT, BOUNDS);
    if (train.mode === TrainMode.OFF_RAIL) {
      return {
        x: train.x,
        y: train.y,
        ang: train.ang,
        vx: train.vx,
        vy: train.vy,
        prefer: train.offRailPreferAng,
        steps: i,
      };
    }
    if (train.mode === TrainMode.STOPPED) break;
  }
  return null;
}

function runOffRailFrom(board, derail, speed) {
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  train.x = derail.x;
  train.y = derail.y;
  train.ang = derail.ang;
  train.speed = speed;
  train.vx = Math.cos(derail.ang) * speed;
  train.vy = Math.sin(derail.ang) * speed;
  train.offRailPreferAng =
    derail.prefer != null ? derail.prefer : derail.ang;
  train.offRailCarryTenths = 0;
  train.reRailDistLeft = OFF_RAIL_REF_SPEED * 0.45;
  train.reRailCooldown = 0;
  train.pathRef = null;

  const samples = [];
  let sawRerail = false;
  for (let i = 0; i < MAX_OFF; i++) {
    updateTrain(train, board, DT, BOUNDS);
    if (train.mode === TrainMode.OFF_RAIL) {
      samples.push({
        x: train.x,
        y: train.y,
        ang: train.ang,
        t: i * DT,
      });
    } else if (train.mode === TrainMode.ON_RAIL) {
      sawRerail = true;
      break;
    } else if (train.mode === TrainMode.STOPPED) {
      break;
    }
  }
  return { samples, sawRerail, endMode: train.mode };
}

function meanNearestDist(pathA, pathB) {
  if (!pathA.length || !pathB.length) return Infinity;
  let sum = 0;
  for (const p of pathB) {
    let best = Infinity;
    for (let i = 0; i < pathA.length - 1; i++) {
      const a = pathA[i];
      const b = pathA[i + 1];
      const d = distPointSeg(p.x, p.y, a.x, a.y, b.x, b.y);
      if (d < best) best = d;
    }
    if (pathA.length === 1) {
      best = Math.hypot(p.x - pathA[0].x, p.y - pathA[0].y);
    }
    sum += best;
  }
  return sum / pathB.length;
}

function distPointSeg(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((px - x1) * dx + (py - y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pathLen(samples) {
  let L = 0;
  for (let i = 1; i < samples.length; i++) {
    L += Math.hypot(
      samples[i].x - samples[i - 1].x,
      samples[i].y - samples[i - 1].y
    );
  }
  return L;
}

const board = makeBoard();

// Gold derail from center speed (same geometric exit as the good feel)
const derail = runToDerail(board, OFF_RAIL_REF_SPEED);
if (!derail) {
  console.error("Never derailed at ref speed", OFF_RAIL_REF_SPEED);
  process.exit(1);
}
console.log(
  "Derail pose @",
  OFF_RAIL_REF_SPEED,
  "after",
  (derail.steps * DT).toFixed(2),
  "s",
  { x: +derail.x.toFixed(1), y: +derail.y.toFixed(1), ang: +derail.ang.toFixed(3) }
);

const refRun = runOffRailFrom(board, derail, OFF_RAIL_REF_SPEED);
console.log(
  "Ref off-rail len",
  pathLen(refRun.samples).toFixed(1),
  "samples",
  refRun.samples.length,
  "rerail",
  refRun.sawRerail
);

console.log("\n=== Score vs center-speed off-rail path (same derail pose) ===");
console.log("OFF_RAIL_DS =", OFF_RAIL_DS, "px");

const rows = [];
for (const s of SPEEDS) {
  const run = runOffRailFrom(board, derail, s);
  // Compare only shared arc length prefix of ref (fair at low speed / early stop)
  const targetLen = Math.min(pathLen(refRun.samples), pathLen(run.samples));
  const refTrim = trimToLen(refRun.samples, targetLen);
  const runTrim = trimToLen(run.samples, targetLen);
  const mean = meanNearestDist(refTrim, runTrim);
  const row = {
    speed: s,
    sawRerail: run.sawRerail,
    endMode: run.endMode,
    pathLen: +pathLen(run.samples).toFixed(1),
    compareLen: +targetLen.toFixed(1),
    meanDistToRef: +mean.toFixed(2),
    ok: mean < 10, // ~1/4 track width; perfect 0 at ≤140
  };
  rows.push(row);
  console.log(
    `speed ${String(s).padStart(3)}  meanΔ=${mean.toFixed(2).padStart(6)}  len=${String(
      row.pathLen
    ).padStart(7)}  rerail=${String(run.sawRerail).padEnd(5)}  ${
      row.ok ? "OK" : "DRIFT"
    }`
  );
}

function trimToLen(samples, maxLen) {
  if (!samples.length) return samples;
  const out = [samples[0]];
  let L = 0;
  for (let i = 1; i < samples.length; i++) {
    const d = Math.hypot(
      samples[i].x - samples[i - 1].x,
      samples[i].y - samples[i - 1].y
    );
    if (L + d > maxLen) break;
    L += d;
    out.push(samples[i]);
  }
  return out;
}

mkdirSync(join(root, "layouts"), { recursive: true });
writeFileSync(
  join(root, "layouts/offrail-reference.json"),
  JSON.stringify(
    {
      format: "plarail-offrail-reference",
      version: 1,
      refSpeed: OFF_RAIL_REF_SPEED,
      ds: OFF_RAIL_DS,
      derail,
      samples: refRun.samples.map((p) => ({
        x: +p.x.toFixed(3),
        y: +p.y.toFixed(3),
        ang: +p.ang.toFixed(4),
      })),
      scores: rows,
    },
    null,
    2
  ) + "\n"
);
console.log("\nWrote layouts/offrail-reference.json");

const bad = rows.filter((r) => !r.ok);
if (bad.length) {
  console.log("WARNING: speeds still diverge (meanΔ >= 10).");
  process.exitCode = 2;
} else {
  console.log("All speeds track the center-speed off-rail path (meanΔ < 10).");
}
