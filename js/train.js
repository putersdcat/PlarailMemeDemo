/**
 * Train: path following, derail ΓåÆ wall glide ΓåÆ re-rail, canvas edge stop.
 *
 * Path solver:
 *   1) Connectivity graph (gender-linked connectors)
 *   2) Geometric hop at open joints (near endpoints, heading-matched)
 * so visually joined track stays continuous even if a gender link is missing.
 *
 * Wheelbase: front axle guides path + wall contact (~1/3 body back from nose).
 */

import {
  pointOnPolyline,
  angleDiff,
  normalizeAngle,
  HALF_W,
  TRACK_W,
} from "./geometry.js";
import { closestPathPoint } from "./track.js";

export const TrainMode = {
  IDLE: "idle",
  ON_RAIL: "on_rail",
  OFF_RAIL: "off_rail",
  STOPPED: "stopped",
};

/**
 * Body half-width ≈ track half-width (+ a hair so it fills the rails).
 * TRACK_W is the plastic bed width; train should read as track-width or slightly more.
 */
export const TRAIN_RADIUS = HALF_W + 2; // 22 when TRACK_W=40
export const TRAIN_LENGTH = Math.round(TRACK_W * 2.15); // ~86
export const FRONT_AXLE_FROM_NOSE = TRAIN_LENGTH / 3;
export const FRONT_AXLE_OFFSET = TRAIN_LENGTH / 2 - FRONT_AXLE_FROM_NOSE;
export const REAR_AXLE_OFFSET = -TRAIN_LENGTH * 0.28;
/** Axle contact radius — just under body half so walls meet the silhouette. */
export const WHEEL_RADIUS = HALF_W - 1;

/**
 * Re-rail snap window — intentionally tight so drive-bys past
 * perpendicular track do not steal the train.
 * Mouth re-entry is a bit looser than mid-path.
 */
export const RE_RAIL_LATERAL = 14;
export const RE_RAIL_ANGLE = (38 * Math.PI) / 180;
/** Geometric hop between path ends when graph link is missing. */
export const PATH_HOP_DIST = 30;
export const PATH_HOP_ANGLE = (40 * Math.PI) / 180;
/** Zero bounce: walls kill normal velocity and slide only. */
export const EDGE_RESTITUTION = 0;
/** Hit radius for selecting / dragging the train body. */
export const TRAIN_HIT_R = Math.round(TRAIN_LENGTH * 0.55);

export function createTrain() {
  return {
    mode: TrainMode.IDLE,
    x: 0,
    y: 0,
    ang: 0,
    speed: 140,
    pathRef: null,
    /** Front axle parameter along current path [0,1] */
    s: 0,
    /** +1 with path tangent, -1 against */
    dir: 1,
    vx: 0,
    vy: 0,
    reRailCooldown: 0,
    selected: false,
    /** Set true when walls were hit this simulation step (for SFX) */
    wallHit: false,
  };
}

export function frontAxlePos(train) {
  return {
    x: train.x + Math.cos(train.ang) * FRONT_AXLE_OFFSET,
    y: train.y + Math.sin(train.ang) * FRONT_AXLE_OFFSET,
  };
}

export function rearAxlePos(train) {
  return {
    x: train.x + Math.cos(train.ang) * REAR_AXLE_OFFSET,
    y: train.y + Math.sin(train.ang) * REAR_AXLE_OFFSET,
  };
}

export function bodyFromFrontAxle(ax, ay, ang) {
  return {
    x: ax - Math.cos(ang) * FRONT_AXLE_OFFSET,
    y: ay - Math.sin(ang) * FRONT_AXLE_OFFSET,
    ang,
  };
}

/** True if (x,y) is over the train body (for select/drag). */
export function hitTestTrain(train, x, y, placed) {
  if (!placed || !train) return false;
  return Math.hypot(train.x - x, train.y - y) <= TRAIN_HIT_R;
}

/**
 * Seat train on a path hit. opts.dir: +1 / -1 travel direction.
 * opts.keepDir: keep train.dir if already set.
 */
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
}

