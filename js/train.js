/**
 * Train: path following, derail → wall glide → re-rail, canvas edge stop.
 *
 * Path solver:
 *   1) Connectivity graph (gender-linked connectors)
 *   2) Geometric hop at open joints (near endpoints, heading-matched)
 * so visually joined track stays continuous even if a gender link is missing.
 *
 * Visual body (TRAIN_LENGTH / TRAIN_RADIUS) is elongated for drawing.
 * Collision wheelbase is frozen to the pre-scale compact values so wall
 * glide does not fight itself across a long chassis.
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
 * Visual body: narrower than track bed, elongated.
 * TRACK_W = plastic bed width (40).
 */
export const TRAIN_RADIUS = HALF_W - 2; // 18
export const TRAIN_LENGTH = Math.round(TRACK_W * 2.15 * (4 / 3)); // ~115

/**
 * Physics wheelbase — pre-scale compact train (L=48 era).
 * Do not derive these from TRAIN_LENGTH or wall contact goes unstable.
 */
const PHYS_LEN = 48;
export const FRONT_AXLE_FROM_NOSE = PHYS_LEN / 3;
export const FRONT_AXLE_OFFSET = PHYS_LEN / 2 - FRONT_AXLE_FROM_NOSE; // +8
export const REAR_AXLE_OFFSET = -PHYS_LEN * 0.28; // ~-13.4
/** Compact contact radius used before the visual scale-up. */
export const WHEEL_RADIUS = 9;

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
    /**
     * Locked travel heading at derail. Used only as a unit direction
     * (never scaled by speed) so wall-tangent choice is speed-invariant.
     */
    offRailPreferAng: null,
    /** Integer tenths-of-px carry for fixed-size off-rail substeps. */
    offRailCarryTenths: 0,
    /** Distance remaining before re-rail is allowed (speed-invariant). */
    reRailDistLeft: 0,
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
  train.offRailPreferAng = null;
  train.offRailCarryTenths = 0;
  train.reRailDistLeft = 0;
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
  train.offRailPreferAng = null;
  train.offRailCarryTenths = 0;
  train.reRailDistLeft = 0;
  train.wallHit = false;
}

