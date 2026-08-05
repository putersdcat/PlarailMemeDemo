import { readFileSync, writeFileSync } from "fs";

const layout = JSON.parse(
  readFileSync(new URL("../layouts/real-meme-track.json", import.meta.url), "utf8")
);

const body = {
  format: "plarail-meme-layout",
  version: 1,
  name: layout.name || "Real-2-Sim meme track",
  source: layout.source || undefined,
  pieces: layout.pieces,
  train: layout.train || undefined,
};

const hint = layout.train
  ? { x: layout.train.x, y: layout.train.y }
  : { x: 528.73, y: 653 };

const out = `/**
 * Built-in layouts.
 * Default: gold-standard WORKING meme track (plarail-layout-WORKING-*).
 */

import { UNIT, PIECE_TYPES } from "./geometry.js";
import { addPiece, clearBoard, rebuild, loadBoard } from "./track.js";

/** Absolute layout — functionally tested gold standard. */
export const REAL_MEME_LAYOUT = ${JSON.stringify(body, null, 2)};

/**
 * Load the gold-standard Real-2-Sim meme track.
 */
export function loadRealMemeTrack(board) {
  const result = loadBoard(board, REAL_MEME_LAYOUT);
  const t = REAL_MEME_LAYOUT.train;
  const th = t
    ? { x: t.x, y: t.y, ang: t.ang, speed: t.speed ?? 120 }
    : ${JSON.stringify({ ...hint, ang: 0.7853981633974487, speed: 120 })};
  return {
    ok: result.ok,
    pieceCount: result.pieceCount,
    trainHint: th,
    speed: th.speed,
    note: \`Loaded Real-2-Sim meme track (\${result.pieceCount} pieces). Drag train onto a rail, then Start.\`,
  };
}

/** Alias used by the Load Real-2-Sim track button. */
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
  "presets.js written with",
  layout.pieces.length,
  "pieces, trainHint",
  hint
);
