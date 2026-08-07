/**
 * Multi-car consist: separate entities, rigid hitch, per-car on/off-rail mode.
 *
 * - Each car has its own mode (on_rail / off_rail / idle).
 * - Lead re-rail does NOT force followers onto on-rail physics.
 * - Coupler length is one constant (on-rail == off-rail hitch).
 * - Mid cars capped at MAX_MID_CARS; engine place does not auto-build a consist.
 */
import {
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  FRONT_AXLE_OFFSET,
  TrainMode,
  RE_RAIL_LATERAL,
  RE_RAIL_ANGLE,
} from "./constants.js";
import { normalizeAngle, angleDiff } from "../geometry.js";
import { closestPathPoint } from "../track.js";
import { bodyFromFrontAxle } from "./pose.js";
// Note: do not import off-rail.js here (circular). Wall resolve for free cars is in train.js.

/** Max middle cars in one consist. */
export const MAX_MID_CARS = 3;

/**
 * Rigid coupler: same length on-rail and off-rail (short air gap).
 * On-rail path-walk seating was removed — it lengthened links and teleported.
 */
export const COUPLER_AIR_GAP = 12;
export const COUPLER_DIST = TRAIN_LENGTH + COUPLER_AIR_GAP;
export const REAR_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;
export const FRONT_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;

let nextCarId = 1;

function newCarId(prefix = "car") {
  return `${prefix}${nextCarId++}`;
}

function matchTravelAng(prevAng, pathAng) {
  const dFwd = Math.atan2(
    Math.sin(prevAng - pathAng),
    Math.cos(prevAng - pathAng)
  );
  const dRev = Math.atan2(
    Math.sin(prevAng - (pathAng + Math.PI)),
    Math.cos(prevAng - (pathAng + Math.PI))
  );
  if (Math.abs(dRev) < Math.abs(dFwd)) {
    return normalizeAngle(pathAng + Math.PI);
  }
  return pathAng;
}

export function threeCarConsistSpec() {
  return [
    { role: "lead", kind: "engine", facing: 1 },
    { role: "mid", kind: "mid", facing: 1 },
    { role: "trail", kind: "engine", facing: -1 },
  ];
}

export function countMidCars(train) {
  return (train?.cars || []).filter((c) => c.kind === "mid").length;
}

function makeCar(partial) {
  return {
    id: partial.id || newCarId(partial.kind === "mid" ? "mid" : "eng"),
    role: partial.role || "mid",
    kind: partial.kind || "mid",
    facing: partial.facing ?? 1,
    coupled: partial.coupled !== false,
    powered: !!partial.powered,
    x: partial.x ?? 0,
    y: partial.y ?? 0,
    ang: partial.ang ?? 0,
    mode: partial.mode || TrainMode.IDLE,
    pathRef: partial.pathRef || null,
    s: partial.s ?? 0,
    dir: partial.dir ?? 1,
    vx: partial.vx ?? 0,
    vy: partial.vy ?? 0,
    selected: !!partial.selected,
  };
}

/** Single engine entity (default place — never auto-appends mid/trail). */
export function ensureSingleEngine(train) {
  train.cars = [
    makeCar({
      id: "lead",
      role: "lead",
      kind: "engine",
      facing: 1,
      coupled: true,
      powered: true,
      x: train.x,
      y: train.y,
      ang: train.ang,
      mode: train.mode || TrainMode.IDLE,
      pathRef: train.pathRef,
      s: train.s,
      dir: train.dir,
    }),
  ];
  train.poweredId = "lead";
  train.consistSpec = null;
  return train.cars;
}

