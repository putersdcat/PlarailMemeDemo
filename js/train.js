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
} from "./train/constants.js";
import { frontAxlePos, bodyFromFrontAxle } from "./train/pose.js";
import { leaveRails, stepOffRail } from "./train/off-rail.js";
import {
  ensureConsist,
  placeFollowers,
  getPoweredChain,
  threeCarConsistSpec,
  COUPLER_DIST,
  uncoupleCar,
  tryRecoupleCar,
  setActiveEngine,
  hitTestCar,
  spawnFreeCar,
  snapCarPoseToHit,
  consistLinks,
  couplerLink,
} from "./train/consist.js";

export {
  TrainMode,
  TRAIN_RADIUS,
  TRAIN_LENGTH,
  FRONT_AXLE_FROM_NOSE,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
  WHEEL_RADIUS,
  RE_RAIL_LATERAL,
  RE_RAIL_ANGLE,
  PATH_HOP_DIST,
  PATH_HOP_ANGLE,
  EDGE_RESTITUTION,
  TRAIN_HIT_R,
} from "./train/constants.js";

export {
  createTrain,
  frontAxlePos,
  rearAxlePos,
  bodyFromFrontAxle,
  hitTestTrain,
} from "./train/pose.js";

export {
  OFF_RAIL_DS,
  OFF_RAIL_REF_SPEED,
  leaveRails,
  stepOffRail,
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
  placeFollowers,
  getPoweredChain,
  threeCarConsistSpec,
  COUPLER_DIST,
  uncoupleCar,
  tryRecoupleCar,
  setActiveEngine,
  hitTestCar,
  spawnFreeCar,
  snapCarPoseToHit,
  consistLinks,
  couplerLink,
};

// placeFollowersOnRail is exported at its declaration below

