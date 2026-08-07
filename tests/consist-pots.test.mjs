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
  ensureSingleEngine,
  placeFollowers,
  seatConsistHard,
  threeCarConsistSpec,
  COUPLER_DIST,
  MAX_MID_CARS,
  countMidCars,
  setActiveEngine,
  uncoupleCar,
  tryRecoupleCar,
  snapCarPoseToHit,
  spawnFreeCar,
  tryRerailCar,
  resolveCarCollisions,
  carMinCenterDist,
  TRAIN_LENGTH,
  resetTrainHard,
  clearTrainCars,
  removeCar,
  placeLayoutCars,
  serializeTrainCars,
} from "../js/train.js";
import { carModeSoundEvents } from "../js/sound.js";
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

test("loadArntenoughrailsTrack: pieces, solid walls, 3 separate cars, no pots", () => {
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  assert(info.ok);
  assert(info.pieceCount > 0);
  assert(info.solidPlayfield === true);
  assert(info.northAlign === true);
  // Separate car entities — never a consist template
  assert(!info.consist, "no fake consist template");
  assert(info.cars?.length === 3, "three car entities");
  assertEq(info.cars[0].id, "lead");
  assertEq(info.cars[1].id, "mid1");
  assertEq(info.cars[2].id, "trail1");
  assert(info.cars.every((car) => car.id && car.kind && car.role));
  assertEq(info.cars[0].kind, "engine");
  assertEq(info.cars[1].kind, "mid");
  assertEq(info.cars[2].kind, "engine");
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

test("uncoupleCar splits consist — trail free, not snapped onto mid", () => {
  const train = createTrain();
  train.x = 0;
  train.y = 0;
  train.ang = 0;
  ensureConsist(train, threeCarConsistSpec(), { hard: true });
  placeFollowers(train, { hard: true });
  const mid = train.cars[1];
  const trail = train.cars[2];
  const midId = mid.id;
  const trailId = trail.id;
  const midPos = { x: mid.x, y: mid.y };
  const trailPos = { x: trail.x, y: trail.y };

  assert(uncoupleCar(train, midId));
  assertEq(train.cars.find((c) => c.id === midId).coupled, false);
  // Trail must also uncouple (split) — not stay coupled and hard-hitch onto mid
  assertEq(train.cars.find((c) => c.id === trailId).coupled, false);

  train.x += 80;
  placeFollowers(train, { hard: true });
  const mid2 = train.cars.find((c) => c.id === midId);
  const trail2 = train.cars.find((c) => c.id === trailId);
  // Free cars stay put (not teleported onto each other)
  assert(Math.hypot(mid2.x - midPos.x, mid2.y - midPos.y) < 1e-6, "mid stays");
  assert(
    Math.hypot(trail2.x - trailPos.x, trail2.y - trailPos.y) < 1e-6,
    "trail stays"
  );
  const gap = Math.hypot(mid2.x - trail2.x, mid2.y - trail2.y);
  assert(gap > COUPLER_DIST * 0.5, `mid/trail must not collapse, gap=${gap}`);
});

test("setActiveEngine reverses chain in place (no teleport mid onto rear)", () => {
  const train = createTrain();
  train.x = 0;
  train.y = 0;
  train.ang = 0;
  ensureConsist(train, threeCarConsistSpec(), { hard: true });
  placeFollowers(train, { hard: true });
  const before = train.cars.map((c) => ({
    id: c.id,
    x: c.x,
    y: c.y,
    kind: c.kind,
  }));
  const trailId = train.cars.find((c) => c.facing === -1 || c.role === "trail")
    .id;
  const trailBefore = before.find((c) => c.id === trailId);

  assert(setActiveEngine(train, trailId));
  assertEq(train.poweredId, trailId);
  assert(train.cars[0].id === trailId && train.cars[0].powered);

  // Powered car stays at its former world pose (not a random hitch slot)
  assert(
    Math.hypot(train.x - trailBefore.x, train.y - trailBefore.y) < 2,
    `powered stayed in place, d=${Math.hypot(train.x - trailBefore.x, train.y - trailBefore.y)}`
  );
  // All three cars remain spaced (no overlap after reverse)
  placeFollowers(train, { hard: true });
  for (let i = 1; i < train.cars.length; i++) {
    if (!train.cars[i].coupled) continue;
    const d = Math.hypot(
      train.cars[i].x - train.cars[i - 1].x,
      train.cars[i].y - train.cars[i - 1].y
    );
    assert(
      d > COUPLER_DIST * 0.4 && d < COUPLER_DIST * 1.5,
      `chain spacing after power switch d=${d}`
    );
  }
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

test("rotateSelectionAboutCenter orbits shared center (not independent pivots)", () => {
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

  // Pivots must MOVE in world space (orbit) — independent per-pivot rotate leaves pivots fixed
  const movedA = Math.hypot(pivA1.x - pivA0.x, pivA1.y - pivA0.y);
  const movedB = Math.hypot(pivB1.x - pivB0.x, pivB1.y - pivB0.y);
  assert(movedA > UNIT * 0.3, `A pivot must orbit, moved=${movedA}`);
  assert(movedB > UNIT * 0.3, `B pivot must orbit, moved=${movedB}`);

  // Distances to original shared center preserved (rigid body about centroid)
  assert(
    Math.abs(Math.hypot(pivA1.x - cx0, pivA1.y - cy0) - dA0) < 1.5,
    "A distance to group center"
  );
  assert(
    Math.abs(Math.hypot(pivB1.x - cx0, pivB1.y - cy0) - dB0) < 1.5,
    "B distance to group center"
  );
  // 90° orbit: A was left of center → should be roughly above/below after +90°
  // (deltaSteps=2 → +90° CCW in standard math if y-down still rotates same)
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
  assert(!info.cars?.length);
});

test("seatConsistHard after whip angles restores full coupler spacing", () => {
  // Skeptic: hard:true was ignored for off-rail cars (whip path first) → pile-up.
  const train = createTrain();
  train.x = 100;
  train.y = 100;
  train.ang = 0;
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec, { hard: true });
  placeFollowers(train, { hard: true });
  // Simulate trailer-whipped pose after leaveRails (mid/trail facing ~90°)
  train.cars[1].mode = TrainMode.OFF_RAIL;
  train.cars[1].ang = Math.PI / 2;
  train.cars[1].x = 100;
  train.cars[1].y = 160;
  train.cars[2].mode = TrainMode.OFF_RAIL;
  train.cars[2].ang = Math.PI / 2;
  train.cars[2].x = 100;
  train.cars[2].y = 220;
  train.mode = TrainMode.ON_RAIL;
  train.cars[0].mode = TrainMode.ON_RAIL;
  train.cars[0].x = 100;
  train.cars[0].y = 100;
  train.cars[0].ang = 0;

  seatConsistHard(train);
  const d01 = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  const d12 = Math.hypot(
    train.cars[1].x - train.cars[2].x,
    train.cars[1].y - train.cars[2].y
  );
  assert(
    d01 >= COUPLER_DIST * 0.75,
    `mid piled after hard seat d01=${d01} want ~${COUPLER_DIST}`
  );
  assert(
    d12 >= COUPLER_DIST * 0.75,
    `trail piled after hard seat d12=${d12} want ~${COUPLER_DIST}`
  );
  assert(Math.abs(d01 - COUPLER_DIST) < 2, `d01 exact hitch ${d01}`);
  assert(Math.abs(d12 - COUPLER_DIST) < 2, `d12 exact hitch ${d12}`);
});

test("re-rail with whipped mid/trail keeps full spacing (shipped updateTrain)", () => {
  const board = createBoard();
  for (let i = 0; i < 4; i++) addPiece(board, "R01", i * UNIT, 100, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT * 1.5, 100, 40);
  assert(hit);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  // leaveRails-style whip: cars off, mid/trail at ~90°
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  for (const c of train.cars) {
    c.mode = TrainMode.OFF_RAIL;
    c.pathRef = null;
  }
  train.cars[1].ang = Math.PI / 2;
  train.cars[1].x = train.x;
  train.cars[1].y = train.y + 80;
  train.cars[2].ang = Math.PI / 2;
  train.cars[2].x = train.x;
  train.cars[2].y = train.y + 160;
  // Put lead on path for re-rail
  train.x = hit.x;
  train.y = hit.y;
  train.ang = hit.ang;
  train.vx = Math.cos(hit.ang) * 50;
  train.vy = Math.sin(hit.ang) * 50;
  train.speed = 180;
  train.reRailDistLeft = 0;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.offRailPreferAng = hit.ang;
  const bounds = { minX: 0, minY: 0, maxX: 900, maxY: 500 };
  let ok = false;
  for (let i = 0; i < 100; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode === TrainMode.ON_RAIL) {
      const d01 = Math.hypot(
        train.cars[0].x - train.cars[1].x,
        train.cars[0].y - train.cars[1].y
      );
      const d12 = Math.hypot(
        train.cars[1].x - train.cars[2].x,
        train.cars[1].y - train.cars[2].y
      );
      assert(
        d01 >= COUPLER_DIST * 0.75,
        `re-rail frame mid pile d01=${d01}`
      );
      assert(
        d12 >= COUPLER_DIST * 0.75,
        `re-rail frame trail pile d12=${d12}`
      );
      // Followers still off_rail entities
      assertEq(train.cars[1].mode, TrainMode.OFF_RAIL);
      assertEq(train.cars[2].mode, TrainMode.OFF_RAIL);
      ok = true;
      break;
    }
  }
  assert(ok, "lead should re-rail");
});

test("re-rail hard-seats multi-car without pile-up on lead", () => {
  // Near wall/mouth, path walk can fail; re-rail must use full hitch length.
  const board = createBoard();
  for (let i = 0; i < 3; i++) addPiece(board, "R01", i * UNIT, 80, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 80, 40);
  assert(hit);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  // Simulate off-rail near the rail then re-rail via updateTrain
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.vx = 0;
  train.vy = 0;
  train.ang = hit.ang;
  train.x = hit.x;
  train.y = hit.y;
  train.speed = 180;
  train.reRailDistLeft = 0;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.offRailPreferAng = hit.ang;
  train.vx = Math.cos(hit.ang) * 80;
  train.vy = Math.sin(hit.ang) * 80;
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 400 };
  let rerailed = false;
  for (let i = 0; i < 90; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode === TrainMode.ON_RAIL) {
      rerailed = true;
      const d01 = Math.hypot(
        train.cars[0].x - train.cars[1].x,
        train.cars[0].y - train.cars[1].y
      );
      const d12 = Math.hypot(
        train.cars[1].x - train.cars[2].x,
        train.cars[1].y - train.cars[2].y
      );
      assert(
        d01 > COUPLER_DIST * 0.75,
        `mid piled on lead after re-rail d01=${d01}`
      );
      assert(
        d12 > COUPLER_DIST * 0.75,
        `trail piled on mid after re-rail d12=${d12}`
      );
      break;
    }
  }
  assert(rerailed, "expected re-rail onto track");
});

