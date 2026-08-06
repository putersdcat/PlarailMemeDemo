/**
 * Linked connector midpoint weld — drives real rebuild() / weldLinkedConnectors().
 */
import { test, assert, assertEq } from "./assert.mjs";
import {
  createBoard,
  addPiece,
  rebuild,
  loadBoard,
  weldLinkedConnectors,
  maxLinkedPairDistance,
  getPiece,
} from "../js/track.js";
import { UNIT } from "../js/geometry.js";
import { REAL_MEME_LAYOUT } from "../js/presets.js";

test("weldLinkedConnectors moves offset R01 pair to shared midpoint", () => {
  const board = createBoard();
  // Perfect join would be B at x=UNIT; offset B so ports are ~8px apart
  const a = addPiece(board, "R01", 0, 0, 0, { flip: false });
  const b = addPiece(board, "R01", UNIT + 8, 3, 0, { flip: false });
  // Pair without weld first
  // rebuild welds — check after
  rebuild(board);
  const d = maxLinkedPairDistance(board);
  assert(d < 1e-6, `linked pair should coincide after rebuild weld, d=${d}`);

  // Ports should both sit at midpoint of original gap
  // Original A.b at 48,0 and B.a at 48+8=56, 3 → mid (52, 1.5) roughly
  // After weld both at same world pos
  const ca = board.connectors.find((c) => c.pieceId === a.id && c.id === "b");
  const cb = board.connectors.find((c) => c.pieceId === b.id && c.id === "a");
  assert(ca && cb && ca.linked === cb);
  assert(Math.hypot(ca.wx - cb.wx, ca.wy - cb.wy) < 1e-6);
});

test("rebuild weld does not break perfect joins", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0, { flip: false });
  addPiece(board, "R01", UNIT, 0, 0, { flip: false });
  rebuild(board);
  assert(maxLinkedPairDistance(board) < 1e-6);
  assertEq(board.connectors.filter((c) => c.linked).length, 2);
});

test("meme layout linked gaps collapse toward 0 after rebuild weld", () => {
  const board = createBoard();
  const r = loadBoard(board, REAL_MEME_LAYOUT);
  assert(r.ok);
  const maxD = maxLinkedPairDistance(board);
  // Pre-weld outliers were ~4–12 px. After weld, gaps must be ≤1px (canvas
  // sub-pixel). Rigid multi-link loops can leave a fraction of a pixel.
  assert(
    maxD < 1.0,
    `meme max linked gap should be ≤1px after weld, got ${maxD}`
  );
});

test("weldLinkedConnectors returns false when already coincident", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  addPiece(board, "R01", UNIT, 0, 0);
  rebuild(board);
  // Pairs already welded; another weld pass after caches
  const moved = weldLinkedConnectors(board);
  assertEq(moved, false);
});

test("multi-link piece: three R01 chain welds all joints", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0);
  addPiece(board, "R01", UNIT + 5, 2, 0);
  addPiece(board, "R01", 2 * UNIT + 9, -1, 0);
  rebuild(board);
  assert(
    maxLinkedPairDistance(board) < 1e-6,
    `chain max gap ${maxLinkedPairDistance(board)}`
  );
  // Two joints ⇒ 4 linked connector ends
  assert(board.connectors.filter((c) => c.linked).length >= 4);
});
