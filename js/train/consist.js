/**
 * Multi-car consist: separable cars, trailer hitch, active powered engine.
 * Lead/powered unit drives physics (train.x/y/ang); coupled followers trail.
 */
import {
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
} from "./constants.js";
import { normalizeAngle } from "../geometry.js";

/** Center-to-center spacing when coupled. */
export const COUPLER_DIST = TRAIN_LENGTH * 0.88;
export const REAR_HITCH = TRAIN_LENGTH * 0.48;
export const FRONT_HITCH = TRAIN_LENGTH * 0.4;

let nextCarId = 1;

export function threeCarConsistSpec() {
  return [
    { role: "lead", kind: "engine", facing: 1 },
    { role: "mid", kind: "mid", facing: 1 },
    { role: "trail", kind: "engine", facing: -1 },
  ];
}

function newCarId(prefix = "car") {
  return `${prefix}${nextCarId++}`;
}

/**
 * @param {object} train
 * @param {Array|null} spec
 * @param {{ hard?: boolean }} [opts]
 */
export function ensureConsist(train, spec = null, opts = {}) {
  const hard = !!opts.hard;
  if (train.cars && train.cars.length >= 1 && !spec && !hard) {
    return train.cars;
  }

  const carsSpec =
    spec ||
    train.consistSpec ||
    (train.cars?.length
      ? train.cars.map((c) => ({
          role: c.role,
          kind: c.kind,
          facing: c.facing,
        }))
      : null);

  if (!carsSpec?.length) {
    train.cars = [
      {
        id: "lead",
        role: "lead",
        kind: "engine",
        facing: 1,
        coupled: true,
        powered: true,
        x: train.x,
        y: train.y,
        ang: train.ang,
      },
    ];
    train.poweredId = "lead";
    return train.cars;
  }

  train.consistSpec = carsSpec.map((c) => ({
    role: c.role || "mid",
    kind: c.kind || (c.role === "mid" ? "mid" : "engine"),
    facing: c.facing ?? (c.role === "trail" ? -1 : 1),
  }));

  train.cars = train.consistSpec.map((c, i) => {
    const isLead = i === 0;
    const isTrail =
      c.role === "trail" ||
      (i === train.consistSpec.length - 1 && c.kind === "engine" && i > 0);
    return {
      id: isLead ? "lead" : newCarId(c.kind === "mid" ? "mid" : "eng"),
      role: c.role || (isLead ? "lead" : isTrail ? "trail" : "mid"),
      kind: c.kind || "mid",
      facing: c.facing ?? (isTrail ? -1 : 1),
      coupled: true,
      powered: isLead,
      x: train.x - Math.cos(train.ang || 0) * COUPLER_DIST * i,
      y: train.y - Math.sin(train.ang || 0) * COUPLER_DIST * i,
      ang: train.ang || 0,
    };
  });
  if (train.cars[0]) {
    train.cars[0].id = "lead";
    train.cars[0].role = "lead";
    train.cars[0].powered = true;
    train.cars[0].kind = train.cars[0].kind || "engine";
  }
  train.poweredId = train.cars[0].id;
  placeFollowers(train, { hard: true });
  return train.cars;
}

/**
 * Place coupled followers behind the powered lead.
 * Trail engines keep facing=-1 (body drawn reversed).
 * Uncoupled cars are left in place.
 */
export function placeFollowers(train, opts = {}) {
  if (!train) return { spacingOk: true, minSpacing: 0 };
  const hard = !!opts.hard;
  if (!train.cars?.length) {
    if (train.consistSpec?.length) {
      ensureConsist(train, train.consistSpec, { hard: true });
    } else {
      return { spacingOk: true, minSpacing: 0 };
    }
  }
  const cars = train.cars;
  const powered =
    cars.find((c) => c.powered || c.id === train.poweredId) || cars[0];

  // Powered unit is the physics body
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.powered = true;

  // Chain order: powered first, then remaining *coupled* cars in list order
  const chain = [powered, ...cars.filter((c) => c !== powered && c.coupled)];
  // Keep uncoupled out of chain

  let minSpacing = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const car = chain[i];
    const hitchX = prev.x - Math.cos(prev.ang) * REAR_HITCH;
    const hitchY = prev.y - Math.sin(prev.ang) * REAR_HITCH;

    let ang = prev.ang;
    if (
      !hard &&
      car.x != null &&
      Number.isFinite(car.x) &&
      Number.isFinite(car.y)
    ) {
      const dx = hitchX - car.x;
      const dy = hitchY - car.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3 && d < COUPLER_DIST * 2.5) {
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
    // Trail engines face backward (same body, reversed)
    if (car.kind === "engine" && car.role === "trail") car.facing = -1;
    if (car.kind === "mid") car.facing = 1;

    const sp = Math.hypot(car.x - prev.x, car.y - prev.y);
    if (sp < minSpacing) minSpacing = sp;
  }
  if (!Number.isFinite(minSpacing)) minSpacing = 0;
  const coupledCount = chain.length;
  const spacingOk =
    coupledCount < 2 ||
    (minSpacing > COUPLER_DIST * 0.35 && minSpacing < COUPLER_DIST * 1.6);
  return { spacingOk, minSpacing };
}