test("engine place alone does not auto-append mid+trail", () => {
  const board = createBoard();
  for (let i = 0; i < 3; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  const train = createTrain();
  // Leftover layout template must not force a 3-car turd on bare engine place
  train.consistSpec = threeCarConsistSpec();
  train.cars = null;
  placeTrainOnPath(train, hit, { dir: 1, hardReset: false, board });
  assertEq(train.cars.length, 1);
  assertEq(train.cars[0].kind, "engine");
  assert(!train.consistSpec, "consistSpec cleared for single engine");
});

test("resetTrainHard clears cars and consistSpec (no multi rebuild)", () => {
  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec, { hard: true });
  assertEq(train.cars.length, 3);
  resetTrainHard(train);
  assert(!train.cars || train.cars.length === 0, "cars cleared");
  assert(!train.consistSpec, "consistSpec cleared — no layout re-spawn");
});

test("delete/removeCar strips unit; last car clears train", () => {
  const train = createTrain();
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec, { hard: true });
  const midId = train.cars[1].id;
  const r1 = removeCar(train, midId);
  assert(r1.removed && !r1.cleared);
  assertEq(train.cars.length, 2);
  assert(!train.consistSpec);
  // Remove remaining including lead
  removeCar(train, train.cars[1].id);
  const r2 = removeCar(train, train.cars[0].id);
  assert(r2.cleared);
  assert(!train.cars);
});

