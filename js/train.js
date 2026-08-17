/**
 * Train: path following, derail → wall glide → re-rail, canvas edge stop.
 *
 * Modules: train/constants.js, train/pose.js, train/off-rail.js, on-rail (here).
 */

import {
  pointOnPolyline,
  angleDiff,
  normalizeAngle,
} from "./geometry.js";
import { closestPathPoint } from "./track.js";
import {
  TrainMode,
  FRONT_AXLE_OFFSET,
  PATH_HOP_DIST,
  PATH_HOP_ANGLE,
  SOLID_PLAYFIELD_FIT_PAD,
} from "./train/constants.js";
import { frontAxlePos, bodyFromFrontAxle } from "./train/pose.js";
import { snapshotTrain } from "./train/telemetry.js";
import { couplerError } from "./world-model.js";
import {
  leaveRails,
  stepOffRail,
  stepOffRailEntity,
  resolveOffRailContacts,
} from "./train/off-rail.js";
import {
  captureConsistFrame,
  consistPinState,
  initializeCoupledConsist,
  resetConsistMotion,
  solveCoupledConsist,
} from "./train/motion-trail.js";
import {
  ensureConsist,
  ensureSingleEngine,
  placeFollowers,
  railPoseClear,
  seatConsistHard,
  getPoweredChain,
  threeCarConsistSpec,
  threeMiddleConsistSpec,
  COUPLER_DIST,
  MAX_MID_CARS,
  countMidCars,
  getTrainInsertionTargets,
  uncoupleCar,
  tryRecoupleCar,
  setActiveEngine,
  hitTestCar,
  spawnFreeCar,
  snapCarPoseToHit,
  consistLinks,
  couplerLink,
  tryRerailCar,
  markChainOffRail,
  markPoweredOnRail,
  resolveCarCollisions,
  carMinCenterDist,
  carProjectedHalf,
  CAR_BODY_SKIN,
  seatConsistOnPath,
  clearTrainCars,
  removeCar,
  placeLayoutCars,
  serializeTrainCars,
  capturePlacementState,
  commitCoupledPlacement,
  trainBodyOverlaps,
  validateTrainPlacement,
} from "./train/consist.js";

export {
  TrainMode,
  TRAIN_RADIUS,
  TRAIN_LENGTH,
  FRONT_AXLE_FROM_NOSE,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
  COUPLER_LATERAL_LIMIT,
  COUPLER_CENTER_BIAS_OFF_RAIL,
  COUPLER_CENTER_BIAS_ON_RAIL,
  COUPLER_CENTER_CURVE_ANGLE,
  WHEEL_RADIUS,
  RE_RAIL_LATERAL,
  RE_RAIL_ANGLE,
  PATH_HOP_DIST,
  PATH_HOP_ANGLE,
  SOLID_PLAYFIELD_FIT_PAD,
  EDGE_RESTITUTION,
  TRAIN_HIT_R,
} from "./train/constants.js";

export {
  createTrain,
  frontAxlePos,
  rearAxlePos,
  bodyFromFrontAxle,
  bodyFromRearAxle,
  bodyFromRailProbe,
  hitTestTrain,
} from "./train/pose.js";

export { createTrainTelemetry, snapshotTrain } from "./train/telemetry.js";

export {
  captureConsistFrame,
  consistPinState,
  initializeCoupledConsist,
  resetConsistMotion,
  solveCoupledConsist,
} from "./train/motion-trail.js";

export {
  OFF_RAIL_DS,
  OFF_RAIL_REF_SPEED,
  leaveRails,
  stepOffRail,
  stepOffRailEntity,
  resolveOffRailContacts,
  playfieldWallSegments,
  resolvePlayfieldAabb,
  nearestPlayfieldCorner,
  cornerExitDir,
  pickCornerPair,
  wallSlideDir,
  wallHitsSorted,
  deepestWallHit,
  CORNER_DOT_MAX,
} from "./train/off-rail.js";

export {
  ensureConsist,
  ensureSingleEngine,
  placeFollowers,
  railPoseClear,
  seatConsistHard,
  getPoweredChain,
  threeCarConsistSpec,
  threeMiddleConsistSpec,
  COUPLER_DIST,
  MAX_MID_CARS,
  countMidCars,
  getTrainInsertionTargets,
  uncoupleCar,
  tryRecoupleCar,
  setActiveEngine,
  hitTestCar,
  spawnFreeCar,
  snapCarPoseToHit,
  consistLinks,
  couplerLink,
  tryRerailCar,
  markChainOffRail,
  markPoweredOnRail,
  resolveCarCollisions,
  carMinCenterDist,
  carProjectedHalf,
  CAR_BODY_SKIN,
  seatConsistOnPath,
  clearTrainCars,
  removeCar,
  placeLayoutCars,
  serializeTrainCars,
  capturePlacementState,
  commitCoupledPlacement,
  trainBodyOverlaps,
  validateTrainPlacement,
};

