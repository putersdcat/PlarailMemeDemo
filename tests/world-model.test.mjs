import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, assert, assertEq } from "./assert.mjs";
import {
  addPiece,
  closestPathPoint,
  createBoard,
  loadBoard,
  movePiece,
  rebuild,
  serializeBoard,
} from "../js/track.js";
import {
  createTrain,
  createTrainTelemetry,
  COUPLER_DIST,
  COUPLER_LATERAL_LIMIT,
  commitCoupledPlacement,
  placeLayoutCars,
  resetConsistMotion,
  setActiveEngine,
  snapCarPoseToHit,
  spawnFreeCar,
  startTrain,
  threeCarConsistSpec,
  TrainMode,
  tryRecoupleCar,
  updateTrain,
  validateTrainPlacement,
} from "../js/train.js";
import { createLayoutScenario, runLayoutScenario } from "../js/simulation/scenario.js";
import {
  computeBoardBounds,
  createView,
  fitBoardToView,
  solidPlayfieldBounds,
} from "../js/app/camera.js";
import {
  activePathMinY,
  buildWorldPersistence,
  prepareLoadedWorld,
} from "../js/app/world-persistence.js";
import { analyzeTrainTrace } from "../js/train/trace-analysis.js";
import {
  buildWorldContract,
  carBodyOverlap,
  couplerError,
  renderWorldAscii,
  worldSolidBoundary,
} from "../js/world-model.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const targetLayout = JSON.parse(
  readFileSync(join(root, "layouts", "arntenoughrails.json"), "utf8")
);
const memeLayout = JSON.parse(
  readFileSync(join(root, "layouts", "real-meme-track.json"), "utf8")
);

function targetRun(frames = 900) {
  const scenario = createLayoutScenario(targetLayout);
  const trace = runLayoutScenario(scenario, {
    frames,
    stopOnTerminal: false,
  });
  return { scenario, trace, analysis: analyzeTrainTrace(trace) };
}

test("world contract serializes target topology and renderer-solid geometry", () => {
  const scenario = createLayoutScenario(targetLayout, { start: false });
  const contract = buildWorldContract(scenario.board, scenario.bounds);
  assertEq(contract.schema, "plarail-world-contract");
  assertEq(contract.pieces.length, 16);
  assertEq(contract.paths.length, 18);
  assertEq(contract.topology.openMouths.length, 4);
  assert(contract.collision.polygonCount >= 16);
  assert(contract.collision.exposedBoundarySegments > 100);
  assertEq(contract.diagnostics.endpointFailures.length, 0);
  assertEq(contract.dimensions.coupling, "coincident-pin-tips");
});

function assertOnlyTinyRerailDiscontinuities(analysis) {
  assertEq(analysis.badInvariantFrames, 0);
  assert(
    !analysis.violations.some((event) => event.type !== "pose_discontinuity"),
    `unexpected violations: ${JSON.stringify(analysis.violationCounts)}`
  );
  for (const event of analysis.violations) {
    assert(
      (event.distance || 0) - (event.allowedDistance || 0) < 1,
      `pose step ${event.distance} exceeded ${event.allowedDistance} by more than 1px`
    );
  }
}

test("target cycle derails and rerails all cars in physical order with no violations", () => {
  const { analysis } = targetRun();
  assertEq(analysis.finalMode, TrainMode.ON_RAIL);
  assertOnlyTinyRerailDiscontinuities(analysis);
  assert(analysis.maxCouplerError <= 0.05, `pin error ${analysis.maxCouplerError}`);

  const physical = analysis.transitions.filter((event) =>
    ["rail_exit", "car_rail_exit", "lead_rerail", "follower_rerail"].includes(
      event.type
    )
  );
  assertEq(
    physical.map((event) => event.type).join(","),
    "rail_exit,car_rail_exit,car_rail_exit,lead_rerail,follower_rerail,follower_rerail"
  );
  assertEq(physical[1].carId, "mid1");
  assertEq(physical[2].carId, "trail1");
  assertEq(physical[4].carId, "mid1");
  assertEq(physical[5].carId, "trail1");
  for (let i = 1; i < physical.length; i++) {
    assert(physical[i].frame > physical[i - 1].frame);
  }
});

