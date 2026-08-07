import { test, assert, assertEq } from "./assert.mjs";
import {
  createTrain,
  ensureSingleEngine,
  spawnFreeCar,
  tryRerailCar,
  resolveCarCollisions,
  carMinCenterDist,
  placeLayoutCars,
  serializeTrainCars,
  restoreTrainSnapshot,
  railPoseClear,
  createTrainTelemetry,
  startTrain,
  stopTrain,
  updateTrain,
  TrainMode,
  threeCarConsistSpec,
  threeMiddleConsistSpec,
  COUPLER_DIST,
} from "../js/train.js";
import { createBoard, addPiece, rebuild, closestPathPoint } from "../js/track.js";
import { angleDiff } from "../js/geometry.js";
import { resolveCircleSegment } from "../js/train/off-rail.js";
import { loadArntenoughrailsTrack } from "../js/presets.js";

test("body re-rail probe preserves the body center", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 20, 0, 40);
  assert(hit);

  const train = createTrain();
  ensureSingleEngine(train);
  const car = spawnFreeCar(train, "mid", hit.x, hit.y, hit.ang);
  car.mode = TrainMode.OFF_RAIL;
  car.pathRef = null;
  const before = { x: car.x, y: car.y };

  assert(tryRerailCar(car, board, train));
  assertEq(car.mode, TrainMode.ON_RAIL);
  assert(Math.hypot(car.x - before.x, car.y - before.y) < 1e-6);
});

test("coupled followers keep valid rail paths after lead derails", () => {
  const board = createBoard();
  for (let i = 0; i < 4; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96, 0, 40);
  assert(hit);

  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, {
    seatHit: hit,
    dir: 1,
  });
  startTrain(train);
  const bounds = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
  let sawDerail = false;
  for (let i = 0; i < 300; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode === TrainMode.OFF_RAIL) {
      sawDerail = true;
      assertEq(train.cars[0].mode, TrainMode.OFF_RAIL);
      assert(
        train.cars.slice(1).some(
          (car) => car.mode === TrainMode.ON_RAIL && car.pathRef
        ),
        "at least one valid follower should remain on its rail path"
      );
      break;
    }
  }
  assert(sawDerail);
});

test("exactly overlapping cars separate along a unit axis", () => {
  const train = createTrain();
  ensureSingleEngine(train);
  const a = spawnFreeCar(train, "mid", 100, 100, 0);
  const b = spawnFreeCar(train, "mid", 100, 100, 0);
  a.coupled = false;
  b.coupled = false;

  resolveCarCollisions(train);
  const d = Math.hypot(a.x - b.x, a.y - b.y);
  assert([a.x, a.y, b.x, b.y].every(Number.isFinite));
  assert(d < 1000, `overlap separation exploded to d=${d}`);
  assert(d >= carMinCenterDist(a, b) * 0.98, `cars still overlap d=${d}`);
});

test("exact circle-on-wall contact resolves instead of disappearing", () => {
  const hit = resolveCircleSegment(50, 100, 9, {
    x1: 0,
    y1: 100,
    x2: 100,
    y2: 100,
  });
  assert(hit);
  assert(Math.hypot(hit.nx, hit.ny) > 0.99);
  assert(hit.pen > 8.9);
});

test("off-rail stepping tolerates omitted bounds", () => {
  const board = createBoard();
  rebuild(board);
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  train.speed = 100;
  train.vx = 100;
  train.vy = 0;
  train.reRailDistLeft = 9999;

  updateTrain(train, board, 0.1, undefined, { solidPlayfield: false });
  assertEq(train.mode, TrainMode.OFF_RAIL);
  assert(Number.isFinite(train.x) && Number.isFinite(train.y));
});