test("build train one car at a time: engine then mids then trail", () => {
  const board = createBoard();
  for (let i = 0; i < 8; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT * 3, 0, 40);
  const train = createTrain();
  // Simulate leftover layout + user reset
  train.consistSpec = threeCarConsistSpec();
  resetTrainHard(train);
  assert(!train.consistSpec);
  // Place engine only
  placeTrainOnPath(train, hit, { dir: 1, hardReset: false, board });
  assertEq(train.cars.length, 1);
  assertEq(train.cars[0].kind, "engine");
  // Add mids one by one at the live chain tail hitch
  for (let m = 0; m < MAX_MID_CARS; m++) {
    const chain = train.cars.filter(
      (c, i, arr) =>
        i === 0 ||
        (arr[i - 1] &&
          (arr[i - 1].powered || arr[i - 1].coupled) &&
          c.coupled !== false)
    );
    // powered chain via getPoweredChain semantics: all coupled after lead
    const tail = train.cars.filter((c) => c.coupled || c.powered).slice(-1)[0];
    const x = tail.x - Math.cos(tail.ang) * COUPLER_DIST;
    const y = tail.y - Math.sin(tail.ang) * COUPLER_DIST;
    const mid = spawnFreeCar(train, "mid", x, y, tail.ang);
    assert(mid, `mid ${m + 1}`);
    mid.ang = tail.ang;
    mid.x = x;
    mid.y = y;
    mid.mode = TrainMode.ON_RAIL;
    mid.coupled = false;
    assert(tryRecoupleCar(train, mid.id), `mid ${m + 1} should couple`);
    placeFollowers(train, { hard: true });
  }
  assertEq(countMidCars(train), MAX_MID_CARS);
  assertEq(spawnFreeCar(train, "mid", 0, 0, 0), null);
  // Trail engine at chain tail
  const tail = train.cars.filter((c) => c.coupled || c.powered).slice(-1)[0];
  const tx = tail.x - Math.cos(tail.ang) * COUPLER_DIST;
  const ty = tail.y - Math.sin(tail.ang) * COUPLER_DIST;
  const trail = spawnFreeCar(train, "engine", tx, ty, tail.ang);
  assert(trail);
  trail.x = tx;
  trail.y = ty;
  trail.ang = tail.ang;
  trail.mode = TrainMode.ON_RAIL;
  trail.coupled = false;
  trail.powered = false;
  assert(tryRecoupleCar(train, trail.id), "trail engine couples");
  assertEq(train.cars.length, 1 + MAX_MID_CARS + 1);
  assert(!train.consistSpec);
});

