import { closestPathPoint } from "../track.js";
import { FRONT_AXLE_OFFSET, REAR_AXLE_OFFSET } from "./constants.js";

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
    s: hit.s,
    dist: hit.dist,
    x: hit.x,
    y: hit.y,
    ang: hit.ang,
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
  return {
    id: car.id,
    role: car.role,
    kind: car.kind,
    mode: car.mode,
    x: car.x,
    y: car.y,
    ang: car.ang,
    s: car.s,
    dir: car.dir,
    vx: car.vx,
    vy: car.vy,
    coupled: !!car.coupled,
    powered: !!car.powered,
    pathRef: refSnapshot(car.pathRef),
    pathKey: pathKey(car.pathRef),
    nearest: nearestSnapshot(board, car.x, car.y),
    nearestFront: nearestSnapshot(board, axles.front.x, axles.front.y),
    nearestRear: nearestSnapshot(board, axles.rear.x, axles.rear.y),
  };
}

export function snapshotTrain(train, board) {
  if (!train) return null;
  const lead = {
    id: train.poweredId ?? "train",
    role: "lead",
    kind: "engine",
    mode: train.mode,
    x: train.x,
    y: train.y,
    ang: train.ang,
    s: train.s,
    dir: train.dir,
    vx: train.vx,
    vy: train.vy,
    coupled: true,
    powered: true,
    pathRef: refSnapshot(train.pathRef),
    pathKey: pathKey(train.pathRef),
    nearest: nearestSnapshot(board, train.x, train.y),
  };
  return {
    mode: train.mode,
    x: train.x,
    y: train.y,
    ang: train.ang,
    s: train.s,
    dir: train.dir,
    vx: train.vx,
    vy: train.vy,
    pathRef: refSnapshot(train.pathRef),
    pathKey: pathKey(train.pathRef),
    reRailCooldown: train.reRailCooldown,
    reRailDistLeft: train.reRailDistLeft,
    offRailDistAcc: train.offRailDistAcc,
    offRailStepsDone: train.offRailStepsDone,
    offRailPreferAng: train.offRailPreferAng,
    wallHit: !!train.wallHit,
    nearest: nearestSnapshot(board, train.x, train.y),
    cars: train.cars?.length
      ? train.cars.map((car) => carSnapshot(car, board))
      : [lead],
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
      for (const car of after.cars || []) {
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