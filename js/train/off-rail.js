/**
 * Off-rail wall glide: fixed-step geometry, deepest-wall steer, re-rail.
 *
 * Wall materials:
 *   default (track) — deepest hit + slide, no reverse (existing good path)
 *   cornerRedirect  — at ~90° dual hits, vector turn: enter one edge, leave the other
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

/** |n1·n2| below this ⇒ treat as ~perpendicular corner pair */
export const CORNER_DOT_MAX = 0.35;
/** Both hits need at least this penetration to count as a corner */
export const CORNER_MIN_PEN = 0.15;

export function leaveRails(train) {
  train.mode = TrainMode.OFF_RAIL;
  train.pathRef = null;
  train.vx = Math.cos(train.ang) * train.speed;
  train.vy = Math.sin(train.ang) * train.speed;
  train.wallHit = false;
  // Freeze intended travel at derail — wall corners use THIS, never speed-scaled vel
  train.offRailPreferAng = train.ang;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  // Same unlock distance for every speed (~0.45s at default speed)
  train.reRailDistLeft = OFF_RAIL_REF_SPEED * 0.45;
  train.reRailCooldown = 0;
  train.cornerLockSteps = 0;
}

/**
 * Four segments of the playfield rectangle (for solid outer walls).
 * Material: cornerRedirect — sharp 90° corners use vector turn, not thrash.
 */
export function playfieldWallSegments(bounds) {
  if (!bounds) return [];
  const { minX, minY, maxX, maxY } = bounds;
  const mat = { cornerRedirect: true };
  return [
    { x1: minX, y1: minY, x2: maxX, y2: minY, ...mat }, // top
    { x1: maxX, y1: minY, x2: maxX, y2: maxY, ...mat }, // right
    { x1: maxX, y1: maxY, x2: minX, y2: maxY, ...mat }, // bottom
    { x1: minX, y1: maxY, x2: minX, y2: minY, ...mat }, // left
  ];
}

/**
 * Nearest interior playfield corner within `radius`, with free-space normals
 * (pointing into the box). Exported for tests.
 */