test("mid cars capped at three; fourth spawn blocked", () => {
  const train = createTrain();
  ensureSingleEngine(train);
  for (let i = 0; i < MAX_MID_CARS; i++) {
    const c = spawnFreeCar(train, "mid", i * 50, 0, 0);
    assert(c, `mid ${i + 1} should spawn`);
  }
  assertEq(countMidCars(train), MAX_MID_CARS);
  const blocked = spawnFreeCar(train, "mid", 200, 0, 0);
  assertEq(blocked, null);
  assertEq(countMidCars(train), MAX_MID_CARS);
});

test("on-rail coupler length matches off-rail hard hitch", () => {
  const board = createBoard();
  for (let i = 0; i < 6; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  placeFollowers(train, { hard: true, onRail: true, board });
  const onD = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  seatConsistHard(train);
  const offD = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  assert(
    Math.abs(onD - offD) < 4,
    `on-rail ${onD} vs off-rail hitch ${offD} should match`
  );
  assert(Math.abs(offD - COUPLER_DIST) < 2, `hitch ${offD} vs COUPLER ${COUPLER_DIST}`);
});

test("lead re-rail leaves off-rail followers off-rail until they re-rail", () => {
  const board = createBoard();
  for (let i = 0; i < 4; i++) addPiece(board, "R01", i * UNIT, 100, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 100, 40);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  startTrain(train);
  train.speed = 200;
  // Derail whole train
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  for (const c of train.cars) {
    c.mode = TrainMode.OFF_RAIL;
    c.pathRef = null;
  }
  train.vx = 0;
  train.vy = 0;
  train.reRailDistLeft = 0;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.offRailPreferAng = 0;
  // Put lead on path, leave mid far off path so only lead re-rails
  train.x = hit.x;
  train.y = hit.y;
  train.ang = hit.ang;
  train.vx = Math.cos(hit.ang) * 60;
  train.vy = Math.sin(hit.ang) * 60;
  train.cars[1].x = hit.x;
  train.cars[1].y = hit.y + 200; // far from rails
  train.cars[1].mode = TrainMode.OFF_RAIL;
  train.cars[2].x = hit.x;
  train.cars[2].y = hit.y + 280;
  train.cars[2].mode = TrainMode.OFF_RAIL;

  const bounds = { minX: 0, minY: 0, maxX: 900, maxY: 500 };
  let leadOn = false;
  for (let i = 0; i < 100; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode === TrainMode.ON_RAIL) {
      leadOn = true;
      // Immediately after lead re-rails, followers must still be off_rail
      assertEq(train.cars[0].mode, TrainMode.ON_RAIL);
      assert(
        train.cars[1].mode === TrainMode.OFF_RAIL,
        `mid should stay off_rail, got ${train.cars[1].mode}`
      );
      assert(
        train.cars[2].mode === TrainMode.OFF_RAIL,
        `trail should stay off_rail, got ${train.cars[2].mode}`
      );
      break;
    }
  }
  assert(leadOn, "lead should re-rail");
});

