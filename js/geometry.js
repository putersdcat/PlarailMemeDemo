/**
 * Geometry public API — re-exports modular pieces.
 * Prefer importing from here so call sites stay stable.
 */
export * from "./geometry/units-math.js";
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
} from "./geometry/piece-templates.js";
