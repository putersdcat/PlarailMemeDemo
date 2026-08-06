/**
 * Multi-car consist (linked cars) + knockable freestanding pots.
 *
 * Lead car = train body (existing on/off-rail physics).
 * Followers = trailer hitch chain: mid car + trailing pulled engine.
 */
import {
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
} from "./constants.js";

/** Center-to-center spacing when coupled (slight gap between shells). */
export const COUPLER_DIST = TRAIN_LENGTH * 0.88;
/**
 * Hitch offsets from body center — sum ≈ COUPLER_DIST so cars don't stack.
 * (Do not use compact physics wheelbase here; visuals need full car length.)
 */
export const REAR_HITCH = TRAIN_LENGTH * 0.48;
export const FRONT_HITCH = TRAIN_LENGTH * 0.4;
/** Default pot / green-dome radius. */
export const POT_RADIUS = 22;

/**
 * Build a 3-unit consist: powered lead, middle car, trailing pulled engine.
 * Lead pose mirrors train.x/y/ang.
 */
export function ensureConsist(train, spec = null) {
  if (train.cars && train.cars.length >= 1 && !spec) return train.cars;

  const carsSpec =
    spec ||
    train.consistSpec ||
    (train.cars && train.cars.length
      ? train.cars.map((c) => ({ role: c.role, kind: c.kind }))
      : null);

  if (!carsSpec || !carsSpec.length) {
    // Single-engine default (existing meme track)
    train.cars = [
      {
        id: "lead",
        role: "lead",
        kind: "engine",
        x: train.x,
        y: train.y,
        ang: train.ang,
      },
    ];
    return train.cars;
  }

  train.consistSpec = carsSpec.map((c) => ({
    role: c.role || "mid",
    kind: c.kind || (c.role === "lead" || c.role === "trail" ? "engine" : "mid"),
  }));

  train.cars = train.consistSpec.map((c, i) => ({
    id: c.role === "lead" ? "lead" : `car${i}`,
    role: c.role || (i === 0 ? "lead" : i === train.consistSpec.length - 1 ? "trail" : "mid"),
    kind: c.kind || "mid",
    x: train.x - Math.cos(train.ang || 0) * COUPLER_DIST * i,
    y: train.y - Math.sin(train.ang || 0) * COUPLER_DIST * i,
    ang: train.ang || 0,
  }));
  // Ensure first is lead
  if (train.cars[0]) {
    train.cars[0].role = "lead";
    train.cars[0].kind = train.cars[0].kind || "engine";
    train.cars[0].id = "lead";
  }
  placeFollowers(train);
  return train.cars;
}

/** Three-car Shinkansen-style consist for the not-enough-rails meme. */
export function threeCarConsistSpec() {
  return [
    { role: "lead", kind: "engine" },
    { role: "mid", kind: "mid" },
    { role: "trail", kind: "engine" },
  ];
}

/**
 * Place followers behind the lead using a simple trailer hitch model.
 * Lead is always train.x / train.y / train.ang (driven by path physics).
 * @returns {{ spacingOk: boolean, minSpacing: number }}
 */
export function placeFollowers(train) {
  if (!train) return { spacingOk: true, minSpacing: 0 };
  ensureConsist(train);
  const cars = train.cars;
  if (!cars.length) return { spacingOk: true, minSpacing: 0 };

  // Sync lead
  cars[0].x = train.x;
  cars[0].y = train.y;
  cars[0].ang = train.ang;
  cars[0].role = "lead";

  let minSpacing = Infinity;
  for (let i = 1; i < cars.length; i++) {
    const prev = cars[i - 1];
    const car = cars[i];
    // Hitch point at rear of previous car
    const hitchX = prev.x - Math.cos(prev.ang) * REAR_HITCH;
    const hitchY = prev.y - Math.sin(prev.ang) * REAR_HITCH;

    // Preferred: car faces toward hitch (same travel sense as lead)
    let ang = prev.ang;
    if (car.x != null && car.y != null) {
      const dx = hitchX - car.x;
      const dy = hitchY - car.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3) {
        // Blend toward hitch direction so trailers lag on curves
        const hitchAng = Math.atan2(dy, dx);
        let da = hitchAng - ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        ang = ang + da * 0.85;
      }
    }
    car.ang = ang;
    car.x = hitchX - Math.cos(ang) * FRONT_HITCH;
    car.y = hitchY - Math.sin(ang) * FRONT_HITCH;

    const sp = Math.hypot(car.x - prev.x, car.y - prev.y);
    if (sp < minSpacing) minSpacing = sp;
  }
  if (!Number.isFinite(minSpacing)) minSpacing = 0;
  // Spacing should stay near coupler length (not collapsed on top of lead)
  const spacingOk =
    cars.length < 2 ||
    (minSpacing > COUPLER_DIST * 0.35 && minSpacing < COUPLER_DIST * 1.6);
  return { spacingOk, minSpacing };
}

