/**
 * Multi-car consist: separate entities, rigid hitch, per-car on/off-rail mode.
 *
 * - Each car has its own mode (on_rail / off_rail / idle).
 * - Lead re-rail does NOT force followers onto on-rail physics.
 * - Coupler length is one constant (on-rail == off-rail hitch).
 * - Mid cars capped at MAX_MID_CARS; engine place does not auto-build a consist.
 */
import {
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
  WHEEL_RADIUS,
  TrainMode,
  RE_RAIL_LATERAL,
  RE_RAIL_ANGLE,
} from "./constants.js";
import {
  normalizeAngle,
  angleDiff,
  pointOnPolyline,
  HALF_W,
} from "../geometry.js";
import { closestPathPoint } from "../track.js";
import { bodyFromFrontAxle, bodyFromRailProbe } from "./pose.js";
// Note: do not import off-rail.js here (circular). Wall resolve for free cars is in train.js.

/** Max middle cars in one consist. */
export const MAX_MID_CARS = 3;

/**
 * Rigid coupler: same length on-rail and off-rail (short air gap).
 * On-rail path-walk seating was removed — it lengthened links and teleported.
 */
export const COUPLER_AIR_GAP = 12;
export const COUPLER_DIST = TRAIN_LENGTH + COUPLER_AIR_GAP;
export const REAR_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;
export const FRONT_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;

let nextCarId = 1;

function newCarId(prefix = "car") {
  return `${prefix}${nextCarId++}`;
}

function matchTravelAng(prevAng, pathAng) {
  const dFwd = Math.atan2(
    Math.sin(prevAng - pathAng),
    Math.cos(prevAng - pathAng)
  );
  const dRev = Math.atan2(
    Math.sin(prevAng - (pathAng + Math.PI)),
    Math.cos(prevAng - (pathAng + Math.PI))
  );
  if (Math.abs(dRev) < Math.abs(dFwd)) {
    return normalizeAngle(pathAng + Math.PI);
  }
  return pathAng;
}

export function threeCarConsistSpec() {
  return [
    { role: "lead", kind: "engine", facing: 1 },
    { role: "mid", kind: "mid", facing: 1 },
    { role: "trail", kind: "engine", facing: -1 },
  ];
}

/**
 * Maximum supported authored chain: one powered engine, three middle cars,
 * and an optional reverse-facing trail engine. Keep the older
 * threeCarConsistSpec() above for callers that want the compact demo chain.
 */
export function threeMiddleConsistSpec({ trail = true } = {}) {
  const cars = [
    { role: "lead", kind: "engine", facing: 1 },
    ...Array.from({ length: MAX_MID_CARS }, () => ({
      role: "mid",
      kind: "mid",
      facing: 1,
    })),
  ];
  if (trail) cars.push({ role: "trail", kind: "engine", facing: -1 });
  return cars;
}

export function countMidCars(train) {
  return (train?.cars || []).filter((c) => c.kind === "mid").length;
}

function makeCar(partial) {
  return {
    id: partial.id || newCarId(partial.kind === "mid" ? "mid" : "eng"),
    role: partial.role || "mid",
    kind: partial.kind || "mid",
    facing: partial.facing ?? 1,
    coupled: partial.coupled !== false,
    powered: !!partial.powered,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    ang: partial.ang ?? 0,
    mode: partial.mode || TrainMode.IDLE,
    pathRef: partial.pathRef || null,
    s: partial.s ?? 0,
    dir: partial.dir ?? 1,
    vx: partial.vx ?? 0,
    vy: partial.vy ?? 0,
    reRailCooldown: partial.reRailCooldown ?? 0,
    lastRailExitKey: partial.lastRailExitKey || null,
    openMouthClearSteps: partial.openMouthClearSteps ?? 0,
    selected: !!partial.selected,
  };
}

/**
 * Wipe all rolling stock. Clears layout consistSpec so the next engine place
 * is single-unit only (no auto mid+trail from a leftover template).
 */
export function clearTrainCars(train) {
  if (!train) return;
  train.cars = null;
  train.consistSpec = null;
  train.poweredId = null;
  train.selectedCarId = null;
  train.pathRef = null;
  train.mode = TrainMode.IDLE;
  train.vx = 0;
  train.vy = 0;
  train.s = 0;
  train.dir = 1;
  train.selected = false;
  train.wallHit = false;
  train.offRailPreferAng = null;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.reRailDistLeft = 0;
  train.reRailCooldown = 0;
  train.cornerLockSteps = 0;
  train.cornerLockUx = null;
  train.cornerLockUy = null;
  train.openMouthClearSteps = 0;
}

/** Single engine entity (default place — never auto-appends mid/trail). */
export function ensureSingleEngine(train) {
  // Always one engine — drop any leftover multi-car template
  train.consistSpec = null;
  train.cars = [
    makeCar({
      id: "lead",
      role: "lead",
      kind: "engine",
      facing: 1,
      coupled: true,
      powered: true,
      x: train.x,
      y: train.y,
      ang: train.ang,
      mode: train.mode || TrainMode.IDLE,
      pathRef: train.pathRef,
      s: train.s,
      dir: train.dir,
    }),
  ];
  train.poweredId = "lead";
  return train.cars;
}

/**
 * Test/helper: build separate car entities from a list (or existing cars).
 * Does NOT store a multi-car template on train.consistSpec.
 * Prefer placeLayoutCars for layout load / production paths.
 */
export function ensureConsist(train, spec = null, _opts = {}) {
  const list =
    spec ||
    train.consistSpec ||
    (train.cars?.length
      ? train.cars.map((c) => ({
          role: c.role,
          kind: c.kind,
          facing: c.facing,
          coupled: c.coupled,
          powered: c.powered,
        }))
      : null);
  if (!list?.length) return ensureSingleEngine(train);
  const cars = placeLayoutCars(train, list, null, {
    seatHit: {
      x: train.x,
      y: train.y,
      ang: train.ang || 0,
      s: train.s || 0,
      path: train.pathRef?.path || null,
    },
    dir: train.dir || 1,
  });
  // Never leave a template that place/reset could re-inject
  train.consistSpec = null;
  return cars;
}

/**
 * Serialize live cars for save (each unit is its own entity).
 * Never emits a consist template / threeCarConsistSpec.
 */
export function serializeTrainCars(train) {
  if (!train?.cars?.length) return null;
  return train.cars.map((c) => ({
    id: c.id,
    role: c.role,
    kind: c.kind || "mid",
    facing: c.facing ?? 1,
    coupled: !!c.coupled,
    powered: !!c.powered,
    x: c.x,
    y: c.y,
    ang: c.ang,
    mode: c.mode || TrainMode.IDLE,
    s: c.s,
    dir: c.dir,
    vx: c.vx,
    vy: c.vy,
    reRailCooldown: c.reRailCooldown,
    lastRailExitKey: c.lastRailExitKey,
    openMouthClearSteps: c.openMouthClearSteps,
    pathRef: c.pathRef
      ? {
          pieceId: c.pathRef.pieceId,
          pathId: c.pathRef.pathId,
        }
      : null,
  }));
}