test("oldest meme demo clears its open-mouth route without jumping through solids", () => {
  const trace = runLayoutScenario(createLayoutScenario(memeLayout), {
    frames: 1200,
    stopOnTerminal: false,
  });
  const analysis = analyzeTrainTrace(trace);

  assert(
    analysis.finalMode !== TrainMode.STALLED,
    `meme floor tour must not stall, got ${analysis.finalMode}`
  );
  assertEq(analysis.badInvariantFrames, 0);
  assertEq(analysis.violationCount, 0);
  assert(analysis.maxCouplerError <= 0.05);

  const physical = analysis.transitions.filter((event) =>
    ["rail_exit", "lead_rerail"].includes(event.type)
  );
  assertEq(
    physical.map((event) => event.type).join(","),
    "rail_exit,lead_rerail"
  );
  assertEq(physical[0].fromPath, "p424:main");
  assertEq(physical[1].pathKey, "p412:main");
});

test("oldest meme demo repeats both open-mouth recoveries without a teleport", () => {
  const trace = runLayoutScenario(createLayoutScenario(memeLayout), {
    frames: 3600,
    stopOnTerminal: false,
  });
  const analysis = analyzeTrainTrace(trace);

  assert(
    analysis.finalMode !== TrainMode.STALLED,
    `meme floor tour must not stall, got ${analysis.finalMode}`
  );
  assertEq(analysis.badInvariantFrames, 0);
  assertEq(analysis.violationCount, 0);
  assert(
    analysis.transitions.some(
      (event) =>
        event.type === "rail_exit" && event.fromPath === "p424:main"
    )
  );
  assert(
    analysis.transitions.some(
      (event) => event.type === "lead_rerail" && event.pathKey === "p412:main"
    )
  );
  for (const event of analysis.transitions.filter(
    (item) => item.type === "lead_rerail"
  )) {
    assert(
      event.approachAngleDeg <= 15.0001,
      `rerail approach ${event.approachAngleDeg}° exceeded the 15° gate`
    );
  }
});

test("maximum five-car target cycle exits and recovers every body in order", () => {
  const data = structuredClone(targetLayout);
  data.train.cars = [
    { id: "active", kind: "engine", role: "lead", powered: true, coupled: true },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `mid${index + 1}`,
      kind: "mid",
      role: "mid",
      powered: false,
      coupled: true,
    })),
    {
      id: "passive",
      kind: "engine",
      role: "trail",
      powered: false,
      coupled: true,
      facing: -1,
    },
  ];
  const trace = runLayoutScenario(createLayoutScenario(data), {
    frames: 900,
    stopOnTerminal: false,
  });
  const analysis = analyzeTrainTrace(trace);
  assertEq(analysis.finalMode, TrainMode.ON_RAIL);
  assertOnlyTinyRerailDiscontinuities(analysis);
  assert(analysis.maxCouplerError <= 0.05);
  const lateralOffsets = trace.frames.flatMap((frame) =>
    (frame.after.cars || []).flatMap((car) => [
      Math.abs(car.frontCouplerOffset || 0),
      Math.abs(car.rearCouplerOffset || 0),
    ])
  );
  assert(
    lateralOffsets.some((offset) => offset > 0.1),
    "articulated chain should use lateral coupler pocket travel"
  );
  assert(
    Math.max(...lateralOffsets) <= COUPLER_LATERAL_LIMIT + 0.001,
    `lateral slot exceeded ${COUPLER_LATERAL_LIMIT}px`
  );
  const physical = analysis.transitions.filter((event) =>
    ["rail_exit", "car_rail_exit", "lead_rerail", "follower_rerail"].includes(
      event.type
    )
  );
  assertEq(
    physical.map((event) => event.type).join(","),
    "rail_exit,car_rail_exit,car_rail_exit,car_rail_exit,car_rail_exit,lead_rerail,follower_rerail,follower_rerail,follower_rerail,follower_rerail"
  );
  assertEq(
    physical
      .filter((event) => event.type === "follower_rerail")
      .map((event) => event.carId)
      .join(","),
    "mid1,mid2,mid3,passive"
  );
});

