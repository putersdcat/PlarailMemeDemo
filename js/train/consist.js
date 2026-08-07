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
import { closestPathPoint } from "../track.js";

/**
 * Center-to-center when coupled: full body length + air gap so shells
 * do not overlap and a plastic coupler bar is visible between cars.
 */
export const COUPLER_AIR_GAP = 20;
export const COUPLER_DIST = TRAIN_LENGTH + COUPLER_AIR_GAP;
/** Hitch offsets from body center (sum = COUPLER_DIST). */
export const REAR_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;
export const FRONT_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;

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
 * Front-to-back chain starting at the powered unit.
 * Uses cars array order: powered, then following entries that are still coupled,
 * stopping at the first free car (split).
 */
export function getPoweredChain(train) {
  if (!train?.cars?.length) return [];
  const cars = train.cars;
  let pIdx = cars.findIndex((c) => c.powered || c.id === train.poweredId);
  if (pIdx < 0) pIdx = 0;
  const chain = [cars[pIdx]];
  for (let i = pIdx + 1; i < cars.length; i++) {
    if (!cars[i].coupled) break; // split — free car ends the consist
    chain.push(cars[i]);
  }
  return chain;
}

/**
 * Place coupled followers behind the powered lead.
 * When `opts.board` is set, each car is snapped onto the nearest rail
 * (same snap idea as the engine) so mid/trail do not free-fly off-track.
 * Trail engines keep facing=-1 (body drawn reversed).
 */
export function placeFollowers(train, opts = {}) {
  if (!train) return { spacingOk: true, minSpacing: 0 };
  const hard = !!opts.hard;
  const board = opts.board || null;
  if (!train.cars?.length) {
    if (train.consistSpec?.length) {
      ensureConsist(train, train.consistSpec, { hard: true });
    } else {
      return { spacingOk: true, minSpacing: 0 };
    }
  }
  const chain = getPoweredChain(train);
  if (!chain.length) return { spacingOk: true, minSpacing: 0 };
  const powered = chain[0];

  // Powered unit is the physics body
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.powered = true;
  powered.facing = 1;

  let minSpacing = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const car = chain[i];
    // Desired center directly behind previous car along its heading
    const targetX = prev.x - Math.cos(prev.ang) * COUPLER_DIST;
    const targetY = prev.y - Math.sin(prev.ang) * COUPLER_DIST;
    let ang = prev.ang;
    let x = targetX;
    let y = targetY;

    // Snap onto rail centerline so cars follow track, not free air
    if (board) {
      // Fan of probes behind prev (covers curves)
      const probes = [];
      for (let t = 0.75; t <= 1.25; t += 0.1) {
        for (let a = -0.7; a <= 0.7; a += 0.175) {
          const pa = prev.ang + a;
          probes.push({
            x: prev.x - Math.cos(pa) * COUPLER_DIST * t,
            y: prev.y - Math.sin(pa) * COUPLER_DIST * t,
          });
        }
      }
      probes.push({ x: targetX, y: targetY });
      let best = null;
      for (const p of probes) {
        const hit = closestPathPoint(board, p.x, p.y, 72);
        if (!hit) continue;
        // Prefer hits roughly coupler-distance from prev center
        const dPrev = Math.hypot(hit.x - prev.x, hit.y - prev.y);
        const distScore =
          hit.dist + Math.abs(dPrev - COUPLER_DIST) * 0.35;
        if (!best || distScore < best.score) {
          best = { hit, score: distScore };
        }
      }
      if (best && best.hit.dist < 52) {
        const h = best.hit;
        let pathAng = h.ang;
        const d1 = Math.abs(
          Math.atan2(
            Math.sin(prev.ang - pathAng),
            Math.cos(prev.ang - pathAng)
          )
        );
        const d2 = Math.abs(
          Math.atan2(
            Math.sin(prev.ang - (pathAng + Math.PI)),
            Math.cos(prev.ang - (pathAng + Math.PI))
          )
        );
        if (d2 < d1) pathAng = normalizeAngle(pathAng + Math.PI);
        ang = pathAng;
        // Seat body so front axle sits on the path point (same as engine)
        x = h.x - Math.cos(ang) * FRONT_AXLE_OFFSET;
        y = h.y - Math.sin(ang) * FRONT_AXLE_OFFSET;
      } else {
        // Geometric fallback still behind prev (never leave at origin)
        x = targetX;
        y = targetY;
        ang = prev.ang;
      }
    } else if (
      !hard &&
      car.x != null &&
      Number.isFinite(car.x) &&
      Number.isFinite(car.y)
    ) {
      // Soft free-space trailer blend when no board
      const hitchX = prev.x - Math.cos(prev.ang) * REAR_HITCH;
      const hitchY = prev.y - Math.sin(prev.ang) * REAR_HITCH;
      const dx = hitchX - car.x;
      const dy = hitchY - car.y;
      const d = Math.hypot(dx, dy);
      if (d > 1e-3 && d < COUPLER_DIST * 2.5) {
        const hitchAng = Math.atan2(dy, dx);
        let da = hitchAng - ang;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        ang = ang + da * 0.5;
      }
      x = hitchX - Math.cos(ang) * FRONT_HITCH;
      y = hitchY - Math.sin(ang) * FRONT_HITCH;
    }

    car.ang = ang;
    car.x = x;
    car.y = y;
    // Non-powered engines in the chain face backward
    if (car.kind === "engine" && !car.powered) car.facing = -1;
    if (car.kind === "mid") car.facing = 1;

    const sp = Math.hypot(car.x - prev.x, car.y - prev.y);
    if (sp < minSpacing) minSpacing = sp;
  }
  if (!Number.isFinite(minSpacing)) minSpacing = 0;
  const coupledCount = chain.length;
  const spacingOk =
    coupledCount < 2 ||
    (minSpacing > COUPLER_DIST * 0.45 && minSpacing < COUPLER_DIST * 1.75);
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
  const chain = getPoweredChain(train);
  const links = [];
  for (let i = 1; i < chain.length; i++) {
    const L = couplerLink(chain[i - 1], chain[i]);
    if (L) links.push(L);
  }
  return links;
}