/**
 * Place separate rolling-stock entities from a saved/layout car list.
 * Couples units that request it — no hard-coded multi-car "turd" template.
 *
 * @param {object} train
 * @param {Array<object>} carsList [{ kind, role?, x?, y?, ang?, coupled?, powered?, facing? }]
 * @param {object|null} board for path snap
 * @param {{ seatHit?: object, dir?: number }} [opts]
 * @returns {object[]} train.cars
 */
export function placeLayoutCars(train, carsList, board = null, opts = {}) {
  clearTrainCars(train);
  train.consistSpec = null;
  if (!carsList?.length) return [];

  // Cap mids
  let midCount = 0;
  const list = [];
  for (const c of carsList) {
    const kind = c.kind || (c.role === "mid" ? "mid" : "engine");
    if (kind === "mid") {
      if (midCount >= MAX_MID_CARS) continue;
      midCount++;
    }
    list.push({ ...c, kind });
  }
  if (!list.length) return [];

  const dir = opts.dir === -1 || opts.dir === 1 ? opts.dir : 1;
  const seat = opts.seatHit || null;
  const preserveSavedState = !!opts.preserveSavedState;

  // Saved consists normally already have the powered unit first, but older
  // files and manually authored data may not. Keep the powered unit first so
  // getPoweredChain() and follower ordering remain deterministic.
  const poweredIndex = list.findIndex((c) => c.powered);
  if (poweredIndex > 0) {
    const powered = list[poweredIndex];
    list.splice(poweredIndex, 1);
    list.unshift(powered);
  }

  // --- Lead (powered) unit ---
  const leadSpec = list[0];
  const leadKind = leadSpec.kind || "engine";
  let leadX = leadSpec.x;
  let leadY = leadSpec.y;
  let leadAng = leadSpec.ang;
  let leadPath = null;
  let leadS = leadSpec.s ?? 0;

  if (board && seat?.path) {
    const pathAng = seat.ang ?? 0;
    const ang = dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
    const body = bodyFromFrontAxle(seat.x, seat.y, ang);
    leadX = body.x;
    leadY = body.y;
    leadAng = ang;
    leadPath = {
      path: seat.path,
      pieceId: seat.path.pieceId,
      pathId: seat.path.id,
    };
    leadS = seat.s ?? 0;
  } else if (board && leadX != null && leadY != null) {
    const hit = closestPathPoint(board, leadX, leadY, 64);
    if (hit) {
      const ang =
        dir > 0 ? hit.ang : normalizeAngle(hit.ang + Math.PI);
      const body = bodyFromFrontAxle(hit.x, hit.y, ang);
      leadX = body.x;
      leadY = body.y;
      leadAng = ang;
      leadPath = {
        path: hit.path,
        pieceId: hit.path.pieceId,
        pathId: hit.path.id,
      };
      leadS = hit.s;
    }
  } else if (leadX == null || leadY == null) {
    leadX = train.x || 0;
    leadY = train.y || 0;
    leadAng = leadAng ?? train.ang ?? 0;
  }

  train.x = leadX;
  train.y = leadY;
  train.ang = leadAng ?? 0;
  train.dir = dir;
  train.s = leadS;
  train.pathRef = leadPath;
  train.mode = TrainMode.ON_RAIL;
  train.consistSpec = null;

  train.cars = [
    makeCar({
      id: leadSpec.id || "lead",
      role: leadSpec.role || "lead",
      kind: leadKind === "mid" ? "mid" : "engine",
      facing: leadSpec.facing ?? 1,
      coupled: true,
      powered: true,
      x: leadX,
      y: leadY,
      ang: leadAng ?? 0,
      mode: TrainMode.ON_RAIL,
      pathRef: leadPath,
      s: leadS,
      dir,
    }),
  ];
  train.poweredId = train.cars[0].id;

  // --- Followers: each is its own entity, then couple ---
  for (let i = 1; i < list.length; i++) {
    const spec = list[i];
    const kind = spec.kind || "mid";
    const prev = train.cars[train.cars.length - 1];
    let x =
      spec.x != null
        ? spec.x
        : prev.x - Math.cos(prev.ang) * COUPLER_DIST;
    let y =
      spec.y != null
        ? spec.y
        : prev.y - Math.sin(prev.ang) * COUPLER_DIST;
    let ang = spec.ang != null ? spec.ang : prev.ang;

    if (board && !preserveSavedState) {
      const hit = closestPathPoint(board, x, y, 64);
      if (hit && hit.dist < 56) {
        const pang = matchTravelAng(prev.ang, hit.ang);
        const body = bodyFromFrontAxle(hit.x, hit.y, pang);
        // Prefer fixed coupler on path when possible
        const idealX = prev.x - Math.cos(pang) * COUPLER_DIST;
        const idealY = prev.y - Math.sin(pang) * COUPLER_DIST;
        const near = closestPathPoint(board, idealX, idealY, 28);
        if (near && near.dist < 16) {
          x = idealX;
          y = idealY;
          ang = matchTravelAng(prev.ang, near.ang);
        } else {
          x = body.x;
          y = body.y;
          ang = pang;
        }
      }
    }

    const isTrail =
      spec.role === "trail" ||
      (kind === "engine" && i === list.length - 1);
    const car = makeCar({
      id: spec.id || newCarId(kind === "mid" ? "mid" : "eng"),
      role: spec.role || (isTrail ? "trail" : "mid"),
      kind,
      facing: spec.facing ?? (isTrail && kind === "engine" ? -1 : 1),
      coupled: preserveSavedState ? spec.coupled !== false : false,
      powered: false,
      x,
      y,
      ang,
      mode: preserveSavedState ? spec.mode || TrainMode.ON_RAIL : TrainMode.ON_RAIL,
      dir,
    });
    if (board && !preserveSavedState) {
      const hit = closestPathPoint(board, x, y, 48);
      if (hit) {
        car.pathRef = {
          path: hit.path,
          pieceId: hit.path.pieceId,
          pathId: hit.path.id,
        };
        car.s = hit.s;
      }
    }
    train.cars.push(car);
    // Couple if layout says so (default true for authored layout cars).
    // Saved runtime state already carries exact coupling/order; do not run
    // recouple placement logic and accidentally reorder free cars.
    if (!preserveSavedState && spec.coupled !== false) {
      tryRecoupleCar(train, car.id, COUPLER_DIST * 2.5);
    }
  }

  // Final on-path seat for authored/layout placement. Saved runtime poses are
  // restored by restoreTrainSnapshot and must not be moved here.
  if (!preserveSavedState && board && train.cars.length > 1) {
    placeFollowers(train, {
      hard: false,
      whip: false,
      pathSeat: true,
      onRail: true,
      board,
    });
  } else if (!preserveSavedState && train.cars.length > 1) {
    placeFollowers(train, { hard: true, whip: false });
  }

  // Mark all coupled units on_rail
  for (const c of train.cars) {
    if (c.coupled || c.powered) {
      c.mode = TrainMode.ON_RAIL;
    }
  }
  return train.cars;
}