test("single off-rail snapshot restores pose and accumulators", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  rebuild(board);

  const source = createTrain();
  ensureSingleEngine(source);
  source.mode = TrainMode.OFF_RAIL;
  source.pathRef = null;
  source.x = 321;
  source.y = 222;
  source.ang = 1.1;
  source.vx = 42;
  source.vy = 137;
  source.s = 0.4;
  source.dir = -1;
  source.offRailPreferAng = 0.8;
  source.offRailDistAcc = 17.5;
  source.offRailStepsDone = 7;
  source.reRailDistLeft = 33;
  source.reRailCooldown = 0.2;

  const restored = createTrain();
  ensureSingleEngine(restored);
  assert(
    restoreTrainSnapshot(restored, board, {
      ...source,
      cars: serializeTrainCars(source),
      pathRef: null,
    })
  );
  assertEq(restored.mode, TrainMode.OFF_RAIL);
  assertEq(restored.pathRef, null);
  assertEq(restored.x, source.x);
  assertEq(restored.y, source.y);
  assertEq(restored.ang, source.ang);
  assertEq(restored.vx, source.vx);
  assertEq(restored.vy, source.vy);
  assertEq(restored.dir, source.dir);
  assertEq(restored.offRailDistAcc, source.offRailDistAcc);
  assertEq(restored.offRailStepsDone, source.offRailStepsDone);
  assertEq(restored.reRailDistLeft, source.reRailDistLeft);
  assertEq(restored.cars[0].mode, TrainMode.OFF_RAIL);
});

test("multi-car snapshot preserves ids, power, coupling, and poses", () => {
  const board = createBoard();
  for (let i = 0; i < 6; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96, 0, 40);
  assert(hit);

  const source = createTrain();
  placeLayoutCars(
    source,
    [
      { id: "engine-a", role: "lead", kind: "engine", powered: true, coupled: true },
      { id: "mid-a", role: "mid", kind: "mid", coupled: false },
      { id: "engine-b", role: "trail", kind: "engine", facing: -1, coupled: false },
    ],
    board,
    { seatHit: hit, dir: 1 }
  );
  source.mode = TrainMode.OFF_RAIL;
  source.pathRef = null;
  source.selectedCarId = "engine-b";
  source.cars[2].coupled = true;
  source.cars[0].x = 400;
  source.cars[0].y = 300;
  source.cars[1].x = 250;
  source.cars[1].y = 330;
  source.cars[2].x = 120;
  source.cars[2].y = 360;
  for (const car of source.cars) {
    car.mode = TrainMode.OFF_RAIL;
    car.pathRef = null;
  }

  const snapshot = {
    ...source,
    pathRef: null,
    cars: serializeTrainCars(source),
  };
  const restored = createTrain();
  placeLayoutCars(restored, snapshot.cars, board, {
    seatHit: hit,
    dir: 1,
    preserveSavedState: true,
  });
  assert(restoreTrainSnapshot(restored, board, snapshot));

  assertEq(restored.poweredId, "engine-a");
  assertEq(restored.selectedCarId, "engine-b");
  assertEq(restored.cars.map((c) => c.id).join(","), "engine-a,mid-a,engine-b");
  assertEq(restored.cars[1].coupled, false);
  assertEq(restored.cars[2].coupled, true);
  for (let i = 0; i < source.cars.length; i++) {
    assertEq(restored.cars[i].x, source.cars[i].x);
    assertEq(restored.cars[i].y, source.cars[i].y);
    assertEq(restored.cars[i].mode, TrainMode.OFF_RAIL);
  }
});

test("authored on-rail consist keeps rail-bed contact and solid spacing", () => {
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  const hit = closestPathPoint(board, info.trainHint.x, info.trainHint.y, 160);
  assert(hit);

  const train = createTrain();
  placeLayoutCars(train, info.cars, board, { seatHit: hit, dir: 1 });
  startTrain(train);
  const bounds = { minX: -500, minY: -500, maxX: 1500, maxY: 1200 };

  for (let i = 0; i < 250; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.mode !== TrainMode.ON_RAIL) break;
    for (const car of train.cars) {
      assert(railPoseClear(board, car), `car ${car.id} left active rail bed`);
    }
    for (let j = 1; j < train.cars.length; j++) {
      const prev = train.cars[j - 1];
      const car = train.cars[j];
      const d = Math.hypot(car.x - prev.x, car.y - prev.y);
      assert(
        d + 0.5 >= carMinCenterDist(prev, car),
        `cars overlap on rail j=${j} d=${d}`
      );
    }
  }
});

