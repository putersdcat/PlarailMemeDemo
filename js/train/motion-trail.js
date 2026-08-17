import { HALF_W, angleDiff, normalizeAngle } from "../geometry.js";
import { closestPathPoint } from "../track.js";
import {
  COUPLER_DIST,
  COUPLER_LATERAL_LIMIT,
  COUPLER_CENTER_BIAS_OFF_RAIL,
  COUPLER_CENTER_BIAS_ON_RAIL,
  COUPLER_CENTER_CURVE_ANGLE,
  FRONT_AXLE_OFFSET,
  FRONT_HITCH,
  POSITION_QUANTUM,
  REAR_AXLE_OFFSET,
  REAR_HITCH,
  TRAIN_LENGTH,
  TrainMode,
} from "./constants.js";
import {
  bodyInsidePlayfield,
  carBodyOverlap,
  couplerError,
  findOpenMouthPortal,
  findOpenMouthExitPortal,
  frontHitch,
  quantize,
  quantizeAngle,
  quantizePose,
  rearHitch,
  playfieldBodyContact,
  playfieldPortalSides,
  trackBodyContact,
} from "../world-model.js";
import { bodyFromFrontAxle } from "./pose.js";
import { pathPoseBehind } from "./rail-route.js";

const TRAIL_VERSION = 1;
const SAMPLE_STEP = 2.5;
const STATE_EPSILON = POSITION_QUANTUM;
const MIN_CENTER_LAG = TRAIN_LENGTH * 0.82;
// Tight compound curves can make route distance substantially longer than
// the straight pin-to-pin chord. Exact hitch and body checks remain the
// authority, so a wider route search cannot introduce stretch.
const MAX_CENTER_LAG = COUPLER_DIST * 3;
const ROOT_STEP = 2;
const ROOT_ITERS = 20;
// Keep runtime acceptance aligned with the world contract. Quantized curved
// route samples can produce a few hundredths of a pixel of harmless pin error;
// freezing a live consist at 0.020 px is a numerical false positive, not a
// physically blocked hinge.
export const COUPLER_SOLVE_TOLERANCE = 0.05;

function clonePathRef(ref) {
  if (!ref) return null;
  return {
    path: ref.path,
    pieceId: ref.pieceId ?? ref.path?.pieceId,
    pathId: ref.pathId ?? ref.path?.id,
  };
}

function chainFor(train) {
  const cars = train?.cars || [];
  if (!cars.length) return [];
  let poweredIndex = cars.findIndex(
    (car) => car.powered || car.id === train.poweredId
  );
  if (poweredIndex < 0) poweredIndex = 0;
  const chain = [cars[poweredIndex]];
  for (let i = poweredIndex + 1; i < cars.length; i++) {
    if (!cars[i].coupled) break;
    chain.push(cars[i]);
  }
  return chain;
}

function chainKey(chain) {
  return chain.map((car) => car.id).join(">");
}

function stateFromEntity(entity, d) {
  return {
    d,
    x: entity.x,
    y: entity.y,
    ang: entity.ang || 0,
    mode: entity.mode || TrainMode.IDLE,
    pathRef: clonePathRef(entity.pathRef),
    s: entity.s ?? 0,
    dir: entity.dir === -1 ? -1 : 1,
    frontCouplerOffset: entity.frontCouplerOffset || 0,
    rearCouplerOffset: entity.rearCouplerOffset || 0,
    wallHit: !!entity.wallHit,
    openMouthClearSteps: entity.openMouthClearSteps || 0,
    openMouthPieceId: entity.openMouthPieceId || null,
    openMouthAdjacentPieceId: entity.openMouthAdjacentPieceId || null,
    railEntryGraceDistance: entity.railEntryGraceDistance || 0,
  };
}

function shortestAngle(from, to) {
  return normalizeAngle(to - from);
}

function interpolateState(a, b, t, d) {
  const stateSource = t >= 1 - 1e-9 ? b : a;
  const samePath =
    a.pathRef &&
    b.pathRef &&
    a.pathRef.pieceId === b.pathRef.pieceId &&
    a.pathRef.pathId === b.pathRef.pathId;
  return {
    d,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    ang: normalizeAngle(a.ang + shortestAngle(a.ang, b.ang) * t),
    mode: stateSource.mode,
    pathRef: clonePathRef(stateSource.pathRef),
    s: samePath ? a.s + (b.s - a.s) * t : stateSource.s,
    dir: stateSource.dir,
    frontCouplerOffset:
      (a.frontCouplerOffset || 0) +
      ((b.frontCouplerOffset || 0) - (a.frontCouplerOffset || 0)) * t,
    rearCouplerOffset:
      (a.rearCouplerOffset || 0) +
      ((b.rearCouplerOffset || 0) - (a.rearCouplerOffset || 0)) * t,
    wallHit: !!stateSource.wallHit,
    openMouthClearSteps: stateSource.openMouthClearSteps || 0,
    openMouthPieceId: stateSource.openMouthPieceId || null,
    openMouthAdjacentPieceId:
      stateSource.openMouthAdjacentPieceId || null,
    railEntryGraceDistance: stateSource.railEntryGraceDistance || 0,
  };
}

