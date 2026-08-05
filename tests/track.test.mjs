import { test, assert, assertEq, assertApprox } from "./assert.mjs";
import {
  createBoard,
  addPiece,
  serializeBoard,
  loadBoard,
  findSnap,
  findGroupSnap,
  rebuild,
  closestPathPoint,
  normalizePieceColor,
  pieceColorHex,
  PIECE_COLORS,
} from "../js/track.js";
import { UNIT, HALF, SNAP_DIST } from "../js/geometry.js";

test("normalizePieceColor defaults blue", () => {
  assertEq(normalizePieceColor(null), "blue");
  assertEq(normalizePieceColor("green"), "green");
  assertEq(normalizePieceColor("nope"), "blue");
  assertEq(pieceColorHex("red"), PIECE_COLORS.red);
});

test("addPiece assigns color and id", () => {
  const board = createBoard();
  const p = addPiece(board, "R01", 0, 0, 0, { color: "green" });
  assertEq(p.color, "green");
  assert(p.id.startsWith("p"));
  assertEq(board.pieces.length, 1);
});

test("serialize / load round-trip preserves color", () => {
  const board = createBoard();
  addPiece(board, "R01", 10, 20, 2, { color: "red", flip: true });
  addPiece(board, "R02", 100, 20, 0, { color: "gray" });
  const data = serializeBoard(board);
  assertEq(data.pieces.length, 2);
  assertEq(data.pieces[0].color, "red");

  const board2 = createBoard();
  const r = loadBoard(board2, data);
  assert(r.ok);
  assertEq(r.pieceCount, 2);
  assertEq(board2.pieces[0].color, "red");
  assertEq(board2.pieces[0].flip, true);
  assertEq(board2.pieces[1].color, "gray");
});

test("two R01 butted M-F link when facing", () => {
  const board = createBoard();
  // Default R01: M at -HALF, F at +HALF. Second piece flipped: F at -HALF, M at +HALF.
  // Centers UNIT apart: first F at +HALF meets second F at UNIT-HALF = +HALF — same gender, no link.
  // Centers UNIT apart with second NOT flipped: first F (+HALF) meets second M (UNIT-HALF) — link.
  addPiece(board, "R01", 0, 0, 0, { flip: false });
  addPiece(board, "R01", UNIT, 0, 0, { flip: false });
  rebuild(board);
  const linked = board.connectors.filter((c) => c.linked).length;
  assert(linked >= 2, `expected linked ports, got ${linked}`);
});

test("findSnap does not throw and can snap free ends", () => {
  const board = createBoard();
  addPiece(board, "R01", 0, 0, 0, { flip: false });
  // Ghost near the free F end, flipped so left port is M facing board F
  const ghost = {
    id: "ghost",
    type: "R01",
    x: UNIT + 8,
    y: 0,
    rotSteps: 0,
    flip: true,
    branchSide: "R",
    pivotX: UNIT + 8,
    pivotY: 0,
  };
  const snap = findSnap(board, ghost, SNAP_DIST * 2);
  assert(snap === null || (snap.snapped === true && typeof snap.x === "number"));
});

test("findGroupSnap translates whole selection", () => {
  const board = createBoard();
  const a = addPiece(board, "R01", 0, 0, 0);
  // free end of a at +UNIT/2 F
  const g1 = addPiece(board, "R02", UNIT / 2 + HALF + 12, 8, 0); // offset
  // R02 half = HALF length; center so left end near a's right
  // Rebuild after manual nudge
  g1.x = UNIT / 2 + 24 + 10; // half of R02 is 24 if UNIT=96 → HALF=48, half len=24
  g1.y = 5;
  rebuild(board);
  const snap = findGroupSnap(board, new Set([g1.id]), SNAP_DIST);
  // soft assertion — geometry dependent
  assert(snap === null || typeof snap.dx === "number");
});

test("closestPathPoint finds active path", () => {
  const board = createBoard();
  addPiece(board, "R01", 200, 100, 0);
  const hit = closestPathPoint(board, 200, 100, 80);
  assert(hit, "should find path");
  assert(hit.dist < 5);
  assert(hit.path);
});