test("after lead re-rail, mid and trail each become on_rail with full spacing", () => {
  // Skeptic: followers must not stay permanent hitch-turds — each re-rails itself.
  const board = createBoard();
  // Long straight so trail hitch seat eventually sits over path
  for (let i = 0; i < 10; i++) addPiece(board, "R01", i * UNIT, 100, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT * 4, 100, 40);
  assert(hit);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  startTrain(train);
  train.speed = 220;
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  for (const c of train.cars) {
    c.mode = TrainMode.OFF_RAIL;
    c.pathRef = null;
  }
  train.cars[1].ang = Math.PI / 2;
  train.cars[1].x = train.x;
  train.cars[1].y = train.y + 80;
  train.cars[2].ang = Math.PI / 2;
  train.cars[2].x = train.x;
  train.cars[2].y = train.y + 160;
  train.x = hit.x;
  train.y = hit.y;
  train.ang = hit.ang;
  train.vx = Math.cos(hit.ang) * 80;
  train.vy = Math.sin(hit.ang) * 80;
  train.reRailDistLeft = 0;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.offRailPreferAng = hit.ang;

  const bounds = { minX: -200, minY: 0, maxX: 1200, maxY: 500 };
  let sawLeadOn = false;
  let midOn = false;
  let trailOn = false;
  for (let i = 0; i < 240; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode === TrainMode.ON_RAIL) sawLeadOn = true;
    if (train.cars[1].mode === TrainMode.ON_RAIL) midOn = true;
    if (train.cars[2].mode === TrainMode.ON_RAIL) trailOn = true;
    if (sawLeadOn && midOn && trailOn) {
      const d01 = Math.hypot(
        train.cars[0].x - train.cars[1].x,
        train.cars[0].y - train.cars[1].y
      );
      const d12 = Math.hypot(
        train.cars[1].x - train.cars[2].x,
        train.cars[1].y - train.cars[2].y
      );
      assert(
        d01 >= COUPLER_DIST * 0.75,
        `mid piled after individual re-rail d01=${d01}`
      );
      assert(
        d12 >= COUPLER_DIST * 0.75,
        `trail piled after individual re-rail d12=${d12}`
      );
      break;
    }
  }
  assert(sawLeadOn, "lead should re-rail");
  assert(midOn, "mid should re-rail as its own entity within N frames");
  assert(trailOn, "trail should re-rail as its own entity within N frames");
  assertEq(train.cars[0].mode, TrainMode.ON_RAIL);
  assertEq(train.cars[1].mode, TrainMode.ON_RAIL);
  assertEq(train.cars[2].mode, TrainMode.ON_RAIL);
});

test("placeTrainOnPath re-seat preserves uncouple and active engine", () => {
  // Skeptic: placeTrainOnPath nulling cars + ensureConsist undid uncouple/power.
  const board = createBoard();
  for (let i = 0; i < 5; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, UNIT, 0, 40);
  assert(hit);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), null, { seatHit: hit, dir: 1 });
  assertEq(train.cars.length, 3);
  const midId = train.cars[1].id;
  const trailId = train.cars[2].id;
  const trailX = train.cars[2].x;

  assert(uncoupleCar(train, midId));
  assertEq(train.cars.find((c) => c.id === midId).coupled, false);
  assertEq(train.cars.find((c) => c.id === trailId).coupled, false);

  // Re-seat powered engine further down the rail
  const hit2 = closestPathPoint(board, UNIT * 2.5, 0, 40);
  assert(hit2);
  placeTrainOnPath(train, hit2, { dir: 1, keepDir: true });
  // Free cars must still exist and stay free — not rebuilt from consistSpec
  assert(train.cars.some((c) => c.id === midId), "mid car id preserved");
  assert(train.cars.some((c) => c.id === trailId), "trail car id preserved");
  assertEq(train.cars.find((c) => c.id === midId).coupled, false);
  assertEq(train.cars.find((c) => c.id === trailId).coupled, false);

  // Power switch then re-seat must keep poweredId
  // First recouple for a full chain, then switch power
  train.cars.forEach((c) => {
    c.coupled = true;
  });
  placeFollowers(train, { hard: true });
  assert(setActiveEngine(train, trailId));
  assertEq(train.poweredId, trailId);
  const hit3 = closestPathPoint(board, UNIT * 3, 0, 40);
  placeTrainOnPath(train, hit3, { dir: 1, keepDir: true });
  assertEq(train.poweredId, trailId);
  assert(train.cars.find((c) => c.id === trailId).powered);
});