export function nearestPlayfieldCorner(x, y, bounds, radius) {
  if (!bounds) return null;
  const { minX, minY, maxX, maxY } = bounds;
  // n1,n2 = free normals at that corner (into playfield)
  const corners = [
    { cx: minX, cy: minY, n1x: 1, n1y: 0, n2x: 0, n2y: 1 }, // top-left
    { cx: maxX, cy: minY, n1x: -1, n1y: 0, n2x: 0, n2y: 1 }, // top-right
    { cx: maxX, cy: maxY, n1x: -1, n1y: 0, n2x: 0, n2y: -1 }, // bottom-right
    { cx: minX, cy: maxY, n1x: 1, n1y: 0, n2x: 0, n2y: -1 }, // bottom-left
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

/**
 * Off-rail: fixed-distance steps (speed-invariant geometry).
 *
 * @param {object} [opts]
 * @param {boolean} [opts.solidPlayfield] — bounce on playfield rect instead of STOPPED
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

  // Track walls + optional solid playfield perimeter
  const walls = solidPlayfield
    ? [...(board.walls || []), ...playfieldWallSegments(bounds)]
    : board.walls || [];

  while ((train.offRailStepsDone || 0) < targetSteps) {
    train.offRailStepsDone = (train.offRailStepsDone || 0) + 1;
    if (train.reRailDistLeft > 0) {
      train.reRailDistLeft = Math.max(0, train.reRailDistLeft - OFF_RAIL_DS);
    }
    if (train.cornerLockSteps > 0) {
      train.cornerLockSteps -= 1;
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

    // Playfield geometric corner: vector redirect before segment thrash.
    // Margin must clear FRONT/REAR axles or the rear hangs outside the wall,
    // soft-clamp fights the step, and the train looks "stuck flapping".
    const axleReach = Math.max(
      Math.abs(FRONT_AXLE_OFFSET),
      Math.abs(REAR_AXLE_OFFSET)
    );
    const playfieldMargin = WHEEL_RADIUS + axleReach + 2;

    if (solidPlayfield && bounds) {
      const corner = nearestPlayfieldCorner(
        x,
        y,
        bounds,
        playfieldMargin * 1.35
      );
      if (corner) {
        hitAny = true;
        // Only pick a new exit when not already locked — avoids re-steering thrash
        if (!(train.cornerLockSteps > 0 && train.cornerLockUx != null)) {
          const { tx, ty } = cornerExitDir(
            corner.n1x,
            corner.n1y,
            corner.n2x,
            corner.n2y,
            ux,
            uy,
            preferAng
          );
          ux = tx;
          uy = ty;
          ang = Math.atan2(uy, ux);
          train.cornerLockUx = ux;
          train.cornerLockUy = uy;
          train.cornerLockSteps = 36;
        } else {
          ux = train.cornerLockUx;
          uy = train.cornerLockUy;
          ang = Math.atan2(uy, ux);
        }
        x = Math.max(
          bounds.minX + playfieldMargin,
          Math.min(bounds.maxX - playfieldMargin, x)
        );
        y = Math.max(
          bounds.minY + playfieldMargin,
          Math.min(bounds.maxY - playfieldMargin, y)
        );
      }
    }

    // Settle passes — track-style deepest slide; cornerRedirect pair if needed
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
      const frontHits = wallHitsSorted(fa2.x, fa2.y, walls);
      if (frontHits.length === 0) {
        if (!rearHit) break;
        continue;
      }

      hitAny = true;
      const frontHit = frontHits[0];
      x += (frontHit.x - fa2.x) * 0.75;
      y += (frontHit.y - fa2.y) * 0.75;

      // Hold locked corner exit heading (material / geometric)
      if (train.cornerLockSteps > 0 && train.cornerLockUx != null) {
        ux = train.cornerLockUx;
        uy = train.cornerLockUy;
        ang = Math.atan2(uy, ux);
      } else {
        const pair = pickCornerPair(frontHits);
        if (pair) {
          const { tx, ty } = cornerExitDir(
            pair.a.nx,
            pair.a.ny,
            pair.b.nx,
            pair.b.ny,
            ux,
            uy,
            preferAng
          );
          ux = tx;
          uy = ty;
          ang = Math.atan2(uy, ux);
          train.cornerLockUx = ux;
          train.cornerLockUy = uy;
          train.cornerLockSteps = 24;
        } else {
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
      }

      if (!rearHit && frontHits.length === 0) break;
    }

    // Soft containment after resolve (full wheelbase, not just body radius)
    if (solidPlayfield && bounds) {
      x = Math.max(
        bounds.minX + playfieldMargin,
        Math.min(bounds.maxX - playfieldMargin, x)
      );
      y = Math.max(
        bounds.minY + playfieldMargin,
        Math.min(bounds.maxY - playfieldMargin, y)
      );
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

/** Deepest wall penetration for a circle (avoids inner/outer thrashing). */
export function deepestWallHit(cx, cy, walls) {
  const hits = wallHitsSorted(cx, cy, walls);
  return hits[0] || null;
}

/**
 * If top hits form a ~90° pair and at least one has cornerRedirect material, return them.
 * Exported for unit tests.
 */
export function pickCornerPair(hits) {
  if (!hits || hits.length < 2) return null;
  const a = hits[0];
  for (let i = 1; i < Math.min(hits.length, 4); i++) {
    const b = hits[i];
    if (a.pen < CORNER_MIN_PEN || b.pen < CORNER_MIN_PEN) continue;
    const dot = a.nx * b.nx + a.ny * b.ny;
    if (Math.abs(dot) > CORNER_DOT_MAX) continue; // not perpendicular enough
    if (!a.cornerRedirect && !b.cornerRedirect) continue;
    return { a, b };
  }
  return null;
}

/**
 * Enter along one wall of a 90° corner → leave along the other (stable vector pick).
 * Normals point into free space (from wall toward train).
 * Exported for unit tests.
 */
export function cornerExitDir(n1x, n1y, n2x, n2y, ux, uy, preferAng) {
  const hx = Math.cos(preferAng);
  const hy = Math.sin(preferAng);

  /** Tangents of wall with normal (nx,ny): ±(-ny, nx) that leave the other wall */
  function exitTangents(nx, ny, ox, oy) {
    const out = [];
    for (const s of [1, -1]) {
      const tx = -ny * s;
      const ty = nx * s;
      // Must not dive into the other wall
      if (tx * ox + ty * oy < -0.05) continue;
      out.push({ tx, ty });
    }
    return out;
  }

  const candidates = [
    ...exitTangents(n1x, n1y, n2x, n2y),
    ...exitTangents(n2x, n2y, n1x, n1y),
  ];

  // Prefer exits that continue inbound travel; else any free-edge tangent
  const cont = candidates.filter((c) => c.tx * ux + c.ty * uy >= -0.05);
  const pool = cont.length ? cont : candidates;

  let best = null;
  let bestScore = -Infinity;
  for (const c of pool) {
    const along = c.tx * ux + c.ty * uy;
    const pref = c.tx * hx + c.ty * hy;
    // Prefer continuing inbound sense; preferAng breaks ties
    const score = along * 3 + pref;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (best) {
    const L = Math.hypot(best.tx, best.ty) || 1;
    return { tx: best.tx / L, ty: best.ty / L };
  }

  // Fallback: free bisector (n1+n2) — leave the corner into open space
  let fx = n1x + n2x;
  let fy = n1y + n2y;
  let L = Math.hypot(fx, fy);
  if (L < 1e-6) {
    return wallSlideDir(n1x, n1y, ux, uy, preferAng);
  }
  fx /= L;
  fy /= L;
  return { tx: fx, ty: fy };
}

/**
 * Slide direction on a wall:
 * 1) keep going the way we were already traveling (stops mid-curve flip-flops)
 * 2) if almost stopped / ambiguous, fall back to locked derail heading
 */
export function wallSlideDir(nx, ny, ux, uy, preferAng) {
  let tx = -ny;
  let ty = nx;
  const along = ux * tx + uy * ty;
  if (Math.abs(along) > 0.05) {
    // Continue current travel along the wall — never reverse
    if (along < 0) {
      tx = -tx;
      ty = -ty;
    }
  } else {
    // Ambiguous: use derail prefer
    const hx = Math.cos(preferAng);
    const hy = Math.sin(preferAng);
    if (hx * tx + hy * ty < 0) {
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
  // Full seat on the deepest wall — no residual penetration thrash
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
  train.offRailPreferAng = null;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  train.reRailDistLeft = 0;
  train.reRailCooldown = 0.55;
  train.cornerLockSteps = 0;
}
