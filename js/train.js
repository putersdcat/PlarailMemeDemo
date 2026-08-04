/**
 * Train state machine: OnRail / OffRail / Stopped + edge physics.
 *
 * Wheelbase model (critical for meme edge-glide):
 *   Real Plarail engines guide on front bogie set back ~1/3 of body length
 *   from the nose. We treat the front axle as the path/collision probe so
 *   the train leaves curves and slides walls at a shallower angle than if
 *   the geometric center or nose were the contact point.
 */

import {
  pointOnPolyline,
  angleDiff,
  normalizeAngle,
} from "./geometry.js";
import { closestPathPoint } from "./track.js";

export const TrainMode = {
  IDLE: "idle",
  ON_RAIL: "on_rail",
  OFF_RAIL: "off_rail",
  STOPPED: "stopped",
};

export const TRAIN_RADIUS = 10;
export const TRAIN_LENGTH = 48;
/** Distance from nose back to front axle ≈ 1/3 of body length. */
export const FRONT_AXLE_FROM_NOSE = TRAIN_LENGTH / 3;
/**
 * Front axle offset from body center along heading (+ = toward nose).
 * Nose is at +L/2; front axle at +L/2 - L/3 = +L/6.
 */
export const FRONT_AXLE_OFFSET = TRAIN_LENGTH / 2 - FRONT_AXLE_FROM_NOSE;
/** Rear axle for dual-circle collision (optional). */
export const REAR_AXLE_OFFSET = -TRAIN_LENGTH * 0.28;
export const WHEEL_RADIUS = 9;

export const RE_RAIL_LATERAL = 18;
export const RE_RAIL_ANGLE = (65 * Math.PI) / 180;
export const EDGE_RESTITUTION = 0.1;

export function createTrain() {
  return {
    mode: TrainMode.IDLE,
    /** Body center */
    x: 0,
    y: 0,
    ang: 0,
    speed: 140,
    pathRef: null,
    /** Path parameter tracks the FRONT AXLE along the centerline */
    s: 0,
    dir: 1,
    vx: 0,
    vy: 0,
    reRailCooldown: 0,
  };
}

/** World position of front axle from body pose. */
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

/** Set body center so front axle sits at (ax, ay) with heading ang. */
export function bodyFromFrontAxle(ax, ay, ang) {
  return {
    x: ax - Math.cos(ang) * FRONT_AXLE_OFFSET,
    y: ay - Math.sin(ang) * FRONT_AXLE_OFFSET,
    ang,
  };
}

export function placeTrainOnPath(train, hit) {
  if (!hit) return false;
  train.mode = TrainMode.IDLE;
  train.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  train.s = hit.s;
  train.dir = 1;
  // hit is where user clicked — put front axle there, body trails behind
  const ang = hit.ang;
  const body = bodyFromFrontAxle(hit.x, hit.y, ang);
  train.x = body.x;
  train.y = body.y;
  train.ang = ang;
  train.vx = 0;
  train.vy = 0;
  return true;
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

function stepOnRail(train, board, dt) {
  const pref = train.pathRef;
  if (!pref || !pref.path) {
    leaveRails(train);
    return;
  }

  let live = board.pathIndex.find(
    (p) => p.pieceId === pref.pieceId && p.id === pref.pathId && p.active
  );
  if (!live) {
    leaveRails(train);
    return;
  }
  train.pathRef.path = live;

  let len = live.length || 1;
  // Advance front axle along path
  const ds = (train.speed * dt) / len;
  train.s += ds * train.dir;

  let guard = 0;
  while ((train.s > 1 || train.s < 0) && guard++ < 12) {
    const atHigh = train.s > 1;
    const overshoot = atHigh ? train.s - 1 : -train.s;
    const leavingHigh = (train.dir > 0 && atHigh) || (train.dir < 0 && !atHigh);
    const exitConn = leavingHigh ? live.toC : live.fromC;

    const endS = leavingHigh ? 1 : 0;
    const pose = pointOnPolyline(live.points, endS);
    if (train.dir > 0) {
      train.ang = leavingHigh ? pose.ang : normalizeAngle(pose.ang + Math.PI);
    } else {
      train.ang = leavingHigh
        ? normalizeAngle(pose.ang + Math.PI)
        : pose.ang;
    }
    // Park front axle at endpoint while resolving graph hop
    const body = bodyFromFrontAxle(pose.x, pose.y, train.ang);
    train.x = body.x;
    train.y = body.y;

    const next = findNextPath(board, live, exitConn, train);
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
    train.s = next.s;
    const nlen = next.path.length || 1;
    const extra = (overshoot * len) / nlen;
    train.s += extra * train.dir;
    live = next.path;
    len = nlen;
  }

  if (train.s >= 0 && train.s <= 1) {
    const cur = train.pathRef.path;
    const p = pointOnPolyline(cur.points, train.s);
    train.ang = train.dir > 0 ? p.ang : normalizeAngle(p.ang + Math.PI);
    // Front axle on path → body trails behind (shallower exit from curves)
    const body = bodyFromFrontAxle(p.x, p.y, train.ang);
    train.x = body.x;
    train.y = body.y;
  }
}

function findNextPath(board, live, exitConnId, train) {
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
        candidates.push(pathEntryFromEdge(e2));
      }
    } else if (e.path) {
      if (e.path.pieceId === live.pieceId && e.path.id === live.id) continue;
      candidates.push(pathEntryFromEdge(e));
    }
  }

  if (candidates.length === 0) return null;

  const travelAng = train.ang;
  candidates.sort(
    (a, b) =>
      angleDiff(a.entryAng, travelAng) - angleDiff(b.entryAng, travelAng)
  );
  return candidates[0];
}