export function getPoweredChain(train) {
  if (!train?.cars?.length) return [];
  const cars = train.cars;
  let pIdx = cars.findIndex((c) => c.powered || c.id === train.poweredId);
  if (pIdx < 0) pIdx = 0;
  const chain = [cars[pIdx]];
  for (let i = pIdx + 1; i < cars.length; i++) {
    if (!cars[i].coupled) break;
    chain.push(cars[i]);
  }
  return chain;
}

/**
 * On-rail contact invariant: both compact axle circles must remain inside an
 * active centerline bed. This deliberately uses active paths rather than all
 * walls, because an inactive turnout branch is not a solid obstacle to a car
 * travelling on the selected route.
 */
export function railPoseClear(board, entity) {
  if (!board || !entity) return false;
  const safeRadius = Math.max(0, HALF_W - WHEEL_RADIUS);
  const ca = Math.cos(entity.ang || 0);
  const sa = Math.sin(entity.ang || 0);
  const probes = [
    {
      x: entity.x + ca * FRONT_AXLE_OFFSET,
      y: entity.y + sa * FRONT_AXLE_OFFSET,
    },
    {
      x: entity.x + ca * REAR_AXLE_OFFSET,
      y: entity.y + sa * REAR_AXLE_OFFSET,
    },
  ];
  return probes.every((probe) => {
    const hit = closestPathPoint(board, probe.x, probe.y, safeRadius + 0.5);
    return !!hit && hit.dist <= safeRadius + 0.5;
  });
}

/**
 * Place coupled followers with one shared coupler length (on-rail == off-rail).
 *
 * Per-car mode:
 * - hard:true (re-rail / seatConsistHard / lead-on dragging off-rail cars):
 *   straight fixed hitch — never whip (whipping piles cars at the lead).
 * - pathSeat:true + board (layout load / placeTrainOnPath multi-car):
 *   snap each follower onto the path ~COUPLER_DIST behind prev — NOT a
 *   straight world-space line that parks cars off the rails.
 * - whip:true (lead off-rail): trailer whip hitch.
 * - else: hitch + optional path heading for bends (same length as off-rail).
 */