/** Circle vs car body (approx ellipse using TRAIN_RADIUS / half-length). */
export function carHitsCircle(car, cx, cy, r) {
  if (!car) return false;
  const dx = cx - car.x;
  const dy = cy - car.y;
  const c = Math.cos(-car.ang);
  const s = Math.sin(-car.ang);
  const lx = dx * c - dy * s;
  const ly = dx * s + dy * c;
  const halfL = TRAIN_LENGTH * 0.48;
  const halfW = TRAIN_RADIUS + 2;
  // Expand AABB by pot radius in local frame
  return (
    Math.abs(lx) <= halfL + r &&
    Math.abs(ly) <= halfW + r
  );
}

/**
 * Knock freestanding pots when any car body overlaps.
 * Mutates pot.knocked / pot.vx / pot.vy / pot.spin.
 * @returns {number} count of pots newly knocked this call
 */
export function knockPots(train, board, dt = 1 / 60) {
  if (!board?.pots?.length || !train) return 0;
  ensureConsist(train);
  placeFollowers(train);
  let newly = 0;
  const cars = train.cars || [{ x: train.x, y: train.y, ang: train.ang }];

  for (const pot of board.pots) {
    if (!pot) continue;
    const r = pot.r ?? POT_RADIUS;
    // Integrate already-knocked motion
    if (pot.knocked) {
      pot.x = (pot.x || 0) + (pot.vx || 0) * dt;
      pot.y = (pot.y || 0) + (pot.vy || 0) * dt;
      pot.ang = (pot.ang || 0) + (pot.spin || 0) * dt;
      // friction
      pot.vx = (pot.vx || 0) * 0.92;
      pot.vy = (pot.vy || 0) * 0.92;
      pot.spin = (pot.spin || 0) * 0.94;
      continue;
    }

    for (const car of cars) {
      if (!carHitsCircle(car, pot.x, pot.y, r)) continue;
      pot.knocked = true;
      newly++;
      // Impart velocity away from car center + along car heading
      const dx = pot.x - car.x;
      const dy = pot.y - car.y;
      const d = Math.hypot(dx, dy) || 1;
      const push = Math.max(120, (train.speed || 180) * 0.85);
      pot.vx = (dx / d) * push + Math.cos(car.ang) * push * 0.35;
      pot.vy = (dy / d) * push + Math.sin(car.ang) * push * 0.35;
      pot.spin = (Math.random() > 0.5 ? 1 : -1) * (2.5 + Math.random() * 3);
      pot.ang = pot.ang || 0;
      break;
    }
  }
  return newly;
}

/**
 * Normalize pots array from layout JSON.
 */
export function loadPotsFromLayout(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList.map((p, i) => ({
    id: p.id || `pot${i + 1}`,
    x: Number(p.x) || 0,
    y: Number(p.y) || 0,
    r: Number(p.r) > 0 ? Number(p.r) : POT_RADIUS,
    kind: p.kind || "pot",
    color: p.color || "#5aaf3a",
    knocked: !!p.knocked,
    vx: 0,
    vy: 0,
    ang: Number(p.ang) || 0,
    spin: 0,
  }));
}
