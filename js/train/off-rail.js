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
import { frontAxlePos, rearAxlePos, bodyFromFrontAxle } from "./pose.js";
import { placeFollowers } from "./consist.js";

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
 * to remaining free motion (slide).
 *
 * Hit semantics (SFX / tap-tap):
 *  - `hit` only when an into-wall velocity component is killed (impact), or
 *    position was outside and got clamped.
 *  - Pure parallel glide on an edge is NOT a hit (no continuous tap-tap).
 *
 * Direction (thrash):
 *  - Mid-edge: keep free-axis velocity sign; never re-pick from stale prefer.
 *  - Dual-edge corner when stopped: free axes only, scored by pre-impact
 *    travel then preferAng (turn the corner, don't reverse along the wall).
 *
 * Exported for unit tests. All solid-playfield logic lives here for revert.
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
  /** On-boundary tolerance — inclusive so vertical walls kill into-vel. */
  const on = 0.75;
  let hit = false;

  // Capture travel before wall kills — used to keep along-wall sign / turn
  const inUx = ux;
  const inUy = uy;

  // Seat inside the inner rect; clamp from outside counts as impact
  if (x < loX) {
    x = loX;
    hit = true;
  } else if (x > hiX) {
    x = hiX;
    hit = true;
  }
  if (y < loY) {
    y = loY;
    hit = true;
  } else if (y > hiY) {
    y = hiY;
    hit = true;
  }

  const onLeft = x <= loX + on;
  const onRight = x >= hiX - on;
  const onTop = y <= loY + on;
  const onBottom = y >= hiY - on;

  // Kill velocity *into* walls we're on — real impact only when we zero a
  // nonzero into-wall component (not when already tangent / parallel).
  if (onLeft && ux < -1e-6) {
    ux = 0;
    hit = true;
  }
  if (onRight && ux > 1e-6) {
    ux = 0;
    hit = true;
  }
  if (onTop && uy < -1e-6) {
    uy = 0;
    hit = true;
  }
  if (onBottom && uy > 1e-6) {
    uy = 0;
    hit = true;
  }

  const hx = Math.cos(preferAng);
  const hy = Math.sin(preferAng);
  let sp = Math.hypot(ux, uy);
  const wallCount =
    (onLeft ? 1 : 0) + (onRight ? 1 : 0) + (onTop ? 1 : 0) + (onBottom ? 1 : 0);

  /**
   * Free cardinal dirs that do not dig into a seated wall.
   * Dual-edge corners only allow inward free axes (turn, not reverse).
   */
  function freeDirs() {
    const cands = [
      { ux: 1, uy: 0 },
      { ux: -1, uy: 0 },
      { ux: 0, uy: 1 },
      { ux: 0, uy: -1 },
    ];
    return cands.filter((c) => {
      if (onLeft && c.ux < 0) return false;
      if (onRight && c.ux > 0) return false;
      if (onTop && c.uy < 0) return false;
      if (onBottom && c.uy > 0) return false;
      return true;
    });
  }

  /** Score free dir: prefer continuing inbound travel, then preferAng. */
  function scoreDir(c) {
    // Strong weight on pre-impact travel so mid-edge / corner don't reverse
    const cont = c.ux * inUx + c.uy * inUy;
    const pref = c.ux * hx + c.uy * hy;
    return cont * 4 + pref;
  }

  function pickBest(dirs) {
    let best = null;
    let bestScore = -Infinity;
    for (const c of dirs) {
      const s = scoreDir(c);
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    return best;
  }

  if (sp < 0.08 && wallCount > 0) {
    // Fully stopped into wall(s): choose free slide — never use into-wall dirs
    let dirs = freeDirs();
    if (!dirs.length) {
      // Degenerate: force inward from each seated wall
      dirs = [];
      if (onRight) dirs.push({ ux: -1, uy: 0 });
      if (onLeft) dirs.push({ ux: 1, uy: 0 });
      if (onBottom) dirs.push({ ux: 0, uy: -1 });
      if (onTop) dirs.push({ ux: 0, uy: 1 });
    }
    const best = pickBest(dirs) || { ux: hx, uy: hy };
    ux = best.ux;
    uy = best.uy;
    sp = 1;
  } else if (sp > 1e-6) {
    // Keep residual free motion (along-wall sign preserved)
    ux /= sp;
    uy /= sp;
  } else {
    // No wall, no residual — aim by prefer
    ux = hx;
    uy = hy;
    sp = Math.hypot(ux, uy) || 1;
    ux /= sp;
    uy /= sp;
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
      // Prefer tracks current slide so corners turn instead of reverse thrash
      const slidePrefer =
        train.offRailPreferAng != null ? train.offRailPreferAng : preferAng;
      const r = resolvePlayfieldAabb(
        x,
        y,
        ux,
        uy,
        slidePrefer,
        bounds,
        WHEEL_RADIUS
      );
      x = r.x;
      y = r.y;
      ux = r.ux;
      uy = r.uy;
      ang = r.ang;
      if (r.hit) hitAny = true;
      // Update leave-rails prefer to *current* free motion (not stale derail ang)
      train.offRailPreferAng = ang;
    }

    const len = Math.hypot(ux, uy);
    if (len > 1e-6) {
      ux /= len;
      uy /= len;
    } else {
      const pa =
        train.offRailPreferAng != null ? train.offRailPreferAng : preferAng;
      ux = Math.cos(pa);
      uy = Math.sin(pa);
      ang = pa;
    }

    train.x = x;
    train.y = y;
    train.ang = ang;
    train.vx = ux * speed;
    train.vy = uy * speed;
    // wallHit = true only if this frame had impact (not parallel scrape)
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
  // Probe front axle, body, and rear — multi-car wall slides often put only
  // the body near the rail while the front axle is still slightly off.
  const fa = frontAxlePos(train);
  const ra = rearAxlePos(train);
  const probes = [
    { x: fa.x, y: fa.y, max: RE_RAIL_LATERAL + 6 },
    { x: train.x, y: train.y, max: RE_RAIL_LATERAL + 8 },
    { x: ra.x, y: ra.y, max: RE_RAIL_LATERAL + 6 },
  ];
  let hit = null;
  for (const p of probes) {
    const h = closestPathPoint(board, p.x, p.y, p.max);
    if (!h) continue;
    if (!hit || h.dist < hit.dist) hit = h;
  }
  if (!hit) return;

  const pathAng = hit.ang;
  const d1 = angleDiff(train.ang, pathAng);
  const d2 = angleDiff(train.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);

  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  // Slightly looser near mouths and when multi-car (wall adjacency)
  const multi = !!(train.cars && train.cars.length > 1);
  const angLimit =
    (nearMouth ? RE_RAIL_ANGLE * 1.2 : RE_RAIL_ANGLE * 0.78) *
    (multi ? 1.12 : 1);
  const latLimit =
    (nearMouth ? RE_RAIL_LATERAL + 5 : RE_RAIL_LATERAL * 0.9) *
    (multi ? 1.15 : 1);
  if (hit.dist > latLimit || best > angLimit) return;
  if (!nearMouth && best > (32 * Math.PI) / 180) return;

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
  // Seat multi-car chain immediately so trailers don't drag re-rail back off
  if (train.cars?.length > 1) {
    placeFollowers(train, { hard: true, board });
  }
}