/**
 * Build consist from explicit spec only (layout load). Not used for bare engine place.
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
    return ensureSingleEngine(train);
  }

  // Cap mids in spec
  let midCount = 0;
  const capped = [];
  for (const c of carsSpec) {
    const kind = c.kind || (c.role === "mid" ? "mid" : "engine");
    if (kind === "mid") {
      if (midCount >= MAX_MID_CARS) continue;
      midCount++;
    }
    capped.push({ ...c, kind });
  }

  train.consistSpec = capped.map((c) => ({
    role: c.role || "mid",
    kind: c.kind || "mid",
    facing: c.facing ?? (c.role === "trail" ? -1 : 1),
  }));

  train.cars = train.consistSpec.map((c, i) => {
    const isLead = i === 0;
    const isTrail =
      c.role === "trail" ||
      (i === train.consistSpec.length - 1 && c.kind === "engine" && i > 0);
    return makeCar({
      id: isLead ? "lead" : newCarId(c.kind === "mid" ? "mid" : "eng"),
      role: c.role || (isLead ? "lead" : isTrail ? "trail" : "mid"),
      kind: c.kind || "mid",
      facing: c.facing ?? (isTrail ? -1 : 1),
      coupled: true,
      powered: isLead,
      x: train.x - Math.cos(train.ang || 0) * COUPLER_DIST * i,
      y: train.y - Math.sin(train.ang || 0) * COUPLER_DIST * i,
      ang: train.ang || 0,
      mode: train.mode || TrainMode.IDLE,
    });
  });
  if (train.cars[0]) {
    train.cars[0].id = "lead";
    train.cars[0].role = "lead";
    train.cars[0].powered = true;
  }
  train.poweredId = train.cars[0].id;
  placeFollowers(train, { hard: true, onRail: false });
  return train.cars;
}

export function getPoweredChain(train) {
  if (!train?.cars?.length) return [];
  const cars = train.cars;
  let pIdx = cars.findIndex((c) => c.powered || c.id === train.poweredId);
  if (pIdx < 0) pIdx = 0;
  const chain = [cars[pIdx]];
  for (let i = pIdx + 1; i < cars.length; i++) {
    if (!cars[i].coupled) break;
    chain.push(cars[i]);
  }
  return chain;
}

/**
 * Place coupled followers with one shared coupler length (on-rail == off-rail).
 *
 * Per-car mode:
 * - Follower on_rail + prev on_rail: hitch + path heading (same length as off-rail).
 * - Follower off_rail: trailer whip hitch (stays off-rail until it re-rails itself).
 * - Never path-walk seat that forces off-rail cars onto rails.
 */
export function placeFollowers(train, opts = {}) {
  if (!train) return { spacingOk: true, minSpacing: 0 };
  const hard = !!opts.hard;
  const board = opts.board || null;
  const whip = opts.whip != null ? !!opts.whip : !hard;

  if (!train.cars?.length) {
    return { spacingOk: true, minSpacing: 0 };
  }
  const chain = getPoweredChain(train);
  if (!chain.length) return { spacingOk: true, minSpacing: 0 };
  const powered = chain[0];

  // Sync powered entity with train body
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.powered = true;
  powered.facing = 1;
  powered.mode = train.mode || powered.mode;
  if (train.mode === TrainMode.ON_RAIL || train.mode === TrainMode.IDLE) {
    if (train.pathRef) {
      powered.pathRef = train.pathRef;
      powered.s = train.s;
      powered.dir = train.dir;
    }
  }

  let minSpacing = Infinity;
  for (let i = 1; i < chain.length; i++) {
    const prev = chain[i - 1];
    const car = chain[i];
    const hitchX = prev.x - Math.cos(prev.ang) * REAR_HITCH;
    const hitchY = prev.y - Math.sin(prev.ang) * REAR_HITCH;

    const carOff =
      car.mode === TrainMode.OFF_RAIL ||
      car.mode === TrainMode.STOPPED ||
      (!car.mode && train.mode === TrainMode.OFF_RAIL);
    const prevOn =
      prev.mode === TrainMode.ON_RAIL ||
      prev.mode === TrainMode.IDLE ||
      (!prev.mode && train.mode !== TrainMode.OFF_RAIL);

    let ang = prev.ang;

    // Off-rail car: trailer whip (do not force onto rails)
    if (carOff || whip) {
      if (
        car.x != null &&
        Number.isFinite(car.x) &&
        Number.isFinite(car.y)
      ) {
        const dx = hitchX - car.x;
        const dy = hitchY - car.y;
        const d = Math.hypot(dx, dy);
        if (d > 1e-3) {
          const target = Math.atan2(dy, dx);
          let da = target - (car.ang || prev.ang);
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          const maxTurn = 0.55;
          if (da > maxTurn) da = maxTurn;
          if (da < -maxTurn) da = -maxTurn;
          ang = (car.ang || prev.ang) + da;
        }
      }
      car.ang = ang;
      car.x = hitchX - Math.cos(ang) * FRONT_HITCH;
      car.y = hitchY - Math.sin(ang) * FRONT_HITCH;
    } else {
      // On-rail follower: same hitch length; path heading only for bend
      if (board && prevOn) {
        const px = prev.x - Math.cos(prev.ang) * COUPLER_DIST;
        const py = prev.y - Math.sin(prev.ang) * COUPLER_DIST;
        const hit = closestPathPoint(board, px, py, 48);
        if (hit && hit.dist < 40) {
          ang = matchTravelAng(prev.ang, hit.ang);
        }
      }
      car.ang = ang;
      car.x = hitchX - Math.cos(ang) * FRONT_HITCH;
      car.y = hitchY - Math.sin(ang) * FRONT_HITCH;
    }

    if (car.kind === "engine" && !car.powered) car.facing = -1;
    if (car.kind === "mid") car.facing = 1;

    const sp = Math.hypot(car.x - prev.x, car.y - prev.y);
    if (sp < minSpacing) minSpacing = sp;
  }
  if (!Number.isFinite(minSpacing)) minSpacing = 0;
  const spacingOk =
    chain.length < 2 || Math.abs(minSpacing - COUPLER_DIST) < 4;
  return { spacingOk, minSpacing };
}