function appendDense(samples, a, b, d0, d1) {
  const span = Math.max(STATE_EPSILON, d1 - d0);
  const count = Math.max(1, Math.ceil(span / SAMPLE_STEP));
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    samples.push(interpolateState(a, b, t, d0 + span * t));
  }
}

function seedRailTrail(train, chain, board) {
  if (!board || train.mode !== TrainMode.ON_RAIL || !train.pathRef) {
    return null;
  }
  const desired = COUPLER_DIST * chain.length;
  const poses = [];
  for (let distance = 0; distance <= desired + 1e-6; distance += SAMPLE_STEP) {
    const useDistance = Math.min(distance, desired);
    const pose = pathPoseBehind(board, train, useDistance);
    if (!pose) break;
    poses.push({ distance: useDistance, pose });
    if (useDistance >= desired) break;
  }
  if (
    !poses.length ||
    poses.at(-1).distance < COUPLER_DIST * (chain.length - 1)
  ) {
    return null;
  }
  if (poses.at(-1).distance < desired) {
    const pose = pathPoseBehind(board, train, desired);
    if (pose) poses.push({ distance: desired, pose });
  }
  const maxDistance = poses.at(-1).distance;
  const samples = poses.reverse().map(({ distance, pose }) => {
    const body = bodyFromFrontAxle(pose.x, pose.y, pose.ang);
    return {
      d: maxDistance - distance,
      x: body.x,
      y: body.y,
      ang: pose.ang,
      mode: TrainMode.ON_RAIL,
      pathRef: {
        path: pose.path,
        pieceId: pose.path.pieceId,
        pathId: pose.path.id,
      },
      s: pose.s,
      dir: pose.dir,
      frontCouplerOffset: 0,
      rearCouplerOffset: 0,
      openMouthClearSteps: 0,
      openMouthPieceId: null,
      railEntryGraceDistance: 0,
    };
  });
  return {
    version: TRAIL_VERSION,
    chainKey: chainKey(chain),
    samples,
    headD: maxDistance,
    cursors: new Map(
      chain.map((car, index) => [
        car.id,
        maxDistance - index * COUPLER_DIST,
      ])
    ),
  };
}

function seedTrail(train, chain, board = null) {
  // The train object is authoritative for the powered body. Editor/debug
  // callers often mutate it directly before the next frame.
  if (chain[0]) {
    Object.assign(chain[0], {
      x: train.x,
      y: train.y,
      ang: train.ang,
      mode: train.mode,
      pathRef: clonePathRef(train.pathRef),
      s: train.s,
      dir: train.dir,
      vx: train.vx,
      vy: train.vy,
    });
  }
  const railTrail = seedRailTrail(train, chain, board);
  if (railTrail) return railTrail;
  const samples = [];
  const reversed = [...chain].reverse();
  // Keep one full-car route reserve behind the authored tail. Exact pin
  // geometry on a curve can require a little more route lag than nominal
  // center spacing; without this reserve the last car had no legal root on
  // the very first frame even though its rail continued behind it.
  if (reversed.length) {
    const tail = reversed[0];
    const reserve = stateFromEntity(tail, 0);
    reserve.x -= Math.cos(tail.ang || 0) * COUPLER_DIST;
    reserve.y -= Math.sin(tail.ang || 0) * COUPLER_DIST;
    samples.push(reserve);
  }
  for (let i = 0; i < reversed.length; i++) {
    const entity = reversed[i];
    const d = (i + 1) * COUPLER_DIST;
    const state = stateFromEntity(entity, d);
    const prior = samples[samples.length - 1];
    appendDense(samples, prior, state, prior.d, d);
  }
  if (!samples.length) samples.push(stateFromEntity(train, 0));
  const head = stateFromEntity(train, samples[samples.length - 1].d);
  const last = samples[samples.length - 1];
  if (Math.hypot(head.x - last.x, head.y - last.y) > 0.001) {
    appendDense(samples, last, head, last.d, last.d + COUPLER_DIST);
  } else {
    samples[samples.length - 1] = head;
  }
  return {
    version: TRAIL_VERSION,
    chainKey: chainKey(chain),
    samples,
    headD: samples[samples.length - 1].d,
    cursors: new Map(chain.map((car, index) => [
      car.id,
      samples[samples.length - 1].d - index * COUPLER_DIST,
    ])),
  };
}

export function resetConsistMotion(train) {
  if (!train) return;
  train.motionTrail = null;
  train.stallReason = null;
}

/** Pre-solve authored/dragged rail placement so Start has no settle frame. */
export function initializeCoupledConsist(train, board, opts = {}) {
  if (!train?.cars || chainFor(train).length < 2) return { ok: true };
  let result = { ok: true };
  // Re-seeding from each solved pose removes synthetic-chord error at curved
  // authored starts. Three deterministic passes converge below quantization.
  for (let pass = 0; pass < 3; pass++) {
    resetConsistMotion(train);
    ensureConsistMotion(train, board);
    const frame = captureConsistFrame(train);
    result = solveCoupledConsist(
      train,
      board,
      0,
      null,
      { solidPlayfield: false, ...opts },
      frame
    );
    if (!result.ok) return result;
  }
  return result;
}