test("on-rail multi-car followers stay on path through curves (no fly-off)", () => {
  // Bug: chord hitch put mid/trail off the outside of bends when lead pulled.
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  assert(info.ok);
  const hit = closestPathPoint(board, info.trainHint.x, info.trainHint.y, 160);
  assert(hit);
  const train = createTrain();
  placeLayoutCars(train, info.cars, board, { seatHit: hit, dir: 1 });
  startTrain(train);
  train.speed = 200;
  const bounds = { minX: -200, minY: -200, maxX: 1400, maxY: 1000 };
  let maxOff = 0;
  for (let i = 0; i < 240; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode !== TrainMode.ON_RAIL) break;
    for (const c of train.cars) {
      const near = closestPathPoint(board, c.x, c.y, 80);
      const d = near ? near.dist : 999;
      if (d > maxOff) maxOff = d;
    }
  }
  assert(
    maxOff < 12,
    `followers flew off rails maxPathDist=${maxOff.toFixed(2)}`
  );
  assertEq(train.cars[1].mode, TrainMode.ON_RAIL);
  assertEq(train.cars[2].mode, TrainMode.ON_RAIL);
});

test("layout multi-car seats mid/trail on path not straight off-track", () => {
  // placeLayoutCars: three separate entities on path, coupled — no consistSpec
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  assert(info.ok);
  assert(info.cars?.length >= 3);
  assert(!info.consist);
  const train = createTrain();
  const hint = info.trainHint;
  const hit = closestPathPoint(board, hint.x, hint.y, 160);
  assert(hit);
  placeLayoutCars(train, info.cars, board, { seatHit: hit, dir: 1 });
  assertEq(train.cars.length, 3);
  assert(!train.consistSpec, "no template after placeLayoutCars");
  // Distinct ids / entities
  const ids = new Set(train.cars.map((c) => c.id));
  assertEq(ids.size, 3);
  assert(train.cars[0].powered);
  assert(train.cars[1].coupled);
  assert(train.cars[2].coupled);
  for (let i = 0; i < train.cars.length; i++) {
    const c = train.cars[i];
    const near = closestPathPoint(board, c.x, c.y, 64);
    assert(near, `car ${i} has no nearby path`);
    assert(
      near.dist < 18,
      `car ${i} off track pathDist=${near.dist.toFixed(1)} (straight hitch spawn)`
    );
    assertEq(c.mode, TrainMode.ON_RAIL);
  }
  const d01 = Math.hypot(
    train.cars[0].x - train.cars[1].x,
    train.cars[0].y - train.cars[1].y
  );
  assert(
    d01 >= COUPLER_DIST * 0.7 && d01 <= COUPLER_DIST * 1.35,
    `mid spacing d01=${d01} want ~${COUPLER_DIST}`
  );
  // Serialize round-trip is per-car, not a consist template
  const ser = serializeTrainCars(train);
  assertEq(ser.length, 3);
  assert(ser.every((c) => c.kind));
  assert(!ser.consist);
});

