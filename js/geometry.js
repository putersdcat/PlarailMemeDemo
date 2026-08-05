/**
 * Geometry public API — re-exports modular pieces.
 * Prefer importing from here so call sites stay stable.
 */
export * from "./geometry/core.js";
export {
  buildTemplate,
  worldGeometry,
  localPivotFromTemplate,
  localPivotForPiece,
  worldPivot,
  originFromWorldPivot,
  rotateAroundVisualPivot,
  flipAroundVisualPivot,
  mirrorAroundVisualPivot,
} from "./geometry/templates.js";
