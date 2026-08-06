/**
 * Train dimensions and mode constants.
 */
import { HALF_W, TRACK_W } from "../geometry.js";

export const TrainMode = {
  IDLE: "idle",
  ON_RAIL: "on_rail",
  OFF_RAIL: "off_rail",
  STOPPED: "stopped",
};

/**
 * Visual body: narrower than track bed, elongated.
 * TRACK_W = plastic bed width (40).
 */
export const TRAIN_RADIUS = HALF_W - 2; // 18
export const TRAIN_LENGTH = Math.round(TRACK_W * 2.15 * (4 / 3)); // ~115

/**
 * Physics wheelbase — pre-scale compact train (L=48 era).
 * Do not derive these from TRAIN_LENGTH or wall contact goes unstable.
 */
const PHYS_LEN = 48;
export const FRONT_AXLE_FROM_NOSE = PHYS_LEN / 3;
export const FRONT_AXLE_OFFSET = PHYS_LEN / 2 - FRONT_AXLE_FROM_NOSE; // +8
export const REAR_AXLE_OFFSET = -PHYS_LEN * 0.28; // ~-13.4
/** Compact contact radius used before the visual scale-up. */
export const WHEEL_RADIUS = 9;

/**
 * Re-rail snap window — intentionally tight so drive-bys past
 * perpendicular track do not steal the train.
 * Mouth re-entry is a bit looser than mid-path.
 */
export const RE_RAIL_LATERAL = 14;
export const RE_RAIL_ANGLE = (38 * Math.PI) / 180;
/** Geometric hop between path ends when graph link is missing. */
export const PATH_HOP_DIST = 30;
export const PATH_HOP_ANGLE = (40 * Math.PI) / 180;
/** Zero bounce: walls kill normal velocity and slide only. */
export const EDGE_RESTITUTION = 0;
/** Hit radius for selecting / dragging the train body. */
export const TRAIN_HIT_R = Math.round(TRAIN_LENGTH * 0.55);

