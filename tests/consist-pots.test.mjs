/**
 * Multi-car consist UX: reverse trail, separable cars, active engine, no pots.
 */
import { test, assert, assertEq } from "./assert.mjs";
import {
  createTrain,
  updateTrain,
  placeTrainOnPath,
  startTrain,
  TrainMode,
  ensureConsist,
  placeFollowers,
  threeCarConsistSpec,
  COUPLER_DIST,
  setActiveEngine,
  uncoupleCar,
  snapCarPoseToHit,
  spawnFreeCar,
} from "../js/train.js";
import {
  createBoard,
  addPiece,
  rebuild,
  loadBoard,
  closestPathPoint,
  rotateSelectionAboutCenter,
  getPiece,
} from "../js/track.js";
import { UNIT, worldPivot } from "../js/geometry.js";
import {
  TRACK_CATALOG,
  getTrackById,
  loadArntenoughrailsTrack,
  ARNTENOUGHRAILS_LAYOUT,
  loadRealMemeTrack,
} from "../js/presets.js";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("TRACK_CATALOG exposes arntenoughrails without removing real-meme", () => {
  assert(TRACK_CATALOG.some((t) => t.id === "real-meme"));
  assert(TRACK_CATALOG.some((t) => t.id === "arntenoughrails"));
  assertEq(getTrackById("arntenoughrails").id, "arntenoughrails");
});

test("loadArntenoughrailsTrack: pieces, solid walls, 3-car, no pots", () => {
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  assert(info.ok);
  assert(info.pieceCount > 0);
  assert(info.solidPlayfield === true);
  assert(info.northAlign === true);
  assert(info.consist?.length === 3);
  assertEq(info.consist[2].kind, "engine");
  // Pots purged forever
  assert(!board.pots?.length, "board.pots must be empty");
  assert(!("pots" in ARNTENOUGHRAILS_LAYOUT) || !ARNTENOUGHRAILS_LAYOUT.pots?.length);
});

test("layout JSON and embed have no pots/dome keys with data", () => {
  const disk = JSON.parse(
    readFileSync(join(root, "layouts/arntenoughrails.json"), "utf8")
  );
  assert(!disk.pots?.length, "arntenoughrails.json must not ship pots");
  const src = readFileSync(join(root, "js/layouts-arntenoughrails.js"), "utf8");
  assert(!/"pots"\s*:\s*\[/.test(src) || /"pots"\s*:\s*\[\s*\]/.test(src));
  // drawPot purged
  const draw = readFileSync(join(root, "js/render/draw-train.js"), "utf8");
  assert(!draw.includes("drawPot"), "drawPot must be removed");
  const consist = readFileSync(join(root, "js/train/consist.js"), "utf8");
  assert(!consist.includes("knockPots"), "knockPots must be removed");
});

test("trail engine faces reverse relative to lead when coupled", () => {
  const train = createTrain();
  train.x = 100;
  train.y = 200;
  train.ang = 0;
  ensureConsist(train, threeCarConsistSpec(), { hard: true });
  placeFollowers(train, { hard: true });
  assertEq(train.cars.length, 3);
  assertEq(train.cars[0].facing, 1);
  const trail = train.cars.find((c) => c.role === "trail" || c.kind === "engine" && !c.powered);
  assert(trail, "trail engine");
  assertEq(trail.facing, -1);
  // Same travel ang as lead chain, reverse visual facing
  assert(Math.abs(trail.ang - train.cars[0].ang) < 0.2);
});

test("placeTrainOnPath seats full coupler spacing without frames", () => {
  const board = createBoard();
  for (let i = 0; i < 4; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  assert(hit);
  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec);
  train.cars[1].x = 999;
  train.cars[1].y = 999;
  placeTrainOnPath(train, hit, { dir: 1 });
  const d01 = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  assert(Math.abs(d01 - COUPLER_DIST) < COUPLER_DIST * 0.2, `d01=${d01}`);
});

test("updateTrain pulls coupled mid and trail when lead advances", () => {
  const board = createBoard();
  for (let i = 0; i < 6; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT * 0.5, 0, 40);
  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train);
  placeTrainOnPath(train, hit, { dir: 1 });
  placeFollowers(train, { hard: true });
  startTrain(train);
  train.speed = 210;
  const trail0 = { x: train.cars[2].x, y: train.cars[2].y };
  const bounds = { minX: -200, minY: -200, maxX: 2000, maxY: 200 };
  for (let i = 0; i < 90; i++) {
    updateTrain(train, board, 1 / 60, bounds, {});
  }
  assertEq(train.mode, TrainMode.ON_RAIL);
  const trailMoved = Math.hypot(
    train.cars[2].x - trail0.x,
    train.cars[2].y - trail0.y
  );
  assert(trailMoved > 20, `trail moved ${trailMoved}`);
});