export function ensureConsistMotion(train, board = null) {
  const chain = chainFor(train);
  if (chain.length < 2) {
    train.motionTrail = null;
    return { chain, trail: null };
  }
  const key = chainKey(chain);
  let trail = train.motionTrail;
  const last = trail?.samples?.[trail.samples.length - 1];
  const discontinuity = last
    ? Math.hypot(last.x - train.x, last.y - train.y)
    : Infinity;
  const stateMismatch =
    !!last &&
    (last.mode !== train.mode ||
      last.pathRef?.pieceId !== train.pathRef?.pieceId ||
      last.pathRef?.pathId !== train.pathRef?.pathId);
  if (
    !trail ||
    trail.version !== TRAIL_VERSION ||
    trail.chainKey !== key ||
    !trail.samples?.length ||
    stateMismatch ||
    discontinuity > COUPLER_DIST * 0.75
  ) {
    trail = seedTrail(train, chain, board);
    train.motionTrail = trail;
  }
  return { chain, trail };
}

function captureEntity(entity) {
  return {
    x: entity.x,
    y: entity.y,
    ang: entity.ang,
    mode: entity.mode,
    pathRef: entity.pathRef,
    s: entity.s,
    dir: entity.dir,
    vx: entity.vx,
    vy: entity.vy,
    frontCouplerOffset: entity.frontCouplerOffset,
    rearCouplerOffset: entity.rearCouplerOffset,
    wallHit: entity.wallHit,
    reRailCooldown: entity.reRailCooldown,
    openMouthClearSteps: entity.openMouthClearSteps,
    openMouthPieceId: entity.openMouthPieceId,
    openMouthAdjacentPieceId: entity.openMouthAdjacentPieceId,
    railEntryGraceDistance: entity.railEntryGraceDistance,
    lastRailExitKey: entity.lastRailExitKey,
  };
}

function restoreEntity(entity, state) {
  Object.assign(entity, state);
}

export function captureConsistFrame(train) {
  const { chain, trail } = ensureConsistMotion(train);
  if (!trail) return null;
  return {
    train: captureEntity(train),
    cars: new Map((train.cars || []).map((car) => [car.id, captureEntity(car)])),
    trailLength: trail.samples.length,
    headD: trail.headD,
    cursors: new Map(trail.cursors),
    chainKey: trail.chainKey,
    chainIds: chain.map((car) => car.id),
  };
}

function restoreFrame(train, frame) {
  if (!frame) return;
  restoreEntity(train, frame.train);
  for (const car of train.cars || []) {
    const state = frame.cars.get(car.id);
    if (state) restoreEntity(car, state);
  }
  const trail = train.motionTrail;
  if (trail && trail.chainKey === frame.chainKey) {
    trail.samples.length = frame.trailLength;
    trail.headD = frame.headD;
    trail.cursors = new Map(frame.cursors);
  }
}

function appendHeadState(train, trail) {
  const previous = trail.samples[trail.samples.length - 1];
  const current = stateFromEntity(train, previous.d);
  const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
  const stateChanged =
    previous.mode !== current.mode ||
    previous.pathRef?.pieceId !== current.pathRef?.pieceId ||
    previous.pathRef?.pathId !== current.pathRef?.pathId;
  if (distance < 1e-8 && !stateChanged) {
    Object.assign(previous, current, { d: previous.d });
    trail.headD = previous.d;
    return { distance: 0, stateChanged: false };
  }
  const span = Math.max(distance, stateChanged ? STATE_EPSILON : 0);
  const nextD = previous.d + span;
  appendDense(trail.samples, previous, current, previous.d, nextD);
  trail.headD = nextD;
  trail.cursors.set(train.poweredId || "lead", nextD);
  return { distance, stateChanged };
}

export function sampleMotionTrail(trail, d) {
  const samples = trail?.samples;
  if (!samples?.length) return null;
  if (d < samples[0].d - 1e-6 || d > samples[samples.length - 1].d + 1e-6) {
    return null;
  }
  if (d <= samples[0].d) return { ...samples[0], pathRef: clonePathRef(samples[0].pathRef) };
  if (d >= samples[samples.length - 1].d) {
    const last = samples[samples.length - 1];
    return { ...last, pathRef: clonePathRef(last.pathRef) };
  }
  let lo = 0;
  let hi = samples.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].d <= d) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const t = (d - a.d) / Math.max(EPSILON, b.d - a.d);
  return interpolateState(a, b, t, d);
}

const EPSILON = 1e-9;

