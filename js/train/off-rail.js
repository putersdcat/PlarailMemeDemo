/**
 * Off-rail wall glide: fixed-step geometry, deepest-wall steer, re-rail.
 *
 * Track walls: deepest hit + slide (no reverse) — proven path, unchanged.
 * Solid playfield: separate AABB resolve (align + slide / corner free-axis),
 * not mixed into track segment thrash.
 */
import { angleDiff, normalizeAngle } from "../geometry.js";
import { closestPathPoint } from "../track.js";
import {
  TrainMode,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
  WHEEL_RADIUS,
  RE_RAIL_LATERAL,
  RE_RAIL_ANGLE,
} from "./constants.js";
import { frontAxlePos, bodyFromFrontAxle } from "./pose.js";

export const OFF_RAIL_DS = 2.5;
/** Center-slider reference speed (for re-rail unlock distance). */
export const OFF_RAIL_REF_SPEED = 210;

export function leaveRails(train) {
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.vx = Math.cos(train.ang) * train.speed;
  train.vy = Math.sin(train.ang) * train.speed;
  train.wallHit = false;
  train.offRailPreferAng = train.ang;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.reRailDistLeft = OFF_RAIL_REF_SPEED * 0.45;
  train.reRailCooldown = 0;
  train.cornerLockSteps = 0;
  train.cornerLockUx = null;
  train.cornerLockUy = null;
}

/**
 * Four segments for debug draw only — collision uses resolvePlayfieldAabb.
 * Kept for tests / wall-debug visualization helpers.
 */
export function playfieldWallSegments(bounds) {
  if (!bounds) return [];
  const { minX, minY, maxX, maxY } = bounds;
  const mat = { cornerRedirect: true };
  return [
    { x1: minX, y1: minY, x2: maxX, y2: minY, ...mat },
    { x1: maxX, y1: minY, x2: maxX, y2: maxY, ...mat },
    { x1: maxX, y1: maxY, x2: minX, y2: maxY, ...mat },
    { x1: minX, y1: maxY, x2: minX, y2: minY, ...mat },
  ];
}

/**
 * AABB playfield: seat body inside, kill velocity into walls, align heading
 * to remaining free motion (slide). Corners pick a free axis from prefer.
 * Exported for unit tests.
 */