export function placeFollowers(train, opts = {}) {
  if (!train) return { spacingOk: true, minSpacing: 0 };
  const hard = !!opts.hard;
  const board = opts.board || null;
  const telemetry = opts.telemetry;
  const hybridOffRail = !!opts.hybridOffRail;
  const pathSeat = !!opts.pathSeat && !!board;
  // whip only when explicitly requested (or default !hard). Off-rail cars
  // alone do NOT whip — that was stacking re-railed consists at path mouths.
  const whip = opts.whip != null ? !!opts.whip : !hard && !pathSeat;

  if (!train.cars?.length) {
    return { spacingOk: true, minSpacing: 0 };
  }
  const chain = getPoweredChain(train);
  if (!chain.length) return { spacingOk: true, minSpacing: 0 };
  const powered = chain[0];

  // Sync powered entity with train body
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.powered = true;
  powered.facing = 1;
  powered.mode = train.mode || powered.mode;
  if (train.mode === TrainMode.ON_RAIL || train.mode === TrainMode.IDLE) {
    if (train.pathRef) {
      powered.pathRef = train.pathRef;
      powered.s = train.s;
      powered.dir = train.dir;
    }
  }

  let minSpacing = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const car = chain[i];
    const hitchX = prev.x - Math.cos(prev.ang) * REAR_HITCH;
    const hitchY = prev.y - Math.sin(prev.ang) * REAR_HITCH;

    const prevOn =
      prev.mode === TrainMode.ON_RAIL ||
      prev.mode === TrainMode.IDLE ||
      (!prev.mode && train.mode !== TrainMode.OFF_RAIL);

    let ang = prev.ang;

    if (
      hybridOffRail &&
      car.coupled &&
      car.mode === TrainMode.ON_RAIL &&
      car.pathRef
    ) {
      // Mixed-domain stepping above owns an on-rail follower's pose. Do not
      // overwrite it with a straight hitch while it catches the rail or
      // floor mouth.
      const preservedSpacing = Math.hypot(car.x - prev.x, car.y - prev.y);
      if (preservedSpacing < minSpacing) minSpacing = preservedSpacing;
      telemetry?.event("follower_domain_pose_preserved", {
        carId: car.id,
        prevId: prev.id,
        mode: car.mode,
        pathKey: car.pathRef
          ? `${car.pathRef.pieceId}:${car.pathRef.pathId}`
          : null,
        spacing: preservedSpacing,
      });
      continue;
    }

    if (hybridOffRail && car.coupled && car.mode === TrainMode.OFF_RAIL) {
      // An off-rail follower still belongs to the chain. If it is far from
      // the predecessor's straight hitch, steer toward that hitch rather
      // than preserving a stale heading forever. Close cars fall through to
      // the exact hitch below and get a non-overlapping link. Do not let the
      // lead whip branch run when a middle car owns the live rail domain.
      const targetX = hitchX - Math.cos(prev.ang) * FRONT_HITCH;
      const targetY = hitchY - Math.sin(prev.ang) * FRONT_HITCH;
      const errorX = targetX - car.x;
      const errorY = targetY - car.y;
      const errorDist = Math.hypot(errorX, errorY);
      if (errorDist > RE_RAIL_LATERAL + FRONT_AXLE_OFFSET + 8) {
        const targetAng = Math.atan2(errorY, errorX);
        let turn = normalizeAngle(targetAng - (car.ang || prev.ang));
        const maxTurn = 0.45;
        turn = Math.max(-maxTurn, Math.min(maxTurn, turn));
        car.ang = normalizeAngle((car.ang || prev.ang) + turn);
        // A direction-only tether cannot catch a predecessor moving at the
        // same cruise speed. Apply a small bounded positional pull as well;
        // it is large enough to close a stretched coupler but never a full
        // frame teleport.
        const correction = Math.min(8, Math.max(2, errorDist * 0.1));
        car.x += (errorX / errorDist) * correction;
        car.y += (errorY / errorDist) * correction;
        const speed = Math.max(
          train.speed || 180,
          Math.hypot(car.vx || 0, car.vy || 0)
        );
        car.vx = Math.cos(car.ang) * speed;
        car.vy = Math.sin(car.ang) * speed;
        const spacing = Math.hypot(car.x - prev.x, car.y - prev.y);
        if (spacing < minSpacing) minSpacing = spacing;
        telemetry?.event("follower_hitch_tether", {
          carId: car.id,
          prevId: prev.id,
          error: errorDist,
          correction,
          targetX,
          targetY,
        });
        continue;
      }
      car.ang = prev.ang;
      car.x = targetX;
      car.y = targetY;
      telemetry?.event("follower_hitch_settled", {
        carId: car.id,
        prevId: prev.id,
        spacing: Math.hypot(car.x - prev.x, car.y - prev.y),
      });
      continue;
    }

    if (
      train.mode === TrainMode.OFF_RAIL &&
      car.mode === TrainMode.ON_RAIL &&
      car.pathRef
    ) {
      // The follower is still physically on its own rail path. Do not let
      // the off-rail lead's whip solver overwrite its independently stepped
      // pose; the coupler may stretch until this car reaches its own exit.
      telemetry?.event("follower_rail_preserved", {
        carId: car.id,
        prevId: prev.id,
        pathKey: `${car.pathRef.pieceId}:${car.pathRef.pathId}`,
        s: car.s,
      });
      const preservedSpacing = Math.hypot(car.x - prev.x, car.y - prev.y);
      if (preservedSpacing < minSpacing) minSpacing = preservedSpacing;
      continue;
    }

    // In a mixed chain, keep an already-on-rail follower on path geometry;
    // only the off-rail cars use the straight hitch. Otherwise a single
    // off-rail follower would make every on-rail follower lose its path pose.
    const carOnRail = car.mode !== TrainMode.OFF_RAIL;
    const hardThisCar = hard && !(board && carOnRail);
    const pathSeatThisCar = pathSeat || (hard && board && carOnRail);

    // hard:true (re-rail / seatConsistHard / mixed on+off) uses a straight
    // fixed hitch for off-rail cars — never trailer-whip those cars.
    if (hardThisCar) {
      car.ang = prev.ang;
      car.x = hitchX - Math.cos(car.ang) * FRONT_HITCH;
      car.y = hitchY - Math.sin(car.ang) * FRONT_HITCH;
    } else if (pathSeatThisCar) {
      // Layout / on-rail place: put follower ON the rails behind prev.
      // Probe center ~COUPLER_DIST back, snap to path, seat like lead
      // (front-axle on path). Keeps short coupler; avoids off-track spawn.
      const seated = seatFollowerOnPath(board, prev, car, opts.onRail);
      if (!seated) {
        // No connected rail behind: this car is genuinely off-rail. Do not
        // leave stale pathRef/s metadata while falling back to the hitch.
        car.mode = TrainMode.OFF_RAIL;
        car.pathRef = null;
        car.ang = prev.ang;
        car.x = hitchX - Math.cos(car.ang) * FRONT_HITCH;
        car.y = hitchY - Math.sin(car.ang) * FRONT_HITCH;
        telemetry?.event("follower_seat_failed", {
          carId: car.id,
          prevId: prev.id,
          reason: "no_connected_clear_path",
          fallback: "hard_hitch",
        });
      } else {
        telemetry?.event("follower_seat", {
          carId: car.id,
          prevId: prev.id,
          pathKey: car.pathRef
            ? `${car.pathRef.pieceId}:${car.pathRef.pathId}`
            : null,
          s: car.s,
          dir: car.dir,
          spacing: Math.hypot(car.x - prev.x, car.y - prev.y),
        });
      }
    } else if (whip) {
      // Lead off-rail: trailer whip (do not force onto rails)
      if (
        car.x != null &&
        Number.isFinite(car.x) &&
        Number.isFinite(car.y)
      ) {
        const dx = hitchX - car.x;
        const dy = hitchY - car.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-3) {
          const target = Math.atan2(dy, dx);
          let da = target - (car.ang || prev.ang);
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const maxTurn = 0.55;
          if (da > maxTurn) da = maxTurn;
          if (da < -maxTurn) da = -maxTurn;
          ang = (car.ang || prev.ang) + da;
        }
      }
      car.ang = ang;
      car.x = hitchX - Math.cos(ang) * FRONT_HITCH;
      car.y = hitchY - Math.sin(ang) * FRONT_HITCH;
    } else if (board && prevOn) {
      // On-rail running: seat ON the path (not chord hitch — that flies off curves)
      const seated = seatFollowerOnPath(board, prev, car, opts.onRail);
      if (!seated) {
        car.mode = TrainMode.OFF_RAIL;
        car.pathRef = null;
        car.ang = prev.ang;
        car.x = hitchX - Math.cos(car.ang) * FRONT_HITCH;
        car.y = hitchY - Math.sin(car.ang) * FRONT_HITCH;
        telemetry?.event("follower_seat_failed", {
          carId: car.id,
          prevId: prev.id,
          reason: "no_connected_clear_path",
          fallback: "hard_hitch",
        });
      } else {
        telemetry?.event("follower_seat", {
          carId: car.id,
          prevId: prev.id,
          pathKey: car.pathRef
            ? `${car.pathRef.pieceId}:${car.pathRef.pathId}`
            : null,
          s: car.s,
          dir: car.dir,
          spacing: Math.hypot(car.x - prev.x, car.y - prev.y),
        });
      }
    } else {
      // No board: fixed hitch length along prev heading
      car.ang = prev.ang;
      car.x = hitchX - Math.cos(car.ang) * FRONT_HITCH;
      car.y = hitchY - Math.sin(car.ang) * FRONT_HITCH;
    }

    if (car.kind === "engine" && !car.powered) car.facing = -1;
    if (car.kind === "mid") car.facing = 1;

    const sp = Math.hypot(car.x - prev.x, car.y - prev.y);
    if (sp < minSpacing) minSpacing = sp;
  }
  if (!Number.isFinite(minSpacing)) minSpacing = 0;
  const spacingOk =
    chain.length < 2 || Math.abs(minSpacing - COUPLER_DIST) < 4;
  return { spacingOk, minSpacing };
}

/**
 * Seat one follower ON the path exactly COUPLER_DIST of path travel behind
 * prev. The old implementation probed a world-space chord and chose the
 * nearest path sample; on curves and joints that put cars 20–40px too close
 * or even on a different branch. This walks the active path graph instead.
 * @returns {boolean} true if a path seat was found
 */
function seatFollowerOnPath(board, prev, car, forceOnRail) {
  if (!board || !prev || !car) return false;
  if (prev.mode !== TrainMode.ON_RAIL || !prev.pathRef) return false;

  const seat = findFollowerRailSeat(board, prev, car, { near: false });
  if (!seat) return false;

  car.x = seat.body.x;
  car.y = seat.body.y;
  car.ang = seat.target.ang;
  car.pathRef = {
    path: seat.target.path,
    pieceId: seat.target.path.pieceId,
    pathId: seat.target.path.id,
  };
  car.s = seat.target.s;
  car.dir = seat.target.dir;
  if (forceOnRail) car.mode = TrainMode.ON_RAIL;
  car.vx = 0;
  car.vy = 0;
  return true;
}

/** Candidate path-distance offsets used for both placement and recovery. */
const FOLLOWER_SEAT_DISTANCES = [
  0,
  4,
  8,
  12,
  16,
  24,
  32,
  48,
  -4,
  -8,
  -12,
];

function followerRailTargets(board, prev) {
  if (!board || !prev || prev.mode !== TrainMode.ON_RAIL || !prev.pathRef) {
    return [];
  }
  const targets = [];
  for (const delta of FOLLOWER_SEAT_DISTANCES) {
    const target = pathPoseBehind(board, prev, COUPLER_DIST + delta);
    if (target) targets.push(target);
  }
  return targets;
}