function followerRoot(
  trail,
  prev,
  car,
  prevCursor,
  priorCars = [],
  board = null,
  bounds = null,
  opts = {},
  dt = 0
) {
  const available = prevCursor - trail.samples[0].d;
  const maxLag = Math.min(MAX_CENTER_LAG, available);
  if (maxLag < MIN_CENTER_LAG) return null;
  const roots = [];
  const bias = centerBias(
    prev,
    car,
    { mode: TrainMode.ON_RAIL, ang: car.ang },
    dt
  );
  const rearOffsets = biasedLateralSlotCandidates(
    prev.rearCouplerOffset,
    bias
  );
  const frontOffsets = biasedLateralSlotCandidates(
    car.frontCouplerOffset,
    bias
  );
  for (const rearOffset of rearOffsets) {
    const hitch = rearHitch({ ...prev, rearCouplerOffset: rearOffset });
    for (const frontOffset of frontOffsets) {
      const targetRadius = Math.hypot(FRONT_HITCH, frontOffset);
      const evaluate = (lag) => {
        const cursor = prevCursor - lag;
        const sample = sampleMotionTrail(trail, cursor);
        if (!sample) return null;
        return {
          lag,
          cursor,
          sample,
          frontOffset,
          rearOffset,
          value:
            Math.hypot(sample.x - hitch.x, sample.y - hitch.y) - targetRadius,
        };
      };
      let prior = evaluate(MIN_CENTER_LAG);
      for (
        let lag = MIN_CENTER_LAG + ROOT_STEP;
        lag <= maxLag + 1e-6;
        lag += ROOT_STEP
      ) {
        const current = evaluate(Math.min(lag, maxLag));
        if (!prior || !current) {
          prior = current;
          continue;
        }
        if (Math.abs(prior.value) <= COUPLER_SOLVE_TOLERANCE) roots.push(prior);
        if (prior.value * current.value <= 0) {
          let left = prior;
          let right = current;
          for (let i = 0; i < ROOT_ITERS; i++) {
            const middle = evaluate((left.lag + right.lag) * 0.5);
            if (!middle) break;
            if (left.value * middle.value <= 0) right = middle;
            else left = middle;
          }
          roots.push(
            Math.abs(left.value) <= Math.abs(right.value) ? left : right
          );
        }
        prior = current;
        if (lag >= maxLag) break;
      }
      if (prior && Math.abs(prior.value) <= 0.1) roots.push(prior);
    }
  }
  roots.sort(
    (a, b) => {
      const lagA = Math.abs(a.lag - COUPLER_DIST);
      const lagB = Math.abs(b.lag - COUPLER_DIST);
      const centerA = Math.abs(a.rearOffset) + Math.abs(a.frontOffset);
      const centerB = Math.abs(b.rearOffset) + Math.abs(b.frontOffset);
      const curveA = Math.min(
        1,
        angleDiff(prev.ang || 0, a.sample.ang || 0) /
          Math.max(COUPLER_CENTER_CURVE_ANGLE, 1e-6)
      );
      const curveB = Math.min(
        1,
        angleDiff(prev.ang || 0, b.sample.ang || 0) /
          Math.max(COUPLER_CENTER_CURVE_ANGLE, 1e-6)
      );
      const biasA = bias * (1 - curveA);
      const biasB = bias * (1 - curveB);
      return (
        lagA + centerA * (biasA * 2.5 + 0.02) -
        (lagB + centerB * (biasB * 2.5 + 0.02))
      );
    }
  );
  let best = null;
  for (const root of roots) {
    const hitch = rearHitch({ ...prev, rearCouplerOffset: root.rearOffset });
    const pinAngle = Math.atan2(hitch.y - root.sample.y, hitch.x - root.sample.x);
    const ang = normalizeAngle(
      pinAngle - Math.atan2(root.frontOffset, FRONT_HITCH)
    );
    const candidate = {
      ...root.sample,
      ang,
      x: root.sample.x,
      y: root.sample.y,
      frontCouplerOffset: root.frontOffset,
      rearCouplerOffset: car.rearCouplerOffset || 0,
      predecessorRearCouplerOffset: root.rearOffset,
    };
    if (carBodyOverlap(prev, candidate)) continue;
    const blocked = candidateBlocked(
      candidate,
      priorCars,
      board,
      bounds,
      opts
    );
    if (!blocked) {
      const alignment = opts.railAlignment
        ? railPoseAlignment(candidate)
        : 0;
      const score =
        alignment + Math.abs(root.lag - COUPLER_DIST) * 0.02;
      if (!best || score < best.score) {
        best = { root, candidate, score };
      }
    }
  }
  if (!best) return null;
  prev.rearCouplerOffset = best.root.rearOffset;
  delete best.candidate.predecessorRearCouplerOffset;
  return { ...best.root, candidate: best.candidate };
}

function applyTrailState(car, solved, old, dt) {
  const state = solved.sample;
  car.x = solved.candidate.x;
  car.y = solved.candidate.y;
  car.ang = solved.candidate.ang;
  car.mode = state.mode;
  car.pathRef = clonePathRef(state.pathRef);
  car.s = state.s;
  car.dir = state.dir;
  car.openMouthClearSteps = state.openMouthClearSteps || 0;
  car.openMouthPieceId = state.openMouthPieceId || null;
  car.openMouthAdjacentPieceId = state.openMouthAdjacentPieceId || null;
  car.frontCouplerOffset = solved.candidate.frontCouplerOffset ?? car.frontCouplerOffset ?? 0;
  car.rearCouplerOffset = solved.candidate.rearCouplerOffset ?? car.rearCouplerOffset ?? 0;
  car.wallHit = !!state.wallHit;
  car.railEntryGraceDistance = state.railEntryGraceDistance || 0;
  car.reRailCooldown = 0;
  if (dt > 0) {
    car.vx = (car.x - old.x) / dt;
    car.vy = (car.y - old.y) / dt;
  } else {
    car.vx = 0;
    car.vy = 0;
  }
  quantizePose(car);
}

