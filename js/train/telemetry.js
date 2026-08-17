import { closestPathPoint } from "../track.js";
import { FRONT_AXLE_OFFSET, REAR_AXLE_OFFSET } from "./constants.js";
import {
  carBodyExtents,
  frontHitch,
  inspectTrainState,
  rearHitch,
} from "../world-model.js";

function q(value, digits = 6) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function pathKey(ref) {
  if (!ref?.pieceId || !ref?.pathId) return null;
  return `${ref.pieceId}:${ref.pathId}`;
}

function refSnapshot(ref) {
  if (!ref) return null;
  return {
    pieceId: ref.pieceId ?? ref.path?.pieceId ?? null,
    pathId: ref.pathId ?? ref.path?.id ?? null,
  };
}

function nearestSnapshot(board, x, y) {
  if (!board || !Number.isFinite(x) || !Number.isFinite(y)) return null;
  const hit = closestPathPoint(board, x, y, 1e9);
  if (!hit) return null;
  return {
    pieceId: hit.path?.pieceId ?? null,
    pathId: hit.path?.id ?? null,
    s: q(hit.s),
    dist: q(hit.dist),
    x: q(hit.x, 3),
    y: q(hit.y, 3),
    ang: q(hit.ang),
  };
}

function axleSnapshot(car) {
  const ca = Math.cos(car.ang || 0);
  const sa = Math.sin(car.ang || 0);
  return {
    front: {
      x: car.x + ca * FRONT_AXLE_OFFSET,
      y: car.y + sa * FRONT_AXLE_OFFSET,
    },
    rear: {
      x: car.x + ca * REAR_AXLE_OFFSET,
      y: car.y + sa * REAR_AXLE_OFFSET,
    },
  };
}

function carSnapshot(car, board) {
  const axles = axleSnapshot(car);
  const extents = carBodyExtents(car.ang || 0);
  return {
    id: car.id,
    role: car.role,
    kind: car.kind,
    mode: car.mode,
    x: q(car.x, 3),
    y: q(car.y, 3),
    ang: q(car.ang),
    s: q(car.s),
    dir: car.dir,
    vx: q(car.vx, 3),
    vy: q(car.vy, 3),
    coupled: !!car.coupled,
    powered: !!car.powered,
    frontCouplerOffset: q(car.frontCouplerOffset || 0, 3),
    rearCouplerOffset: q(car.rearCouplerOffset || 0, 3),
    wallHit: !!car.wallHit,
    pathRef: refSnapshot(car.pathRef),
    pathKey: pathKey(car.pathRef),
    openMouthAdjacentPieceId: car.openMouthAdjacentPieceId || null,
    frontHitch: Object.fromEntries(
      Object.entries(frontHitch(car)).map(([key, value]) => [key, q(value, 3)])
    ),
    rearHitch: Object.fromEntries(
      Object.entries(rearHitch(car)).map(([key, value]) => [key, q(value, 3)])
    ),
    bodyExtents: { x: q(extents.x, 3), y: q(extents.y, 3) },
    openMouthPieceId: car.openMouthPieceId || null,
    railEntryGraceDistance: q(car.railEntryGraceDistance || 0, 3),
    nearest: nearestSnapshot(board, car.x, car.y),
    nearestFront: nearestSnapshot(board, axles.front.x, axles.front.y),
    nearestRear: nearestSnapshot(board, axles.rear.x, axles.rear.y),
  };
}

export function snapshotTrain(train, board, context = {}) {
  if (!train) return null;
  const lead = {
    id: train.poweredId ?? "train",
    role: "lead",
    kind: "engine",
    mode: train.mode,
    x: q(train.x, 3),
    y: q(train.y, 3),
    ang: q(train.ang),
    s: q(train.s),
    dir: train.dir,
    vx: q(train.vx, 3),
    vy: q(train.vy, 3),
    coupled: true,
    powered: true,
    pathRef: refSnapshot(train.pathRef),
    pathKey: pathKey(train.pathRef),
    nearest: nearestSnapshot(board, train.x, train.y),
  };
  return {
    mode: train.mode,
    x: q(train.x, 3),
    y: q(train.y, 3),
    ang: q(train.ang),
    s: q(train.s),
    dir: train.dir,
    vx: q(train.vx, 3),
    vy: q(train.vy, 3),
    frontCouplerOffset: q(train.frontCouplerOffset || 0, 3),
    rearCouplerOffset: q(train.rearCouplerOffset || 0, 3),
    speed: q(train.speed, 3),
    pathRef: refSnapshot(train.pathRef),
    pathKey: pathKey(train.pathRef),
    reRailCooldown: q(train.reRailCooldown || 0),
    reRailDistLeft: q(train.reRailDistLeft || 0, 3),
    railEntryGraceDistance: q(train.railEntryGraceDistance || 0, 3),
    openMouthAdjacentPieceId: train.openMouthAdjacentPieceId || null,
    offRailDistAcc: q(train.offRailDistAcc || 0, 3),
    offRailStepsDone: train.offRailStepsDone,
    offRailPreferAng: train.offRailPreferAng,
    wallHit: !!train.wallHit,
    nearest: nearestSnapshot(board, train.x, train.y),
    cars: train.cars?.length
      ? train.cars.map((car) => carSnapshot(car, board))
      : [lead],
    invariants: inspectTrainState(
      board,
      train,
      context.bounds || null,
      { solidPlayfield: !!context.solidPlayfield }
    ),
  };
}

function changed(a, b) {
  return a !== b;
}

