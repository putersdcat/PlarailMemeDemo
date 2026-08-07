/**
 * Train pose helpers (create, axles, hit-test).
 */
import {
  TrainMode,
  FRONT_AXLE_OFFSET,
  REAR_AXLE_OFFSET,
  TRAIN_HIT_R,
} from "./constants.js";

export function createTrain() {
  return {
    mode: TrainMode.IDLE,
    x: 0,
    y: 0,
    ang: 0,
    speed: 210,
    pathRef: null,
    /** Front axle parameter along current path [0,1] */
    s: 0,
    /** +1 with path tangent, -1 against */
    dir: 1,
    vx: 0,
    vy: 0,
    reRailCooldown: 0,
    selected: false,
    /** Set true when walls were hit this simulation step (for SFX) */
    wallHit: false,
    /** Heading at derail — locks wall-slide left/right for all speeds */
    offRailPreferAng: null,
    /** Cumulative distance traveled off-rail (px) */
    offRailDistAcc: 0,
    /** Completed fixed-size geometry steps */
    offRailStepsDone: 0,
    /** Distance left before re-rail is allowed */
    reRailDistLeft: 0,
    /** After corner-redirect material fires, hold exit heading this many steps */
    cornerLockSteps: 0,
    cornerLockUx: null,
    cornerLockUy: null,
    /** Fixed geometry steps allowed to clear an open turnout mouth/footprint. */
    openMouthClearSteps: 0,
    /**
     * Linked cars (lead + followers). Empty/absent → single engine.
     * Powered car mirrors train.x/y/ang after placeFollowers.
     */
    cars: null,
    /** Spec used to (re)build cars: [{role, kind, facing}, ...] */
    consistSpec: null,
    /** Id of powered engine car */
    poweredId: null,
    /** Selected car id for power switch / uncouple UI */
    selectedCarId: null,
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

export function bodyFromRearAxle(ax, ay, ang) {
  return {
    x: ax - Math.cos(ang) * REAR_AXLE_OFFSET,
    y: ay - Math.sin(ang) * REAR_AXLE_OFFSET,
    ang,
  };
}

/**
 * Convert a path probe back to a body pose without losing which point was
 * probed. Front/rear axle samples need an offset; a body sample is already
 * the body center.
 */
export function bodyFromRailProbe(x, y, ang, anchor = "body") {
  if (anchor === "front") return bodyFromFrontAxle(x, y, ang);
  if (anchor === "rear") return bodyFromRearAxle(x, y, ang);
  return { x, y, ang };
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
