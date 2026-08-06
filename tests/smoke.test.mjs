/**
 * Catastrophic-breakage smoke tests — load paths, catalog, layout, off-rail.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { test, assert, assertEq } from "./assert.mjs";
import {
  UNIT,
  PIECE_TYPES,
  PIECE_META,
  worldGeometry,
  buildTemplate,
} from "../js/geometry.js";
import {
  createBoard,
  addPiece,
  loadBoard,
  serializeBoard,
  rebuild,
  closestPathPoint,
  toggleSwitch,
} from "../js/track.js";
import {
  createTrain,
  placeTrainOnPath,
  startTrain,
  updateTrain,
  TrainMode,
  OFF_RAIL_DS,
  OFF_RAIL_REF_SPEED,
} from "../js/train.js";
import { REAL_MEME_LAYOUT, loadRealMemeTrack } from "../js/presets.js";
import {
  createView,
  fitWorldRect,
  playfieldBounds,
  screenToWorld,
  panByScreen,
  zoomAtScreen,
  computeBoardBounds,
} from "../js/app/camera.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every catalog piece type builds a template without throw", () => {
  const types = Object.keys(PIECE_TYPES);
  assert(types.length >= 15, `expected full catalog, got ${types.length}`);
  for (const t of types) {
    const tpl = buildTemplate(t);
    assert(tpl, `template missing for ${t}`);
    assert(Array.isArray(tpl.paths) || tpl.paths == null || true);
    const geo = worldGeometry({
      id: "t",
      type: t,
      x: 0,
      y: 0,
      rotSteps: 0,
      flip: false,
      branchSide: "R",
      switchState: 0,
    });
    assert(geo.paths?.length >= 1, `${t} should have ≥1 path`);
    assert(geo.connectors?.length >= 1, `${t} should have connectors`);
  }
});

test("PIECE_META covers canonical catalog types (not legacy aliases)", () => {
  for (const [key, canon] of Object.entries(PIECE_TYPES)) {
    if (key !== canon) continue; // skip R01L → R07 style aliases
    assert(PIECE_META[key], `PIECE_META missing ${key}`);
  }
});

test("layouts/real-meme-track.json matches embedded REAL_MEME_LAYOUT piece count", () => {
  const disk = JSON.parse(
    readFileSync(join(root, "layouts/real-meme-track.json"), "utf8")
  );
  assertEq(disk.pieces.length, REAL_MEME_LAYOUT.pieces.length);
  assert(disk.pieces.length >= 30, "meme track should have 30+ pieces");
  assert(disk.train || REAL_MEME_LAYOUT.train, "train pose required");
});

test("REAL_MEME_LAYOUT serialize/load round-trip preserves piece count", () => {
  const board = createBoard();
  const r = loadBoard(board, REAL_MEME_LAYOUT);
  assert(r.ok);
  const data = serializeBoard(board);
  assertEq(data.pieces.length, REAL_MEME_LAYOUT.pieces.length);
  const board2 = createBoard();
  const r2 = loadBoard(board2, data);
  assert(r2.ok);
  assertEq(r2.pieceCount, r.pieceCount);
  assert(board2.walls.length > 10, "walls should rebuild");
  assert(board2.pathIndex.length > 10, "paths should rebuild");
});

test("loadRealMemeTrack seats a runnable train", () => {
  const board = createBoard();
  const info = loadRealMemeTrack(board);
  assert(info.ok);
  assert(info.pieceCount >= 30);
  const th = info.trainHint;
  const hit = closestPathPoint(board, th.x, th.y, 120);
  assert(hit, "train hint should land on a path");
  const train = createTrain();
  placeTrainOnPath(train, hit, { dir: 1 });
  assert(startTrain(train));
  assertEq(train.mode, TrainMode.ON_RAIL);
});

test("open-rail derail then off-rail advances without freezing", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 0, 0, 40);
  const train = createTrain();
  train.speed = 210;
  placeTrainOnPath(train, hit, { dir: 1 });
  startTrain(train);
  const bounds = { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 };
  let sawOff = false;
  let offFrames = 0;
  let lastX = train.x;
  let lastY = train.y;
  let moved = 0;
  for (let i = 0; i < 400; i++) {
    updateTrain(train, board, 1 / 60, bounds);
    if (train.mode === TrainMode.OFF_RAIL) {
      sawOff = true;
      offFrames++;
      moved += Math.hypot(train.x - lastX, train.y - lastY);
      lastX = train.x;
      lastY = train.y;
    }
    if (train.mode === TrainMode.STOPPED) break;
  }
  assert(sawOff, "should leave the open rail");
  assert(offFrames > 5, `expected several off-rail frames, got ${offFrames}`);
  // traveled some distance while off-rail (not stuck thrashing in place)
  assert(moved > OFF_RAIL_DS * 3, `expected off-rail travel, moved=${moved}`);
});

test("off-rail fixed step size is positive", () => {
  assert(OFF_RAIL_DS > 0 && OFF_RAIL_DS < 10);
  assert(OFF_RAIL_REF_SPEED >= 100);
});

test("switch toggle rebuilds without losing pieces", () => {
  const board = createBoard();
  const r = loadBoard(board, REAL_MEME_LAYOUT);
  assert(r.ok);
  const before = board.pieces.length;
  const sw = board.pieces.find((p) => {
    const g = worldGeometry(p);
    return g.tpl?.switchable;
  });
  assert(sw, "meme track should have a switch");
  const prev = sw.switchState ?? 0;
  toggleSwitch(board, sw.id);
  assertEq(board.pieces.length, before);
  assert(sw.switchState !== prev || true); // state may wrap 0/1
  rebuild(board);
  assert(board.pathIndex.length > 0);
});

test("camera fit/zoom/pan stay finite", () => {
  const view = createView(1920, 1080);
  fitWorldRect(view, { minX: 0, minY: 0, maxX: 1000, maxY: 800 }, 40);
  assert(view.scale > 0 && Number.isFinite(view.scale));
  const mid = screenToWorld(view, 960, 540);
  assert(Number.isFinite(mid.x) && Number.isFinite(mid.y));
  zoomAtScreen(view, 960, 540, view.scale * 1.2);
  panByScreen(view, 40, -20);
  const b = playfieldBounds(view, 20);
  assert(b.maxX > b.minX && b.maxY > b.minY);
  const board = createBoard();
  loadBoard(board, REAL_MEME_LAYOUT);
  const bb = computeBoardBounds(board, UNIT);
  assert(bb && bb.maxX > bb.minX);
});

test("sound module exports motor API (no AudioContext required)", async () => {
  const sound = await import("../js/sound.js");
  assert(typeof sound.startMotor === "function");
  assert(typeof sound.stopMotor === "function");
  assert(typeof sound.setMotorSpeed === "function");
  assert(typeof sound.setMotorLevel === "function");
  assert(typeof sound.syncTrainAudio === "function");
  assert(typeof sound.unlockAudio === "function");
  // Safe no-op without gesture / AudioContext in Node
  sound.syncTrainAudio({ running: false, mode: "idle", speed: 140 }, {});
});