export function createTrainTelemetry(options = {}) {
  let enabled = !!options.enabled;
  const maxFrames = Math.max(1, options.maxFrames ?? 2400);
  const maxEvents = Math.max(1, options.maxEvents ?? maxFrames * 12);
  let nextFrame = 0;
  let current = null;
  let droppedFrames = 0;
  let droppedEvents = 0;
  const frames = [];
  const events = [];

  function addEvent(type, data = {}) {
    if (!enabled) return;
    if (events.length >= maxEvents) {
      events.shift();
      droppedEvents++;
    }
    events.push({
      frame: current?.frame ?? Math.max(0, nextFrame - 1),
      type,
      ...data,
    });
  }

  function begin(meta = {}, before = null) {
    if (!enabled) return null;
    current = {
      frame: nextFrame++,
      meta: { ...meta },
      before,
      events: [],
    };
    return current.frame;
  }

  function end(after) {
    if (!enabled || !current) return;
    current.after = after;
    const before = current.before;
    if (before && after) {
      if (changed(before.mode, after.mode)) {
        addEvent("mode_transition", {
          from: before.mode,
          to: after.mode,
          x: after.x,
          y: after.y,
          ang: after.ang,
          pathKey: after.pathKey,
        });
      }
      if (changed(before.pathKey, after.pathKey)) {
        addEvent("lead_path_transition", {
          from: before.pathKey,
          to: after.pathKey,
          mode: after.mode,
          s: after.s,
        });
      }
      if (
        after.mode === "on_rail" &&
        after.pathKey &&
        after.nearest &&
        after.nearest.dist > 24
      ) {
        addEvent("lead_path_pose_divergence", {
          pathKey: after.pathKey,
          nearestPath: `${after.nearest.pieceId}:${after.nearest.pathId}`,
          distance: after.nearest.dist,
        });
      }
      const beforeCars = new Map((before.cars || []).map((car) => [car.id, car]));
      const afterCars = after.cars || [];
      for (let carIndex = 0; carIndex < afterCars.length; carIndex++) {
        const car = afterCars[carIndex];
        const prior = beforeCars.get(car.id);
        if (!prior) continue;
        if (changed(prior.mode, car.mode)) {
          addEvent("car_mode_transition", {
            carId: car.id,
            from: prior.mode,
            to: car.mode,
            pathKey: car.pathKey,
            x: car.x,
            y: car.y,
          });
        }
        if (changed(prior.pathKey, car.pathKey)) {
          addEvent("car_path_transition", {
            carId: car.id,
            from: prior.pathKey,
            to: car.pathKey,
            mode: car.mode,
            s: car.s,
          });
        }
        if (
          car.mode === "on_rail" &&
          car.pathKey &&
          car.nearest &&
          car.nearest.dist > 24
        ) {
          addEvent("car_path_pose_divergence", {
            carId: car.id,
            pathKey: car.pathKey,
            nearestPath: `${car.nearest.pieceId}:${car.nearest.pathId}`,
            distance: car.nearest.dist,
          });
        }
        const step = Math.hypot(car.x - prior.x, car.y - prior.y);
        const turn = Math.abs(
          Math.atan2(
            Math.sin(car.ang - prior.ang),
            Math.cos(car.ang - prior.ang)
          )
        );
        let upstreamPinSweep = 0;
        for (let upstream = 0; upstream <= carIndex; upstream++) {
          const currentCar = afterCars[upstream];
          const priorCar = beforeCars.get(currentCar.id);
          if (!priorCar) continue;
          upstreamPinSweep +=
            Math.abs(
              Math.atan2(
                Math.sin(currentCar.ang - priorCar.ang),
                Math.cos(currentCar.ang - priorCar.ang)
              )
            ) * 64;
        }
        const expected = Math.max(
          15,
          (after.speed || 0) * (current.meta?.dt || 0) * 4.5 +
            upstreamPinSweep
        );
        const placementExpected =
          prior.mode !== car.mode || prior.pathKey !== car.pathKey
            ? Math.max(expected, 20)
            : expected;
        if (step > placementExpected || (turn > 0.65 && !car.wallHit)) {
          addEvent("pose_discontinuity", {
            carId: car.id,
            distance: q(step, 3),
            angleDelta: q(turn),
            allowedDistance: q(placementExpected, 3),
          });
        }
      }
      const invariants = after.invariants;
      if (invariants) {
        for (const link of invariants.couplers || []) {
          if (!link.ok) addEvent("coupler_violation", { ...link });
        }
        for (const overlap of invariants.overlaps || []) {
          addEvent("solid_body_overlap", { ...overlap });
        }
        for (const escaped of invariants.escaped || []) {
          addEvent("playfield_escape", { ...escaped });
        }
        for (const penetration of invariants.trackPenetrations || []) {
          addEvent("track_body_penetration", { ...penetration });
        }
      }
    }
    current.events = events
      .filter((event) => event.frame === current.frame)
      .map((event) => ({ ...event }));
    if (frames.length >= maxFrames) {
      frames.shift();
      droppedFrames++;
    }
    frames.push(current);
    current = null;
  }

  return {
    get enabled() {
      return enabled;
    },
    set enabled(value) {
      enabled = !!value;
    },
    setEnabled(value) {
      enabled = !!value;
    },
    clear() {
      frames.length = 0;
      events.length = 0;
      current = null;
      nextFrame = 0;
      droppedFrames = 0;
      droppedEvents = 0;
    },
    begin,
    event: addEvent,
    end,
    snapshot() {
      return {
        enabled,
        frames: frames.map((frame) => ({ ...frame })),
        events: events.map((event) => ({ ...event })),
        droppedFrames,
        droppedEvents,
      };
    },
    toJSON() {
      return this.snapshot();
    },
  };
}