test("maximum five-car target cycle remains unstalled through a long replay", () => {
  const data = structuredClone(targetLayout);
  data.train.cars = [
    { id: "active", kind: "engine", role: "lead", powered: true, coupled: true },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `mid${index + 1}`,
      kind: "mid",
      role: "mid",
      coupled: true,
    })),
    {
      id: "passive",
      kind: "engine",
      role: "trail",
      coupled: true,
      facing: -1,
    },
  ];
  const trace = runLayoutScenario(createLayoutScenario(data), {
    frames: 1800,
    stopOnTerminal: false,
  });
  const analysis = analyzeTrainTrace(trace);
  assert(
    analysis.finalMode !== TrainMode.STALLED,
    `five-car replay must not stall, got ${analysis.finalMode}`
  );
  assertOnlyTinyRerailDiscontinuities(analysis);
  assert(
    !trace.events.some((event) => event.type === "consist_stall"),
    "quantized late-frame pin error must not freeze the consist"
  );
  const recovers = analysis.transitions.filter(
    (event) => event.type === "lead_rerail"
  );
  assert(recovers.length >= 2, "long replay should complete more than one recover");
  assert(analysis.maxCouplerError <= 0.05);
});

test("target telemetry is quantized and exposes exact pin and hull invariants", () => {
  const { trace } = targetRun(740);
  for (const frame of trace.frames) {
    assert(frame.after.invariants, `frame ${frame.frame} invariants`);
    assert(frame.after.invariants.maxCouplerError <= 0.05);
    for (const car of frame.after.cars) {
      assert(Math.abs(car.x * 1000 - Math.round(car.x * 1000)) < 1e-6);
      assert(car.frontHitch && car.rearHitch && car.bodyExtents);
    }
  }
});

test("preexisting stretched pin breaks coupling before motion", () => {
  const board = createBoard();
  for (let i = 0; i < 8; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96 * 3, 0, 40);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  train.cars[1].x += 40;
  const telemetry = createTrainTelemetry({ enabled: true });
  startTrain(train);
  updateTrain(
    train,
    board,
    1 / 60,
    { minX: -1000, minY: -500, maxX: 2000, maxY: 500 },
    { telemetry }
  );
  assertEq(train.cars[1].coupled, false);
  assertEq(train.cars[2].coupled, false);
  assert(
    telemetry
      .snapshot()
      .events.some(
        (event) =>
          event.type === "coupler_break" &&
          event.reason === "preexisting_stretch"
      )
  );
});

test("blocked exact coupling rolls back and stalls without stretching", () => {
  const board = createBoard();
  for (let i = 0; i < 8; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96 * 3, 0, 40);
  const train = createTrain();
  placeLayoutCars(train, threeCarConsistSpec(), board, { seatHit: hit, dir: 1 });
  const follower = train.cars[1];
  follower.mode = TrainMode.OFF_RAIL;
  follower.pathRef = null;
  train.cars[2].coupled = false;
  resetConsistMotion(train);
  const before = { x: train.x, y: train.y };
  startTrain(train);
  updateTrain(
    train,
    board,
    1 / 60,
    {
      minX: follower.x + 20,
      minY: -100,
      maxX: train.x + 200,
      maxY: 100,
    },
    { solidPlayfield: true }
  );
  assertEq(train.mode, TrainMode.STALLED);
  assert(Math.hypot(train.x - before.x, train.y - before.y) < 0.01);
  assert(couplerError(train.cars[0], train.cars[1]) <= 0.05);
});