export function seatConsistHard(train) {
  // Hard hitch only — does not change per-car modes
  return placeFollowers(train, { hard: true, whip: false, onRail: false });
}

/** Mark all cars off-rail with inherited velocity (lead derail). */
export function markChainOffRail(train) {
  const sp = train.speed || 180;
  const vx = Math.cos(train.ang) * sp;
  const vy = Math.sin(train.ang) * sp;
  for (const c of train.cars || []) {
    if (!c.coupled && !c.powered) continue;
    c.mode = TrainMode.OFF_RAIL;
    c.pathRef = null;
    c.vx = vx;
    c.vy = vy;
  }
}

/** Powered unit re-railed — only that car becomes on_rail. */
export function markPoweredOnRail(train) {
  const powered =
    (train.cars || []).find((c) => c.powered || c.id === train.poweredId) ||
    train.cars?.[0];
  if (!powered) return;
  powered.mode = TrainMode.ON_RAIL;
  powered.pathRef = train.pathRef;
  powered.s = train.s;
  powered.dir = train.dir;
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.vx = 0;
  powered.vy = 0;
  // Followers keep their mode; hard-hitch positions only for still-coupled
  seatConsistHard(train);
}

/**
 * Try to re-rail a single non-powered car. Returns true if it caught a rail.
 */
export function tryRerailCar(car, board, train) {
  if (!car || !board || car.powered) return false;
  if (car.mode === TrainMode.ON_RAIL) return false;

  const hit = closestPathPoint(board, car.x, car.y, RE_RAIL_LATERAL + 10);
  if (!hit) return false;

  const pathAng = hit.ang;
  const d1 = angleDiff(car.ang, pathAng);
  const d2 = angleDiff(car.ang, pathAng + Math.PI);
  const best = Math.min(d1, d2);
  const nearMouth = hit.s < 0.12 || hit.s > 0.88;
  const angLimit = nearMouth ? RE_RAIL_ANGLE * 1.25 : RE_RAIL_ANGLE * 0.85;
  const latLimit = nearMouth ? RE_RAIL_LATERAL + 6 : RE_RAIL_LATERAL + 2;
  if (hit.dist > latLimit || best > angLimit) return false;

  const dir = d1 <= d2 ? 1 : -1;
  const ang = dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
  const body = bodyFromFrontAxle(hit.x, hit.y, ang);
  car.mode = TrainMode.ON_RAIL;
  car.pathRef = {
    path: hit.path,
    pieceId: hit.path.pieceId,
    pathId: hit.path.id,
  };
  car.s = hit.s;
  car.dir = dir;
  car.x = body.x;
  car.y = body.y;
  car.ang = ang;
  car.vx = 0;
  car.vy = 0;
  return true;
}

export function uncoupleCar(train, carId) {
  if (!train?.cars) return false;
  const chain = getPoweredChain(train);
  const idx = chain.findIndex((c) => c.id === carId);
  if (idx <= 0) return false;
  for (let i = idx; i < chain.length; i++) {
    chain[i].coupled = false;
    chain[i].powered = false;
  }
  return true;
}

export function tryRecoupleCar(train, carId, maxDist = COUPLER_DIST * 1.35) {
  if (!train?.cars) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.powered) return false;
  if (car.kind === "mid" && countMidCars(train) > MAX_MID_CARS) return false;

  const chain = getPoweredChain(train);
  if (!chain.length) return false;
  const tail = chain[chain.length - 1];
  // Cap mid count when recoupling a mid into a chain that already has 3
  if (car.kind === "mid") {
    const midsInChain = chain.filter((c) => c.kind === "mid").length;
    if (midsInChain >= MAX_MID_CARS) return false;
  }

  const hitchX = tail.x - Math.cos(tail.ang) * REAR_HITCH;
  const hitchY = tail.y - Math.sin(tail.ang) * REAR_HITCH;
  const noseX = car.x + Math.cos(car.ang) * FRONT_HITCH;
  const noseY = car.y + Math.sin(car.ang) * FRONT_HITCH;
  if (Math.hypot(noseX - hitchX, noseY - hitchY) > maxDist) return false;
  car.coupled = true;
  // Match mode of tail for now; if tail on rail and car was off, keep car off
  // until it re-rails itself
  train.cars = train.cars.filter((c) => c.id !== carId);
  const p2 = train.cars.findIndex(
    (c) => c.powered || c.id === train.poweredId
  );
  let end = p2;
  while (end + 1 < train.cars.length && train.cars[end + 1].coupled) end++;
  train.cars.splice(end + 1, 0, car);
  placeFollowers(train, { hard: true, onRail: false });
  return true;
}