export function placeTrainOnPath(train, hit, opts = {}) {
  if (!hit?.path) return false;
  const placementSnapshot =
    train.cars?.length > 1 ? capturePlacementState(train) : null;
  resetConsistMotion(train);
  train.mode = TrainMode.ON_RAIL;
  train.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  train.s = Math.max(0, Math.min(1, hit.s));
  if (opts.dir === 1 || opts.dir === -1) {
    train.dir = opts.dir;
  } else if (!opts.keepDir) {
    train.dir = 1;
  }
  // Match heading to path + direction
  const pathAng = hit.ang;
  const ang =
    train.dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  const body = bodyFromFrontAxle(hit.x, hit.y, ang);
  train.x = body.x;
  train.y = body.y;
  train.ang = ang;
  train.vx = 0;
  train.vy = 0;
  train.offRailPreferAng = null;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.openMouthClearSteps = 0;
  train.openMouthPieceId = null;
  train.openMouthAdjacentPieceId = null;
  train.reRailDistLeft = 0;
  const board = opts.board || null;
  // No hardReset multi-car template. Multi-car layouts use placeLayoutCars
  // (separate entities). Bare place is always a single engine.
  if (!train.cars?.length) {
    train.consistSpec = null;
    ensureSingleEngine(train);
    train.cars[0].mode = TrainMode.ON_RAIL;
    train.cars[0].pathRef = train.pathRef;
    train.cars[0].s = train.s;
    train.cars[0].dir = train.dir;
  } else {
    // Re-seat powered unit only onto path; followers keep their modes
    const powered =
      train.cars.find((c) => c.powered || c.id === train.poweredId) ||
      train.cars[0];
    if (powered) {
      powered.mode = TrainMode.ON_RAIL;
      powered.pathRef = train.pathRef;
      powered.s = train.s;
      powered.dir = train.dir;
      powered.x = train.x;
      powered.y = train.y;
      powered.ang = train.ang;
    }
  }
  if (train.cars?.length > 1) {
    // Multi-car on rails: path-seat followers (separate entities, short links)
    if (board) {
      seatConsistOnPath(train, board);
    } else {
      placeFollowers(train, { hard: true, onRail: true, board: null });
    }
    if (board) {
      const committed = commitCoupledPlacement(train, board, {
        snapshot: placementSnapshot,
      });
      if (!committed.ok && !committed.rejected.length) return false;
    }
  }
  return true;
}

/** Reverse travel direction (flip). Keeps front axle on path if possible. */
export function flipTrainDirection(train, board) {
  train.dir = train.dir >= 0 ? -1 : 1;
  train.ang = normalizeAngle(train.ang + Math.PI);
  if (train.pathRef && board) {
    const live = resolveLivePath(board, train.pathRef);
    if (live) {
      const p = pointOnPolyline(live.points, train.s);
      const ang =
        train.dir > 0 ? p.ang : normalizeAngle(p.ang + Math.PI);
      const body = bodyFromFrontAxle(p.x, p.y, ang);
      train.x = body.x;
      train.y = body.y;
      train.ang = ang;
    }
  } else {
    // Free: just reverse heading; body center fixed, nose flips
    const body = bodyFromFrontAxle(
      train.x + Math.cos(train.ang - Math.PI) * FRONT_AXLE_OFFSET,
      train.y + Math.sin(train.ang - Math.PI) * FRONT_AXLE_OFFSET,
      train.ang
    );
    // Simpler: keep center, only ang flipped already
  }
  train.vx = 0;
  train.vy = 0;
  return train;
}

/** Snap train pose to nearest path under (x,y); preserves dir. */
export function snapTrainToPoint(train, board, x, y, maxDist = 48) {
  const hit = closestPathPoint(board, x, y, maxDist);
  if (!hit) return false;
  return placeTrainOnPath(train, hit, { keepDir: true });
}