test("ASCII world view exposes solids, rails, and all cars", () => {
  const scenario = createLayoutScenario(targetLayout, { start: false });
  const text = renderWorldAscii(
    scenario.board,
    scenario.train,
    scenario.bounds,
    { width: 64, height: 20 }
  );
  assert(text.includes("#=solid-track"));
  assert(text.includes("0=lead"));
  assert(text.includes("1=mid1"));
  assert(text.includes("2=trail1"));
  assert(text.includes("="));
});

test("solid-union cache invalidates when a piece moves", () => {
  const board = createBoard();
  const piece = addPiece(board, "R01", 0, 0, 0);
  const before = worldSolidBoundary(board);
  const beforeMinX = Math.min(...before.map((segment) => segment.x1));
  movePiece(board, piece.id, 200, 0);
  const after = worldSolidBoundary(board);
  const afterMinX = Math.min(...after.map((segment) => segment.x1));
  assert(afterMinX - beforeMinX > 190);
});

test("solid autosave reload is idempotent and preserves exact wall AABB", () => {
  const firstBoard = createBoard();
  assert(loadBoard(firstBoard, targetLayout).ok);
  const first = prepareLoadedWorld(firstBoard, targetLayout, 36);
  assert(Math.abs(activePathMinY(firstBoard) - 36) < 0.001);
  const walls = {
    minX: -864.4,
    minY: -23.144,
    maxX: 1007.243,
    maxY: 728.744,
  };
  const saved = {
    ...serializeBoard(firstBoard),
    solidPlayfield: true,
    northAlign: true,
    train: first.data.train,
    world: buildWorldPersistence(firstBoard, walls),
  };
  const poses = saved.pieces.map((piece) => [piece.id, piece.x, piece.y]);

  const secondBoard = createBoard();
  assert(loadBoard(secondBoard, saved).ok);
  const second = prepareLoadedWorld(secondBoard, saved, 36);
  assertEq(second.dy, 0);
  assertEq(second.stable, true);
  assertEq(JSON.stringify(second.playfieldBounds), JSON.stringify(walls));
  assertEq(
    JSON.stringify(secondBoard.pieces.map((piece) => [piece.id, piece.x, piece.y])),
    JSON.stringify(poses)
  );
  assert(Math.abs(activePathMinY(secondBoard) - 36) < 0.001);
});

test("framing v1 gap cache migrates to a zero-gap solid top wall", () => {
  const board = createBoard();
  assert(loadBoard(board, targetLayout).ok);
  const normalized = prepareLoadedWorld(board, targetLayout, 36);
  const legacyGapSave = {
    ...serializeBoard(board),
    solidPlayfield: true,
    northAlign: true,
    train: normalized.data.train,
    world: {
      framingVersion: 1,
      normalized: true,
      northPathY: 36,
      playfieldBounds: {
        minX: -400,
        minY: -50,
        maxX: 550,
        maxY: 760,
      },
    },
  };

  const reloaded = createBoard();
  assert(loadBoard(reloaded, legacyGapSave).ok);
  const migrated = prepareLoadedWorld(reloaded, legacyGapSave, 36);
  assertEq(migrated.stable, false);
  assertEq(migrated.playfieldBounds, null);
  assertEq(migrated.dy, 0, "normalized pieces must not translate again");

  const view = createView(1546, 645);
  fitBoardToView(view, reloaded, 64, 96);
  const walls = solidPlayfieldBounds(view, reloaded, 20);
  const solidTop = computeBoardBounds(reloaded).minY;
  assertEq(walls.minY, solidTop);
  assertEq(solidTop, 16);
});