export function placeTrainOnPath(train, hit, opts = {}) {
  if (!hit?.path) return false;
  train.mode = TrainMode.IDLE;
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
  train.reRailDistLeft = 0;
  // Multi-car: re-seat must NOT rebuild from consistSpec (that undoes uncouple /
  // setActiveEngine). Only build from template when no cars exist yet, or
  // opts.hardReset is set (layout load / hard reset).
  const board = opts.board || null;
  if (opts.hardReset && train.consistSpec?.length) {
    train.cars = null;
    ensureConsist(train, train.consistSpec, { hard: true });
  } else if (!train.cars?.length && train.consistSpec?.length) {
    ensureConsist(train, train.consistSpec, { hard: true });
  }
  // Seat followers: arc-length on rail when path known, else rigid hitch
  if (train.cars?.length > 1) {
    if (board && train.pathRef) placeFollowersOnRail(train, board);
    else placeFollowers(train, { hard: true });
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

export function startTrain(train) {
  if (train.mode === TrainMode.STOPPED) return false;
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
  train.mode = TrainMode.IDLE;
  train.pathRef = null;
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
  train.cornerLockSteps = 0;
  train.cornerLockUx = null;
  train.cornerLockUy = null;
  train.selectedCarId = null;
  // Keep consistSpec; re-seat cars if multi-unit
  if (train.consistSpec?.length) {
    ensureConsist(train, train.consistSpec, { hard: true });
    placeFollowers(train, { hard: true });
  } else {
    train.cars = null;
  }
}


/**
 * @param {object} [opts]
 * @param {boolean} [opts.solidPlayfield] bounce on playfield perimeter instead of STOPPED
 */
export function updateTrain(train, board, dt, bounds, opts = {}) {
  if (train.mode === TrainMode.IDLE || train.mode === TrainMode.STOPPED) {
    // Prefer path seats when we still have a path; else rigid hitch
    if (train.cars?.length > 1) {
      if (train.pathRef && board) placeFollowersOnRail(train, board);
      else placeFollowers(train, { hard: true });
    }
    return;
  }

  if (train.reRailCooldown > 0) train.reRailCooldown -= dt;

  if (train.mode === TrainMode.ON_RAIL) {
    stepOnRail(train, board, dt);
  } else if (train.mode === TrainMode.OFF_RAIL) {
    stepOffRail(train, board, dt, bounds, opts);
  }

  // Coupled followers:
  // On-rail → fixed arc-length along path (no bungy, follows curves).
  // Off-rail → trailer whip (swing when lead turns at walls).
  if (train.cars?.length > 1 || train.consistSpec?.length > 1) {
    if (train.mode === TrainMode.ON_RAIL && board) {
      placeFollowersOnRail(train, board);
    } else {
      placeFollowers(train, { hard: false, whip: true });
    }
  }
}

/**
 * Walk along the path network by a fixed path-length (px).
 * walkDir: +1 increases s, -1 decreases s (independent of lead travel).
 * Returns front-axle pose for the car traveling with travelDirOnPath.
 */
function walkPathByParam(board, pathRef, s0, walkDir, distPx, travelDir) {
  if (!pathRef || !board || !(distPx > 0)) return null;
  let live =
    board.pathIndex.find(
      (p) =>
        p.pieceId === pathRef.pieceId &&
        p.id === (pathRef.pathId || pathRef.id) &&
        p.active
    ) || pathRef.path;
  if (!live?.points?.length) return null;

  let s = Math.max(0, Math.min(1, s0));
  let remaining = distPx;
  let guard = 0;
  // walkDir: which way we move along the polyline parameter
  let wdir = walkDir >= 0 ? 1 : -1;

  while (remaining > 1e-6 && guard++ < 48) {
    const len = live.length || 1e-6;
    const avail = wdir > 0 ? (1 - s) * len : s * len;
    if (remaining <= avail + 1e-9) {
      s += (remaining / len) * wdir;
      remaining = 0;
      break;
    }
    remaining -= avail;
    const exitHigh = wdir > 0;
    const exitConn = exitHigh ? live.toC : live.fromC;
    const endS = exitHigh ? 1 : 0;
    const pose = pointOnPolyline(live.points, endS);
    // Heading while walking in wdir through this exit
    const moveAng =
      wdir > 0 ? pose.ang : normalizeAngle(pose.ang + Math.PI);
    const next = findNextPath(board, live, exitConn, pose, moveAng, {
      dir: wdir,
    });
    if (!next) {
      s = endS;
      remaining = 0;
      break;
    }
    live = next.path;
    s = next.s;
    // Continue walking in the parameter direction that matches moveAng entry
    wdir = next.dir;
  }

  s = Math.max(0, Math.min(1, s));
  const p = pointOnPolyline(live.points, s);
  // Car faces travel direction of the lead (not walk direction)
  const tdir = travelDir >= 0 ? 1 : -1;
  const ang = tdir > 0 ? p.ang : normalizeAngle(p.ang + Math.PI);
  return {
    x: p.x,
    y: p.y,
    ang,
    path: live,
    s,
    dir: tdir,
    pieceId: live.pieceId,
    pathId: live.id,
  };
}

/**
 * Seat coupled followers on the rail at fixed arc spacing behind the lead.
 * Path-length spacing is exact — no stretchy closest-point search.
 */
export function placeFollowersOnRail(train, board) {
  if (!train?.cars?.length || !board || !train.pathRef) {
    placeFollowers(train, { hard: true });
    return { spacingOk: false, minSpacing: 0 };
  }
  const chain = getPoweredChain(train);
  if (chain.length < 2) return { spacingOk: true, minSpacing: 0 };

  const powered = chain[0];
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.powered = true;
  powered.facing = 1;

  // Lead front-axle path state
  let pathRef = {
    pieceId: train.pathRef.pieceId,
    pathId: train.pathRef.pathId || train.pathRef.path?.id,
    path: train.pathRef.path,
  };
  let s = train.s;
  const leadDir = train.dir || 1;
  // Behind lead = walk opposite to lead travel along the track
  const behindWalk = leadDir > 0 ? -1 : 1;

  let minSpacing = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const car = chain[i];
    const pose = walkPathByParam(
      board,
      pathRef,
      s,
      behindWalk,
      COUPLER_DIST,
      leadDir
    );
    if (!pose) {
      placeFollowers(train, { hard: true });
      return { spacingOk: false, minSpacing };
    }
    const body = bodyFromFrontAxle(pose.x, pose.y, pose.ang);
    car.x = body.x;
    car.y = body.y;
    car.ang = pose.ang;
    if (car.kind === "engine" && !car.powered) car.facing = -1;
    if (car.kind === "mid") car.facing = 1;
    car.pathRef = {
      path: pose.path,
      pieceId: pose.pieceId,
      pathId: pose.pathId,
    };
    car.s = pose.s;
    car.dir = pose.dir;

    const prev = chain[i - 1];
    const sp = Math.hypot(car.x - prev.x, car.y - prev.y);
    if (sp < minSpacing) minSpacing = sp;

    // Next follower is further behind this car's axle along the same track
    pathRef = car.pathRef;
    s = car.s;
  }
  if (!Number.isFinite(minSpacing)) minSpacing = 0;
  return {
    spacingOk: minSpacing > COUPLER_DIST * 0.45,
    minSpacing,
  };
}


function resolveLivePath(board, pref) {
  if (!pref) return null;
  return (
    board.pathIndex.find(
      (p) => p.pieceId === pref.pieceId && p.id === pref.pathId && p.active
    ) || null
  );
}

function stepOnRail(train, board, dt) {
  const pref = train.pathRef;
  if (!pref) {
    leaveRails(train);
    return;
  }

  let live = resolveLivePath(board, pref);
  if (!live) {
    // Switch may have de-activated this route ΓÇö try geometric re-seat
    const fa = frontAxlePos(train);
    const hit = closestPathPoint(board, fa.x, fa.y, RE_RAIL_LATERAL + 8);
    if (hit) {
      placeTrainOnPath(train, hit, { keepDir: true });
      train.mode = TrainMode.ON_RAIL;
      live = resolveLivePath(board, train.pathRef);
    }
    if (!live) {
      leaveRails(train);
      return;
    }
  }
  train.pathRef.path = live;

  let len = live.length || 1e-6;
  // Advance in absolute path-length space (px)
  const dist = train.speed * dt;
  train.s += (dist / len) * train.dir;

  let guard = 0;
  while ((train.s > 1 || train.s < 0) && guard++ < 16) {
    const atHigh = train.s > 1;
    const overshootPx = atHigh
      ? (train.s - 1) * len
      : -train.s * len;
    // dir>0 leaves at s=1 (toC); dir<0 leaves at s=0 (fromC)
    const leavingHigh = train.dir > 0;
    const exitConn = leavingHigh ? live.toC : live.fromC;
    const endS = leavingHigh ? 1 : 0;
    const pose = pointOnPolyline(live.points, endS);

    // pose.ang = path tangent along increasing s at this end.
    // Travel heading follows dir.
    const travelAng =
      train.dir > 0 ? pose.ang : normalizeAngle(pose.ang + Math.PI);
    train.ang = travelAng;
    const body = bodyFromFrontAxle(pose.x, pose.y, travelAng);
    train.x = body.x;
    train.y = body.y;

    const next = findNextPath(
      board,
      live,
      exitConn,
      pose,
      travelAng,
      train
    );
    if (!next) {
      leaveRails(train);
      return;
    }

    train.pathRef = {
      path: next.path,
      pieceId: next.path.pieceId,
      pathId: next.path.id,
    };
    train.dir = next.dir;
    live = next.path;
    len = live.length || 1e-6;
    // Enter at end, then consume overshoot in px
    train.s = next.s + (overshootPx / len) * train.dir;
  }

  // Clamp tiny float noise
  if (train.s < 0 && train.s > -1e-6) train.s = 0;
  if (train.s > 1 && train.s < 1 + 1e-6) train.s = 1;

  if (train.s >= 0 && train.s <= 1) {
    const cur = resolveLivePath(board, train.pathRef) || train.pathRef.path;
    const p = pointOnPolyline(cur.points, train.s);
    train.ang =
      train.dir > 0 ? p.ang : normalizeAngle(p.ang + Math.PI);
    const body = bodyFromFrontAxle(p.x, p.y, train.ang);
    train.x = body.x;
    train.y = body.y;
  }
}

/**
 * Continuous path solver:
 * graph link first, then geometric endpoint hop (heading-matched).
 */
function findNextPath(board, live, exitConnId, exitPose, travelAng, train) {
  const fromGraph = findNextFromGraph(board, live, exitConnId, travelAng);
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
    case TrainMode.STOPPED:
      return "Stopped at edge ΓÇö reset train";
    case TrainMode.IDLE:
      return "Idle";
    default:
      return mode;
  }
}