function pathEntryFromEdge(edge) {
  const path = edge.path;
  const reverse = edge.reverse;
  const s = reverse ? 1 : 0;
  const dir = reverse ? -1 : 1;
  const pose = pointOnPolyline(path.points, s);
  const entryAng = dir > 0 ? pose.ang : normalizeAngle(pose.ang + Math.PI);
  return { path, s, dir, entryAng };
}

function leaveRails(train) {
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  // Keep body heading; velocity along nose
  train.vx = Math.cos(train.ang) * train.speed;
  train.vy = Math.sin(train.ang) * train.speed;
  train.reRailCooldown = 0.4;
}

function stepOffRail(train, board, dt, bounds) {
  // Integrate body center
  let x = train.x + train.vx * dt;
  let y = train.y + train.vy * dt;
  let ang = train.ang;
  let vx = train.vx;
  let vy = train.vy;

  // Canvas edge uses body center
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

  // Collide using FRONT AXLE (primary) + rear axle — not the body center.
  // This matches the short wheelbase: walls push the guiding wheels, body yaws.
  let hitAny = false;
  for (let iter = 0; iter < 5; iter++) {
    let hit = false;
    // Recompute axle positions from current body pose
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
        const res = resolveCircleSegment(axle.x, axle.y, WHEEL_RADIUS, w);
        if (!res) continue;
        hit = true;
        hitAny = true;
        // Displacement of this axle
        const dx = res.x - axle.x;
        const dy = res.y - axle.y;
        // Move whole body by the push
        x += dx;
        y += dy;
        // Velocity response at contact
        const nx = res.nx;
        const ny = res.ny;
        const vn = vx * nx + vy * ny;
        if (vn < 0) {
          vx = vx - (1 + EDGE_RESTITUTION) * vn * nx;
          vy = vy - (1 + EDGE_RESTITUTION) * vn * ny;
        }
        // Front axle hits steer the heading more (guiding bogie)
        if (isFront) {
          const sp = Math.hypot(vx, vy);
          if (sp > 1e-3) {
            // Blend velocity heading into ang — shallower than nose-first
            const vAng = Math.atan2(vy, vx);
            ang = normalizeAngle(ang + 0.55 * normalizeAngle(vAng - ang));
          }
          // If nearly head-on, slide along wall using tangent from front axle
          if (Math.hypot(vx, vy) < train.speed * 0.2) {
            const tx = -ny;
            const ty = nx;
            const d1 = Math.cos(ang) * tx + Math.sin(ang) * ty;
            const sign = d1 >= 0 ? 1 : -1;
            vx = tx * sign * train.speed;
            vy = ty * sign * train.speed;
            ang = Math.atan2(vy, vx);
          }
        }
      }
    }
    if (!hit) break;
  }

  // Toy motor: keep cruise speed along heading
  let sp = Math.hypot(vx, vy);
  if (sp > 1e-3) {
    const target = train.speed;
    vx = (vx / sp) * target;
    vy = (vy / sp) * target;
    // Soft align body to velocity (front-guided feel)
    const vAng = Math.atan2(vy, vx);
    ang = normalizeAngle(ang + 0.35 * normalizeAngle(vAng - ang));
  } else if (hitAny) {
    vx = Math.cos(ang) * train.speed;
    vy = Math.sin(ang) * train.speed;
  }

  train.x = x;
  train.y = y;
  train.ang = ang;
  train.vx = vx;
  train.vy = vy;

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
  const push = radius - dist;
  return {
    x: cx + nx * push,
    y: cy + ny * push,
    nx,
    ny,
  };
}

function tryRerail(train, board) {
  // Re-rail based on FRONT AXLE position / heading
  const fa = frontAxlePos(train);
  const hit = closestPathPoint(board, fa.x, fa.y);
  if (!hit || hit.dist > RE_RAIL_LATERAL) return;

  const pathAng = hit.ang;
  const d1 = angleDiff(train.ang, pathAng);
  const d2 = angleDiff(train.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);

  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  const angLimit = nearMouth ? RE_RAIL_ANGLE * 1.15 : RE_RAIL_ANGLE;
  const latLimit = nearMouth ? RE_RAIL_LATERAL + 6 : RE_RAIL_LATERAL;
  if (hit.dist > latLimit || best > angLimit) return;

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
  train.reRailCooldown = 0.5;
}

export function modeLabel(mode) {
  switch (mode) {
    case TrainMode.ON_RAIL:
      return "On rails";
    case TrainMode.OFF_RAIL:
      return "Off rails (floor)";
    case TrainMode.STOPPED:
      return "Stopped at edge — reset train";
    case TrainMode.IDLE:
      return "Idle";
    default:
      return mode;
  }
}