test("authored R-11 open exit derails cars in physical order", () => {
  const board = createBoard();
  const info = loadArntenoughrailsTrack(board);
  const hit = closestPathPoint(board, info.trainHint.x, info.trainHint.y, 160);
  assert(hit);

  const train = createTrain();
  placeLayoutCars(train, info.cars, board, { seatHit: hit, dir: 1 });
  startTrain(train);
  const telemetry = createTrainTelemetry({
    enabled: true,
    maxFrames: 500,
    maxEvents: 10000,
  });
  const bounds = { minX: -500, minY: -500, maxX: 1500, maxY: 1200 };
  for (let i = 0; i < 500; i++) {
    updateTrain(train, board, 1 / 60, bounds, {
      solidPlayfield: true,
      telemetry,
    });
  }

  const events = telemetry
    .snapshot()
    .events.filter((event) =>
      ["rail_exit", "car_rail_exit"].includes(event.type)
    );
  const lead = events.find((event) => event.type === "rail_exit");
  const mid = events.find(
    (event) => event.type === "car_rail_exit" && event.entity === "mid1"
  );
  const trail = events.find(
    (event) => event.type === "car_rail_exit" && event.entity === "trail1"
  );
  assert(lead && mid && trail, "all three cars should report a rail exit");
  assertEq(lead.fromPath, "p475:main");
  assertEq(lead.exitConn, "b");
  assert(lead.frame < mid.frame && mid.frame < trail.frame);

  const postExit = telemetry
    .snapshot()
    .frames.filter(
      (frame) => frame.frame >= lead.frame && frame.frame < lead.frame + 16
    );
  assert(
    postExit.every(
      (frame) =>
        frame.after.mode !== TrainMode.OFF_RAIL ||
        angleDiff(frame.after.ang, lead.travelAng) < 0.1
    ),
    "lead should clear the inactive turnout footprint without turning"
  );

  const leadFrame = telemetry.snapshot().frames.find(
    (frame) => frame.frame === lead.frame
  );
  assert(leadFrame);
  const followerModes = leadFrame.after.cars
    .filter((car) => car.id !== "lead")
    .map((car) => car.mode);
  assert(
    followerModes.includes(TrainMode.ON_RAIL),
    "followers must remain on rail in the lead exit frame"
  );
});

test("paused mixed consist keeps the exact car poses", () => {
  const train = createTrain();
  placeLayoutCars(train, [
    { id: "lead", kind: "engine", role: "lead", powered: true, coupled: true },
    { id: "mid1", kind: "mid", role: "mid", coupled: true },
  ]);
  train.cars[0].x = 100;
  train.cars[0].y = 100;
  train.cars[1].x = 245;
  train.cars[1].y = 130;
  train.mode = TrainMode.OFF_RAIL;
  train.cars[0].mode = TrainMode.OFF_RAIL;
  train.cars[1].mode = TrainMode.ON_RAIL;
  stopTrain(train);
  const before = train.cars.map((car) => ({ x: car.x, y: car.y }));
  updateTrain(train, createBoard(), 1 / 60, undefined);
  assertEq(train.mode, TrainMode.IDLE);
  assertEq(train.cars[0].x, before[0].x);
  assertEq(train.cars[0].y, before[0].y);
  assertEq(train.cars[1].x, before[1].x);
  assertEq(train.cars[1].y, before[1].y);
});

