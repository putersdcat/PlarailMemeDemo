/**
 * Multi-car linked consist + knockable pots — drives shipped train/update APIs.
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
  knockPots,
  threeCarConsistSpec,
  COUPLER_DIST,
} from "../js/train.js";
import {
  createBoard,
  addPiece,
  rebuild,
  loadBoard,
  closestPathPoint,
} from "../js/track.js";
import { UNIT } from "../js/geometry.js";
import {
  TRACK_CATALOG,
  getTrackById,
  loadArntenoughrailsTrack,
  ARNTENOUGHRAILS_LAYOUT,
  loadRealMemeTrack,
} from "../js/presets.js";

test("TRACK_CATALOG exposes arntenoughrails without removing real-meme", () => {
  assert(TRACK_CATALOG.some((t) => t.id === "real-meme"));
  assert(TRACK_CATALOG.some((t) => t.id === "arntenoughrails"));
  const t = getTrackById("arntenoughrails");
  assert(t && typeof t.load === "function");
  assertEq(t.id, "arntenoughrails");
});

test("loadArntenoughrailsTrack yields pieces, pots, solid walls, 3-car consist", () => {
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  assert(info.ok, "load ok");
  assert(info.pieceCount > 0, `pieces ${info.pieceCount}`);
  assert((info.potCount ?? board.pots.length) >= 1, "need pots");
  assert(board.pots.length >= 1);
  assert(info.solidPlayfield === true, "walls intended on");
  assert(info.consist?.length === 3, `consist ${info.consist?.length}`);
  assertEq(info.consist[0].role, "lead");
  assertEq(info.consist[1].role, "mid");
  assertEq(info.consist[2].role, "trail");
  // Layout data present
  assert(ARNTENOUGHRAILS_LAYOUT.pieces.length === info.pieceCount);
});

test("real-meme load still works as single-engine default", () => {
  const board = createBoard();
  const info = loadRealMemeTrack(board);
  assert(info.ok);
  assert(info.pieceCount >= 30);
  assert(!info.consist || info.consist === null);
});

test("three-car placeFollowers keeps non-zero spacing", () => {
  const train = createTrain();
  train.x = 100;
  train.y = 200;
  train.ang = 0;
  ensureConsist(train, threeCarConsistSpec());
  const r = placeFollowers(train, { hard: true });
  assertEq(train.cars.length, 3);
  assert(r.minSpacing > COUPLER_DIST * 0.35, `minSpacing ${r.minSpacing}`);
  assert(r.spacingOk, "spacing ok");
  // Trail is behind mid is behind lead along -x
  assert(train.cars[1].x < train.cars[0].x, "mid behind lead");
  assert(train.cars[2].x < train.cars[1].x, "trail behind mid");
  // Lead mirrors train
  assertEq(train.cars[0].x, train.x);
  assertEq(train.cars[0].y, train.y);
});

test("placeTrainOnPath after ensureConsist seats full coupler spacing (no frames)", () => {
  // Skeptic: catalog load left jackknifed ~56px spacing until updateTrain ran.
  // placeTrainOnPath must hard-trail from lead so idle spacing ≈ COUPLER_DIST.
  const board = createBoard();
  for (let i = 0; i < 4; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  assert(hit, "path hit");

  const train = createTrain();
  // Poison with a prior wrong seat (as if load called ensureConsist before place)
  train.x = 0;
  train.y = 0;
  train.ang = Math.PI / 2;
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec);
  // Deliberately scramble followers (stale poses from old seat)
  train.cars[1].x = train.x + 20;
  train.cars[1].y = train.y + 40;
  train.cars[1].ang = Math.PI;
  train.cars[2].x = train.x - 10;
  train.cars[2].y = train.y + 80;
  train.cars[2].ang = -Math.PI / 2;

  placeTrainOnPath(train, hit, { dir: 1 });
  // NO updateTrain frames — spacing must be correct immediately
  assert(train.cars?.length === 3, "3 cars after place");
  const d01 = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  const d12 = Math.hypot(
    train.cars[1].x - train.cars[2].x,
    train.cars[1].y - train.cars[2].y
  );
  assert(
    Math.abs(d01 - COUPLER_DIST) < COUPLER_DIST * 0.2,
    `lead–mid spacing ${d01} should be near COUPLER_DIST ${COUPLER_DIST}`
  );
  assert(
    Math.abs(d12 - COUPLER_DIST) < COUPLER_DIST * 0.2,
    `mid–trail spacing ${d12} should be near COUPLER_DIST ${COUPLER_DIST}`
  );
  // Not jackknifed: all roughly colinear with lead heading
  const leadAng = train.ang;
  for (let i = 1; i < 3; i++) {
    let da = train.cars[i].ang - leadAng;
    while (da > Math.PI) da -= Math.PI * 2;
    while (da < -Math.PI) da += Math.PI * 2;
    assert(Math.abs(da) < 0.35, `car${i} ang lag ${da} too large (jackknife)`);
  }
});

test("updateTrain moves trailing cars when lead advances on rail", () => {
  const board = createBoard();
  // Long straight for on-rail run
  for (let i = 0; i < 6; i++) {
    addPiece(board, "R01", i * UNIT, 0, 0);
  }
  rebuild(board);
  const hit = closestPathPoint(board, UNIT * 0.5, 0, 40);
  assert(hit, "path hit");

  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train);
  placeTrainOnPath(train, hit, { dir: 1 });
  placeFollowers(train);
  startTrain(train);
  train.speed = 210;

  const trail0 = { x: train.cars[2].x, y: train.cars[2].y };
  const mid0 = { x: train.cars[1].x, y: train.cars[1].y };
  const lead0 = { x: train.x, y: train.y };

  const bounds = { minX: -200, minY: -200, maxX: 2000, maxY: 200 };
  for (let i = 0; i < 90; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: false });
  }

  assertEq(train.mode, TrainMode.ON_RAIL);
  const leadMoved = Math.hypot(train.x - lead0.x, train.y - lead0.y);
  const midMoved = Math.hypot(train.cars[1].x - mid0.x, train.cars[1].y - mid0.y);
  const trailMoved = Math.hypot(
    train.cars[2].x - trail0.x,
    train.cars[2].y - trail0.y
  );
  assert(leadMoved > 40, `lead should advance, moved=${leadMoved}`);
  assert(midMoved > 20, `mid should be pulled, moved=${midMoved}`);
  assert(trailMoved > 20, `trail engine should be pulled, moved=${trailMoved}`);
  // Chain still spaced
  const d01 = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  const d12 = Math.hypot(
    train.cars[1].x - train.cars[2].x,
    train.cars[1].y - train.cars[2].y
  );
  assert(d01 > COUPLER_DIST * 0.3 && d12 > COUPLER_DIST * 0.3, `spacing d01=${d01} d12=${d12}`);
});

test("knockPots marks pot knocked on car overlap via shipped helper", () => {
  const train = createTrain();
  train.x = 0;
  train.y = 0;
  train.ang = 0;
  train.speed = 200;
  ensureConsist(train, threeCarConsistSpec());
  placeFollowers(train);

  const board = createBoard();
  board.pots = [
    {
      id: "p1",
      x: train.x + 5,
      y: train.y,
      r: 20,
      kind: "pot",
      knocked: false,
      vx: 0,
      vy: 0,
      ang: 0,
      spin: 0,
    },
  ];
  const n = knockPots(train, board, 1 / 60);
  assert(n >= 1, `newly knocked ${n}`);
  assert(board.pots[0].knocked === true, "pot.knocked");
  assert(
    Math.hypot(board.pots[0].vx, board.pots[0].vy) > 10,
    "imparted velocity"
  );
});

test("updateTrain knocks pot through full step path", () => {
  const board = createBoard();
  for (let i = 0; i < 4; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  assert(hit);

  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train);
  placeTrainOnPath(train, hit, { dir: 1 });
  startTrain(train);
  train.speed = 220;

  // Place pot ahead of lead on the rail line
  board.pots = [
    {
      id: "dome",
      x: train.x + 80,
      y: train.y,
      r: 24,
      kind: "dome",
      color: "#5aaf3a",
      knocked: false,
      vx: 0,
      vy: 0,
      ang: 0,
      spin: 0,
    },
  ];

  const bounds = { minX: -100, minY: -100, maxX: 1200, maxY: 100 };
  let sawKnock = false;
  for (let i = 0; i < 180; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: false });
    if (board.pots[0].knocked) {
      sawKnock = true;
      break;
    }
  }
  assert(sawKnock, "pot should be knocked by consist via updateTrain");
  assert(train.potHit === true || board.pots[0].knocked, "potHit flag or knocked");
});

test("arntenoughrails layout loadBoard preserves pots", () => {
  const board = createBoard();
  const r = loadBoard(board, ARNTENOUGHRAILS_LAYOUT);
  assert(r.ok);
  assert(r.potCount >= 1);
  assert(board.pots.some((p) => p.kind === "dome" || p.kind === "pot"));
});
