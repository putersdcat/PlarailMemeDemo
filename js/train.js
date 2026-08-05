/**
 * Train: path following, derail → wall glide → re-rail, canvas edge stop.
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
export const FRONT_AXLE_FROM_NOSE = TRAIN_LENGTH / 3;
export const FRONT_AXLE_OFFSET = TRAIN_LENGTH / 2 - FRONT_AXLE_FROM_NOSE;
export const REAR_AXLE_OFFSET = -TRAIN_LENGTH * 0.28;
export const WHEEL_RADIUS = 9;

/** Max lateral distance to snap onto a rail when placing / re-railing. */
export const RE_RAIL_LATERAL = 22;
export const RE_RAIL_ANGLE = (70 * Math.PI) / 180;
/** Geometric hop between path ends when graph link is missing. */
export const PATH_HOP_DIST = 30;
export const PATH_HOP_ANGLE = (40 * Math.PI) / 180;
/** Hit radius for selecting / dragging the train body. */
export const TRAIN_HIT_R = 28;
/**
 * Contour ride: when off-rail but near track, follow the rail-bed edge —
 * a parallel curve at (HALF_W + WHEEL_RADIUS) from the path centerline.
 * This matches the meme video (train skids along the blue plastic outline)
 * far better than bouncing off discrete wall segments.
 */
export const EDGE_FOLLOW_LAT = HALF_W + WHEEL_RADIUS; // ~29px from centerline
/** How far from a path centerline still counts as “on the plastic contour”. */
export const EDGE_FOLLOW_CATCH = EDGE_FOLLOW_LAT + 28;
/** Substeps per frame while free-flying between contour catches. */
export const OFF_RAIL_SUBSTEPS = 4;
/** How strongly body yaw locks to travel direction while on a contour. */
export const CONTOUR_YAW_BLEND = 0.9;
/**
 * Shallow glance: if into-wall fraction of velocity is below this, treat as
 * pure edge slide (no heading kick). Higher = stickier on inside curves.
 */
export const SHALLOW_GLANCE = 0.62;
/** Soft push fraction for shallow penetrations (less “pop” off the wall). */
export const SHALLOW_PUSH = 0.45;

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
    /** True while front axle is riding a wall contour */
    wallGlide: false,
    /** Sticky wall-tangent direction (prevents frame-to-frame flip) */
    glideTx: 0,
    glideTy: 0,
    /** Seconds spent off-rail this excursion (delays re-rail) */
    offRailTime: 0,
    /**
     * Edge-contour ride state (parallel to a path centerline).
     * { pieceId, pathId, s, side, dir }
     */
    edgeRef: null,
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
  train.edgeRef = null;
  train.vx = 0;
  train.vy = 0;
  train.s = 0;
  train.dir = 1;
  train.selected = false;
  train.wallGlide = false;
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
    // Switch may have de-activated this route — try geometric re-seat
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
  train.wallGlide = false;
  train.glideTx = Math.cos(train.ang);
  train.glideTy = Math.sin(train.ang);
  train.offRailTime = 0;
  train.edgeRef = null;
  train.reRailCooldown = 1.2;
}

/**
 * Off-rail (meme contour mode):
 * Ride the rail-bed edge as a parallel curve of the path centerline
 * (offset EDGE_FOLLOW_LAT). Hops across connected pieces like on-rail.
 * Falls into free flight only when leaving the layout envelope.
 */