export function resolvePlayfieldAabb(
  x,
  y,
  ux,
  uy,
  preferAng,
  bounds,
  radius = WHEEL_RADIUS
) {
  if (!bounds) {
    return { x, y, ux, uy, ang: Math.atan2(uy, ux), hit: false };
  }
  const loX = bounds.minX + radius;
  const hiX = bounds.maxX - radius;
  const loY = bounds.minY + radius;
  const hiY = bounds.maxY - radius;
  let hit = false;

  if (x < loX) {
    x = loX;
    if (ux < 0) {
      ux = 0;
      hit = true;
    }
  } else if (x > hiX) {
    x = hiX;
    if (ux > 0) {
      ux = 0;
      hit = true;
    }
  }
  if (y < loY) {
    y = loY;
    if (uy < 0) {
      uy = 0;
      hit = true;
    }
  } else if (y > hiY) {
    y = hiY;
    if (uy > 0) {
      uy = 0;
      hit = true;
    }
  }

  const hx = Math.cos(preferAng);
  const hy = Math.sin(preferAng);
  let sp = Math.hypot(ux, uy);

  if (hit && sp < 0.08) {
    // Stopped into wall(s): start sliding along free axes using prefer
    const free = [];
    // At each edge, free direction is inward along the free axis
    if (x <= loX + 0.5) free.push({ ux: 1, uy: 0 }); // on left → free right is wrong for slide
    // Free *tangents* while on a wall:
    // on bottom (y>=hiY): free tangents ±X, and free normal -Y already zeroed
    // Build candidate unit slides that don't go into a currently touching wall
    const cands = [
      { ux: 1, uy: 0 },
      { ux: -1, uy: 0 },
      { ux: 0, uy: 1 },
      { ux: 0, uy: -1 },
    ];
    let best = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      // Reject if that direction goes into a wall we're sitting on
      if (x <= loX + 0.5 && c.ux < 0) continue;
      if (x >= hiX - 0.5 && c.ux > 0) continue;
      if (y <= loY + 0.5 && c.uy < 0) continue;
      if (y >= hiY - 0.5 && c.uy > 0) continue;
      const score = c.ux * hx + c.uy * hy;
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best) {
      ux = best.ux;
      uy = best.uy;
    } else {
      // True corner: only free directions are into the interior
      const inward = [];
      if (x >= hiX - 0.5) inward.push({ ux: -1, uy: 0 });
      if (x <= loX + 0.5) inward.push({ ux: 1, uy: 0 });
      if (y >= hiY - 0.5) inward.push({ ux: 0, uy: -1 });
      if (y <= loY + 0.5) inward.push({ ux: 0, uy: 1 });
      best = inward[0] || { ux: hx, uy: hy };
      let bs = -Infinity;
      for (const c of inward) {
        const s = c.ux * hx + c.uy * hy;
        if (s > bs) {
          bs = s;
          best = c;
        }
      }
      ux = best.ux;
      uy = best.uy;
    }
    sp = 1;
  }

  if (sp > 1e-6) {
    ux /= sp;
    uy /= sp;
  } else {
    ux = hx;
    uy = hy;
    const L = Math.hypot(ux, uy) || 1;
    ux /= L;
    uy /= L;
  }

  return { x, y, ux, uy, ang: Math.atan2(uy, ux), hit };
}

/**
 * Off-rail: fixed-distance steps (speed-invariant geometry).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.solidPlayfield] bounce on playfield AABB instead of STOPPED
 */