export function updateTrain(train, board, dt, bounds) {
  if (train.mode === TrainMode.IDLE || train.mode === TrainMode.STOPPED) return;

  if (train.reRailCooldown > 0) train.reRailCooldown -= dt;

  if (train.mode === TrainMode.ON_RAIL) {
    stepOnRail(train, board, dt);
  } else if (train.mode === TrainMode.OFF_RAIL) {
    stepOffRail(train, board, dt, bounds);
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

function leaveRails(train) {
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.vx = Math.cos(train.ang) * train.speed;
  train.vy = Math.sin(train.ang) * train.speed;
  train.wallHit = false;
  // Clear the open mouth before re-rail attempts
  train.reRailCooldown = 0.45;
}

function stepOffRail(train, board, dt, bounds) {
  train.wallHit = false;
  let x = train.x + train.vx * dt;
  let y = train.y + train.vy * dt;
  let ang = train.ang;
  let vx = train.vx;
  let vy = train.vy;

  // Canvas edge — stop
  if (
    x < bounds.minX ||
    x > bounds.maxX ||
    y < bounds.minY ||
    y > bounds.maxY
  ) {
    train.x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
    train.y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
    train.vx = 0;
    train.vy = 0;
    train.mode = TrainMode.STOPPED;
    return;
  }

  // Wall slide — soft seat, pure tangent glide (no bounce kick)
  let hitAny = false;
  let lastNx = 0;
  let lastNy = 0;
  for (let iter = 0; iter < 5; iter++) {
    let hit = false;
    const fa = {
      x: x + Math.cos(ang) * FRONT_AXLE_OFFSET,
      y: y + Math.sin(ang) * FRONT_AXLE_OFFSET,
    };
    const ra = {
      x: x + Math.cos(ang) * REAR_AXLE_OFFSET,
      y: y + Math.sin(ang) * REAR_AXLE_OFFSET,
    };

    for (const [axle, isFront] of [
      [fa, true],
      [ra, false],
    ]) {
      for (const w of board.walls) {
        const res = resolveCircleSegment(
          axle.x,
          axle.y,
          WHEEL_RADIUS,
          w
        );
        if (!res) continue;
        hit = true;
        hitAny = true;
        lastNx = res.nx;
        lastNy = res.ny;
        // Gentle push-out (avoid popping off the wall)
        const pushScale = isFront ? 0.42 : 0.28;
        x += (res.x - axle.x) * pushScale;
        y += (res.y - axle.y) * pushScale;

        const nx = res.nx;
        const ny = res.ny;
        const vn = vx * nx + vy * ny;
        // Kill all into-wall velocity (no restitution bounce)
        if (vn < 0) {
          vx -= (1 + EDGE_RESTITUTION) * vn * nx;
          vy -= (1 + EDGE_RESTITUTION) * vn * ny;
        }
        // Also strip any residual outward normal so speed-normalize
        // cannot re-amplify a bounce-off kick
        const vn2 = vx * nx + vy * ny;
        if (vn2 > 0) {
          vx -= vn2 * nx;
          vy -= vn2 * ny;
        }
        // Pure tangent glide along the wall
        const tx = -ny;
        const ty = nx;
        const along = vx * tx + vy * ty;
        const sign = along >= 0 ? 1 : -1;
        const sp = train.speed;
        vx = tx * sign * sp * 0.96 + vx * 0.04;
        vy = ty * sign * sp * 0.96 + vy * 0.04;

        if (isFront) {
          const vSp = Math.hypot(vx, vy);
          if (vSp > 1e-3) {
            const vAng = Math.atan2(vy, vx);
            // Very gentle yaw — follow wall, no ricochet snap
            ang = normalizeAngle(ang + 0.18 * normalizeAngle(vAng - ang));
          }
        }
      }
    }
    if (!hit) break;
  }

  // Cruise speed — if we hit a wall, keep velocity purely tangential
  let sp = Math.hypot(vx, vy);
  if (hitAny && (lastNx || lastNy)) {
    const tx = -lastNy;
    const ty = lastNx;
    const along = vx * tx + vy * ty;
    const sign = along >= 0 ? 1 : -1;
    vx = tx * sign * train.speed;
    vy = ty * sign * train.speed;
    const vAng = Math.atan2(vy, vx);
    ang = normalizeAngle(ang + 0.14 * normalizeAngle(vAng - ang));
  } else if (sp > 1e-3) {
    const target = train.speed;
    vx = (vx / sp) * target;
    vy = (vy / sp) * target;
    const vAng = Math.atan2(vy, vx);
    ang = normalizeAngle(ang + 0.18 * normalizeAngle(vAng - ang));
  } else if (hitAny) {
    vx = Math.cos(ang) * train.speed;
    vy = Math.sin(ang) * train.speed;
  }

  train.x = x;
  train.y = y;
  train.ang = ang;
  train.vx = vx;
  train.vy = vy;
  train.wallHit = hitAny;

  if (train.reRailCooldown <= 0) {
    tryRerail(train, board);
  }
}

function resolveCircleSegment(cx, cy, radius, seg) {
  const dx = seg.x2 - seg.x1;
  const dy = seg.y2 - seg.y1;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((cx - seg.x1) * dx + (cy - seg.y1) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const px = seg.x1 + t * dx;
  const py = seg.y1 + t * dy;
  let nx = cx - px;
  let ny = cy - py;
  const dist = Math.hypot(nx, ny);
  if (dist >= radius || dist < 1e-8) return null;
  nx /= dist;
  ny /= dist;
  // Slightly less than full seat — softer contact
  const push = (radius - dist) * 0.85 + 0.15;
  return {
    x: cx + nx * push,
    y: cy + ny * push,
    nx,
    ny,
  };
}

function tryRerail(train, board) {
  const fa = frontAxlePos(train);
  // Search a bit wider than accept window so we can reject bad angles cleanly
  const hit = closestPathPoint(board, fa.x, fa.y, RE_RAIL_LATERAL + 4);
  if (!hit) return;

  const pathAng = hit.ang;
  const d1 = angleDiff(train.ang, pathAng);
  const d2 = angleDiff(train.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);

  // Mouth re-entry (open ends) is the main re-rail path; mid-path is strict
  // so sliding past a perpendicular piece does not magnet-grab the train.
  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  const angLimit = nearMouth ? RE_RAIL_ANGLE * 1.15 : RE_RAIL_ANGLE * 0.72;
  const latLimit = nearMouth ? RE_RAIL_LATERAL + 3 : RE_RAIL_LATERAL * 0.75;
  if (hit.dist > latLimit || best > angLimit) return;

  // Extra reject: nearly-perpendicular crossings (even if under angLimit)
  if (!nearMouth && best > (28 * Math.PI) / 180) return;

  train.mode = TrainMode.ON_RAIL;
  train.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  train.s = hit.s;
  train.dir = d1 <= d2 ? 1 : -1;
  const ang = train.dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  const body = bodyFromFrontAxle(hit.x, hit.y, ang);
  train.x = body.x;
  train.y = body.y;
  train.ang = ang;
  train.vx = 0;
  train.vy = 0;
  train.reRailCooldown = 0.55;
}

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
