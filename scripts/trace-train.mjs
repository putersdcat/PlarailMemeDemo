import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createBoard,
  loadBoard,
  closestPathPoint,
  rebuild,
} from "../js/track.js";
import {
  createView,
  fitBoardToView,
  playfieldBounds,
} from "../js/app/camera.js";
import {
  createTrain,
  placeLayoutCars,
  placeTrainOnPath,
  startTrain,
  updateTrain,
  createTrainTelemetry,
  TrainMode,
} from "../js/train.js";

function arg(name, fallback = null) {
  const prefix = `--${name}=`;
  const value = process.argv.find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : fallback;
}

const layoutFile = arg("layout", "layouts/arntenoughrails.json");
const frameCount = Math.max(1, Number(arg("frames", 900)) || 900);
const outputFile = arg("out");
const verbose = arg("verbose", "false") === "true";
const data = JSON.parse(readFileSync(resolve(layoutFile), "utf8"));
const solidArg = arg("solid");
const solidPlayfield =
  solidArg == null
    ? data.solidPlayfield !== false
    : solidArg !== "false";
const board = createBoard();
const loaded = loadBoard(board, data);
if (!loaded.ok) throw new Error(loaded.error || "Could not load layout");

function legacyCars(consist) {
  return (consist || []).map((spec, index, all) => {
    const kind = spec?.kind || (spec?.role === "mid" ? "mid" : "engine");
    const lead = index === 0;
    const trail =
      spec?.role === "trail" ||
      (!lead && kind === "engine" && index === all.length - 1);
    return {
      ...spec,
      id: spec?.id || (lead ? "lead" : trail ? "trail1" : `mid${index}`),
      role: spec?.role || (lead ? "lead" : trail ? "trail" : "mid"),
      kind,
      powered: lead || !!spec?.powered,
      coupled: lead ? true : spec?.coupled !== false,
      facing: spec?.facing ?? (trail && kind === "engine" ? -1 : 1),
      mode: spec?.mode || "on_rail",
    };
  });
}

const trainData = data.train
  ? {
      ...data.train,
      y: Number.isFinite(data.train.y) ? data.train.y : data.train.y,
    }
  : null;
const alignNorth = !!(data.solidPlayfield || data.northAlign);
if (alignNorth) {
  const minY = Math.min(
    ...board.pathIndex
      .filter((path) => path.active)
      .flatMap((path) => path.points.map((point) => point.y))
  );
  const dy = 36 - minY;
  for (const piece of board.pieces) piece.y += dy;
  rebuild(board);
  if (trainData && Number.isFinite(trainData.y)) trainData.y += dy;
  if (Array.isArray(trainData?.cars)) {
    trainData.cars = trainData.cars.map((car) => ({
      ...car,
      y: Number.isFinite(car?.y) ? car.y + dy : car?.y,
    }));
  }
}

const train = createTrain();
const hint = trainData || { x: 0, y: 0, ang: 0, speed: 210 };
const hit = closestPathPoint(board, hint.x, hint.y, 160);
if (!hit) throw new Error("No rail found near saved train hint");

const dir = 1;
const cars = trainData?.cars?.length
  ? trainData.cars
  : legacyCars(trainData?.consist);
if (cars.length) {
  placeLayoutCars(train, cars, board, {
    seatHit: hit,
    dir,
  });
} else {
  placeTrainOnPath(train, hit, { dir, board });
}
train.speed = Number(trainData?.speed ?? data.speed ?? 210) || 210;
if (!startTrain(train)) throw new Error("Could not start traced train");

// Match the browser’s solid-wall framing so a saved-track trace exercises the
// same rerail pocket instead of an arbitrary oversized fixed rectangle.
const view = createView(1546, 645);
fitBoardToView(view, board, solidPlayfield ? 18 : 48, 96);
const bounds = playfieldBounds(view, 20);

const telemetry = createTrainTelemetry({
  enabled: true,
  maxFrames: frameCount + 2,
  maxEvents: Math.max(100, frameCount * 20),
});
for (let frame = 0; frame < frameCount; frame++) {
  updateTrain(train, board, 1 / 60, bounds, {
    solidPlayfield,
    telemetry,
  });
  if (train.mode === TrainMode.STOPPED) break;
}

const trace = telemetry.snapshot();
const interestingTypes = new Set([
  "rail_exit",
  "leave_rails",
  "path_candidates",
  "path_handoff",
  "lead_rerail",
  "lead_rerail_miss",
  "follower_seat",
  "follower_seat_failed",
  "follower_rerail",
  "follower_rerail_miss",
  "follower_rerail_blocked",
  "follower_rail_preserved",
  "car_rail_exit",
  "offrail_contact",
  "mode_transition",
  "car_mode_transition",
  "car_path_transition",
  "rail_bed_violation",
  "lead_path_pose_divergence",
  "car_path_pose_divergence",
  "playfield_stop",
]);
const interesting = trace.events.filter((event) =>
  interestingTypes.has(event.type)
);
const summary = {
  layout: layoutFile,
  loadedPieces: loaded.pieceCount,
  frames: trace.frames.length,
  finalMode: train.mode,
  finalCars: (train.cars || []).map((car) => ({
    id: car.id,
    mode: car.mode,
    pathKey: car.pathRef
      ? `${car.pathRef.pieceId}:${car.pathRef.pathId}`
      : null,
    x: car.x,
    y: car.y,
  })),
  eventCount: trace.events.length,
  eventCounts: Object.fromEntries(
    [...new Set(interesting.map((event) => event.type))].map((type) => [
      type,
      interesting.filter((event) => event.type === type).length,
    ])
  ),
  firstInteresting: interesting.slice(0, 40),
  lastInteresting: interesting.slice(-40),
  ...(verbose ? { interesting } : {}),
  trace: outputFile ? resolve(outputFile) : null,
};

if (outputFile) writeFileSync(resolve(outputFile), JSON.stringify(trace, null, 2));
console.log(JSON.stringify(summary, null, 2));