/**
 * Find a safe rail pose behind an already on-rail predecessor.
 *
 * `near: false` is used while initially seating a consist and permits the
 * caller to place the car. `near: true` is used during recovery and requires
 * the existing body pose to be close to the predecessor's connected rail
 * seat. This prevents a newly rerailing middle car from making the following
 * car teleport to whichever visually closest branch happens to be nearby.
 */
function findFollowerRailSeat(board, prev, car, { near = true } = {}) {
  const targets = followerRailTargets(board, prev);
  for (const target of targets) {
    const body = bodyFromFrontAxle(target.x, target.y, target.ang);
    const candidate = { ...car, x: body.x, y: body.y, ang: target.ang };
    if (!railPoseClear(board, candidate)) continue;

    const centerDist = Math.hypot(candidate.x - prev.x, candidate.y - prev.y);
    if (centerDist + 0.5 < carMinCenterDist(prev, candidate)) continue;

    if (near) {
      const currentOffset = Math.hypot(car.x - body.x, car.y - body.y);
      if (currentOffset > RE_RAIL_LATERAL + FRONT_AXLE_OFFSET + 8) continue;
      const headingError = Math.min(
        angleDiff(car.ang || 0, target.ang),
        angleDiff(car.ang || 0, target.ang + Math.PI)
      );
      const nearMouth = target.s < 0.12 || target.s > 0.88;
      const angleLimit = nearMouth ? RE_RAIL_ANGLE * 1.25 : RE_RAIL_ANGLE;
      if (headingError > angleLimit) continue;
      return {
        target,
        body,
        centerDist,
        currentOffset,
        headingError,
      };
    }

    return { target, body, centerDist, currentOffset: 0, headingError: 0 };
  }
  return false;
}

function livePathForRef(board, ref) {
  if (!board || !ref) return null;
  return (
    board.pathIndex?.find(
      (path) =>
        path.active &&
        path.pieceId === ref.pieceId &&
        path.id === ref.pathId
    ) || null
  );
}

function connectedPathCandidates(board, nodeKey, excludedKey, desiredDir, travelAng) {
  const graph = board?.graph;
  if (!graph?.nodes) return [];

  const queue = [nodeKey];
  const seen = new Set([nodeKey]);
  const candidates = [];
  while (queue.length) {
    const key = queue.shift();
    const node = graph.nodes.get(key);
    if (!node) continue;
    for (const edge of node.edges || []) {
      if (edge.link) {
        if (!seen.has(edge.to)) {
          seen.add(edge.to);
          queue.push(edge.to);
        }
        continue;
      }
      const path = edge.path;
      if (!path?.active) continue;
      const pathKey = `${path.pieceId}:${path.id}`;
      if (pathKey === excludedKey) continue;

      // At a path endpoint, reverse=false means this node is fromC and
      // reverse=true means it is toC. A train travelling desiredDir arrives
      // at the node when desiredDir matches the opposite of edge.reverse.
      const candidateDir = edge.reverse ? 1 : -1;
      const endpointS = candidateDir > 0 ? 1 : 0;
      const endpoint = pointOnPolyline(path.points, endpointS);
      const entryAng =
        candidateDir > 0
          ? endpoint.ang
          : normalizeAngle(endpoint.ang + Math.PI);
      candidates.push({
        path,
        dir: candidateDir,
        s: endpointS,
        err: angleDiff(entryAng, travelAng),
        dirPenalty: candidateDir === desiredDir ? 0 : Math.PI,
      });
    }
  }
  candidates.sort(
    (a, b) =>
      a.err * 2 + a.dirPenalty * 0.05 -
      (b.err * 2 + b.dirPenalty * 0.05)
  );
  return candidates;
}

/** Return the front-axle path pose a fixed distance behind a rail car. */
function pathPoseBehind(board, prev, distance) {
  let path = livePathForRef(board, prev.pathRef);
  if (!path || path.length <= 1e-6) return null;

  let dir = prev.dir === -1 ? -1 : 1;
  let s = Math.max(0, Math.min(1, Number(prev.s) || 0));
  let remaining = Math.max(0, distance);
  const travelPose = pointOnPolyline(path.points, s);
  const travelAng =
    dir > 0 ? travelPose.ang : normalizeAngle(travelPose.ang + Math.PI);

  for (let hop = 0; hop < 32; hop++) {
    const len = Math.max(path.length || 0, 1e-6);
    const available = dir > 0 ? s * len : (1 - s) * len;
    if (remaining <= available + 1e-6) {
      const targetS =
        dir > 0
          ? s - remaining / len
          : s + remaining / len;
      const target = pointOnPolyline(path.points, targetS);
      const ang =
        dir > 0 ? target.ang : normalizeAngle(target.ang + Math.PI);
      return { path, s: targetS, dir, x: target.x, y: target.y, ang };
    }

    remaining -= available;
    const nodeKey = `${path.pieceId}:${dir > 0 ? path.fromC : path.toC}`;
    const candidates = connectedPathCandidates(
      board,
      nodeKey,
      `${path.pieceId}:${path.id}`,
      dir,
      travelAng
    );
    // Path parameter direction may reverse at a welded connector. Preserve
    // the physical travel heading, not the local s sign.
    const next = candidates[0];
    if (!next) return null;

    path = next.path;
    dir = next.dir;
    s = next.s;
  }
  return null;
}

/** Seat full consist on rails (layout load / multi-car place). */
export function seatConsistOnPath(train, board) {
  return placeFollowers(train, {
    hard: false,
    whip: false,
    pathSeat: true,
    onRail: true,
    board,
  });
}

export function seatConsistHard(train, telemetry = null) {
  // Hard hitch only — does not change per-car modes
  return placeFollowers(train, {
    hard: true,
    whip: false,
    onRail: false,
    telemetry,
  });
}

/** Mark all cars off-rail with inherited velocity (lead derail). */
export function markChainOffRail(train, opts = {}) {
  const sp = train.speed || 180;
  const vx = Math.cos(train.ang) * sp;
  const vy = Math.sin(train.ang) * sp;
  for (const c of train.cars || []) {
    if (!c.coupled && !c.powered) continue;
    if (
      opts.preserveOnRailFollowers &&
      !c.powered &&
      c.mode === TrainMode.ON_RAIL &&
      c.pathRef
    ) {
      continue;
    }
    c.mode = TrainMode.OFF_RAIL;
    c.pathRef = null;
    c.vx = vx;
    c.vy = vy;
  }
}

/** Powered unit re-railed — only that car becomes on_rail. */
export function markPoweredOnRail(train) {
  const powered =
    (train.cars || []).find((c) => c.powered || c.id === train.poweredId) ||
    train.cars?.[0];
  if (!powered) return;
  powered.mode = TrainMode.ON_RAIL;
  powered.pathRef = train.pathRef;
  powered.s = train.s;
  powered.dir = train.dir;
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.vx = 0;
  powered.vy = 0;
  // Followers keep their mode; hard-hitch positions only for still-coupled
  seatConsistHard(train);
}