function stepOffRail(train, board, dt, bounds) {
  const speed = Math.max(40, train.speed);
  let x = train.x;
  let y = train.y;
  let ang = train.ang;
  let vx = train.vx;
  let vy = train.vy;
  let gliding = false;

  // Ensure we have an edge-follow ref (piece/path/s/side/dir)
  let edge = train.edgeRef;
  if (!edge) {
    edge = captureEdgeRef(train, board);
    train.edgeRef = edge;
  }

  if (edge) {
    // Refresh live path each frame (switch state may change)
    let live = board.pathIndex.find(
      (p) =>
        p.pieceId === edge.pieceId && p.id === edge.pathId && p.active
    );
    if (!live) {
      // Path gone — re-acquire
      edge = captureEdgeRef(train, board);
      train.edgeRef = edge;
      live = edge
        ? board.pathIndex.find(
            (p) =>
              p.pieceId === edge.pieceId &&
              p.id === edge.pathId &&
              p.active
          )
        : null;
    }

    if (live) {
      let len = live.length || 1e-6;
      let s = edge.s;
      let dirSense = edge.dir >= 0 ? 1 : -1;
      const side = edge.side >= 0 ? 1 : -1;

      s += ((speed * dt) / len) * dirSense;

      let guard = 0;
      while ((s > 1 || s < 0) && guard++ < 12) {
        const leavingHigh = dirSense > 0;
        const endS = leavingHigh ? 1 : 0;
        const pose = pointOnPolyline(live.points, endS);
        const travelAng =
          dirSense > 0 ? pose.ang : normalizeAngle(pose.ang + Math.PI);
        const exitConn = leavingHigh ? live.toC : live.fromC;
        const overshootPx = leavingHigh ? (s - 1) * len : -s * len;
        const next = findNextPath(
          board,
          live,
          exitConn,
          pose,
          travelAng,
          train
        );
        if (!next) {
          // Dead end on this contour: reverse and ride back the other way
          // (meme train keeps sliding the plastic instead of freezing)
          dirSense *= -1;
          s = leavingHigh ? 1 - 1e-4 : 1e-4;
          s += (Math.abs(overshootPx) / len) * dirSense * 0.5;
          break;
        }
        live = next.path;
        dirSense = next.dir > 0 ? 1 : -1;
        len = live.length || 1e-6;
        s = next.s + (overshootPx / len) * dirSense;
      }

      s = Math.max(0, Math.min(1, s));
      const ep = edgePose(live, s, side, dirSense);
      const body = bodyFromFrontAxle(ep.x, ep.y, ep.ang);
      x = body.x;
      y = body.y;
      // Smooth yaw onto the contour (less snap on tight inner curves)
      ang = normalizeAngle(
        ang + CONTOUR_YAW_BLEND * normalizeAngle(ep.ang - ang)
      );
      vx = Math.cos(ep.ang) * speed;
      vy = Math.sin(ep.ang) * speed;
      gliding = true;
      train.dir = dirSense;
      train.edgeRef = {
        pieceId: live.pieceId,
        pathId: live.id,
        s,
        side,
        dir: dirSense,
      };
    }
  }

  // Free flight if no edge ref — soft wall slide, then re-catch contour
  if (!train.edgeRef) {
    if (Math.hypot(vx, vy) < 1e-3) {
      vx = Math.cos(ang) * speed;
      vy = Math.sin(ang) * speed;
    }
    const nSub = OFF_RAIL_SUBSTEPS;
    const sdt = dt / nSub;
    let preferX = train.glideTx || Math.cos(ang);
    let preferY = train.glideTy || Math.sin(ang);
    let slid = false;

    for (let i = 0; i < nSub; i++) {
      x += vx * sdt;
      y += vy * sdt;

      const fa = {
        x: x + Math.cos(ang) * FRONT_AXLE_OFFSET,
        y: y + Math.sin(ang) * FRONT_AXLE_OFFSET,
      };
      // Slight stick range so shallow inside-curve glances "catch" the plastic
      const hits = collectWallHits(
        fa.x,
        fa.y,
        WHEEL_RADIUS,
        5,
        board.walls || []
      );
      if (hits.length) {
        // Prefer deepest / closest contact
        hits.sort((a, b) => b.pen - a.pen);
        const h = hits[0];
        const sp0 = Math.hypot(vx, vy) || speed;
        const vn = (vx * h.nx + vy * h.ny) / sp0; // <0 into wall
        const into = Math.max(0, -vn); // 0 glancing … 1 head-on
        const shallow = into < SHALLOW_GLANCE;

        // Soft seat onto surface (shallow = less pop)
        if (h.pen > 0) {
          const push = shallow ? h.pen * SHALLOW_PUSH : h.pen * 0.85;
          x += h.nx * push;
          y += h.ny * push;
        } else if (h.dist < WHEEL_RADIUS + 4 && shallow) {
          // Hug: close tiny air gap on a glance without bouncing away
          const want = WHEEL_RADIUS + 0.4;
          const gap = h.dist - want;
          if (gap > 0) {
            x -= h.nx * Math.min(gap, 1.8) * 0.5;
            y -= h.ny * Math.min(gap, 1.8) * 0.5;
          }
        }

        // Pure tangent drive — no restitution bounce
        let tx = h.tx;
        let ty = h.ty;
        // Keep travel sense (prefer residual v, then sticky glide memory)
        const alongV = vx * tx + vy * ty;
        const alongP = preferX * tx + preferY * ty;
        if (alongV < -1e-3 || (Math.abs(alongV) < 1e-3 && alongP < 0)) {
          tx = -tx;
          ty = -ty;
        }

        if (shallow) {
          // Glancing: lock fully to wall tangent (smooth inside-curve slide)
          vx = tx * speed;
          vy = ty * speed;
          // Slow yaw turn so it looks like it follows the curve, not ricochets
          const vAng = Math.atan2(vy, vx);
          ang = normalizeAngle(
            ang + 0.55 * normalizeAngle(vAng - ang)
          );
          preferX = tx;
          preferY = ty;
          slid = true;
        } else {
          // Steeper hit: still no bounce — project then re-normalize
          let nvx = vx;
          let nvy = vy;
          const rawVn = nvx * h.nx + nvy * h.ny;
          if (rawVn < 0) {
            nvx -= rawVn * h.nx;
            nvy -= rawVn * h.ny;
          }
          // Blend toward tangent so even steep hits settle into a slide
          nvx = nvx * 0.35 + tx * speed * 0.65;
          nvy = nvy * 0.35 + ty * speed * 0.65;
          const sp = Math.hypot(nvx, nvy) || 1;
          vx = (nvx / sp) * speed;
          vy = (nvy / sp) * speed;
          const vAng = Math.atan2(vy, vx);
          ang = normalizeAngle(
            ang + 0.4 * normalizeAngle(vAng - ang)
          );
          preferX = vx / speed;
          preferY = vy / speed;
          slid = true;
        }

        // Secondary hits: only depenetrate, don't re-aim
        for (let j = 1; j < hits.length; j++) {
          const h2 = hits[j];
          if (h2.pen > 0) {
            x += h2.nx * h2.pen * 0.5;
            y += h2.ny * h2.pen * 0.5;
          }
        }
      } else {
        const sp = Math.hypot(vx, vy);
        if (sp > 1e-3) {
          vx = (vx / sp) * speed;
          vy = (vy / sp) * speed;
        } else {
          vx = preferX * speed;
          vy = preferY * speed;
        }
        ang = normalizeAngle(
          ang + 0.28 * normalizeAngle(Math.atan2(vy, vx) - ang)
        );
      }
    }

    train.glideTx = preferX;
    train.glideTy = preferY;

    // After a wall slide, prefer catching the rail-edge contour (inner curves)
    const recap = captureEdgeRef(
      { x, y, ang, dir: train.dir },
      board,
      slid ? EDGE_FOLLOW_CATCH + 12 : EDGE_FOLLOW_CATCH
    );
    if (recap) {
      // Keep travel sense continuous when snapping onto the edge
      if (slid) {
        const live = board.pathIndex.find(
          (p) =>
            p.pieceId === recap.pieceId &&
            p.id === recap.pathId &&
            p.active
        );
        if (live) {
          const pose = pointOnPolyline(live.points, recap.s);
          const along =
            preferX * Math.cos(pose.ang) + preferY * Math.sin(pose.ang);
          recap.dir = along >= 0 ? 1 : -1;
          if (recap.s < 0.08) recap.dir = 1;
          if (recap.s > 0.92) recap.dir = -1;
        }
      }
      train.edgeRef = recap;
      gliding = true;
    }
  }

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
    train.wallGlide = false;
    train.edgeRef = null;
    train.mode = TrainMode.STOPPED;
    return;
  }

  train.x = x;
  train.y = y;
  train.ang = ang;
  train.vx = vx;
  train.vy = vy;
  train.wallGlide = gliding;
  train.glideTx = Math.cos(ang);
  train.glideTy = Math.sin(ang);
  train.offRailTime = (train.offRailTime || 0) + dt;

  if (train.reRailCooldown <= 0 && train.offRailTime > 1.0) {
    tryRerail(train, board, { fromGlide: gliding });
  }
}