export function updateTrain(train, board, dt, bounds) {
  if (train.mode === TrainMode.IDLE || train.mode === TrainMode.STOPPED) return;

  // Time-based cooldown only used as legacy fallback; off-rail uses distance.
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

/**
 * Fixed distance per wall-resolve step. Speed only changes how many of
 * these run per frame — not which walls you hit or which tangent you pick.
 * (Center slider = 140 ≈ this distance × frame count at 60fps for tuning.)
 */
export const OFF_RAIL_DS = 2.5;
/** Integer carry units: 1 unit = 0.1 px (avoids float carry drift). */
const OFF_RAIL_DS_TENTHS = 25; // 2.5 px
/** Physics reference speed (slider center). Used by scoring tools. */
export const OFF_RAIL_REF_SPEED = 140;

function leaveRails(train) {
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.vx = Math.cos(train.ang) * train.speed;
  train.vy = Math.sin(train.ang) * train.speed;
  train.wallHit = false;
  // Unit-direction lock at derail (angle only — never scaled by speed)
  train.offRailPreferAng = train.ang;
  train.offRailCarryTenths = 0;
  // ~0.45s at center speed, but as *distance* so all speeds unlock re-rail
  // at the same point along the wall path
  train.reRailDistLeft = OFF_RAIL_REF_SPEED * 0.45;
  train.reRailCooldown = 0;
}

/**
 * Off-rail: advance with *exactly* OFF_RAIL_DS substeps via a carry register.
 *
 * speed only changes how fast carry fills — every wall resolve sees the same
 * 2.5px step, so geometry matches the center-slider path at any speed.
 * Body ang always snaps to travel (no soft lag / drift look).
 */
function stepOffRail(train, board, dt, bounds) {
  train.wallHit = false;
  const speed = Math.max(1, train.speed);
  // Integer carry in 0.1px units — same substep sequence at every speed
  train.offRailCarryTenths =
    (train.offRailCarryTenths || 0) + Math.round(speed * dt * 10);

  let x = train.x;
  let y = train.y;
  let ang = train.ang;

  // Unit travel direction
  let ux = Math.cos(ang);
  let uy = Math.sin(ang);
  {
    const vsp = Math.hypot(train.vx, train.vy);
    if (vsp > 1e-3) {
      ux = train.vx / vsp;
      uy = train.vy / vsp;
    }
  }

  let hitAny = false;
  let lastNx = 0;
  let lastNy = 0;

  // Only full fixed steps — leftover tenths stay for next frame
  while (train.offRailCarryTenths >= OFF_RAIL_DS_TENTHS) {
    train.offRailCarryTenths -= OFF_RAIL_DS_TENTHS;
    const ds = OFF_RAIL_DS;
    if (train.reRailDistLeft > 0) {
      train.reRailDistLeft = Math.max(0, train.reRailDistLeft - ds);
    }

    x += ux * ds;
    y += uy * ds;

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
      train.ang = ang;
      train.mode = TrainMode.STOPPED;
      return;
    }

    for (let iter = 0; iter < 6; iter++) {
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
          const res = resolveCircleSegment(axle.x, axle.y, WHEEL_RADIUS, w);
          if (!res) continue;
          hit = true;
          hitAny = true;
          lastNx = res.nx;
          lastNy = res.ny;

          // Seat axles out of wall (same every substep — speed-invariant)
          const pushScale = isFront ? 0.55 : 0.4;
          x += (res.x - axle.x) * pushScale;
          y += (res.y - axle.y) * pushScale;

          const nx = res.nx;
          const ny = res.ny;
          // Unit dir: remove into-wall component
          let vn = ux * nx + uy * ny;
          if (vn < 0) {
            ux -= vn * nx;
            uy -= vn * ny;
          }
          vn = ux * nx + uy * ny;
          if (vn > 0) {
            ux -= vn * nx;
            uy -= vn * ny;
          }

          const preferAng =
            train.offRailPreferAng != null ? train.offRailPreferAng : ang;
          const { tx, ty } = wallTangentAlongTravel(nx, ny, ux, uy, preferAng);
          ux = tx;
          uy = ty;

          // Snap body to travel — no soft lag (that was the "drift" look)
          if (isFront) {
            ang = Math.atan2(uy, ux);
            if (train.offRailPreferAng != null) {
              const dPref = normalizeAngle(ang - train.offRailPreferAng);
              if (Math.abs(dPref) < Math.PI * 0.5) {
                train.offRailPreferAng = normalizeAngle(
                  train.offRailPreferAng + 0.08 * dPref
                );
              }
            }
          }
        }
      }
      if (!hit) break;
    }

    // Keep unit dir valid
    const len = Math.hypot(ux, uy);
    if (len > 1e-6) {
      ux /= len;
      uy /= len;
    } else {
      ux = Math.cos(ang);
      uy = Math.sin(ang);
    }

    // Commit pose before re-rail attempt (same arc length for every speed)
    train.x = x;
    train.y = y;
    train.ang = ang;
    train.vx = ux * speed;
    train.vy = uy * speed;
    train.wallHit = hitAny;

    if (train.reRailDistLeft <= 0) {
      tryRerail(train, board);
      if (train.mode !== TrainMode.OFF_RAIL) {
        train.offRailCarryTenths = 0;
        return;
      }
    }
  }

  if (hitAny && (lastNx || lastNy) && train.mode === TrainMode.OFF_RAIL) {
    const preferAng =
      train.offRailPreferAng != null ? train.offRailPreferAng : ang;
    const { tx, ty } = wallTangentAlongTravel(lastNx, lastNy, ux, uy, preferAng);
    ux = tx;
    uy = ty;
    ang = Math.atan2(uy, ux);
  }

  if (train.mode === TrainMode.OFF_RAIL) {
    train.x = x;
    train.y = y;
    train.ang = ang;
    train.vx = ux * speed;
    train.vy = uy * speed;
    train.wallHit = hitAny;
  }
}

/**
 * Wall tangent continuing intended travel.
 * ux/uy must be unit-ish; preferAng is locked derail heading.
 * Never multiplies by speed magnitude.
 */
function wallTangentAlongTravel(nx, ny, ux, uy, preferAng) {
  let tx = -ny;
  let ty = nx;
  const hx = Math.cos(preferAng);
  const hy = Math.sin(preferAng);
  const len = Math.hypot(ux, uy);
  const vx = len > 1e-6 ? ux / len : 0;
  const vy = len > 1e-6 ? uy / len : 0;
  const preferX = hx * 5 + vx * 0.35;
  const preferY = hy * 5 + vy * 0.35;
  if (preferX * tx + preferY * ty < 0) {
    tx = -tx;
    ty = -ty;
  }
  return { tx, ty };
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
  if (train.offRailPreferAng != null) {
    const e1 = angleDiff(train.offRailPreferAng, pathAng);
    const e2 = angleDiff(train.offRailPreferAng, pathAng + Math.PI);
    train.dir = e1 <= e2 ? 1 : -1;
  } else {
    train.dir = d1 <= d2 ? 1 : -1;
  }
  const ang = train.dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  const body = bodyFromFrontAxle(hit.x, hit.y, ang);
  train.x = body.x;
  train.y = body.y;
  train.ang = ang;
  train.vx = 0;
  train.vy = 0;
  train.offRailPreferAng = null;
  train.offRailCarryTenths = 0;
  train.reRailDistLeft = 0;
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