/**
 * Try to re-rail a single non-powered car. Returns true if it caught a rail.
 *
 * Coupled followers re-rail as their own entities (mode flip + path attach).
 * They must NOT relocate via bodyFromFrontAxle onto closestPathPoint — that
 * stacks mid/trail at path mouths/junctions. Keep hitch pose; reject if
 * spacing to prev would collapse. A short lead re-rail grace prevents a
 * same-frame mass flip, then each follower is checked independently.
 */
function commitFollowerRerail(car, path, body, s, dir, telemetry, data = {}) {
  const pathKey = `${path.pieceId}:${path.id}`;
  car.mode = TrainMode.ON_RAIL;
  car.pathRef = {
    path,
    pieceId: path.pieceId,
    pathId: path.id,
  };
  car.s = s;
  car.dir = dir;
  car.x = body.x;
  car.y = body.y;
  car.ang = body.ang;
  car.vx = 0;
  car.vy = 0;
  car.reRailCooldown = 0;
  car.lastRailExitKey = null;
  telemetry?.event("follower_rerail", {
    carId: car.id,
    pathKey,
    s,
    dir,
    ...data,
  });
  return true;
}

export function tryRerailCar(car, board, train, telemetry = null) {
  if (!car || !board || car.powered) return false;
  if (car.mode === TrainMode.ON_RAIL) return false;

  if ((car.reRailCooldown || 0) > 0) {
    telemetry?.event("follower_rerail_blocked", {
      carId: car.id,
      reason: "car_rerail_grace",
      cooldown: car.reRailCooldown,
      lastRailExitKey: car.lastRailExitKey,
    });
    return false;
  }

  if (car.coupled && train && (train.reRailCooldown || 0) > 0) {
    telemetry?.event("follower_rerail_blocked", {
      carId: car.id,
      reason: "lead_rerail_grace",
      cooldown: train.reRailCooldown,
    });
    return false;
  }

  const chain = train?.cars?.length ? getPoweredChain(train) : [];
  const idx = chain.findIndex((c) => c.id === car.id);
  const prev = idx > 0 ? chain[idx - 1] : null;
  const coupledInChain = !!(car.coupled && prev);

  // Recover a coupled chain from front to back. The first follower may catch
  // a rail while the powered lead is still on the floor, but a later car must
  // not independently snap to a distant nearby path while its predecessor
  // is still off rail. That creates a broken chain and the visible whip.
  if (
    coupledInChain &&
    idx > 1 &&
    (prev.mode !== TrainMode.ON_RAIL || !prev.pathRef)
  ) {
    telemetry?.event("follower_rerail_blocked", {
      carId: car.id,
      reason: "predecessor_off_rail",
      predecessorId: prev.id,
    });
    return false;
  }

  // Once the predecessor is on a rail, recovery must use the connected path
  // seat behind it. This is deliberately attempted before the global nearest
  // path probe: at turnouts the nearest branch is often not the branch the
  // consist is physically following.
  const connectedTargets =
    coupledInChain && prev.mode === TrainMode.ON_RAIL && prev.pathRef
      ? followerRailTargets(board, prev)
      : [];
  const connectedSeat = connectedTargets.length
    ? findFollowerRailSeat(board, prev, car, { near: true })
    : null;
  if (connectedSeat) {
    return commitFollowerRerail(
      car,
      connectedSeat.target.path,
      { ...connectedSeat.body, ang: connectedSeat.target.ang },
      connectedSeat.target.s,
      connectedSeat.target.dir,
      telemetry,
      {
        anchor: "coupler",
        spacing: connectedSeat.centerDist,
        predecessorId: prev.id,
      }
    );
  }

  const carAng = car.ang || 0;
  const probes = [
    {
      anchor: "front",
      x: car.x + Math.cos(carAng) * FRONT_AXLE_OFFSET,
      y: car.y + Math.sin(carAng) * FRONT_AXLE_OFFSET,
    },
    { anchor: "body", x: car.x, y: car.y },
    {
      anchor: "rear",
      x: car.x + Math.cos(carAng) * REAR_AXLE_OFFSET,
      y: car.y + Math.sin(carAng) * REAR_AXLE_OFFSET,
    },
  ];
  let hit = null;
  for (const probe of probes) {
    const h = closestPathPoint(
      board,
      probe.x,
      probe.y,
      RE_RAIL_LATERAL + 10
    );
    if (!h) continue;
    if (!hit || h.dist < hit.dist) hit = { ...h, anchor: probe.anchor };
  }
  if (!hit) {
    telemetry?.event("follower_rerail_miss", {
      carId: car.id,
      reason: "no_near_path",
    });
    return false;
  }

  const pathAng = hit.ang;
  const d1 = angleDiff(car.ang, pathAng);
  const d2 = angleDiff(car.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);
  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  const angLimit = nearMouth ? RE_RAIL_ANGLE * 1.25 : RE_RAIL_ANGLE * 0.85;
  const latLimit = nearMouth ? RE_RAIL_LATERAL + 6 : RE_RAIL_LATERAL + 2;
  if (hit.dist > latLimit || best > angLimit) {
    telemetry?.event("follower_rerail_miss", {
      carId: car.id,
      reason: "geometry_gate",
      pathKey: `${hit.path.pieceId}:${hit.path.id}`,
      dist: hit.dist,
      bestAngle: best,
      nearMouth,
    });
    return false;
  }

  const dir = d1 <= d2 ? 1 : -1;
  const ang = dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  const pathKey = `${hit.path.pieceId}:${hit.path.id}`;

  // A coupled car whose predecessor is on rail must wait for the connected
  // coupler seat. Do not use a same-path nearest hit either: on a curve that
  // can still move the body to the wrong s and stretch the next link.
  if (connectedTargets.length) {
    telemetry?.event("follower_rerail_miss", {
      carId: car.id,
      reason: "predecessor_seat_not_ready",
      pathKey,
      predecessorId: prev.id,
    });
    return false;
  }

  if (coupledInChain) {
    // Snap the actual body/axles to the candidate path. The previous code
    // only attached metadata while keeping the hitch pose, which created an
    // on-rail pathRef whose world pose was still off the rail.
    const body = bodyFromRailProbe(hit.x, hit.y, ang, hit.anchor);
    const candidate = { ...car, x: body.x, y: body.y, ang };
    if (!railPoseClear(board, candidate)) {
      telemetry?.event("follower_rerail_miss", {
        carId: car.id,
        reason: "rail_bed_clearance",
        pathKey,
      });
      return false;
    }
    const d = Math.hypot(body.x - prev.x, body.y - prev.y);
    if (d + 0.5 < carMinCenterDist(prev, candidate)) {
      telemetry?.event("follower_rerail_miss", {
        carId: car.id,
        reason: "coupler_spacing",
        spacing: d,
      });
      return false;
    }
    return commitFollowerRerail(
      car,
      hit.path,
      body,
      hit.s,
      dir,
      telemetry,
      {
        anchor: hit.anchor,
        spacing: d,
        predecessorId: prev.id,
      }
    );
  }

  // Free / uncoupled car: full path snap
  const body = bodyFromRailProbe(hit.x, hit.y, ang, hit.anchor);
  if (prev) {
    const d = Math.hypot(body.x - prev.x, body.y - prev.y);
    if (d + 0.5 < carMinCenterDist(prev, { ...car, x: body.x, y: body.y, ang })) {
      telemetry?.event("follower_rerail_miss", {
        carId: car.id,
        reason: "coupler_spacing",
        spacing: d,
      });
      return false;
    }
  }

  car.mode = TrainMode.ON_RAIL;
  car.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  car.s = hit.s;
  car.dir = dir;
  car.x = body.x;
  car.y = body.y;
  car.ang = ang;
  car.vx = 0;
  car.vy = 0;
  car.reRailCooldown = 0;
  car.lastRailExitKey = null;
  telemetry?.event("follower_rerail", {
    carId: car.id,
    pathKey,
    s: hit.s,
    dir,
    anchor: hit.anchor,
  });
  return true;
}