/** Build edgeRef from train pose + nearest path. */
function captureEdgeRef(train, board, catchDist = EDGE_FOLLOW_CATCH) {
  const fa = {
    x: train.x + Math.cos(train.ang) * FRONT_AXLE_OFFSET,
    y: train.y + Math.sin(train.ang) * FRONT_AXLE_OFFSET,
  };
  const near = closestPathPoint(board, fa.x, fa.y, catchDist);
  if (!near) return null;

  const pathAng = near.ang;
  const lx = -Math.sin(pathAng);
  const ly = Math.cos(pathAng);
  let side =
    (fa.x - near.x) * lx + (fa.y - near.y) * ly >= 0 ? 1 : -1;
  // If almost on centerline, pick side from body heading vs left normal
  if (near.dist < 6) {
    side =
      Math.cos(train.ang) * lx + Math.sin(train.ang) * ly >= 0 ? 1 : -1;
  }
  const along =
    Math.cos(train.ang) * Math.cos(pathAng) +
    Math.sin(train.ang) * Math.sin(pathAng);
  let dir = along >= 0 ? 1 : -1;
  // Don't start pinned against an end going nowhere
  if (near.s < 0.08) dir = 1;
  if (near.s > 0.92) dir = -1;
  return {
    pieceId: near.path.pieceId,
    pathId: near.path.id,
    s: near.s,
    side,
    dir,
  };
}

