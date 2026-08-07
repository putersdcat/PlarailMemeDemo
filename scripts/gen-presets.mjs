import { readFileSync, writeFileSync } from "fs";

const realLayout = JSON.parse(
  readFileSync(new URL("../layouts/real-meme-track.json", import.meta.url), "utf8")
);
const arntenoughLayout = JSON.parse(
  readFileSync(new URL("../layouts/arntenoughrails.json", import.meta.url), "utf8")
);

const realBody = {
  format: "plarail-meme-layout",
  version: 1,
  name: realLayout.name || "Real-2-Sim meme track",
  source: realLayout.source || undefined,
  pieces: realLayout.pieces,
  train: realLayout.train || undefined,
};

const hint = realLayout.train
  ? { x: realLayout.train.x, y: realLayout.train.y }
  : { x: 528.73, y: 653 };

const arntenoughModule = `/** Auto: not-enough-rails layout (godi3 meme). */
export const ARNTENOUGHRAILS_LAYOUT = ${JSON.stringify(
  arntenoughLayout,
  null,
  2
)};
`;
writeFileSync(
  new URL("../js/layouts-arntenoughrails.js", import.meta.url),
  arntenoughModule
);

const out = `/**
 * Built-in layouts.
 * Default: gold-standard WORKING meme track (plarail-layout-WORKING-*).
 */

import { UNIT, PIECE_TYPES } from "./geometry.js";
import { addPiece, clearBoard, rebuild, loadBoard } from "./track.js";
import { ARNTENOUGHRAILS_LAYOUT } from "./layouts-arntenoughrails.js";

export { ARNTENOUGHRAILS_LAYOUT };

/** Absolute layout — functionally tested gold standard. */
export const REAL_MEME_LAYOUT = ${JSON.stringify(realBody, null, 2)};

/** Load the gold-standard Real-2-Sim meme track. */
export function loadRealMemeTrack(board) {
  const result = loadBoard(board, REAL_MEME_LAYOUT);
  const t = REAL_MEME_LAYOUT.train;
  const th = t
    ? { x: t.x, y: t.y, ang: t.ang, speed: t.speed ?? 210 }
    : ${JSON.stringify({ ...hint, ang: 0.7853981633974487, speed: 210 })};
  return {
    ok: result.ok,
    pieceCount: result.pieceCount,
    trainHint: th,
    speed: th.speed,
    solidPlayfield: false,
    consist: null,
    note: \`Loaded Real-2-Sim meme track (\${result.pieceCount} pieces). Drag train onto a rail, then Start.\`,
  };
}

/** Load the sparse saved meme track with separate rolling-stock entities. */
export function loadArntenoughrailsTrack(board) {
  const result = loadBoard(board, ARNTENOUGHRAILS_LAYOUT);
  const t = ARNTENOUGHRAILS_LAYOUT.train;
  const th = t
    ? { x: t.x, y: t.y, ang: t.ang, speed: t.speed ?? 200 }
    : { x: 180, y: 580, ang: -Math.PI / 2, speed: 200 };
  const authoredCars = t?.cars?.length >= 1 ? t.cars : null;
  const cars = authoredCars
    ? authoredCars.map((car, index) => ({
        ...car,
        id: car.id || ["lead", "mid1", "trail1"][index] || \`car\${index + 1}\`,
        powered: index === 0 ? true : !!car.powered,
        coupled: index === 0 ? true : car.coupled !== false,
      }))
    : [
        {
          id: "lead",
          kind: "engine",
          role: "lead",
          powered: true,
          coupled: true,
          facing: 1,
        },
        {
          id: "mid1",
          kind: "mid",
          role: "mid",
          powered: false,
          coupled: true,
          facing: 1,
        },
        {
          id: "trail1",
          kind: "engine",
          role: "trail",
          facing: -1,
          coupled: true,
          powered: false,
        },
      ];
  return {
    ok: result.ok,
    pieceCount: result.pieceCount,
    trainHint: th,
    speed: th.speed,
    solidPlayfield: true,
    northAlign: true,
    cars,
    consist: null,
    note: \`Loaded “Not enough rails” (\${result.pieceCount} pieces, 3 separate cars coupled, solid walls). Mid in palette · 🦄 switches engine · Delete removes car.\`,
  };
}

export const TRACK_CATALOG = [
  { id: "real-meme", name: "Real-2-Sim meme track", load: loadRealMemeTrack },
  {
    id: "arntenoughrails",
    name: "Not enough rails (godi3)",
    load: loadArntenoughrailsTrack,
  },
];

export function getTrackById(id) {
  return TRACK_CATALOG.find((t) => t.id === id) || TRACK_CATALOG[0] || null;
}

/** Alias used by older call sites. */
export function loadMemeStyle(board, _cx, _cy) {
  return loadRealMemeTrack(board);
}

export function loadOval(board, cx, cy) {
  clearBoard(board);
  for (let i = 0; i < 8; i++) {
    addPiece(board, PIECE_TYPES.R03, cx, cy, i, { flip: false });
  }
  rebuild(board);
  return { trainHint: { x: cx + UNIT, y: cy }, note: "Oval loop (8x R-03)." };
}

export function loadOpenRun(board, cx, cy) {
  clearBoard(board);
  for (let i = 0; i < 4; i++) {
    addPiece(board, PIECE_TYPES.R01, cx + i * UNIT, cy, 0);
  }
  rebuild(board);
  return { trainHint: { x: cx - UNIT / 2 + 20, y: cy } };
}
`;

writeFileSync(new URL("../js/presets.js", import.meta.url), out);
console.log(
  "presets.js and layouts-arntenoughrails.js written with",
  realLayout.pieces.length,
  "real pieces and",
  arntenoughLayout.pieces.length,
  "saved pieces"
);