function finiteSnapshotValue(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function pathRefFromSnapshot(board, ref) {
  if (!board || !ref?.pieceId || !ref?.pathId) return null;
  const path = board.pathIndex?.find(
    (p) => p.pieceId === ref.pieceId && p.id === ref.pathId && p.active
  );
  if (!path) return null;
  return { path, pieceId: path.pieceId, pathId: path.id };
}

/**
 * Restore a saved runtime train snapshot after the board and car entities
 * have been rebuilt. Placement creates safe defaults; this restores the
 * exact paused pose/mode, including an off-rail state.
 */
export function restoreTrainSnapshot(train, board, snapshot) {
  if (!train || !snapshot || typeof snapshot !== "object") return false;

  train.x = finiteSnapshotValue(snapshot.x, train.x);
  train.y = finiteSnapshotValue(snapshot.y, train.y);
  train.frontCouplerOffset = finiteSnapshotValue(
    snapshot.frontCouplerOffset,
    train.frontCouplerOffset || 0
  );
  train.rearCouplerOffset = finiteSnapshotValue(
    snapshot.rearCouplerOffset,
    train.rearCouplerOffset || 0
  );
  train.ang = finiteSnapshotValue(snapshot.ang, train.ang);
  train.s = finiteSnapshotValue(snapshot.s, train.s);
  train.dir = snapshot.dir === -1 || snapshot.dir === 1 ? snapshot.dir : train.dir;
  train.vx = finiteSnapshotValue(snapshot.vx, train.vx);
  train.vy = finiteSnapshotValue(snapshot.vy, train.vy);

  const validModes = new Set(Object.values(TrainMode));
  if (validModes.has(snapshot.mode)) train.mode = snapshot.mode;

  train.offRailPreferAng =
    snapshot.offRailPreferAng == null
      ? null
      : finiteSnapshotValue(snapshot.offRailPreferAng, train.offRailPreferAng);
  train.offRailDistAcc = finiteSnapshotValue(
    snapshot.offRailDistAcc,
    train.offRailDistAcc || 0
  );
  train.offRailStepsDone = Math.max(
    0,
    Math.floor(finiteSnapshotValue(snapshot.offRailStepsDone, train.offRailStepsDone || 0))
  );
  train.reRailDistLeft = Math.max(
    0,
    finiteSnapshotValue(snapshot.reRailDistLeft, train.reRailDistLeft || 0)
  );
  train.reRailCooldown = Math.max(
    0,
    finiteSnapshotValue(snapshot.reRailCooldown, train.reRailCooldown || 0)
  );
  train.openMouthClearSteps = Math.max(
    0,
    Math.floor(
      finiteSnapshotValue(snapshot.openMouthClearSteps, train.openMouthClearSteps || 0)
    )
  );
  train.openMouthAdjacentPieceId = snapshot.openMouthAdjacentPieceId || null;
  train.railEntryGraceDistance = Math.max(
    0,
    finiteSnapshotValue(
      snapshot.railEntryGraceDistance,
      train.railEntryGraceDistance || 0
    )
  );
  train.cornerLockSteps = Math.max(
    0,
    Math.floor(finiteSnapshotValue(snapshot.cornerLockSteps, train.cornerLockSteps || 0))
  );
  train.cornerLockUx =
    snapshot.cornerLockUx == null
      ? null
      : finiteSnapshotValue(snapshot.cornerLockUx, train.cornerLockUx);
  train.cornerLockUy =
    snapshot.cornerLockUy == null
      ? null
      : finiteSnapshotValue(snapshot.cornerLockUy, train.cornerLockUy);

  const savedPathRef = pathRefFromSnapshot(board, snapshot.pathRef);
  if (train.mode === TrainMode.OFF_RAIL || train.mode === TrainMode.STOPPED) {
    train.pathRef = null;
  } else if (savedPathRef) {
    train.pathRef = savedPathRef;
  }

  const savedCars = Array.isArray(snapshot.cars) ? snapshot.cars : [];
  const currentCars = train.cars || [];
  const usedSaved = new Set();
  const findSavedCar = (car, index) => {
    const byId = car.id
      ? savedCars.findIndex((saved, i) => !usedSaved.has(i) && saved?.id === car.id)
      : -1;
    if (byId >= 0) {
      usedSaved.add(byId);
      return savedCars[byId];
    }
    const byIndex = savedCars.findIndex(
      (saved, i) => !usedSaved.has(i) && i === index
    );
    if (byIndex >= 0) {
      usedSaved.add(byIndex);
      return savedCars[byIndex];
    }
    return null;
  };

  for (let i = 0; i < currentCars.length; i++) {
    const car = currentCars[i];
    const saved = findSavedCar(car, i);
    if (!saved) continue;
    car.x = finiteSnapshotValue(saved.x, car.x);
    car.y = finiteSnapshotValue(saved.y, car.y);
    car.ang = finiteSnapshotValue(saved.ang, car.ang);
    car.s = finiteSnapshotValue(saved.s, car.s);
    car.dir = saved.dir === -1 || saved.dir === 1 ? saved.dir : car.dir;
    car.vx = finiteSnapshotValue(saved.vx, car.vx);
    car.vy = finiteSnapshotValue(saved.vy, car.vy);
    car.frontCouplerOffset = finiteSnapshotValue(
      saved.frontCouplerOffset,
      car.frontCouplerOffset || 0
    );
    car.rearCouplerOffset = finiteSnapshotValue(
      saved.rearCouplerOffset,
      car.rearCouplerOffset || 0
    );
    car.reRailCooldown = Math.max(
      0,
      finiteSnapshotValue(saved.reRailCooldown, car.reRailCooldown || 0)
    );
    car.lastRailExitKey = saved.lastRailExitKey || null;
    car.openMouthClearSteps = Math.max(
      0,
      Math.floor(finiteSnapshotValue(saved.openMouthClearSteps, car.openMouthClearSteps || 0))
    );
    car.openMouthAdjacentPieceId = saved.openMouthAdjacentPieceId || null;
    car.railEntryGraceDistance = Math.max(
      0,
      finiteSnapshotValue(
        saved.railEntryGraceDistance,
        car.railEntryGraceDistance || 0
      )
    );
    car.facing = saved.facing === -1 || saved.facing === 1 ? saved.facing : car.facing;
    car.coupled = saved.coupled !== false;
    car.powered = !!saved.powered;
    if (validModes.has(saved.mode)) car.mode = saved.mode;
    if (
      car.powered &&
      train.mode === TrainMode.OFF_RAIL &&
      (!validModes.has(saved.mode) || saved.mode === TrainMode.IDLE)
    ) {
      // Older snapshots did not always synchronize the powered car record
      // before saving. The train-level mode remains authoritative here.
      car.mode = TrainMode.OFF_RAIL;
    }

    const carPathRef = pathRefFromSnapshot(board, saved.pathRef);
    if (car.mode === TrainMode.OFF_RAIL || car.mode === TrainMode.STOPPED) {
      car.pathRef = null;
    } else if (carPathRef) {
      car.pathRef = carPathRef;
    }
  }

  const powered = snapshot.poweredId
    ? currentCars.find((car) => car.id === snapshot.poweredId)
    : null;
  const fallbackPowered = currentCars.find((car) => car.powered);
  if (powered) {
    for (const car of currentCars) car.powered = car === powered;
    train.poweredId = powered.id;
  } else if (fallbackPowered) {
    train.poweredId = fallbackPowered.id;
  }
  train.selectedCarId = null;
  if (snapshot.selectedCarId != null) {
    const selected = currentCars.find((car) => car.id === snapshot.selectedCarId);
    train.selectedCarId = selected?.id || snapshot.selectedCarId;
  }
  train.consistSpec = null;
  train.wallHit = false;
  resetConsistMotion(train);
  return true;
}

export function startTrain(train) {
  if (train.mode === TrainMode.STOPPED || train.mode === TrainMode.STALLED) {
    return false;
  }
  if (train.mode === TrainMode.OFF_RAIL) {
    const sp = train.speed;
    train.vx = Math.cos(train.ang) * sp;
    train.vy = Math.sin(train.ang) * sp;
    return true;
  }
  if (!train.pathRef) return false;
  train.mode = TrainMode.ON_RAIL;
  return true;
}

export function stopTrain(train) {
  if (train.mode === TrainMode.ON_RAIL || train.mode === TrainMode.OFF_RAIL) {
    train.mode = TrainMode.IDLE;
    train.vx = 0;
    train.vy = 0;
  }
}

export function resetTrainHard(train) {
  // Full clear — do NOT re-spawn layout multi-car template. User must build
  // engine + mids one at a time after reset/delete.
  clearTrainCars(train);
}


/**
 * @param {object} [opts]
 * @param {boolean} [opts.solidPlayfield] bounce on playfield perimeter instead of STOPPED
 */
export function updateTrain(train, board, dt, bounds, opts = {}) {
  const telemetry = opts.telemetry;
  const tracing = !!telemetry?.enabled;
  if (tracing) {
    telemetry.begin(
      {
        dt,
        solidPlayfield: !!opts.solidPlayfield,
        bounds: bounds ? { ...bounds } : null,
      },
      snapshotTrain(train, board, {
        bounds,
        solidPlayfield: !!opts.solidPlayfield,
      })
    );
  }

  if (
    train.mode === TrainMode.IDLE ||
    train.mode === TrainMode.STOPPED ||
    train.mode === TrainMode.STALLED
  ) {
    // Paused/stopped physics is a true freeze. Re-seating here used to
    // teleport mixed rail/floor followers into a straight hitch every frame.
    if (tracing) {
      telemetry.end(
        snapshotTrain(train, board, {
          bounds,
          solidPlayfield: !!opts.solidPlayfield,
        })
      );
    }
    return;
  }
  // External editors/snapshots can present an already-impossible link. A
  // toy coupler cannot heal a stretched gap by teleporting either body, so
  // break at the first bad pin. Runtime-created constraints use rollback +
  // STALLED instead; both policies guarantee no moving stretched link.
  const incomingChain = getPoweredChain(train);
  if (incomingChain[0]) {
    Object.assign(incomingChain[0], {
      x: train.x,
      y: train.y,
      ang: train.ang,
      mode: train.mode,
      pathRef: train.pathRef,
      s: train.s,
      dir: train.dir,
      vx: train.vx,
      vy: train.vy,
    });
  }
  for (let i = 1; i < incomingChain.length; i++) {
    const error = couplerError(incomingChain[i - 1], incomingChain[i]);
    if (error <= 1) continue;
    telemetry?.event("coupler_break", {
      from: incomingChain[i - 1].id,
      to: incomingChain[i].id,
      error,
      reason: "preexisting_stretch",
    });
    for (let j = i; j < incomingChain.length; j++) {
      incomingChain[j].coupled = false;
      incomingChain[j].powered = false;
    }
    resetConsistMotion(train);
    break;
  }

  // Snapshot the exact pre-step pin state. If any follower pose is
  // unsatisfiable, the shared solver restores this frame and stalls; it never
  // leaves a one-frame stretched coupling behind.
  const consistFrame =
    train.cars?.length > 1 ? captureConsistFrame(train) : null;

  if (train.reRailCooldown > 0) {
    train.reRailCooldown = Math.max(0, train.reRailCooldown - dt);
  }
  for (const car of train.cars || []) {
    if (car.reRailCooldown > 0) {
      car.reRailCooldown = Math.max(0, car.reRailCooldown - dt);
      if (car.reRailCooldown === 0) car.lastRailExitKey = null;
    }
  }

  if (train.mode === TrainMode.ON_RAIL) {
    stepOnRail(train, board, dt, telemetry);
    if (train.mode === TrainMode.OFF_RAIL) {
      // A rail exit owns the current pose until the first floor step. Project
      // that transition pose immediately so the hull cannot spend one
      // telemetry frame intersecting a neighboring solid bed.
      resolveOffRailContacts(train, board, bounds, {
        solidPlayfield: !!opts.solidPlayfield,
        telemetry,
      });
    }
    if (
      train.mode === TrainMode.ON_RAIL &&
      (train.railEntryGraceDistance || 0) <= 0 &&
      !railPoseClear(board, train)
    ) {
      // A path centerline is not permission to drive an axle through a solid
      // active rail bed. Leave the rails and let the normal wall-glide solver
      // resolve the contact instead of silently phasing through it.
      telemetry?.event("rail_bed_violation", {
        entity: "lead",
        pathKey: train.pathRef
          ? `${train.pathRef.pieceId}:${train.pathRef.pathId}`
          : null,
      });
      leaveRails(train, "rail_bed_violation", telemetry);
    }
  } else if (train.mode === TrainMode.OFF_RAIL) {
    stepOffRail(train, board, dt, bounds, opts);
  }

  const chain = getPoweredChain(train);
  if (chain.length > 1) {
    const solved = solveCoupledConsist(
      train,
      board,
      dt,
      bounds,
      { ...opts, telemetry },
      consistFrame
    );
    if (!solved.ok) {
      if (tracing) {
        telemetry.end(
          snapshotTrain(train, board, {
            bounds,
            solidPlayfield: !!opts.solidPlayfield,
          })
        );
      }
      return;
    }
  } else {
    // Single powered entity mirrors the train state directly.
    const powered = chain[0] || train.cars?.find((car) => car.powered);
    if (powered) {
      powered.x = train.x;
      powered.y = train.y;
      powered.ang = train.ang;
      powered.mode = train.mode;
      powered.pathRef = train.pathRef;
      powered.s = train.s;
      powered.dir = train.dir;
      powered.vx = train.vx;
      powered.vy = train.vy;
      powered.frontCouplerOffset = train.frontCouplerOffset || 0;
      powered.rearCouplerOffset = train.rearCouplerOffset || 0;
      powered.wallHit = !!train.wallHit;
      powered.openMouthClearSteps = train.openMouthClearSteps || 0;
      powered.openMouthPieceId = train.openMouthPieceId || null;
      powered.openMouthAdjacentPieceId =
        train.openMouthAdjacentPieceId || null;
      powered.railEntryGraceDistance = train.railEntryGraceDistance || 0;
    }
  }

  // Loose cars remain independent floor bodies. Coupled cars are excluded:
  // applying this resolver to them after the pin solve would reintroduce
  // stretch by construction.
  const chainIds = new Set(chain.map((car) => car.id));
  const parkedRailIds = new Set(
    (train.cars || [])
      .filter(
        (car) =>
          !chainIds.has(car.id) &&
          car.coupled === false &&
          car.mode === TrainMode.ON_RAIL
      )
      .map((car) => car.id)
  );
  const looseCars = (train.cars || []).filter(
    (car) => !chainIds.has(car.id) && car.mode === TrainMode.OFF_RAIL
  );
  for (const car of looseCars) {
    stepOffRailEntity(car, board, dt, bounds, {
      speed: train.speed,
      solidPlayfield: !!opts.solidPlayfield,
      telemetry,
    });
    // Even with zero pending fixed-distance steps, an externally moved or
    // newly broken-away body must be projected out of solids immediately.
    resolveOffRailContacts(car, board, bounds, {
      solidPlayfield: !!opts.solidPlayfield,
      telemetry,
    });
    const chainIndex = getPoweredChain(train).findIndex(
      (item) => item.id === car.id
    );
    const predecessor = chainIndex > 0 ? getPoweredChain(train)[chainIndex - 1] : null;
    if (
      !car.coupled ||
      !predecessor ||
      predecessor.mode === TrainMode.ON_RAIL
    ) {
      tryRerailCar(car, board, train, telemetry);
    }
  }
  const parkedRailCars = (train.cars || []).filter(
    (car) =>
      parkedRailIds.has(car.id) &&
      car.mode === TrainMode.ON_RAIL
  );
  const parkedBefore = new Map(
    parkedRailCars.map((car) => [car.id, { x: car.x, y: car.y }])
  );
  if (chain.length <= 1 && train.cars?.length > 1) {
    resolveCarCollisions(train, {
      movableRailCarIds: parkedRailIds,
    });
  } else if (parkedRailCars.length) {
    resolveCarCollisions(train, { parkedRailCars });
  }
  if (parkedRailCars.length) {
    for (const car of parkedRailCars) {
      const old = parkedBefore.get(car.id);
      if (!old) continue;
      const moved = Math.hypot(car.x - old.x, car.y - old.y);
      if (moved <= 0.001) continue;
      // A pushed parked car is no longer rail-owned. Preserve its new body
      // pose and let the normal off-rail wall solver own subsequent motion.
      car.mode = TrainMode.OFF_RAIL;
      car.pathRef = null;
      car.s = 0;
      car.vx = (car.x - old.x) / Math.max(dt, 1e-6);
      car.vy = (car.y - old.y) / Math.max(dt, 1e-6);
      car.offRailDistAcc = 0;
      car.offRailStepsDone = 0;
      telemetry?.event("uncoupled_car_impact", {
        carId: car.id,
        distance: moved,
      });
    }
  }

  if (tracing) {
    telemetry.end(
      snapshotTrain(train, board, {
        bounds,
        solidPlayfield: !!opts.solidPlayfield,
      })
    );
  }
}


function resolveLivePath(board, pref) {
  if (!pref) return null;
  return (
    board.pathIndex.find(
      (p) => p.pieceId === pref.pieceId && p.id === pref.pathId && p.active
    ) || null
  );
}

function adjacentPieceAtPathExit(board, path, exitConn) {
  if (!board?.graph?.nodes || !path || !exitConn) return null;
  const oppositeConn = exitConn === path.fromC ? path.toC : path.fromC;
  const node = board.graph.nodes.get(`${path.pieceId}:${oppositeConn}`);
  for (const edge of node?.edges || []) {
    if (!edge.link || !edge.to) continue;
    const split = edge.to.indexOf(":");
    if (split > 0) return edge.to.slice(0, split);
  }
  return null;
}

function stepOnRail(train, board, dt, telemetry = null) {
  stepRailEntity(train, board, dt, telemetry, true, train.speed);
}

function stepOnRailCar(car, board, dt, telemetry, speed) {
  stepRailEntity(car, board, dt, telemetry, false, speed);
}

function stepRailEntity(entity, board, dt, telemetry, isLead, speed) {
  const pref = entity.pathRef;
  const entityId = isLead ? "lead" : entity.id;
  let live = null;
  const fail = (reason, data = {}) => {
    telemetry?.event(isLead ? "rail_exit" : "car_rail_exit", {
      entity: entityId,
      reason,
      ...data,
    });
    if (isLead) {
      const sourcePieceId =
        data.exitPieceId || entity.pathRef?.pieceId || null;
      leaveRails(entity, reason, telemetry, {
        openMouthPieceId: sourcePieceId,
        openMouthAdjacentPieceId:
          reason === "no_next_path"
            ? adjacentPieceAtPathExit(board, live, data.exitConn)
            : null,
      });
    } else {
      entity.reRailCooldown = 0.35;
      entity.lastRailExitKey = entity.pathRef
        ? `${entity.pathRef.pieceId}:${entity.pathRef.pathId}`
        : null;
      entity.openMouthClearSteps = reason === "no_next_path" ? 32 : 0;
            entity.openMouthPieceId =
              reason === "no_next_path"
                ? data.exitPieceId || entity.pathRef?.pieceId || null
                : null;
      entity.mode = TrainMode.OFF_RAIL;
      entity.pathRef = null;
      entity.vx = Math.cos(entity.ang || 0) * (speed || 180);
      entity.vy = Math.sin(entity.ang || 0) * (speed || 180);
    }
    return false;
  };

  if (!pref) return fail("missing_path_ref");

  live = resolveLivePath(board, pref);
  if (!live) {
    // A switch may have deactivated the referenced route. Re-seat the entity
    // only if the nearby active path has a compatible travel heading.
    const fa = frontAxlePos(entity);
    const hit = closestPathPoint(board, fa.x, fa.y, RE_RAIL_LATERAL + 8);
    const d1 = hit ? angleDiff(entity.ang, hit.ang) : Infinity;
    const d2 = hit ? angleDiff(entity.ang, hit.ang + Math.PI) : Infinity;
    const bestAngle = Math.min(d1, d2);
    if (hit && bestAngle <= PATH_HOP_ANGLE) {
      telemetry?.event("inactive_path_reseat", {
        entity: entityId,
        fromPath: `${pref.pieceId}:${pref.pathId}`,
        toPath: `${hit.path.pieceId}:${hit.path.id}`,
        dist: hit.dist,
        bestAngle,
      });
      const d1 = angleDiff(entity.ang, hit.ang);
      const d2 = angleDiff(entity.ang, hit.ang + Math.PI);
      const dir = d1 <= d2 ? 1 : -1;
      const ang = dir > 0 ? hit.ang : normalizeAngle(hit.ang + Math.PI);
      entity.pathRef = {
        path: hit.path,
        pieceId: hit.path.pieceId,
        pathId: hit.path.id,
      };
      entity.s = hit.s;
      entity.dir = dir;
      entity.ang = ang;
      const body = bodyFromFrontAxle(hit.x, hit.y, ang);
      entity.x = body.x;
      entity.y = body.y;
      live = resolveLivePath(board, entity.pathRef);
    }
    if (!live) {
      return fail("inactive_path_no_reseat", {
        pathKey: `${pref.pieceId}:${pref.pathId}`,
        nearestPath: hit ? `${hit.path.pieceId}:${hit.path.id}` : null,
        nearestDist: hit?.dist ?? null,
        nearestAngle: Number.isFinite(bestAngle) ? bestAngle : null,
      });
    }
  }
  entity.pathRef.path = live;

  let len = live.length || 1e-6;
  const dist = (speed || 180) * dt;
  if ((entity.railEntryGraceDistance || 0) > 0) {
    entity.railEntryGraceDistance = Math.max(
      0,
      entity.railEntryGraceDistance - dist
    );
  }
  entity.s += (dist / len) * entity.dir;

  let guard = 0;
  while ((entity.s > 1 || entity.s < 0) && guard++ < 16) {
    const atHigh = entity.s > 1;
    const overshootPx = atHigh
      ? (entity.s - 1) * len
      : -entity.s * len;
    const leavingHigh = entity.dir > 0;
    const exitConn = leavingHigh ? live.toC : live.fromC;
    const endS = leavingHigh ? 1 : 0;
    const pose = pointOnPolyline(live.points, endS);
    const travelAng =
      entity.dir > 0 ? pose.ang : normalizeAngle(pose.ang + Math.PI);
    entity.ang = travelAng;
    const body = bodyFromFrontAxle(pose.x, pose.y, travelAng);
    entity.x = body.x;
    entity.y = body.y;

    const next = findNextPath(
      board,
      live,
      exitConn,
      pose,
      travelAng,
      entity,
      telemetry
    );
    if (!next) {
      return fail("no_next_path", {
        fromPath: `${live.pieceId}:${live.id}`,
        exitPieceId: live.pieceId,
        exitConn,
        travelAng,
        overshootPx,
      });
    }

    telemetry?.event("path_handoff", {
      entity: entityId,
      fromPath: `${live.pieceId}:${live.id}`,
      exitConn,
      toPath: `${next.path.pieceId}:${next.path.id}`,
      dir: next.dir,
      s: next.s,
      overshootPx,
    });
    entity.pathRef = {
      path: next.path,
      pieceId: next.path.pieceId,
      pathId: next.path.id,
    };
    entity.dir = next.dir;
    live = next.path;
    len = live.length || 1e-6;
    entity.s = next.s + (overshootPx / len) * entity.dir;
  }

  if (entity.s < 0 && entity.s > -1e-6) entity.s = 0;
  if (entity.s > 1 && entity.s < 1 + 1e-6) entity.s = 1;
  if (entity.s >= 0 && entity.s <= 1) {
    const cur = resolveLivePath(board, entity.pathRef) || entity.pathRef.path;
    const p = pointOnPolyline(cur.points, entity.s);
    entity.ang = entity.dir > 0 ? p.ang : normalizeAngle(p.ang + Math.PI);
    const body = bodyFromFrontAxle(p.x, p.y, entity.ang);
    entity.x = body.x;
    entity.y = body.y;
  }
  return true;
}

/**
 * Continuous path solver:
 * graph link first, then geometric endpoint hop (heading-matched).
 */
function findNextPath(
  board,
  live,
  exitConnId,
  exitPose,
  travelAng,
  train,
  telemetry = null
) {
  const fromGraph = findNextFromGraph(board, live, exitConnId, travelAng);
  telemetry?.event("path_candidates", {
    entity: train?.id ?? "lead",
    fromPath: `${live.pieceId}:${live.id}`,
    exitConn: exitConnId,
    graphSelected: fromGraph
      ? `${fromGraph.path.pieceId}:${fromGraph.path.id}`
      : null,
    graphDir: fromGraph?.dir ?? null,
    graphS: fromGraph?.s ?? null,
  });
  if (fromGraph) return fromGraph;
  return findNextGeometric(board, live, exitPose.x, exitPose.y, travelAng);
}

function findNextFromGraph(board, live, exitConnId, travelAng) {
  const graph = board.graph;
  if (!graph) return null;

  const nodeKey = `${live.pieceId}:${exitConnId}`;
  const node = graph.nodes.get(nodeKey);
  if (!node) return null;

  const candidates = [];

  for (const e of node.edges) {
    if (e.link) {
      const other = graph.nodes.get(e.to);
      if (!other) continue;
      for (const e2 of other.edges) {
        if (e2.link || !e2.path) continue;
        if (!e2.path.active) continue;
        const entry = pathEntryFromEdge(e2);
        if (entry) candidates.push(entry);
      }
    } else if (e.path) {
      if (e.path.pieceId === live.pieceId && e.path.id === live.id) continue;
      if (!e.path.active) continue;
      // Same-piece path change (turnouts / 3-way at shared connector)
      const entry = pathEntryFromEdge(e);
      if (entry) candidates.push(entry);
    }
  }

  if (!candidates.length) return null;
  candidates.sort(
    (a, b) =>
      angleDiff(a.entryAng, travelAng) - angleDiff(b.entryAng, travelAng)
  );
  // Reject absurd U-turns unless only option
  const best = candidates[0];
  if (angleDiff(best.entryAng, travelAng) > Math.PI * 0.75 && candidates.length > 1) {
    return candidates[1];
  }
  return best;
}

function pathEntryFromEdge(edge) {
  const path = edge.path;
  if (!path?.points?.length) return null;
  const reverse = edge.reverse;
  const s = reverse ? 1 : 0;
  const dir = reverse ? -1 : 1;
  const pose = pointOnPolyline(path.points, s);
  const entryAng =
    dir > 0 ? pose.ang : normalizeAngle(pose.ang + Math.PI);
  return { path, s, dir, entryAng };
}

/** Join paths whose ends sit near each other with matching heading. */
function findNextGeometric(board, live, x, y, travelAng) {
  const candidates = [];
  for (const path of board.pathIndex) {
    if (!path.active) continue;
    if (path.pieceId === live.pieceId && path.id === live.id) continue;
    if (!path.points || path.points.length < 2) continue;

    // Enter at start going forward (increasing s)
    {
      const pose = pointOnPolyline(path.points, 0);
      const d = Math.hypot(pose.x - x, pose.y - y);
      if (d <= PATH_HOP_DIST) {
        const entryAng = pose.ang;
        const err = angleDiff(entryAng, travelAng);
        if (err <= PATH_HOP_ANGLE) {
          candidates.push({ path, s: 0, dir: 1, entryAng, d, err });
        }
      }
    }
    // Enter at end going reverse (decreasing s)
    {
      const pose = pointOnPolyline(path.points, 1);
      const d = Math.hypot(pose.x - x, pose.y - y);
      if (d <= PATH_HOP_DIST) {
        // At s=1, increasing-s tangent is pose.ang; reverse travel faces opposite
        const entryAng = normalizeAngle(pose.ang + Math.PI);
        const err = angleDiff(entryAng, travelAng);
        if (err <= PATH_HOP_ANGLE) {
          candidates.push({ path, s: 1, dir: -1, entryAng, d, err });
        }
      }
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.err * 40 + a.d - (b.err * 40 + b.d));
  return candidates[0];
}

/**
 * Fixed geometry step (px). Speed only changes how many steps run per frame.
 * Same step count from the same derail pose ⇒ same path at every speed.
 */

export function modeLabel(mode) {
  switch (mode) {
    case TrainMode.ON_RAIL:
      return "On rails";
    case TrainMode.OFF_RAIL:
      return "Off rails (floor)";
    case TrainMode.STALLED:
      return "Stalled (constraint blocked)";
    case TrainMode.STOPPED:
      return "Stopped at edge ΓÇö reset train";
    case TrainMode.IDLE:
      return "Idle";
    default:
      return mode;
  }
}