test("uncoupleCar separates follower; setActiveEngine switches power", () => {
  const train = createTrain();
  train.x = 0;
  train.y = 0;
  train.ang = 0;
  ensureConsist(train, threeCarConsistSpec(), { hard: true });
  const midId = train.cars[1].id;
  const trailId = train.cars.find((c) => c.kind === "engine" && !c.powered).id;
  assert(uncoupleCar(train, midId));
  assertEq(train.cars.find((c) => c.id === midId).coupled, false);
  // Mid no longer moves with hard place of lead
  const midX = train.cars.find((c) => c.id === midId).x;
  train.x += 50;
  placeFollowers(train, { hard: true });
  assertEq(train.cars.find((c) => c.id === midId).x, midX);

  assert(setActiveEngine(train, trailId));
  assertEq(train.poweredId, trailId);
  assert(train.cars.find((c) => c.id === trailId).powered);
  assert(!train.cars.find((c) => c.id === "lead" || c.role === "lead")?.powered || train.cars[0].id === trailId);
});

test("mid car snapCarPoseToHit seats on path like engine", () => {
  const board = createBoard();
  for (let i = 0; i < 3; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  assert(hit);
  const train = createTrain();
  const car = spawnFreeCar(train, "mid", 0, 0, 0);
  assert(snapCarPoseToHit(car, hit, 1));
  assert(Math.hypot(car.x - hit.x, car.y - hit.y) < 40);
  assert(car.pathRef);
});

test("rotateSelectionAboutCenter keeps relative offsets around shared center", () => {
  const board = createBoard();
  const a = addPiece(board, "R01", 0, 0, 0);
  const b = addPiece(board, "R01", UNIT, 0, 0);
  rebuild(board);
  const pivA0 = worldPivot(a);
  const pivB0 = worldPivot(b);
  const cx0 = (pivA0.x + pivB0.x) / 2;
  const cy0 = (pivA0.y + pivB0.y) / 2;
  const dA0 = Math.hypot(pivA0.x - cx0, pivA0.y - cy0);
  const dB0 = Math.hypot(pivB0.x - cx0, pivB0.y - cy0);

  const r = rotateSelectionAboutCenter(board, [a.id, b.id], 2); // 90°
  assert(r && r.count === 2);
  const a2 = getPiece(board, a.id);
  const b2 = getPiece(board, b.id);
  const pivA1 = worldPivot(a2);
  const pivB1 = worldPivot(b2);
  // Distances to original center preserved (rigid about shared center)
  assert(
    Math.abs(Math.hypot(pivA1.x - cx0, pivA1.y - cy0) - dA0) < 1.5,
    "A distance to group center"
  );
  assert(
    Math.abs(Math.hypot(pivB1.x - cx0, pivB1.y - cy0) - dB0) < 1.5,
    "B distance to group center"
  );
  // Not independent: if each rotated about own pivot, centroids would differ
  // Both rotSteps advanced by 2
  assertEq(a2.rotSteps, 2);
  assertEq(b2.rotSteps, 2);
});

test("multi-car re-rail works near solid wall bounds", () => {
  const board = createBoard();
  // Horizontal rail near top (north) of a tight solid playfield
  for (let i = 0; i < 5; i++) addPiece(board, "R01", 100 + i * UNIT, 70, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 100 + UNIT, 70, 40);
  assert(hit);
  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec, { hard: true });
  placeTrainOnPath(train, hit, { dir: 1 });
  placeFollowers(train, { hard: true });
  // Derail off rail toward wall
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.vx = 0;
  train.vy = -40;
  train.ang = -Math.PI / 2;
  train.speed = 180;
  train.reRailDistLeft = 0;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.offRailPreferAng = -Math.PI / 2;
  // Nudge near the rail again with body close to top wall
  const bounds = { minX: 40, minY: 40, maxX: 700, maxY: 400 };
  train.y = 55;
  train.x = hit.x;
  let on = 0;
  for (let i = 0; i < 180; i++) {
    // aim somewhat along rail
    if (i === 20) {
      train.ang = 0;
      train.vx = 180;
      train.vy = 0;
      train.y = 68;
    }
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode === TrainMode.ON_RAIL) on++;
  }
  assert(
    on > 0 || train.mode === TrainMode.ON_RAIL,
    `expected multi-car re-rail near wall, mode=${train.mode} onFrames=${on}`
  );
  if (train.cars?.length > 1) {
    placeFollowers(train, { hard: true });
    const d = Math.hypot(
      train.cars[0].x - train.cars[1].x,
      train.cars[0].y - train.cars[1].y
    );
    assert(d > COUPLER_DIST * 0.3, `followers seated after re-rail d=${d}`);
  }
});

test("north-aligned layout minY sits near wall margin", () => {
  const board = createBoard();
  loadArntenoughrailsTrack(board);
  // apply same north shift as main does
  let minY = Infinity;
  for (const p of board.pieces) minY = Math.min(minY, p.y);
  // Layout file already north-shifted to ~56; load path may shift again
  assert(minY < 120, `north edge should be high on board, minY=${minY}`);
  assert(minY >= 40, `not above wall margin wildly, minY=${minY}`);
});

test("real-meme still loads as single-engine default", () => {
  const board = createBoard();
  const info = loadRealMemeTrack(board);
  assert(info.ok);
  assert(info.pieceCount >= 30);
  assert(!info.consist);
});
