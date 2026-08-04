/**
 * Built-in layouts. Meme-style is a dense multi-loop planar approximation
 * of the video's chaotic Plarail cluster (not frame-perfect).
 */

import { UNIT, LARGE_R, PIECE_TYPES } from "./geometry.js";
import { addPiece, clearBoard, rebuild } from "./track.js";

/**
 * Simple circle — 8× R-03 sharing one center (guaranteed closed loop).
 */
export function loadOval(board, cx, cy) {
  clearBoard(board);
  for (let i = 0; i < 8; i++) {
    addPiece(board, PIECE_TYPES.R03, cx, cy, i, { flip: false });
  }
  rebuild(board);
  return { trainHint: { x: cx + UNIT, y: cy } };
}

/**
 * Open-ended straight run — derail → floor → canvas edge stop.
 */
export function loadOpenRun(board, cx, cy) {
  clearBoard(board);
  for (let i = 0; i < 4; i++) {
    addPiece(board, PIECE_TYPES.R01, cx + i * UNIT, cy, 0);
  }
  rebuild(board);
  return { trainHint: { x: cx - UNIT / 2 + 20, y: cy } };
}

/**
 * Rounded-rectangle outer loop with correct gender flips on each edge.
 * Corner centers form a W × H rectangle; path radius = UNIT.
 */
function addRoundedRectLoop(board, cx, cy, wUnits, hUnits) {
  const W = UNIT * wUnits;
  const H = UNIT * hUnits;

  // 90° corners = 2× R-03 each. startStep selects which quadrant.
  function corner(ox, oy, startStep) {
    addPiece(board, PIECE_TYPES.R03, ox, oy, startStep);
    addPiece(board, PIECE_TYPES.R03, ox, oy, startStep + 1);
  }

  // BR 0–90°, BL 90–180°, TL 180–270°, TR 270–360°
  corner(cx + W / 2, cy + H / 2, 0);
  corner(cx - W / 2, cy + H / 2, 2);
  corner(cx - W / 2, cy - H / 2, 4);
  corner(cx + W / 2, cy - H / 2, 6);

  const yBottom = cy + H / 2 + UNIT;
  const yTop = cy - H / 2 - UNIT;
  const xLeft = cx - W / 2 - UNIT;
  const xRight = cx + W / 2 + UNIT;

  // Gender map for R-03 arcs (M at start / F at end, CCW):
  // Bottom: BL@90° = M, BR@90° = F  → straights need left F, right M → flip
  // Top:    TL@270° = F, TR@270° = M → straights need left M, right F → default
  // Left:   BL@180° = F, TL@180° = M → vertical bottom M, top F → flip (rot 2)
  // Right:  BR@0° = M,  TR@0° = F   → vertical bottom F, top M → default (rot 2)
  for (let i = 0; i < wUnits; i++) {
    const x = cx - W / 2 + UNIT / 2 + i * UNIT;
    addPiece(board, PIECE_TYPES.R01, x, yBottom, 0, { flip: true });
    addPiece(board, PIECE_TYPES.R01, x, yTop, 0, { flip: false });
  }

  for (let i = 0; i < hUnits; i++) {
    const y = cy - H / 2 + UNIT / 2 + i * UNIT;
    addPiece(board, PIECE_TYPES.R01, xLeft, y, 2, { flip: true });
    addPiece(board, PIECE_TYPES.R01, xRight, y, 2, { flip: false });
  }

  return {
    yBottom,
    yTop,
    xLeft,
    xRight,
    W,
    H,
  };
}

/**
 * Dense multi-loop meme-style cluster.
 */