function turnLimited(from, toward, maxTurn) {
  let delta = normalizeAngle(toward - from);
  delta = Math.max(-maxTurn, Math.min(maxTurn, delta));
  return normalizeAngle(from + delta);
}

function pinCandidate(prev, car, sample, ang, rearOffset, frontOffset) {
  const pin = rearHitch({ ...prev, rearCouplerOffset: rearOffset });
  return {
    ...sample,
    x:
      pin.x -
      Math.cos(ang) * FRONT_HITCH +
      Math.sin(ang) * frontOffset,
    y:
      pin.y -
      Math.sin(ang) * FRONT_HITCH -
      Math.cos(ang) * frontOffset,
    ang,
    rearCouplerOffset: car.rearCouplerOffset || 0,
    frontCouplerOffset: frontOffset,
    predecessorRearCouplerOffset: rearOffset,
  };
}

function lateralSlotCandidates(value = 0) {
  const base = Number.isFinite(value) ? value : 0;
  const step = COUPLER_LATERAL_LIMIT / 3;
  return [
    Math.max(-COUPLER_LATERAL_LIMIT, Math.min(COUPLER_LATERAL_LIMIT, base)),
    0,
    -COUPLER_LATERAL_LIMIT,
    COUPLER_LATERAL_LIMIT,
    -step,
    step,
  ];
}

function clampLateralOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-COUPLER_LATERAL_LIMIT, Math.min(COUPLER_LATERAL_LIMIT, n));
}

/**
 * Return the desired one-step pocket position. A curve or wall contact is an
 * outside force and therefore suppresses the centering spring for this step.
 */
function centeredSlotTarget(value, alpha) {
  const current = clampLateralOffset(value);
  return current * (1 - Math.max(0, Math.min(1, alpha)));
}

function centerBias(prev, car, sample, dt) {
  const frameScale = dt > 0 ? Math.min(1, dt * 60) : 1;
  const onRail = sample?.mode === TrainMode.ON_RAIL;
  let alpha =
    (onRail ? COUPLER_CENTER_BIAS_ON_RAIL : COUPLER_CENTER_BIAS_OFF_RAIL) *
    frameScale;
  if (onRail) {
    const routeTurn = angleDiff(prev?.ang || 0, sample?.ang || 0);
    alpha *= Math.max(
      0,
      1 - routeTurn / Math.max(COUPLER_CENTER_CURVE_ANGLE, 1e-6)
    );
  }
  if (prev?.wallHit || car?.wallHit || sample?.wallHit) return 0;
  return Math.max(0, Math.min(1, alpha));
}

function biasedLateralSlotCandidates(value, alpha) {
  const current = clampLateralOffset(value);
  const target = centeredSlotTarget(current, alpha);
  const halfStep = centeredSlotTarget(current, alpha * 0.5);
  return [
    current,
    target,
    halfStep,
    0,
    -COUPLER_LATERAL_LIMIT,
    COUPLER_LATERAL_LIMIT,
    -COUPLER_LATERAL_LIMIT / 3,
    COUPLER_LATERAL_LIMIT / 3,
  ].filter(
    (offset, index, all) =>
      all.findIndex((item) => Math.abs(item - offset) < 1e-9) === index
  );
}

function railAxlesClear(candidate, board) {
  if (!board) return false;
  const ux = Math.cos(candidate.ang || 0);
  const uy = Math.sin(candidate.ang || 0);
  const limit = Math.max(0, HALF_W - 4);
  for (const offset of [FRONT_AXLE_OFFSET, REAR_AXLE_OFFSET]) {
    const hit = closestPathPoint(
      board,
      candidate.x + ux * offset,
      candidate.y + uy * offset,
      limit + 0.5
    );
    if (!hit || hit.dist > limit + 0.5) return false;
  }
  return true;
}

function closestPointOnPath(path, x, y) {
  const points = path?.points;
  if (!points || points.length < 2) return null;
  let best = null;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = Math.max(
      0,
      Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)
    );
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (!best || dist < best.dist) {
      best = {
        x: px,
        y: py,
        dist,
        ang: Math.atan2(dy, dx),
      };
    }
  }
  return best;
}

/** Lower is a better visual two-axle seat on the sampled route path. */
function railPoseAlignment(candidate) {
  if (candidate.mode !== TrainMode.ON_RAIL) return 0;
  const path = candidate.pathRef?.path;
  if (!path) return 999;
  const ux = Math.cos(candidate.ang || 0);
  const uy = Math.sin(candidate.ang || 0);
  let score = 0;
  for (const offset of [FRONT_AXLE_OFFSET, REAR_AXLE_OFFSET]) {
    const probe = closestPointOnPath(
      path,
      candidate.x + ux * offset,
      candidate.y + uy * offset
    );
    if (!probe) return 999;
    const headingError = Math.min(
      angleDiff(candidate.ang || 0, probe.ang),
      angleDiff(candidate.ang || 0, probe.ang + Math.PI)
    );
    score += probe.dist + headingError * 12;
  }
  return score;
}

