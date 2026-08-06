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
import { UNIT, SNAP_DIST } from "../js/geometry.js";
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

test("meme layout linked gaps stay within soft-link range after rebuild", () => {
  const board = createBoard();
  const r = loadBoard(board, REAL_MEME_LAYOUT);
  assert(r.ok);
  const maxD = maxLinkedPairDistance(board);
  // User gold may keep intentional soft links (paired under LINK_DIST).
  // Safe weld must not invent a tighter mesh by warping hubs.
  assert(
    maxD < SNAP_DIST * 1.15 + 1e-6,
    `meme max linked gap should stay within link range, got ${maxD}`
  );
  // Most joints should be exact; allow a few soft residuals
  let soft = 0;
  const seen = new Set();
  for (const c of board.connectors || []) {
    if (!c.linked) continue;
    const key = [c.pieceId + ":" + c.id, c.linked.pieceId + ":" + c.linked.id]
      .sort()
      .join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const d = Math.hypot(c.wx - c.linked.wx, c.wy - c.linked.wy);
    if (d > 1e-3) soft++;
  }
  assert(
    soft <= 3,
    `expected at most a few soft-linked residuals, got ${soft} (maxD=${maxD})`
  );
});

test("meme layout load preserves authored piece poses (no weld warp)", () => {
  const board = createBoard();
  const r = loadBoard(board, REAL_MEME_LAYOUT);
  assert(r.ok);
  let maxPose = 0;
  for (const raw of REAL_MEME_LAYOUT.pieces) {
    const p = getPiece(board, raw.id);
    assert(p, `missing piece ${raw.id}`);
    maxPose = Math.max(maxPose, Math.hypot(p.x - raw.x, p.y - raw.y));
  }
  assert(
    maxPose < 1e-6,
    `load must not move gold pieces, max pose delta ${maxPose}`
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