test("a coupled follower can re-rail while the lead is off-rail", () => {
  const board = createBoard();
  for (let i = 0; i < 8; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96 * 3, 0, 40);
  assert(hit);

  const train = createTrain();
  placeLayoutCars(
    train,
    [
      { id: "lead", kind: "engine", role: "lead", powered: true, coupled: true },
      { id: "mid1", kind: "mid", role: "mid", coupled: true },
    ],
    board,
    { seatHit: hit, dir: 1 }
  );
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.cars[0].mode = TrainMode.OFF_RAIL;
  train.cars[0].pathRef = null;
  train.cars[0].x = 400;
  train.cars[0].y = 100;
  train.cars[0].ang = 0;

  const follower = train.cars[1];
  follower.mode = TrainMode.OFF_RAIL;
  follower.pathRef = null;
  follower.x = 273;
  follower.y = 0;
  follower.ang = 0;
  train.reRailCooldown = 0;

  assert(tryRerailCar(follower, board, train));
  assertEq(follower.mode, TrainMode.ON_RAIL);
  assert(follower.pathRef);
});

test("open connector mouth lets a straight derail pass the rail endpoint", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  rebuild(board);
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  train.speed = 200;
  train.x = 48 - 8;
  train.y = 0;
  train.ang = 0;
  train.vx = train.speed;
  train.vy = 0;
  train.reRailDistLeft = 9999;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;

  updateTrain(
    train,
    board,
    1 / 60,
    { minX: -500, minY: -500, maxX: 500, maxY: 500 },
    { solidPlayfield: false }
  );
  assertEq(train.mode, TrainMode.OFF_RAIL);
  assert(train.x > 40, `train should pass the open mouth x=${train.x}`);
  assert(Math.abs(train.ang) < 0.1, `mouth exit should stay straight ang=${train.ang}`);
});

test("off-rail followers keep moving and can catch a lead re-rail", () => {
  const board = createBoard();
  for (let i = 0; i < 10; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96 * 4, 0, 40);
  assert(hit);

  const train = createTrain();
  placeLayoutCars(
    train,
    [
      { id: "lead", kind: "engine", role: "lead", powered: true, coupled: true },
      { id: "mid1", kind: "mid", role: "mid", coupled: true },
      { id: "trail1", kind: "engine", role: "trail", coupled: true, facing: -1 },
    ],
    board,
    { seatHit: hit, dir: 1 }
  );
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.x = hit.x;
  train.y = hit.y + 6;
  train.ang = 0;
  train.vx = 80;
  train.vy = 0;
  train.reRailDistLeft = 0;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  for (const [index, car] of train.cars.entries()) {
    car.mode = TrainMode.OFF_RAIL;
    car.pathRef = null;
    car.x = train.x - index * COUPLER_DIST;
    car.y = train.y + 6;
    car.ang = 0;
    car.vx = 80;
    car.vy = 0;
  }

  const before = { x: train.cars[1].x, y: train.cars[1].y };
  const bounds = { minX: -500, minY: -500, maxX: 1500, maxY: 500 };
  updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  assertEq(train.mode, TrainMode.ON_RAIL);
  assert(
    Math.hypot(train.cars[1].x - before.x, train.cars[1].y - before.y) > 0.1,
    "follower must advance while lead re-rails"
  );

  let caught = false;
  for (let i = 0; i < 60; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (train.cars[1].mode === TrainMode.ON_RAIL) {
      caught = true;
      break;
    }
  }
  assert(caught, "follower should catch the rail after lead re-rail");
});

