import { rebuild } from "../track.js";

export const WORLD_FRAMING_VERSION = 2;

function finiteBounds(value) {
  if (!value || typeof value !== "object") return null;
  const keys = ["minX", "minY", "maxX", "maxY"];
  if (!keys.every((key) => Number.isFinite(value[key]))) return null;
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

export function activePathMinY(board) {
  let minY = Infinity;
  for (const path of board?.pathIndex || []) {
    if (!path.active) continue;
    for (const point of path.points || []) minY = Math.min(minY, point.y);
  }
  return Number.isFinite(minY) ? minY : null;
}

export function buildWorldPersistence(board, playfieldBounds) {
  return {
    framingVersion: WORLD_FRAMING_VERSION,
    normalized: true,
    northPathY: activePathMinY(board),
    playfieldBounds: finiteBounds(playfieldBounds),
  };
}

/**
 * Normalize legacy solid layouts once. Current saves are already in world
 * coordinates and are returned untouched, preventing cache-reload drift.
 */
export function prepareLoadedWorld(board, data, targetNorthPathY = 36) {
  const stable =
    data?.world?.framingVersion === WORLD_FRAMING_VERSION &&
    data.world.normalized === true;
  // Version 1 persisted the regression's camera-derived top gap. Discard
  // those bounds during migration; version 2 recaptures the flush top wall.
  const playfieldBounds = stable
    ? finiteBounds(data?.world?.playfieldBounds)
    : null;
  const solidPlayfield = !!data?.solidPlayfield;
  if (stable) {
    return {
      data,
      dy: 0,
      stable: true,
      solidPlayfield,
      playfieldBounds,
    };
  }

  const needsNorthAlign = !!(data?.solidPlayfield || data?.northAlign);
  const minY = activePathMinY(board);
  const dy =
    needsNorthAlign && Number.isFinite(minY)
      ? targetNorthPathY - minY
      : 0;
  if (Math.abs(dy) > 0.000001) {
    for (const piece of board.pieces || []) piece.y += dy;
    rebuild(board);
  }
  if (!dy || !data?.train) {
    return {
      data,
      dy,
      stable: false,
      solidPlayfield,
      playfieldBounds,
    };
  }

  const train = {
    ...data.train,
    y: Number.isFinite(data.train.y) ? data.train.y + dy : data.train.y,
  };
  if (Array.isArray(data.train.cars)) {
    train.cars = data.train.cars.map((car) => ({
      ...car,
      y: Number.isFinite(car?.y) ? car.y + dy : car?.y,
    }));
  }
  return {
    data: { ...data, train },
    dy,
    stable: false,
    solidPlayfield,
    playfieldBounds,
  };
}