/** Visible coupler segment endpoints between two cars (world). */
export function couplerLink(prev, car) {
  if (!prev || !car) return null;
  const x1 = prev.x - Math.cos(prev.ang) * REAR_HITCH * 0.85;
  const y1 = prev.y - Math.sin(prev.ang) * REAR_HITCH * 0.85;
  const x2 = car.x + Math.cos(car.ang) * FRONT_HITCH * 0.85;
  const y2 = car.y + Math.sin(car.ang) * FRONT_HITCH * 0.85;
  return { x1, y1, x2, y2 };
}

/** All visible links for coupled chain from powered unit. */
export function consistLinks(train) {
  if (!train?.cars?.length) return [];
  const powered =
    train.cars.find((c) => c.powered || c.id === train.poweredId) ||
    train.cars[0];
  const chain = [
    powered,
    ...train.cars.filter((c) => c !== powered && c.coupled),
  ];
  const links = [];
  for (let i = 1; i < chain.length; i++) {
    const L = couplerLink(chain[i - 1], chain[i]);
    if (L) links.push(L);
  }
  return links;
}

/** Uncouple a car so it becomes a free unit (still on train.cars). */
export function uncoupleCar(train, carId) {
  if (!train?.cars) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.powered) return false;
  car.coupled = false;
  return true;
}

/** Re-couple a free car to the end of the powered chain if close enough. */
export function tryRecoupleCar(train, carId, maxDist = COUPLER_DIST * 1.35) {
  if (!train?.cars) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.powered) return false;
  const powered =
    train.cars.find((c) => c.powered || c.id === train.poweredId) ||
    train.cars[0];
  const chain = [
    powered,
    ...train.cars.filter((c) => c !== powered && c.coupled),
  ];
  const tail = chain[chain.length - 1];
  const hitchX = tail.x - Math.cos(tail.ang) * REAR_HITCH;
  const hitchY = tail.y - Math.sin(tail.ang) * REAR_HITCH;
  const noseX = car.x + Math.cos(car.ang) * FRONT_HITCH;
  const noseY = car.y + Math.sin(car.ang) * FRONT_HITCH;
  if (Math.hypot(noseX - hitchX, noseY - hitchY) > maxDist) return false;
  car.coupled = true;
  placeFollowers(train, { hard: true });
  return true;
}

/**
 * Make an engine the powered (driving) unit.
 * Gender/flip UX calls this when an engine car is selected.
 */
export function setActiveEngine(train, carId) {
  if (!train?.cars?.length) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.kind !== "engine") return false;

  // Capture pose of new powered unit
  const px = car.x;
  const py = car.y;
  // Body travel direction: if facing reverse, travel is opposite nose
  let pang = car.ang;
  if (car.facing === -1) {
    // Visual nose is reverse of ang; powering it: use current ang as travel
    pang = car.ang;
  }

  for (const c of train.cars) {
    c.powered = c.id === carId;
  }
  train.poweredId = carId;
  train.x = px;
  train.y = py;
  train.ang = pang;

  // Reorder: powered first for bookkeeping
  train.cars = [car, ...train.cars.filter((c) => c !== car)];
  // Trail engines that aren't powered keep reverse facing when coupled behind
  for (const c of train.cars) {
    if (c.kind === "engine" && !c.powered && c.coupled) c.facing = -1;
    if (c.powered) c.facing = 1;
  }
  placeFollowers(train, { hard: true });
  return true;
}

/** Hit-test any car body; returns car or null. */
export function hitTestCar(train, x, y, hitR = TRAIN_RADIUS + 12) {
  if (!train?.cars?.length) {
    if (Math.hypot(train.x - x, train.y - y) <= hitR) return train.cars?.[0] || null;
    return null;
  }
  // Prefer non-lead hit for selection
  for (let i = train.cars.length - 1; i >= 0; i--) {
    const c = train.cars[i];
    if (Math.hypot(c.x - x, c.y - y) <= hitR) return c;
  }
  return null;
}

/** Create a free (uncoupled) mid car or engine at a pose. */
export function spawnFreeCar(train, kind, x, y, ang = 0) {
  if (!train.cars) train.cars = [];
  const car = {
    id: newCarId(kind === "mid" ? "mid" : "eng"),
    role: kind === "mid" ? "mid" : "trail",
    kind: kind === "mid" ? "mid" : "engine",
    facing: kind === "engine" ? -1 : 1,
    coupled: false,
    powered: false,
    x,
    y,
    ang,
  };
  // If no cars yet, this becomes lead if engine
  if (!train.cars.length && kind === "engine") {
    car.id = "lead";
    car.role = "lead";
    car.powered = true;
    car.facing = 1;
    car.coupled = true;
    train.poweredId = car.id;
    train.x = x;
    train.y = y;
    train.ang = ang;
  }
  train.cars.push(car);
  return car;
}

/**
 * Snap a free car (or train body) to nearest path.
 * Returns hit or null. Mutates car pose.
 */
export function snapCarPoseToHit(car, hit, dir = 1) {
  if (!car || !hit) return false;
  const pathAng = hit.ang;
  const ang = dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  // Body center from front axle at path point
  car.x = hit.x - Math.cos(ang) * FRONT_AXLE_OFFSET;
  car.y = hit.y - Math.sin(ang) * FRONT_AXLE_OFFSET;
  car.ang = ang;
  car.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  car.s = hit.s;
  car.dir = dir;
  return true;
}