function candidateBlocked(candidate, priorCars, board, bounds, opts = {}) {
  const collisionCars = [
    ...priorCars,
    ...(opts.placementTrain?.cars || []).filter(
      (car) =>
        !car.coupled &&
        !car.powered &&
        !priorCars.some((prior) => prior.id === car.id) &&
        car.id !== candidate.id
    ),
  ];
  for (const prior of collisionCars) {
    const overlap = carBodyOverlap(prior, candidate);
    if (overlap && overlap.penetration > 0.05) {
      return {
        reason: "solid_body_overlap",
        otherId: prior.id,
        penetration: overlap.penetration,
      };
    }
  }
  if (
    opts.solidPlayfield &&
    bounds &&
    !bodyInsidePlayfield(candidate, bounds, 0.05)
  ) {
    const contact = playfieldBodyContact(candidate, bounds);
    const portals = playfieldPortalSides(board, candidate, bounds);
    const predecessor = priorCars.at(-1);
    // A floor follower directly pinned behind an on-rail predecessor is still
    // crossing that predecessor's rail-owned throat. Use the predecessor's
    // live path only for this exact link; do not let an arbitrary nearby rail
    // open a wall for an unrelated car.
    if (
      candidate.mode === TrainMode.OFF_RAIL &&
      predecessor?.mode === TrainMode.ON_RAIL &&
      predecessor.pathRef &&
      couplerError(predecessor, candidate) <= COUPLER_SOLVE_TOLERANCE
    ) {
      for (const side of playfieldPortalSides(
        board,
        { ...candidate, mode: TrainMode.ON_RAIL, pathRef: predecessor.pathRef },
        bounds
      )) {
        portals.add(side);
      }
    }
    if (!contact || !portals.has(contact.side)) {
      return {
        reason: "playfield_body_contact",
        side: contact?.side || null,
        penetration: contact?.penetration || 0,
        portalSides: [...portals],
        openMouthClearSteps: candidate.openMouthClearSteps || 0,
        openMouthPieceId: candidate.openMouthPieceId || null,
        openMouthAdjacentPieceId: candidate.openMouthAdjacentPieceId || null,
      };
    }
  }
  if (candidate.mode === TrainMode.OFF_RAIL) {
    const portal = findOpenMouthPortal(board, candidate);
    const exitPortal = findOpenMouthExitPortal(
      board,
      candidate,
      candidate.openMouthPieceId
    );
    const predecessor = priorCars.at(-1);
    const pinnedRailPiece =
      predecessor?.mode === TrainMode.ON_RAIL &&
      predecessor.pathRef &&
      couplerError(predecessor, candidate) <= COUPLER_SOLVE_TOLERANCE
        ? predecessor.pathRef.pieceId
        : null;
    const contact = trackBodyContact(candidate, board, {
      ignorePieceIds: [
        exitPortal?.pieceId,
        portal?.pieceId,
        pinnedRailPiece,
        candidate.openMouthClearSteps > 0
          ? candidate.openMouthAdjacentPieceId
          : null,
      ].filter(Boolean),
    });
    if (contact && contact.penetration > 0.15) {
      return {
        reason: "track_body_contact",
        pieceId: contact.pieceId,
        penetration: contact.penetration,
      };
    }
  } else if (
    candidate.mode === TrainMode.ON_RAIL &&
    candidate.pathRef &&
    board &&
    !railAxlesClear(candidate, board)
  ) {
    return { reason: "rail_axle_clearance" };
  }
  return null;
}

/**
 * One rotational degree of freedom remains after two hitch tips coincide.
 * Search that legal arc for the route-guided, collision-free orientation.
 */