/**
 * Uncouple a car and every car behind it (split the consist).
 * Prevents the trail from re-hitching through a free mid onto the lead slot.
 */
export function uncoupleCar(train, carId) {
  if (!train?.cars) return false;
  const chain = getPoweredChain(train);
  const idx = chain.findIndex((c) => c.id === carId);
  if (idx <= 0) return false; // not in chain, or is powered lead
  for (let i = idx; i < chain.length; i++) {
    chain[i].coupled = false;
    chain[i].powered = false;
  }
  return true;
}

/** Re-couple a free car to the end of the powered chain if close enough. */
export function tryRecoupleCar(train, carId, maxDist = COUPLER_DIST * 1.35) {
  if (!train?.cars) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.powered) return false;
  const chain = getPoweredChain(train);
  if (!chain.length) return false;
  const tail = chain[chain.length - 1];
  const hitchX = tail.x - Math.cos(tail.ang) * REAR_HITCH;
  const hitchY = tail.y - Math.sin(tail.ang) * REAR_HITCH;
  const noseX = car.x + Math.cos(car.ang) * FRONT_HITCH;
  const noseY = car.y + Math.sin(car.ang) * FRONT_HITCH;
  if (Math.hypot(noseX - hitchX, noseY - hitchY) > maxDist) return false;
  car.coupled = true;
  // Move free car to end of cars list after chain segment
  const pIdx = train.cars.findIndex((c) => c.id === chain[0].id);
  train.cars = train.cars.filter((c) => c.id !== carId);
  // Insert after last coupled car of chain
  let insertAt = pIdx + chain.length; // chain no longer includes car
  // recompute: after filter, find powered again
  const p2 = train.cars.findIndex(
    (c) => c.powered || c.id === train.poweredId
  );
  let end = p2;
  while (end + 1 < train.cars.length && train.cars[end + 1].coupled) end++;
  train.cars.splice(end + 1, 0, car);
  placeFollowers(train, { hard: true });
  return true;
}

/**
 * Make an engine the powered (driving) unit.
 * Preserves relative consist order by reversing the chain in place so the
 * chosen engine becomes the new front (no teleporting mid/lead onto the rear).
 */
export function setActiveEngine(train, carId) {
  if (!train?.cars?.length) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.kind !== "engine") return false;

  const chain = getPoweredChain(train);
  const idx = chain.findIndex((c) => c.id === carId);
  // Free engine not in chain: power it solo (leave others free)
  if (idx < 0) {
    if (!car.coupled && !car.powered) {
      for (const c of train.cars) c.powered = false;
      car.powered = true;
      car.facing = 1;
      train.poweredId = car.id;
      train.x = car.x;
      train.y = car.y;
      train.ang = car.ang;
      // Move to front of array
      train.cars = [car, ...train.cars.filter((c) => c !== car)];
      return true;
    }
    return false;
  }
  if (idx === 0) return true; // already powered

  // Reverse [front .. newEngine] so newEngine is front; keep free cars aside
  const head = chain.slice(0, idx + 1);
  const behind = chain.slice(idx + 1); // usually empty for end engines
  const free = train.cars.filter((c) => !chain.includes(c));

  // Travel away from the rest of the train (from neighbor toward old rear-as-front)
  const prev = head[idx - 1];
  const intoX = prev.x - car.x;
  const intoY = prev.y - car.y;
  const intoL = Math.hypot(intoX, intoY) || 1;
  // travel = opposite of "into train"
  train.ang = Math.atan2(-intoY / intoL, -intoX / intoL);
  train.x = car.x;
  train.y = car.y;

  const newHead = head.slice().reverse(); // [newEngine, ..., oldLead]
  for (const c of newHead) {
    c.coupled = true;
    c.powered = c.id === carId;
  }
  for (const c of behind) {
    c.coupled = false; // detached segment if any
    c.powered = false;
  }
  car.facing = 1;
  for (let i = 1; i < newHead.length; i++) {
    if (newHead[i].kind === "engine") newHead[i].facing = -1;
    if (newHead[i].kind === "mid") newHead[i].facing = 1;
  }

  train.poweredId = carId;
  train.cars = [...newHead, ...behind, ...free];
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