export function loadMemeStyle(board, cx, cy) {
  clearBoard(board);

  // Outer rounded rect 3×2 units between corner centers
  const outer = addRoundedRectLoop(board, cx, cy, 3, 2);

  // Inner closed circle (offset slightly) for nested loop bulk
  const ix = cx - UNIT * 0.05;
  const iy = cy + UNIT * 0.05;
  for (let i = 0; i < 8; i++) {
    addPiece(board, PIECE_TYPES.R03, ix, iy, i);
  }

  // Cross junction near center-top of inner area
  addPiece(board, PIECE_TYPES.R14, cx + UNIT * 0.1, cy - UNIT * 0.15, 0);

  // Turnouts parked along bottom outer for branch chaos (may free-place)
  addPiece(board, PIECE_TYPES.R11, cx - UNIT * 1.1, cy + UNIT * 0.35, 0, {
    branchSide: "R",
    switchState: 0,
  });
  addPiece(board, PIECE_TYPES.R11, cx + UNIT * 1.1, cy + UNIT * 0.35, 4, {
    branchSide: "L",
    switchState: 1,
  });

  // Y-points + critical 1→3 split (screenshot multi-junction language)
  addPiece(board, PIECE_TYPES.R12, cx - UNIT * 0.2, cy - UNIT * 0.95, 2, {
    switchState: 0,
  });
  addPiece(board, PIECE_TYPES.R17, cx + UNIT * 0.9, cy - UNIT * 0.2, 0, {
    switchState: 1,
  });

  // Large curves (R-04) + 90° convenience pieces
  addPiece(board, PIECE_TYPES.R04, cx + LARGE_R * 0.15, cy + UNIT * 1.6, 0);
  addPiece(board, PIECE_TYPES.R04, cx + LARGE_R * 0.15, cy + UNIT * 1.6, 1);
  addPiece(board, PIECE_TYPES.R105, cx - UNIT * 1.4, cy - UNIT * 0.2, 2);
  addPiece(board, PIECE_TYPES.R105, cx + UNIT * 1.4, cy + UNIT * 0.2, 6);

  // R-07 double straight + R-08 stop
  addPiece(board, PIECE_TYPES.R07, cx, cy + UNIT * 0.55, 0, { flip: true });
  addPiece(board, PIECE_TYPES.R08, cx - UNIT * 0.2, cy - UNIT * 1.55, 0);

  // Half straights + extra curves for wall mass (meme bounce surfaces)
  addPiece(board, PIECE_TYPES.R02, cx + UNIT * 1.6, cy - UNIT * 0.4, 2);
  addPiece(board, PIECE_TYPES.R02, cx - UNIT * 1.6, cy + UNIT * 0.4, 2);
  addPiece(board, PIECE_TYPES.R03, cx + UNIT * 1.35, cy + UNIT * 1.0, 5, {
    flip: true,
  });
  addPiece(board, PIECE_TYPES.R03, cx - UNIT * 1.35, cy - UNIT * 1.0, 1, {
    flip: true,
  });
  addPiece(board, PIECE_TYPES.R03, cx + UNIT * 0.55, cy - UNIT * 1.45, 3);
  addPiece(board, PIECE_TYPES.R03, cx - UNIT * 0.55, cy + UNIT * 1.45, 7);
  rebuild(board);

  return {
    trainHint: { x: cx, y: outer.yBottom },
    note: "Meme-style cluster (R-01…R-17 units). Drag pieces; snap does not auto-rotate.",
  };
}

/**
 * 7/8 circle + interior walls — open mouth derail with catch-basin re-rail chance.
 */
export function loadCatchBasin(board, cx, cy) {
  clearBoard(board);

  // Nearly-closed outer ring (7 of 8 segments) — open gap ~45°
  for (let i = 0; i < 7; i++) {
    addPiece(board, PIECE_TYPES.R03, cx, cy, i);
  }

  // Inner reverse ring segment (creates channel / wall pocket)
  for (let i = 0; i < 6; i++) {
    addPiece(board, PIECE_TYPES.R03, cx, cy, i, { flip: true });
  }

  // Outer blocking arcs so free train is more likely to slide the ring
  // Small satellite arcs around the gap
  addPiece(board, PIECE_TYPES.R03, cx + UNIT * 0.9, cy - UNIT * 0.9, 5);
  addPiece(board, PIECE_TYPES.R03, cx + UNIT * 0.9, cy + UNIT * 0.9, 6);
  addPiece(board, PIECE_TYPES.R01, cx - UNIT * 1.4, cy, 2, { flip: true });
  addPiece(board, PIECE_TYPES.R01, cx, cy - UNIT * 1.4, 0, { flip: true });
  addPiece(board, PIECE_TYPES.R01, cx, cy + UNIT * 1.4, 0);

  rebuild(board);
  return {
    trainHint: { x: cx + UNIT, y: cy },
    note: "Open catch-basin: train leaves the gap, slides on outer/inner edges, may re-rail.",
  };
}
