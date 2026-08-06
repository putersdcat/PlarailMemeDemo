import { test, assert, assertEq, assertApprox } from "./assert.mjs";
import {
  createTrain,
  placeTrainOnPath,
  startTrain,
  updateTrain,
  flipTrainDirection,
  hitTestTrain,
  TrainMode,
  modeLabel,
} from "../js/train.js";
import {
  createBoard,
  addPiece,
  loadBoard,
  closestPathPoint,
  rebuild,
} from "../js/track.js";
import { UNIT } from "../js/geometry.js";
import { REAL_MEME_LAYOUT } from "../js/presets.js";

test("modeLabel covers modes", () => {
  assert(modeLabel(TrainMode.ON_RAIL).includes("rail") || modeLabel(TrainMode.ON_RAIL).length > 0);
  assertEq(typeof modeLabel(TrainMode.IDLE), "string");
});

test("place + start on R01 straight stays on rail", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  // closed loop of 8 curves for long run
  for (let i = 0; i < 8; i++) {
    addPiece(board, "R03", 300, 300, i);
  }
  rebuild(board);
  const hit = closestPathPoint(board, 300 + UNIT, 300, 200);
  assert(hit, "path hit");
  const train = createTrain();
  assert(placeTrainOnPath(train, hit, { dir: 1 }));
  assert(startTrain(train));
  assertEq(train.mode, TrainMode.ON_RAIL);
  const bounds = { minX: -500, minY: -500, maxX: 2000, maxY: 2000 };
  for (let i = 0; i < 120; i++) updateTrain(train, board, 1 / 60, bounds);
  // On a full circle should still be on rail
  assertEq(train.mode, TrainMode.ON_RAIL);
});

test("flipTrainDirection reverses dir", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  const hit = closestPathPoint(board, 0, 0, 80);
  const train = createTrain();
  placeTrainOnPath(train, hit, { dir: 1 });
  assertEq(train.dir, 1);
  flipTrainDirection(train, board);
  assertEq(train.dir, -1);
});

test("hitTestTrain detects body", () => {
  const train = createTrain();
  train.x = 50;
  train.y = 50;
  assert(hitTestTrain(train, 50, 50, true));
  assert(!hitTestTrain(train, 50, 50, false));
  assert(!hitTestTrain(train, 500, 500, true));
});

test("WORKING layout loads and train can run on-rail", () => {
  const board = createBoard();
  const r = loadBoard(board, REAL_MEME_LAYOUT);
  assert(r.ok);
  assert(r.pieceCount >= 30, `expected 30+ pieces, got ${r.pieceCount}`);
  const hit = closestPathPoint(board, 528, 653, 120);
  assert(hit, "should find path near train hint");
  const train = createTrain();
  placeTrainOnPath(train, hit, { dir: 1 });
  startTrain(train);
  const bounds = { minX: -500, minY: -500, maxX: 3000, maxY: 3000 };
  let on = 0;
  for (let i = 0; i < 180; i++) {
    updateTrain(train, board, 1 / 60, bounds);
    if (train.mode === TrainMode.ON_RAIL) on++;
  }
  assert(on > 30, `expected significant on-rail time, got ${on}/180`);
});

test("open-ended R01 derails eventually", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  const hit = closestPathPoint(board, 0, 0, 40);
  const train = createTrain();
  placeTrainOnPath(train, hit, { dir: 1 });
  startTrain(train);
  const bounds = { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 };
  for (let i = 0; i < 300; i++) updateTrain(train, board, 1 / 60, bounds);
  assert(
    train.mode === TrainMode.OFF_RAIL || train.mode === TrainMode.STOPPED,
    `expected derail, got ${train.mode}`
  );
});

test("solid playfield walls bounce instead of STOPPED", () => {
  const board = createBoard();
  // No track walls — only the playfield box
  rebuild(board);
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  train.speed = 200;
  train.x = 50;
  train.y = 100;
  train.ang = Math.PI; // head left toward minX
  train.vx = Math.cos(train.ang) * train.speed;
  train.vy = Math.sin(train.ang) * train.speed;
  train.offRailPreferAng = train.ang;
  train.reRailDistLeft = 9999; // don't re-rail
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  for (let i = 0; i < 240; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  assert(
    train.x >= bounds.minX - 1 && train.x <= bounds.maxX + 1,
    `x stayed in box, got ${train.x}`
  );
  assert(
    train.y >= bounds.minY - 1 && train.y <= bounds.maxY + 1,
    `y stayed in box, got ${train.y}`
  );
  // Without solid walls, same setup hits STOPPED at the edge
  const train2 = createTrain();
  train2.mode = TrainMode.OFF_RAIL;
  train2.speed = 200;
  train2.x = 50;
  train2.y = 100;
  train2.ang = Math.PI;
  train2.vx = Math.cos(train2.ang) * train2.speed;
  train2.vy = Math.sin(train2.ang) * train2.speed;
  train2.offRailPreferAng = train2.ang;
  train2.reRailDistLeft = 9999;
  for (let i = 0; i < 240; i++) {
    updateTrain(train2, board, 1 / 60, bounds, { solidPlayfield: false });
    if (train2.mode === TrainMode.STOPPED) break;
  }
  assertEq(train2.mode, TrainMode.STOPPED);
});
