import { readFileSync, writeFileSync } from "fs";

const layout = JSON.parse(
  readFileSync(new URL("../layouts/real-meme-track.json", import.meta.url), "utf8")
);

const body = {
  format: "plarail-meme-layout",
  version: 1,
  name: "Real-2-Sim meme track",
  pieces: layout.pieces,
};

const out = `/**
 * Built-in layouts.
 * Default: the real meme track extracted from the user's live build.
 */

import { UNIT, PIECE_TYPES } from "./geometry.js";
import { addPiece, clearBoard, rebuild, loadBoard } from "./track.js";

/** Absolute layout captured from the Real-2-Sim browser session. */
export const REAL_MEME_LAYOUT = ${JSON.stringify(body, null, 2)};

/**
 * Load the captured real meme track (absolute coordinates as built).
 */
export function loadRealMemeTrack(board) {
  const result = loadBoard(board, REAL_MEME_LAYOUT);
  return {
    ok: result.ok,
    pieceCount: result.pieceCount,
    trainHint: { x: 521, y: 366 },
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
console.log("presets.js written with", layout.pieces.length, "pieces");