function solvePinnedFollower(
  prev,
  car,
  sample,
  priorCars,
  board,
  bounds,
  opts,
  dt
) {
  // A pinned bar can articulate, but it cannot rotate an entire downstream
  // car without regard for the swept center path. Keep the established turn
  // envelope needed by the recovered route; candidate ranking below chooses
  // the hinge orientation with the smallest physical center sweep.
  const maxTurn = dt > 0 ? Math.max(0.12, Math.min(0.2, dt * 12)) : Math.PI;
  const desired = turnLimited(car.ang || sample.ang, sample.ang, maxTurn);
  const candidates = [desired];
  const steps = 12;
  for (let i = 1; i <= steps; i++) {
    const offset = (maxTurn * i) / steps;
    candidates.push(
      normalizeAngle((car.ang || sample.ang) + offset),
      normalizeAngle((car.ang || sample.ang) - offset)
    );
  }
  const uniqueAngles = [...new Set(candidates.map((ang) => quantizeAngle(ang)))];
  const bias = centerBias(prev, car, sample, dt);
  const candidatesWithSlots = [];
  for (const ang of uniqueAngles) {
    for (const rearOffset of biasedLateralSlotCandidates(
      prev.rearCouplerOffset,
      bias
    )) {
      for (const frontOffset of biasedLateralSlotCandidates(
        car.frontCouplerOffset,
        bias
      )) {
        candidatesWithSlots.push({ ang, rearOffset, frontOffset });
      }
    }
  }
  candidatesWithSlots.sort((a, b) => {
    const candidateA = pinCandidate(
      prev,
      car,
      sample,
      a.ang,
      a.rearOffset,
      a.frontOffset
    );
    const candidateB = pinCandidate(
      prev,
      car,
      sample,
      b.ang,
      b.rearOffset,
      b.frontOffset
    );
    const stepA = Math.hypot(candidateA.x - car.x, candidateA.y - car.y);
    const stepB = Math.hypot(candidateB.x - car.x, candidateB.y - car.y);
    const headingA = Math.abs(normalizeAngle(a.ang - sample.ang));
    const headingB = Math.abs(normalizeAngle(b.ang - sample.ang));
    const slotA =
      Math.abs(a.rearOffset - (prev.rearCouplerOffset || 0)) +
      Math.abs(a.frontOffset - (car.frontCouplerOffset || 0));
    const slotB =
      Math.abs(b.rearOffset - (prev.rearCouplerOffset || 0)) +
      Math.abs(b.frontOffset - (car.frontCouplerOffset || 0));
    const centerA = Math.abs(a.rearOffset) + Math.abs(a.frontOffset);
    const centerB = Math.abs(b.rearOffset) + Math.abs(b.frontOffset);
    // Pixels are the primary physical criterion. The small angular term
    // keeps a nearly tied candidate following the swept route instead of
    // accumulating a visible hinge lag.
    return (
      stepA +
      headingA * 8 +
      slotA * 0.15 +
      centerA * (bias * 2.5 + 0.02) -
      (stepB +
        headingB * 8 +
        slotB * 0.15 +
        centerB * (bias * 2.5 + 0.02))
    );
  });
  let firstBlock = null;
  for (const choice of candidatesWithSlots) {
    const candidate = pinCandidate(
      prev,
      car,
      sample,
      choice.ang,
      choice.rearOffset,
      choice.frontOffset
    );
    candidate.id = car.id;
    const blocked = candidateBlocked(
      candidate,
      priorCars,
      board,
      bounds,
      opts
    );
    if (!blocked) {
      prev.rearCouplerOffset = candidate.predecessorRearCouplerOffset;
      delete candidate.predecessorRearCouplerOffset;
      return { candidate, sample };
    }
    if (!firstBlock) firstBlock = blocked;
  }
  return { candidate: null, sample, blocked: firstBlock };
}

function syncPowered(train, chain) {
  const powered = chain[0];
  powered.x = train.x;
  powered.y = train.y;
  powered.ang = train.ang;
  powered.mode = train.mode;
  powered.pathRef = train.pathRef;
  powered.s = train.s;
  powered.dir = train.dir;
  powered.vx = train.vx;
  powered.vy = train.vy;
  powered.frontCouplerOffset = train.frontCouplerOffset || 0;
  powered.rearCouplerOffset =
    train.rearCouplerOffset ||
    powered.rearCouplerOffset ||
    0;
  powered.wallHit = !!train.wallHit;
  powered.openMouthClearSteps = train.openMouthClearSteps || 0;
  powered.openMouthPieceId = train.openMouthPieceId || null;
  powered.openMouthAdjacentPieceId =
    train.openMouthAdjacentPieceId || null;
  powered.railEntryGraceDistance = train.railEntryGraceDistance || 0;
  quantizePose(powered);
}

function trimTrail(trail, tailCursor) {
  const keepFrom = tailCursor - COUPLER_DIST;
  let remove = 0;
  while (
    remove + 1 < trail.samples.length &&
    trail.samples[remove + 1].d < keepFrom
  ) {
    remove++;
  }
  if (remove > 0) trail.samples.splice(0, remove);
}

function stall(train, frame, telemetry, reason, data = {}) {
  restoreFrame(train, frame);
  train.mode = TrainMode.STALLED;
  train.stallReason = reason;
  train.vx = 0;
  train.vy = 0;
  const chain = chainFor(train);
  if (chain[0]) {
    chain[0].mode = TrainMode.STALLED;
    chain[0].vx = 0;
    chain[0].vy = 0;
  }
  for (const car of chain.slice(1)) {
    car.vx = 0;
    car.vy = 0;
  }
  telemetry?.event("consist_stall", { reason, ...data });
  return { ok: false, stalled: true, reason, ...data };
}

/**
 * Solve every coupled follower from the powered car's swept center route.
 * Adjacent extended hitch tips coincide to within COUPLER_SOLVE_TOLERANCE.
 * No follower is independently integrated, projected, or snapped afterward.
 */