test("supported rolling-stock composition matrix keeps exact pins and one power", () => {
  const board = createBoard();
  for (let i = 0; i < 40; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const hit = closestPathPoint(board, 96 * 20, 0, 40);
  const active = {
    id: "active",
    kind: "engine",
    role: "lead",
    powered: true,
    coupled: true,
    facing: 1,
  };
  const mid = (id) => ({
    id,
    kind: "mid",
    role: "mid",
    powered: false,
    coupled: true,
    facing: 1,
  });
  const passive = {
    id: "passive",
    kind: "engine",
    role: "trail",
    powered: false,
    coupled: true,
    facing: -1,
  };
  const cases = [
    [active],
    [active, passive],
    [active, mid("mid1")],
    [active, mid("mid1"), passive],
    [active, mid("mid1"), mid("mid2"), mid("mid3")],
    [active, mid("mid1"), mid("mid2"), mid("mid3"), passive],
  ];

  for (const spec of cases) {
    const train = createTrain();
    placeLayoutCars(train, spec, board, { seatHit: hit, dir: 1 });
    assertEq(train.cars.length, spec.length);
    assertEq(train.cars.filter((car) => car.powered).length, 1);
    assert(train.cars.filter((car) => car.kind === "mid").length <= 3);
    assert(startTrain(train));
    for (let frame = 0; frame < 90; frame++) {
      updateTrain(
        train,
        board,
        1 / 60,
        { minX: -1000, minY: -500, maxX: 5000, maxY: 500 },
        { solidPlayfield: false }
      );
      assertEq(train.mode, TrainMode.ON_RAIL);
      for (let i = 1; i < train.cars.length; i++) {
        assert(
          couplerError(train.cars[i - 1], train.cars[i]) <= 0.05,
          `${spec.length}-car pin ${i}`
        );
      }
    }

    if (spec.at(-1)?.kind === "engine" && spec.length > 1) {
      assert(setActiveEngine(train, train.cars.at(-1).id));
      assertEq(train.cars.filter((car) => car.powered).length, 1);
      assertEq(train.poweredId, train.cars[0].id);
      for (let i = 1; i < train.cars.length; i++) {
        assert(couplerError(train.cars[i - 1], train.cars[i]) <= 0.05);
      }
    }
  }
});

test("middle and passive engine snap onto the powered tail like modular pieces", () => {
  const board = createBoard();
  for (let i = 0; i < 20; i++) addPiece(board, "R01", i * 96, 0, 0);
  rebuild(board);
  const leadHit = closestPathPoint(board, 96 * 10, 0, 40);
  const train = createTrain();
  placeLayoutCars(train, [
    { id: "active", kind: "engine", powered: true, coupled: true },
  ], board, { seatHit: leadHit, dir: 1 });

  for (const [kind, id] of [
    ["mid", "mid-part"],
    ["engine", "passive-part"],
  ]) {
    const tail = train.cars.at(-1);
    const targetX = tail.x - Math.cos(tail.ang) * COUPLER_DIST;
    const targetY = tail.y - Math.sin(tail.ang) * COUPLER_DIST;
    const hit = closestPathPoint(board, targetX, targetY, 48);
    const car = spawnFreeCar(train, kind, targetX, targetY, tail.ang, {
      powered: false,
    });
    car.id = id;
    snapCarPoseToHit(car, hit, tail.dir);
    car.coupled = false;
    car.powered = false;
    assert(tryRecoupleCar(train, car.id));
    assert(couplerError(tail, car) <= 0.05);
  }
  assertEq(train.cars.filter((car) => car.powered).length, 1);
  assertEq(train.cars.map((car) => car.kind).join(","), "engine,mid,engine");
});

test("five-car minimum circle never commits lead/passive overlap", () => {
  const board = createBoard();
  for (let step = 0; step < 8; step++) {
    addPiece(board, "R03", 0, 0, step);
  }
  rebuild(board);
  const hit = closestPathPoint(board, 96, 0, 20);
  const spec = [
    { id: "lead", kind: "engine", role: "lead", powered: true, coupled: true },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `mid${index + 1}`,
      kind: "mid",
      role: "mid",
      powered: false,
      coupled: true,
    })),
    {
      id: "passive",
      kind: "engine",
      role: "trail",
      powered: false,
      coupled: true,
      facing: -1,
    },
  ];
  const train = createTrain();
  placeLayoutCars(train, spec, board, { seatHit: hit, dir: 1 });
  assertEq(train.cars.length, 5);
  assert(validateTrainPlacement(train).ok, "clean five-car circle may fit");
  const lead = train.cars[0];
  const passive = train.cars[4];
  assertEq(carBodyOverlap(lead, passive), null);

  const saved = { x: passive.x, y: passive.y, ang: passive.ang };
  passive.x = lead.x;
  passive.y = lead.y;
  passive.ang = lead.ang;
  const invalid = validateTrainPlacement(train);
  assertEq(invalid.ok, false);
  assert(
    invalid.overlaps.some(
      (overlap) =>
        [overlap.a, overlap.b].includes("lead") &&
        [overlap.a, overlap.b].includes("passive")
    ),
    "lead/passive hull collision must reject placement"
  );
  Object.assign(passive, saved);
  assert(validateTrainPlacement(train).ok);
});

