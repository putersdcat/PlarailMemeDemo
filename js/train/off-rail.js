/**
 * Off-rail wall glide: fixed-step geometry, deepest-wall steer, re-rail.
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
  // Freeze intended travel at derail — wall corners use THIS, never speed-scaled vel
  train.offRailPreferAng = train.ang;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  // Same unlock distance for every speed (~0.45s at default speed)
  train.reRailDistLeft = OFF_RAIL_REF_SPEED * 0.45;
  train.reRailCooldown = 0;
}

/**
 * Four segments of the playfield rectangle (for solid outer walls).
 * Same segment format as board.walls.
 */
export function playfieldWallSegments(bounds) {
  if (!bounds) return [];
  const { minX, minY, maxX, maxY } = bounds;
  return [
    { x1: minX, y1: minY, x2: maxX, y2: minY }, // top
    { x1: maxX, y1: minY, x2: maxX, y2: maxY }, // right
    { x1: maxX, y1: maxY, x2: minX, y2: maxY }, // bottom
    { x1: minX, y1: maxY, x2: minX, y2: minY }, // left
  ];
}

/**
 * Off-rail: fixed-distance steps (speed-invariant geometry).
 * Curve flip-flop fix: only the *deepest* front wall steers, and travel
 * never reverses more than 90° in one step (inner/outer rail thrashing).
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

  // Track walls + optional solid playfield perimeter (same collision as rails)
  const walls = solidPlayfield
    ? [...(board.walls || []), ...playfieldWallSegments(bounds)]
    : board.walls || [];

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

    // Soft clamp if solid walls somehow tunnel past the perimeter
    if (solidPlayfield) {
      const m = WHEEL_RADIUS + 1;
      x = Math.max(bounds.minX + m, Math.min(bounds.maxX - m, x));
      y = Math.max(bounds.minY + m, Math.min(bounds.maxY - m, y));
    }

    // A few settle passes — each pass uses only deepest contact per axle
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

      const frontHit = deepestWallHit(fa.x, fa.y, walls);
      if (frontHit) {
        hitAny = true;
        x += (frontHit.x - fa.x) * 0.75;
        y += (frontHit.y - fa.y) * 0.75;

        // Continue *current* travel along this wall — never reverse in-place
        // (prefer only breaks ties when travel is nearly zero)
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

/** Deepest wall penetration for a circle (avoids inner/outer thrashing). */
function deepestWallHit(cx, cy, walls) {
  let best = null;
  for (const w of walls) {
    const res = resolveCircleSegment(cx, cy, WHEEL_RADIUS, w);
    if (!res) continue;
    if (!best || res.pen > best.pen) best = res;
  }
  return best;
}

/**
 * Slide direction on a wall:
 * 1) keep going the way we were already traveling (stops mid-curve flip-flops)
 * 2) if almost stopped / ambiguous, fall back to locked derail heading
 */
function wallSlideDir(nx, ny, ux, uy, preferAng) {
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
}

