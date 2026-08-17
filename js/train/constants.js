/**
 * Train dimensions and mode constants.
 */
import { HALF_W, TRACK_W } from "../geometry.js";

export const TrainMode = {
  IDLE: "idle",
  ON_RAIL: "on_rail",
  OFF_RAIL: "off_rail",
  STALLED: "stalled",
};

/**
 * Visual body: narrower than track bed, elongated.
 * TRACK_W = plastic bed width (40).
 */
export const TRAIN_RADIUS = HALF_W - 2; // 18
export const TRAIN_LENGTH = Math.round(TRACK_W * 2.15 * (4 / 3)); // ~115

/**
 * Coupling geometry.
 *
 * The two extended hitch tips occupy half of the visible air gap each. A
 * healthy coupled pair therefore has coincident hitch tips (zero error), not
 * a spring whose center spacing is allowed to drift around COUPLER_DIST.
 */
export const COUPLER_AIR_GAP = 12;
export const COUPLER_DIST = TRAIN_LENGTH + COUPLER_AIR_GAP;
export const REAR_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;
export const FRONT_HITCH = TRAIN_LENGTH * 0.5 + COUPLER_AIR_GAP * 0.5;
/**
 * Real coupler pins can float laterally in their pockets while the bar keeps
 * its fixed length. Each car end gets an independent slot equal to one
 * quarter of the visible 36 px car width (9 px at the current scale).
 */
export const COUPLER_LATERAL_LIMIT = TRAIN_RADIUS * 0.5;
/** Per-60 Hz frame return toward a centered pin pocket when unforced. */
export const COUPLER_CENTER_BIAS_OFF_RAIL = 0.32;
export const COUPLER_CENTER_BIAS_ON_RAIL = 0.24;
/** Heading delta over which a rail curve fully overcomes centering. */
export const COUPLER_CENTER_CURVE_ANGLE = Math.PI / 3;

/** Runtime quantization. Fine enough to be invisible, coarse enough that
 * telemetry and saved state do not accumulate floating-point confetti. */
export const POSITION_QUANTUM = 0.001;
export const ANGLE_QUANTUM = 0.000001;
/** Camera fit margin that leaves one full-width car corridor outside track. */
export const SOLID_PLAYFIELD_FIT_PAD = 64;

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

/** Re-rail approach window — drive-bys more than 15° off a rail do not steal. */
export const RE_RAIL_LATERAL = 14;
export const RE_RAIL_ANGLE = (15 * Math.PI) / 180;
/** Geometric hop between path ends when graph link is missing. */
export const PATH_HOP_DIST = 30;
export const PATH_HOP_ANGLE = (40 * Math.PI) / 180;
/** Zero bounce: walls kill normal velocity and slide only. */
export const EDGE_RESTITUTION = 0;
/** Hit radius for selecting / dragging the train body. */
export const TRAIN_HIT_R = Math.round(TRAIN_LENGTH * 0.55);