test("crowded minimum circle rejects a fifth coupled car and preserves prior stock", () => {
  const board = createBoard();
  for (let step = 0; step < 8; step++) addPiece(board, "R03", 0, 0, step);
  rebuild(board);
  const hit = closestPathPoint(board, 96, 0, 20);
  const fourSpec = [
    { id: "lead", kind: "engine", powered: true, coupled: true },
    ...Array.from({ length: 3 }, (_, index) => ({
      id: `mid${index + 1}`,
      kind: "mid",
      coupled: true,
    })),
  ];
  const four = createTrain();
  placeLayoutCars(four, fourSpec, board, { seatHit: hit, dir: 1 });
  const before = four.cars.map((car) => ({
    id: car.id,
    x: car.x,
    y: car.y,
    ang: car.ang,
    coupled: car.coupled,
  }));

  // Obtain the only clean fifth-car seat, then occupy it with parked stock.
  const reference = createTrain();
  placeLayoutCars(
    reference,
    [
      ...fourSpec,
      { id: "seat", kind: "engine", role: "trail", coupled: true, facing: -1 },
    ],
    board,
    { seatHit: hit, dir: 1 }
  );
  const seat = reference.cars.at(-1);
  const blocker = spawnFreeCar(
    four,
    "engine",
    seat.x,
    seat.y,
    seat.ang,
    { powered: false }
  );
  blocker.id = "parked-passive";
  blocker.mode = TrainMode.ON_RAIL;
  blocker.pathRef = seat.pathRef;
  blocker.s = seat.s;
  blocker.dir = seat.dir;
  blocker.coupled = false;

  const candidate = spawnFreeCar(
    four,
    "engine",
    seat.x,
    seat.y,
    seat.ang,
    { powered: false }
  );
  candidate.id = "candidate-passive";
  candidate.mode = TrainMode.ON_RAIL;
  candidate.pathRef = seat.pathRef;
  candidate.s = seat.s;
  candidate.dir = seat.dir;
  candidate.coupled = false;
  assertEq(
    tryRecoupleCar(four, candidate.id, COUPLER_DIST * 3, board),
    false
  );
  assert(candidate.placementRejected, "crowded candidate must be rejected");

  // UI behavior for a rejected new palette part: do not commit it to world.
  four.cars = four.cars.filter((car) => car.id !== candidate.id);
  assertEq(four.cars.length, 5); // four-car chain + parked passive
  assertEq(four.cars.filter((car) => car.powered).length, 1);
  assertEq(validateTrainPlacement(four).ok, true);
  for (const original of before) {
    const current = four.cars.find((car) => car.id === original.id);
    assert(Math.hypot(current.x - original.x, current.y - original.y) < 0.01);
    assertEq(current.coupled, original.coupled);
  }
});