export function uncoupleCar(train, carId) {
  if (!train?.cars) return false;
  const chain = getPoweredChain(train);
  const idx = chain.findIndex((c) => c.id === carId);
  if (idx <= 0) return false;
  for (let i = idx; i < chain.length; i++) {
    chain[i].coupled = false;
    chain[i].powered = false;
  }
  return true;
}

/**
 * Remove a car from the world entirely (Delete). Not just uncouple.
 * If it was powered, promote another car or clear the train.
 * @returns {{ removed: boolean, cleared: boolean }}
 */
export function removeCar(train, carId) {
  if (!train?.cars?.length) return { removed: false, cleared: false };
  const idx = train.cars.findIndex((c) => c.id === carId);
  if (idx < 0) return { removed: false, cleared: false };
  const wasPowered =
    !!train.cars[idx].powered || train.cars[idx].id === train.poweredId;
  train.cars.splice(idx, 1);
  if (!train.cars.length) {
    clearTrainCars(train);
    return { removed: true, cleared: true };
  }
  // Drop layout template so it cannot re-spawn deleted units
  train.consistSpec = null;
  if (wasPowered) {
    const next =
      train.cars.find((c) => c.kind === "engine") || train.cars[0];
    for (const c of train.cars) {
      c.powered = false;
    }
    next.powered = true;
    next.facing = 1;
    next.coupled = true;
    train.poweredId = next.id;
    train.x = next.x;
    train.y = next.y;
    train.ang = next.ang;
    train.mode = next.mode || train.mode;
    train.pathRef = next.pathRef;
    train.s = next.s ?? train.s;
    train.dir = next.dir ?? train.dir;
    // Re-order so powered is first in cars list for chain helpers
    train.cars = [next, ...train.cars.filter((c) => c.id !== next.id)];
  }
  if (train.selectedCarId === carId) train.selectedCarId = train.poweredId;
  return { removed: true, cleared: false };
}

export function tryRecoupleCar(train, carId, maxDist = COUPLER_DIST * 1.35) {
  if (!train?.cars) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.powered) return false;
  if (car.kind === "mid" && countMidCars(train) > MAX_MID_CARS) return false;

  const chain = getPoweredChain(train);
  if (!chain.length) return false;
  const tail = chain[chain.length - 1];
  // Cap mid count when recoupling a mid into a chain that already has 3
  if (car.kind === "mid") {
    const midsInChain = chain.filter((c) => c.kind === "mid").length;
    if (midsInChain >= MAX_MID_CARS) return false;
  }

  const hitchX = tail.x - Math.cos(tail.ang) * REAR_HITCH;
  const hitchY = tail.y - Math.sin(tail.ang) * REAR_HITCH;
  const noseX = car.x + Math.cos(car.ang) * FRONT_HITCH;
  const noseY = car.y + Math.sin(car.ang) * FRONT_HITCH;
  if (Math.hypot(noseX - hitchX, noseY - hitchY) > maxDist) return false;
  car.coupled = true;
  // Match mode of tail for now; if tail on rail and car was off, keep car off
  // until it re-rails itself
  train.cars = train.cars.filter((c) => c.id !== carId);
  const p2 = train.cars.findIndex(
    (c) => c.powered || c.id === train.poweredId
  );
  let end = p2;
  while (end + 1 < train.cars.length && train.cars[end + 1].coupled) end++;
  train.cars.splice(end + 1, 0, car);
  placeFollowers(train, { hard: true, onRail: false });
  return true;
}

export function setActiveEngine(train, carId) {
  if (!train?.cars?.length) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.kind !== "engine") return false;

  const chain = getPoweredChain(train);
  const idx = chain.findIndex((c) => c.id === carId);
  if (idx < 0) {
    if (!car.coupled && !car.powered) {
      for (const c of train.cars) c.powered = false;
      car.powered = true;
      car.facing = 1;
      train.poweredId = car.id;
      train.x = car.x;
      train.y = car.y;
      train.ang = car.ang;
      train.mode = car.mode || train.mode;
      train.pathRef = car.pathRef;
      train.s = car.s;
      train.dir = car.dir;
      train.cars = [car, ...train.cars.filter((c) => c !== car)];
      return true;
    }
    return false;
  }
  if (idx === 0) return true;

  const head = chain.slice(0, idx + 1);
  const behind = chain.slice(idx + 1);
  const free = train.cars.filter((c) => !chain.includes(c));
  const prev = head[idx - 1];
  const intoX = prev.x - car.x;
  const intoY = prev.y - car.y;
  const intoL = Math.hypot(intoX, intoY) || 1;
  train.ang = Math.atan2(-intoY / intoL, -intoX / intoL);
  train.x = car.x;
  train.y = car.y;
  train.mode = car.mode || train.mode;
  train.pathRef = car.pathRef;
  train.s = car.s ?? train.s;
  train.dir = car.dir ?? train.dir;

  const newHead = head.slice().reverse();
  for (const c of newHead) {
    c.coupled = true;
    c.powered = c.id === carId;
  }
  for (const c of behind) {
    c.coupled = false;
    c.powered = false;
  }
  car.facing = 1;
  for (let i = 1; i < newHead.length; i++) {
    if (newHead[i].kind === "engine") newHead[i].facing = -1;
  }
  train.poweredId = carId;
  train.cars = [...newHead, ...behind, ...free];
  placeFollowers(train, { hard: true, onRail: false });
  return true;
}

export function hitTestCar(train, x, y, hitR = TRAIN_RADIUS + 12) {
  if (!train?.cars?.length) return null;
  for (let i = train.cars.length - 1; i >= 0; i--) {
    const c = train.cars[i];
    if (Math.hypot(c.x - x, c.y - y) <= hitR) return c;
  }
  return null;
}