/**
 * World pose of the rail-bed edge at path parameter s.
 * side: +1 / -1 for left/right of path tangent (screen space).
 * dirSense: +1 follow increasing s, -1 reverse.
 */
function edgePose(path, s, side, dirSense) {
  const p = pointOnPolyline(path.points, Math.max(0, Math.min(1, s)));
  const pathAng = p.ang;
  // Left normal of increasing-s tangent
  const lx = -Math.sin(pathAng);
  const ly = Math.cos(pathAng);
  const x = p.x + lx * side * EDGE_FOLLOW_LAT;
  const y = p.y + ly * side * EDGE_FOLLOW_LAT;
  const ang =
    dirSense > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  return { x, y, ang, pathAng };
}

/**
 * All wall samples near a probe within radius+stick.
 * pen > 0 means penetrating (need push-out).
 */
function collectWallHits(cx, cy, radius, stickExtra, walls) {
  const out = [];
  if (!walls?.length) return out;
  const reach = radius + stickExtra;

  for (const seg of walls) {
    const dx = seg.x2 - seg.x1;
    const dy = seg.y2 - seg.y1;
    const L2 = dx * dx + dy * dy || 1;
    const L = Math.sqrt(L2);
    let t = ((cx - seg.x1) * dx + (cy - seg.y1) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    const qx = seg.x1 + t * dx;
    const qy = seg.y1 + t * dy;
    let nx = cx - qx;
    let ny = cy - qy;
    const dist = Math.hypot(nx, ny);
    if (dist >= reach || dist < 1e-9) continue;
    nx /= dist;
    ny /= dist;
    out.push({
      nx,
      ny,
      tx: dx / L,
      ty: dy / L,
      dist,
      pen: radius - dist,
      t,
      qx,
      qy,
    });
  }
  return out;
}

function tryRerail(train, board, opts = {}) {
  const fa = frontAxlePos(train);
  const hit = closestPathPoint(board, fa.x, fa.y, RE_RAIL_LATERAL + 6);
  if (!hit) return;

  const pathAng = hit.ang;
  const d1 = angleDiff(train.ang, pathAng);
  const d2 = angleDiff(train.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);

  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  // While contour-gliding exterior plastic, almost never re-rail mid-curve —
  // only a near-perfect mouth catch (meme recovery after the wall tour).
  if (opts.fromGlide) {
    if (!nearMouth) return;
    if (hit.dist > 10 || best > (35 * Math.PI) / 180) return;
  } else {
    const angLimit = nearMouth ? RE_RAIL_ANGLE * 1.05 : RE_RAIL_ANGLE * 0.85;
    const latLimit = nearMouth ? RE_RAIL_LATERAL + 4 : RE_RAIL_LATERAL - 2;
    if (hit.dist > latLimit || best > angLimit) return;
  }

  train.mode = TrainMode.ON_RAIL;
  train.wallGlide = false;
  train.edgeRef = null;
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
