/**
 * One-shot modularization helper: split geometry into core + templates.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const js = join(root, "js");
mkdirSync(join(js, "geometry"), { recursive: true });
mkdirSync(join(js, "app"), { recursive: true });

const geoPath = join(js, "geometry.js");
const lines = readFileSync(geoPath, "utf8").split(/\r?\n/);

// buildTemplate starts at line 341 (1-based) → index 340
const splitAt = lines.findIndex((l) => l.startsWith("export function buildTemplate"));
if (splitAt < 0) throw new Error("buildTemplate not found");

const coreLines = lines.slice(0, splitAt);
const templateLines = lines.slice(splitAt);

// core: drop trailing blank-ish, ensure ends cleanly
const core = coreLines.join("\n").replace(/\n+$/, "\n");
writeFileSync(join(js, "geometry", "core.js"), core);

const templates =
  `/**
 * Piece geometry templates + worldGeometry.
 */
import {
  UNIT,
  HALF,
  LARGE_R,
  TRACK_W,
  HALF_W,
  DEG45,
  DOUBLE_GAP,
  PIECE_TYPES,
  normalizePieceType,
  normalizeAngle,
  sampleArc,
  polylineLength,
  transformPoint,
  transformDir,
  rotStepsToRad,
  localPivotForPiece,
} from "./core.js";

` + templateLines.join("\n") + "\n";

writeFileSync(join(js, "geometry", "templates.js"), templates);

writeFileSync(
  geoPath,
  `/**
 * Geometry public API — re-exports modular pieces.
 * Prefer importing from here so call sites stay stable.
 */
export * from "./geometry/core.js";
export { buildTemplate, worldGeometry } from "./geometry/templates.js";
`
);

console.log("geometry split at line", splitAt + 1);
console.log("core lines", coreLines.length, "template lines", templateLines.length);