test("carModeSoundEvents: each car thumps off and taps on", () => {
  const cars = [
    { id: "lead", mode: TrainMode.ON_RAIL },
    { id: "mid", mode: TrainMode.ON_RAIL },
    { id: "trail", mode: TrainMode.ON_RAIL },
  ];
  let mem = {};
  let r = carModeSoundEvents(cars, mem);
  // seed prev
  mem = r.carModes;
  cars[0].mode = TrainMode.OFF_RAIL;
  cars[1].mode = TrainMode.OFF_RAIL;
  r = carModeSoundEvents(cars, mem);
  const derails = r.events.filter((e) => e.kind === "derail");
  assertEq(derails.length, 2);
  assert(derails.some((e) => e.id === "lead"));
  assert(derails.some((e) => e.id === "mid"));
  mem = r.carModes;
  cars[1].mode = TrainMode.ON_RAIL;
  cars[2].mode = TrainMode.OFF_RAIL;
  r = carModeSoundEvents(cars, mem);
  const taps = r.events.filter((e) => e.kind === "rerail");
  const moreThumps = r.events.filter((e) => e.kind === "derail");
  assertEq(taps.length, 1);
  assertEq(taps[0].id, "mid");
  assertEq(moreThumps.length, 1);
  assertEq(moreThumps[0].id, "trail");
});

test("solid car bodies: overlapping free cars separate (no stack)", () => {
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  ensureSingleEngine(train);
  const mid = spawnFreeCar(train, "mid", 100, 100, 0);
  const mid2 = spawnFreeCar(train, "mid", 100, 100, 0); // stacked on mid
  assert(mid && mid2);
  mid.coupled = false;
  mid2.coupled = false;
  mid.mode = TrainMode.OFF_RAIL;
  mid2.mode = TrainMode.OFF_RAIL;
  // Lead far away so it does not interfere
  train.cars[0].x = 500;
  train.cars[0].y = 500;
  train.cars[0].powered = true;
  train.mode = TrainMode.OFF_RAIL;

  const before = Math.hypot(mid.x - mid2.x, mid.y - mid2.y);
  assert(before < 1, `start stacked d=${before}`);
  const res = resolveCarCollisions(train);
  assert(res.separated > 0, "expected separation steps");
  const after = Math.hypot(mid.x - mid2.x, mid.y - mid2.y);
  const need = carMinCenterDist(mid, mid2);
  assert(
    after >= need * 0.98,
    `cars still overlap after resolve d=${after} need>=${need}`
  );
  assert(after > TRAIN_LENGTH * 0.5, `separated too little d=${after}`);
});

test("hard-hitched consist centers stay outside solid body overlap", () => {
  const train = createTrain();
  train.x = 200;
  train.y = 100;
  train.ang = 0;
  train.consistSpec = threeCarConsistSpec();
  ensureConsist(train, train.consistSpec, { hard: true });
  placeFollowers(train, { hard: true });
  resolveCarCollisions(train);
  for (let i = 1; i < train.cars.length; i++) {
    const a = train.cars[i - 1];
    const b = train.cars[i];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const minD = carMinCenterDist(a, b);
    assert(d + 0.5 >= minD, `coupled overlap d=${d} min=${minD}`);
    assert(
      Math.abs(d - COUPLER_DIST) < 4,
      `hitch spacing broken d=${d} COUPLER=${COUPLER_DIST}`
    );
  }
});

test("updateTrain separates stacked free cars via shipped path", () => {
  const board = createBoard();
  for (let i = 0; i < 3; i++) addPiece(board, "R01", i * UNIT, 0, 0);
  rebuild(board);
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  train.speed = 0;
  train.vx = 0;
  train.vy = 0;
  ensureSingleEngine(train);
  train.cars[0].x = 400;
  train.cars[0].y = 200;
  train.cars[0].mode = TrainMode.OFF_RAIL;
  // Stack far from track so re-rail/AABB noise does not dominate
  const a = spawnFreeCar(train, "mid", 300, 300, 0);
  const b = spawnFreeCar(train, "mid", 302, 300, 0);
  a.coupled = false;
  b.coupled = false;
  a.mode = TrainMode.OFF_RAIL;
  b.mode = TrainMode.OFF_RAIL;
  a.ang = 0;
  b.ang = 0;
  a.vx = 0;
  a.vy = 0;
  b.vx = 0;
  b.vy = 0;
  const bounds = { minX: 0, minY: 0, maxX: 800, maxY: 600 };
  for (let i = 0; i < 8; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  const need = carMinCenterDist(a, b);
  assert(
    d + 1 >= need * 0.95,
    `stacked free cars not solid after updateTrain d=${d} need=${need}`
  );
  // Must have left the stacked ~2px start
  assert(d > 40, `barely moved apart d=${d}`);
});