export function setActiveEngine(train, carId) {
  if (!train?.cars?.length) return false;
  const car = train.cars.find((c) => c.id === carId);
  if (!car || car.kind !== "engine") return false;

  const chain = getPoweredChain(train);
  const idx = chain.findIndex((c) => c.id === carId);
  if (idx < 0) {
    if (!car.coupled && !car.powered) {
      for (const c of train.cars) c.powered = false;
      car.powered = true;
      car.facing = 1;
      train.poweredId = car.id;
      train.x = car.x;
      train.y = car.y;
      train.ang = car.ang;
      train.mode = car.mode || train.mode;
      train.pathRef = car.pathRef;
      train.s = car.s;
      train.dir = car.dir;
      train.cars = [car, ...train.cars.filter((c) => c !== car)];
      return true;
    }
    return false;
  }
  if (idx === 0) return true;

  const head = chain.slice(0, idx + 1);
  const behind = chain.slice(idx + 1);
  const free = train.cars.filter((c) => !chain.includes(c));
  const prev = head[idx - 1];
  const intoX = prev.x - car.x;
  const intoY = prev.y - car.y;
  const intoL = Math.hypot(intoX, intoY) || 1;
  train.ang = Math.atan2(-intoY / intoL, -intoX / intoL);
  train.x = car.x;
  train.y = car.y;
  train.mode = car.mode || train.mode;
  train.pathRef = car.pathRef;
  train.s = car.s ?? train.s;
  train.dir = car.dir ?? train.dir;

  const newHead = head.slice().reverse();
  for (const c of newHead) {
    c.coupled = true;
    c.powered = c.id === carId;
  }
  for (const c of behind) {
    c.coupled = false;
    c.powered = false;
  }
  car.facing = 1;
  for (let i = 1; i < newHead.length; i++) {
    if (newHead[i].kind === "engine") newHead[i].facing = -1;
  }
  train.poweredId = carId;
  train.cars = [...newHead, ...behind, ...free];
  placeFollowers(train, { hard: true, onRail: false });
  return true;
}

export function hitTestCar(train, x, y, hitR = TRAIN_RADIUS + 12) {
  if (!train?.cars?.length) return null;
  for (let i = train.cars.length - 1; i >= 0; i--) {
    const c = train.cars[i];
    if (Math.hypot(c.x - x, c.y - y) <= hitR) return c;
  }
  return null;
}

/**
 * Spawn free mid or engine. Blocks 4th mid car.
 * @returns {object|null} car or null if blocked
 */
export function spawnFreeCar(train, kind, x, y, ang = 0) {
  if (!train.cars) train.cars = [];
  if (kind === "mid" && countMidCars(train) >= MAX_MID_CARS) {
    return null;
  }
  const car = makeCar({
    id: newCarId(kind === "mid" ? "mid" : "eng"),
    role: kind === "mid" ? "mid" : "trail",
    kind: kind === "mid" ? "mid" : "engine",
    facing: kind === "engine" ? -1 : 1,
    coupled: false,
    powered: false,
    x,
    y,
    ang,
    mode: TrainMode.IDLE,
  });
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

export function snapCarPoseToHit(car, hit, dir = 1) {
  if (!car || !hit) return false;
  const pathAng = hit.ang;
  const ang = dir > 0 ? pathAng : normalizeAngle(pathAng + Math.PI);
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
  car.mode = TrainMode.ON_RAIL;
  car.vx = 0;
  car.vy = 0;
  return true;
}

export function couplerLink(prev, car) {
  if (!prev || !car) return null;
  const x1 = prev.x - Math.cos(prev.ang) * REAR_HITCH * 0.85;
  const y1 = prev.y - Math.sin(prev.ang) * REAR_HITCH * 0.85;
  const x2 = car.x + Math.cos(car.ang) * FRONT_HITCH * 0.85;
  const y2 = car.y + Math.sin(car.ang) * FRONT_HITCH * 0.85;
  return { x1, y1, x2, y2 };
}

export function consistLinks(train) {
  const chain = getPoweredChain(train);
  const links = [];
  for (let i = 1; i < chain.length; i++) {
    const L = couplerLink(chain[i - 1], chain[i]);
    if (L) links.push(L);
  }
  return links;
}