/**
 * Spawn free mid or engine. Blocks 4th mid car.
 * @returns {object|null} car or null if blocked
 */
export function spawnFreeCar(train, kind, x, y, ang = 0) {
  if (!train.cars) train.cars = [];
  if (kind === "mid" && countMidCars(train) >= MAX_MID_CARS) {
    return null;
  }
  const car = makeCar({
    id: newCarId(kind === "mid" ? "mid" : "eng"),
    role: kind === "mid" ? "mid" : "trail",
    kind: kind === "mid" ? "mid" : "engine",
    facing: kind === "engine" ? -1 : 1,
    coupled: false,
    powered: false,
    x,
    y,
    ang,
    mode: TrainMode.IDLE,
  });
  if (!train.cars.length && kind === "engine") {
    car.id = "lead";
    car.role = "lead";
    car.powered = true;
    car.facing = 1;
    car.coupled = true;
    train.poweredId = car.id;
    train.x = x;
    train.y = y;
    train.ang = ang;
  }
  train.cars.push(car);
  return car;
}

export function snapCarPoseToHit(car, hit, dir = 1) {
  if (!car || !hit) return false;
  const pathAng = hit.ang;
  const ang = dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  car.x = hit.x - Math.cos(ang) * FRONT_AXLE_OFFSET;
  car.y = hit.y - Math.sin(ang) * FRONT_AXLE_OFFSET;
  car.ang = ang;
  car.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  car.s = hit.s;
  car.dir = dir;
  car.mode = TrainMode.ON_RAIL;
  car.vx = 0;
  car.vy = 0;
  return true;
}

export function couplerLink(prev, car) {
  if (!prev || !car) return null;
  const x1 = prev.x - Math.cos(prev.ang) * REAR_HITCH * 0.85;
  const y1 = prev.y - Math.sin(prev.ang) * REAR_HITCH * 0.85;
  const x2 = car.x + Math.cos(car.ang) * FRONT_HITCH * 0.85;
  const y2 = car.y + Math.sin(car.ang) * FRONT_HITCH * 0.85;
  return { x1, y1, x2, y2 };
}

export function consistLinks(train) {
  const chain = getPoweredChain(train);
  const links = [];
  for (let i = 1; i < chain.length; i++) {
    const L = couplerLink(chain[i - 1], chain[i]);
    if (L) links.push(L);
  }
  return links;
}

/** Skin gap between solid car bodies (px). */
export const CAR_BODY_SKIN = 2;

/**
 * Projected half-extent of an oriented car box onto unit axis (ux, uy).
 * Cars are solid OBBs: length × 2×radius.
 */
export function carProjectedHalf(car, ux, uy) {
  const fx = Math.cos(car.ang || 0);
  const fy = Math.sin(car.ang || 0);
  const sx = -fy;
  const sy = fx;
  const halfL = TRAIN_LENGTH * 0.5;
  const halfW = TRAIN_RADIUS;
  return (
    halfL * Math.abs(fx * ux + fy * uy) + halfW * Math.abs(sx * ux + sy * uy)
  );
}

/**
 * Minimum center distance for two solid cars along the line joining centers.
 */
export function carMinCenterDist(a, b) {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.hypot(dx, dy);
  let ux;
  let uy;
  if (d < 1e-6) {
    dx = Math.cos(a.ang || 0);
    dy = Math.sin(a.ang || 0);
    const axisLen = Math.hypot(dx, dy) || 1;
    ux = dx / axisLen;
    uy = dy / axisLen;
  } else {
    ux = dx / d;
    uy = dy / d;
  }
  return (
    carProjectedHalf(a, ux, uy) + carProjectedHalf(b, ux, uy) + CAR_BODY_SKIN
  );
}

/**
 * Solid train-on-train collision: each car is an oriented box; separate pairs
 * that penetrate. Powered on-rail unit stays fixed when possible so the consist
 * does not get shoved off the path. Coupled hitch spacing already uses
 * COUPLER_DIST > body length, so healthy links do not fight this resolver.
 *
 * @returns {{ pairs: number, separated: number }}
 */
export function resolveCarCollisions(train, opts = {}) {
  const cars = train?.cars;
  if (!cars || cars.length < 2) return { pairs: 0, separated: 0 };
  const iters = opts.iters != null ? opts.iters : 4;
  let separated = 0;

  for (let iter = 0; iter < iters; iter++) {
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        if (a.x == null || b.x == null) continue;

        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d = Math.hypot(dx, dy);
        let ux;
        let uy;
        if (d < 1e-6) {
          dx = Math.cos(a.ang || 0) || 1;
          dy = Math.sin(a.ang || 0);
          const axisLen = Math.hypot(dx, dy) || 1;
          ux = dx / axisLen;
          uy = dy / axisLen;
          d = 0;
        } else {
          ux = dx / d;
          uy = dy / d;
        }
        const minD =
          carProjectedHalf(a, ux, uy) +
          carProjectedHalf(b, ux, uy) +
          CAR_BODY_SKIN;
        if (d >= minD) continue;

        const pen = minD - d;
        // Lock rail-owned units as well as the powered unit; free / off-rail
        // cars move. The train object is authoritative for the powered unit,
        // while an on-rail follower is authoritative for its path pose. Do
        // not shove either one away from its rail just because a recovering
        // downstream car briefly overlaps it.
        const aLock =
          train.mode !== TrainMode.IDLE &&
          !!(a.powered || a.mode === TrainMode.ON_RAIL);
        const bLock =
          train.mode !== TrainMode.IDLE &&
          !!(b.powered || b.mode === TrainMode.ON_RAIL);

        // Two rail-owned poses are resolved by path seating, not by a world
        // collision push. Moving either one here would make its pathRef and
        // world pose disagree and can start an oscillating follower.
        if (aLock && bLock) continue;
        let wa = aLock ? 0 : 1;
        let wb = bLock ? 0 : 1;
        if (wa + wb === 0) {
          // Both locked — still separate the non-primary by preference of b
          wa = 0;
          wb = 1;
        }
        const inv = 1 / (wa + wb);
        a.x -= ux * pen * wa * inv;
        a.y -= uy * pen * wa * inv;
        b.x += ux * pen * wb * inv;
        b.y += uy * pen * wb * inv;

        // Kill closing relative velocity on free cars (soft bounce)
        if (a.vx != null || b.vx != null) {
          const avx = a.vx || 0;
          const avy = a.vy || 0;
          const bvx = b.vx || 0;
          const bvy = b.vy || 0;
          const rel = (bvx - avx) * ux + (bvy - avy) * uy;
          if (rel < 0) {
            const push = -rel * 0.5;
            if (!aLock) {
              a.vx = avx - ux * push;
              a.vy = avy - uy * push;
            }
            if (!bLock) {
              b.vx = bvx + ux * push;
              b.vy = bvy + uy * push;
            }
          }
        }
        separated++;
      }
    }
  }
  // pairs counted per iter — report unique pair count
  const n = cars.length;
  return { pairs: (n * (n - 1)) / 2, separated };
}