export function solveCoupledConsist(
  train,
  board,
  dt,
  bounds,
  opts = {},
  frame = null
) {
  // captureConsistFrame() already validated/reseeded external edits at the
  // start of this update. Do not run ensure again after the lead has made a
  // legitimate in-frame path/mode transition.
  const prepared =
    frame && train.motionTrail
      ? { chain: chainFor(train), trail: train.motionTrail }
      : ensureConsistMotion(train);
  const { chain, trail } = prepared;
  if (!trail || chain.length < 2) return { ok: true, chainLength: chain.length };
  const rollback = frame || captureConsistFrame(train);
  syncPowered(train, chain);
  const appended = appendHeadState(train, trail);
  const maxHeadStep = Math.max(24, (train.speed || 0) * Math.max(0, dt) * 4);
  if (appended.distance > maxHeadStep) {
    return stall(train, rollback, opts.telemetry, "lead_discontinuity", {
      distance: quantize(appended.distance),
      limit: quantize(maxHeadStep),
    });
  }

  let prev = chain[0];
  let prevCursor = trail.headD;
  trail.cursors.set(prev.id, prevCursor);
  const solvedCars = [prev];
  let maxError = 0;
  let maxStep = 0;
  for (let i = 1; i < chain.length; i++) {
    const car = chain[i];
    const old = { x: car.x, y: car.y, ang: car.ang, mode: car.mode };
    const cursor = prevCursor - COUPLER_DIST;
    const sample = sampleMotionTrail(trail, cursor);
    if (!sample) {
      return stall(train, rollback, opts.telemetry, "coupler_history_missing", {
        carId: car.id,
        predecessorId: prev.id,
        availableTrail: quantize(prevCursor - trail.samples[0].d),
      });
    }
    // Rail ownership adds a centerline constraint, so solve the exact pin
    // intersection on the recorded rail route. Floor ownership has one free
    // articulation angle and uses collision-aware pin kinematics instead.
    let solved =
      sample.mode === TrainMode.ON_RAIL
        ? followerRoot(
            trail,
            prev,
            car,
            prevCursor,
            solvedCars,
            board,
            bounds,
            opts,
            dt
          )
        : null;
    if (!solved) {
      solved = solvePinnedFollower(
            prev,
            car,
            sample,
            solvedCars,
            board,
            bounds,
            opts,
            dt
          );
    }
    if (!solved?.candidate) {
      return stall(
        train,
        rollback,
        opts.telemetry,
        solved?.blocked?.reason || "coupler_pose_blocked",
        {
          carId: car.id,
          predecessorId: prev.id,
          pieceId: solved?.blocked?.pieceId || null,
          penetration: quantize(solved?.blocked?.penetration || 0),
          side: solved?.blocked?.side || null,
          portalSides: solved?.blocked?.portalSides || [],
          openMouthClearSteps: solved?.blocked?.openMouthClearSteps || 0,
          openMouthPieceId: solved?.blocked?.openMouthPieceId || null,
          openMouthAdjacentPieceId:
            solved?.blocked?.openMouthAdjacentPieceId || null,
        }
      );
    }
    applyTrailState(car, solved, old, dt);
    if (prev === chain[0]) {
      train.rearCouplerOffset = prev.rearCouplerOffset || 0;
    }
    const error = couplerError(prev, car);
    const step = Math.hypot(car.x - old.x, car.y - old.y);
    maxError = Math.max(maxError, error);
    maxStep = Math.max(maxStep, step);
    if (error > COUPLER_SOLVE_TOLERANCE) {
      return stall(train, rollback, opts.telemetry, "coupler_error", {
        carId: car.id,
        predecessorId: prev.id,
        error: quantize(error, 0.000001),
      });
    }
    if (old.mode !== car.mode) {
      opts.telemetry?.event(
        car.mode === TrainMode.ON_RAIL ? "follower_rerail" : "car_rail_exit",
        {
          carId: car.id,
          entity: car.id,
          source: "shared_motion_trail",
          from: old.mode,
          to: car.mode,
          pathKey: car.pathRef
            ? `${car.pathRef.pieceId}:${car.pathRef.pathId}`
            : null,
          predecessorId: prev.id,
        }
      );
    }
    opts.telemetry?.event("coupler_constraint", {
      carId: car.id,
      predecessorId: prev.id,
      error: quantize(error, 0.000001),
      routeLag: quantize(solved.lag ?? COUPLER_DIST),
      cursor: quantize(solved.cursor ?? cursor),
    });
    const solvedCursor = solved.cursor ?? cursor;
    trail.cursors.set(car.id, solvedCursor);
    solvedCars.push(car);
    prev = car;
    prevCursor = solvedCursor;
  }

  // A pin solve is authoritative. Any later projection would stretch it, so
  // overlap is a hard stall rather than a hidden body-separation teleport.
  for (let i = 0; i < chain.length; i++) {
    for (let j = i + 1; j < chain.length; j++) {
      const overlap = carBodyOverlap(chain[i], chain[j]);
      if (overlap && overlap.penetration > 0.05) {
        return stall(train, rollback, opts.telemetry, "solid_body_overlap", {
          a: chain[i].id,
          b: chain[j].id,
          penetration: quantize(overlap.penetration),
        });
      }
    }
  }

  trimTrail(trail, prevCursor);
  train.stallReason = null;
  quantizePose(train);
  return {
    ok: true,
    chainLength: chain.length,
    maxCouplerError: quantize(maxError, 0.000001),
    maxFollowerStep: quantize(maxStep),
    trailSamples: trail.samples.length,
  };
}

/** Exact pin positions for debug drawing / telemetry. */
export function consistPinState(train) {
  const chain = chainFor(train);
  const pins = [];
  for (let i = 1; i < chain.length; i++) {
    pins.push({
      from: chain[i - 1].id,
      to: chain[i].id,
      rear: rearHitch(chain[i - 1]),
      front: frontHitch(chain[i]),
      error: couplerError(chain[i - 1], chain[i]),
    });
  }
  return pins;
}