test("three middle cars recover in predecessor order without downstream whip", () => {
  const board = createBoard();
  for (let i = 0; i < 20; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 720, 0, 40);
  assert(hit);

  const train = createTrain();
  const spec = threeMiddleConsistSpec().map((car, index) => ({
    ...car,
    id:
      index === 0
        ? "lead"
        : index === 4
          ? "trail1"
          : `mid${index}`,
  }));
  placeLayoutCars(train, spec, board, {
    seatHit: hit,
    dir: 1,
  });
  assertEq(train.cars.length, 5);
  assertEq(train.cars.filter((car) => car.kind === "mid").length, 3);
  assertEq(train.cars[0].powered, true);
  assertEq(train.cars[4].facing, -1);

  train.mode = TrainMode.ON_RAIL;
  train.speed = 120;
  train.reRailCooldown = 0;
  for (const [index, car] of train.cars.entries()) {
    car.mode = index === 0 ? TrainMode.ON_RAIL : TrainMode.OFF_RAIL;
    car.pathRef = index === 0 ? train.pathRef : null;
    car.x = train.x - index * COUPLER_DIST;
    car.y =
      index === 1 ? 6 : index === 2 ? 120 : index === 3 ? 150 : 180;
    car.ang = 0;
    car.vx = 120;
    car.vy = 0;
    car.reRailCooldown = 0;
  }

  const bounds = { minX: -500, minY: -500, maxX: 2500, maxY: 500 };
  let allRecovered = false;
  for (let frame = 0; frame < 240; frame++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });

    for (const car of train.cars) {
      assert(
        Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.ang),
        `car ${car.id} must remain finite at frame ${frame}`
      );
    }
    for (let i = 1; i < train.cars.length; i++) {
      const prev = train.cars[i - 1];
      const car = train.cars[i];
      const d = Math.hypot(car.x - prev.x, car.y - prev.y);
      assert(
        d + 0.5 >= carMinCenterDist(prev, car),
        `cars overlap during recovery i=${i} frame=${frame} d=${d}`
      );
    }

    if (train.cars.every((car) => car.mode === TrainMode.ON_RAIL)) {
      allRecovered = true;
      break;
    }
  }

  assert(allRecovered, "all three mids and the trail should recover");
  for (const car of train.cars) {
    assert(car.pathRef, `recovered car ${car.id} needs a rail path`);
    assert(railPoseClear(board, car), `recovered car ${car.id} must sit on rail`);
  }
});

test("a middle rerail while lead is off rail does not whip the follow-on chain", () => {
  const board = createBoard();
  for (let i = 0; i < 40; i++) addPiece(board, "R01", -400 + i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 273, 0, 40);
  assert(hit);

  const train = createTrain();
  const spec = threeMiddleConsistSpec().map((car, index) => ({
    ...car,
    id:
      index === 0
        ? "lead"
        : index === 4
          ? "trail1"
          : `mid${index}`,
  }));
  placeLayoutCars(train, spec, board, {
    seatHit: hit,
    dir: 1,
  });
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.speed = 120;
  train.reRailDistLeft = 9999;
  train.vx = 120;
  train.vy = 0;
  train.ang = 0;
  train.x = 400;
  train.y = 100;

  const x = [400, 273, 146, 19, -108];
  const y = [100, 6, 80, 120, 160];
  for (const [index, car] of train.cars.entries()) {
    car.mode = TrainMode.OFF_RAIL;
    car.pathRef = null;
    car.x = x[index];
    car.y = y[index];
    car.ang = 0;
    car.vx = 120;
    car.vy = 0;
    car.reRailCooldown = 0;
  }

  const telemetry = createTrainTelemetry({
    enabled: true,
    maxFrames: 520,
    maxEvents: 100000,
  });
  const bounds = { minX: -1000, minY: -500, maxX: 4000, maxY: 500 };
  for (let frame = 0; frame < 500; frame++) {
    updateTrain(train, board, 1 / 60, bounds, {
      solidPlayfield: true,
      telemetry,
    });
    for (const car of train.cars) {
      assert(
        Number.isFinite(car.x) && Number.isFinite(car.y),
        `car ${car.id} must remain finite at frame ${frame}`
      );
    }
  }

  const rerails = telemetry
    .snapshot()
    .events.filter((event) => event.type === "follower_rerail");
  assertEq(
    rerails.map((event) => event.carId).join(","),
    "mid1,mid2,mid3,trail1",
    "followers must recover from front to back"
  );
  for (let i = 0; i < rerails.length; i++) {
    assertEq(
      rerails[i].predecessorId,
      i === 0 ? "lead" : rerails[i - 1].carId
    );
    if (i > 0) assert(rerails[i].frame > rerails[i - 1].frame);
  }
  assertEq(train.mode, TrainMode.OFF_RAIL, "lead remains off rail in this setup");
  assert(train.cars.slice(1).every((car) => car.mode === TrainMode.ON_RAIL));
});