export function stepOffRail(train, board, dt, bounds, opts = {}) {
  train.wallHit = false;
  const speed = Math.max(1, train.speed);
  const solidPlayfield = !!opts.solidPlayfield;

  train.offRailDistAcc = (train.offRailDistAcc || 0) + speed * dt;
  const targetSteps = Math.floor(train.offRailDistAcc / OFF_RAIL_DS + 1e-9);

  let x = train.x;
  let y = train.y;
  let ang = train.ang;
  let ux = Math.cos(ang);
  let uy = Math.sin(ang);
  {
    const vsp = Math.hypot(train.vx, train.vy);
    if (vsp > 1e-3) {
      ux = train.vx / vsp;
      uy = train.vy / vsp;
    }
  }

  const preferAng =
    train.offRailPreferAng != null ? train.offRailPreferAng : ang;
  let hitAny = false;

  // Track walls ONLY — playfield is handled separately as AABB
  const walls = board.walls || [];

  while ((train.offRailStepsDone || 0) < targetSteps) {
    train.offRailStepsDone = (train.offRailStepsDone || 0) + 1;
    if (train.reRailDistLeft > 0) {
      train.reRailDistLeft = Math.max(0, train.reRailDistLeft - OFF_RAIL_DS);
    }

    x += ux * OFF_RAIL_DS;
    y += uy * OFF_RAIL_DS;

    if (
      !solidPlayfield &&
      (x < bounds.minX ||
        x > bounds.maxX ||
        y < bounds.minY ||
        y > bounds.maxY)
    ) {
      train.x = Math.max(bounds.minX, Math.min(bounds.maxX, x));
      train.y = Math.max(bounds.minY, Math.min(bounds.maxY, y));
      train.vx = 0;
      train.vy = 0;
      train.ang = ang;
      train.mode = TrainMode.STOPPED;
      return;
    }

    // Track wall settle (original proven path)
    for (let iter = 0; iter < 4; iter++) {
      const fa = {
        x: x + Math.cos(ang) * FRONT_AXLE_OFFSET,
        y: y + Math.sin(ang) * FRONT_AXLE_OFFSET,
      };
      const ra = {
        x: x + Math.cos(ang) * REAR_AXLE_OFFSET,
        y: y + Math.sin(ang) * REAR_AXLE_OFFSET,
      };

      const rearHit = deepestWallHit(ra.x, ra.y, walls);
      if (rearHit) {
        hitAny = true;
        x += (rearHit.x - ra.x) * 0.55;
        y += (rearHit.y - ra.y) * 0.55;
      }

      const fa2 = {
        x: x + Math.cos(ang) * FRONT_AXLE_OFFSET,
        y: y + Math.sin(ang) * FRONT_AXLE_OFFSET,
      };
      const frontHit = deepestWallHit(fa2.x, fa2.y, walls);
      if (frontHit) {
        hitAny = true;
        x += (frontHit.x - fa2.x) * 0.75;
        y += (frontHit.y - fa2.y) * 0.75;
        const { tx, ty } = wallSlideDir(
          frontHit.nx,
          frontHit.ny,
          ux,
          uy,
          preferAng
        );
        ux = tx;
        uy = ty;
        ang = Math.atan2(uy, ux);
      }

      if (!rearHit && !frontHit) break;
    }

    // Solid playfield: AABB align + slide (not segment dual-hit thrash)
    if (solidPlayfield && bounds) {
      const r = resolvePlayfieldAabb(
        x,
        y,
        ux,
        uy,
        preferAng,
        bounds,
        WHEEL_RADIUS
      );
      x = r.x;
      y = r.y;
      ux = r.ux;
      uy = r.uy;
      ang = r.ang;
      if (r.hit) hitAny = true;
    }

    const len = Math.hypot(ux, uy);
    if (len > 1e-6) {
      ux /= len;
      uy /= len;
    } else {
      ux = Math.cos(preferAng);
      uy = Math.sin(preferAng);
      ang = preferAng;
    }

    train.x = x;
    train.y = y;
    train.ang = ang;
    train.vx = ux * speed;
    train.vy = uy * speed;
    train.wallHit = hitAny;

    if (train.reRailDistLeft <= 0) {
      tryRerail(train, board);
      if (train.mode !== TrainMode.OFF_RAIL) return;
    }
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

/** All penetrations, deepest first. */
export function wallHitsSorted(cx, cy, walls) {
  const hits = [];
  for (const w of walls) {
    const res = resolveCircleSegment(cx, cy, WHEEL_RADIUS, w);
    if (!res) continue;
    res.cornerRedirect = !!(w.cornerRedirect || w.material === "wood");
    hits.push(res);
  }
  hits.sort((a, b) => b.pen - a.pen);
  return hits;
}

export function deepestWallHit(cx, cy, walls) {
  const hits = wallHitsSorted(cx, cy, walls);
  return hits[0] || null;
}

/** @deprecated corner pair — kept for tests that still import it */
export const CORNER_DOT_MAX = 0.35;
export const CORNER_MIN_PEN = 0.15;

export function pickCornerPair(hits) {
  if (!hits || hits.length < 2) return null;
  const a = hits[0];
  for (let i = 1; i < Math.min(hits.length, 4); i++) {
    const b = hits[i];
    if (a.pen < CORNER_MIN_PEN || b.pen < CORNER_MIN_PEN) continue;
    const dot = a.nx * b.nx + a.ny * b.ny;
    if (Math.abs(dot) > CORNER_DOT_MAX) continue;
    if (!a.cornerRedirect && !b.cornerRedirect) continue;
    return { a, b };
  }
  return null;
}

/** @deprecated geometric corner helper — tests may still import */
export function nearestPlayfieldCorner(x, y, bounds, radius) {
  if (!bounds) return null;
  const { minX, minY, maxX, maxY } = bounds;
  const corners = [
    { cx: minX, cy: minY, n1x: 1, n1y: 0, n2x: 0, n2y: 1 },
    { cx: maxX, cy: minY, n1x: -1, n1y: 0, n2x: 0, n2y: 1 },
    { cx: maxX, cy: maxY, n1x: -1, n1y: 0, n2x: 0, n2y: -1 },
    { cx: minX, cy: maxY, n1x: 1, n1y: 0, n2x: 0, n2y: -1 },
  ];
  let best = null;
  let bestD = radius;
  for (const c of corners) {
    const d = Math.hypot(x - c.cx, y - c.cy);
    if (d <= bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

/** @deprecated — AABB handles corners; kept for unit tests of vector pick */
export function cornerExitDir(n1x, n1y, n2x, n2y, ux, uy, preferAng) {
  const hx = Math.cos(preferAng);
  const hy = Math.sin(preferAng);
  function exitTangents(nx, ny, ox, oy) {
    const out = [];
    for (const s of [1, -1]) {
      const tx = -ny * s;
      const ty = nx * s;
      if (tx * ox + ty * oy < -0.05) continue;
      out.push({ tx, ty });
    }
    return out;
  }
  const candidates = [
    ...exitTangents(n1x, n1y, n2x, n2y),
    ...exitTangents(n2x, n2y, n1x, n1y),
  ];
  const cont = candidates.filter((c) => c.tx * ux + c.ty * uy >= -0.05);
  const pool = cont.length ? cont : candidates;
  let best = null;
  let bestScore = -Infinity;
  for (const c of pool) {
    const score = c.tx * ux * 3 + c.ty * uy * 3 + c.tx * hx + c.ty * hy;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) {
    const L = Math.hypot(best.tx, best.ty) || 1;
    return { tx: best.tx / L, ty: best.ty / L };
  }
  let fx = n1x + n2x;
  let fy = n1y + n2y;
  const L = Math.hypot(fx, fy) || 1;
  return { tx: fx / L, ty: fy / L };
}

/**
 * Slide direction on a wall:
 * 1) keep going the way we were already traveling
 * 2) head-on: pick stable tangent so carriage aligns parallel
 */
export function wallSlideDir(nx, ny, ux, uy, preferAng) {
  let tx = -ny;
  let ty = nx;
  const along = ux * tx + uy * ty;
  if (Math.abs(along) > 0.05) {
    if (along < 0) {
      tx = -tx;
      ty = -ty;
    }
  } else {
    const hx = Math.cos(preferAng);
    const hy = Math.sin(preferAng);
    let alongPref = hx * tx + hy * ty;
    if (Math.abs(alongPref) < 0.05) {
      alongPref = nx * hy - ny * hx;
    }
    if (alongPref < 0) {
      tx = -tx;
      ty = -ty;
    }
  }
  return { tx, ty };
}

export function resolveCircleSegment(cx, cy, radius, seg) {
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
  const pen = radius - dist;
  const push = pen + 0.05;
  return {
    x: cx + nx * push,
    y: cy + ny * push,
    nx,
    ny,
    pen,
  };
}

function tryRerail(train, board) {
  const fa = frontAxlePos(train);
  const hit = closestPathPoint(board, fa.x, fa.y, RE_RAIL_LATERAL + 4);
  if (!hit) return;

  const pathAng = hit.ang;
  const d1 = angleDiff(train.ang, pathAng);
  const d2 = angleDiff(train.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);

  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  const angLimit = nearMouth ? RE_RAIL_ANGLE * 1.15 : RE_RAIL_ANGLE * 0.72;
  const latLimit = nearMouth ? RE_RAIL_LATERAL + 3 : RE_RAIL_LATERAL * 0.75;
  if (hit.dist > latLimit || best > angLimit) return;
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
  train.offRailPreferAng = null;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.reRailDistLeft = 0;
  train.reRailCooldown = 0.55;
  train.cornerLockSteps = 0;
}
