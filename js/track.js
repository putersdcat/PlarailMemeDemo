/**
 * Track board: placement, snap, connectivity graph, wall cache.
 */

import {
  SNAP_DIST,
  SNAP_ANGLE,
  angleDiff,
  normalizeAngle,
  rotStepsToRad,
  buildTemplate,
  worldGeometry,
  worldPivot,
  rotateAroundVisualPivot,
  flipAroundVisualPivot,
  mirrorAroundVisualPivot,
  localPivotForPiece,
  rotatePoint,
  normalizePieceType,
  isMirrorable,
} from "./geometry.js";

let nextId = 1;

export function createBoard() {
  return {
    pieces: [],
    selectedId: null,
    graph: null,
    walls: [],
    pathIndex: [],
    connectors: [],
  };
}

export function addPiece(board, type, x, y, rotSteps = 0, opts = {}) {
  const piece = {
    id: `p${nextId++}`,
    type: normalizePieceType(type),
    x,
    y,
    rotSteps: ((rotSteps % 8) + 8) % 8,
    flip: !!opts.flip,
    branchSide: opts.branchSide || "R",
    switchState: opts.switchState ?? 0,
  };
  const tpl = buildTemplate(type, piece);
  if (tpl.defaultSwitch != null && opts.switchState == null) {
    piece.switchState = tpl.defaultSwitch;
  }
  board.pieces.push(piece);
  rebuild(board);
  return piece;
}

export function removePiece(board, id) {
  board.pieces = board.pieces.filter((p) => p.id !== id);
  if (board.selectedId === id) board.selectedId = null;
  rebuild(board);
}

export function clearBoard(board) {
  board.pieces = [];
  board.selectedId = null;
  rebuild(board);
}

/** Serialize board to a plain JSON-friendly object (native layout format). */
export function serializeBoard(board) {
  return {
    format: "plarail-meme-layout",
    version: 1,
    pieces: board.pieces.map((p) => ({
      id: p.id,
      type: p.type,
      x: p.x,
      y: p.y,
      rotSteps: p.rotSteps,
      flip: !!p.flip,
      branchSide: p.branchSide || "R",
      switchState: p.switchState ?? 0,
    })),
  };
}

/**
 * Load pieces from a serialized layout. Replaces current board contents.
 * Returns { ok, error?, pieceCount }.
 */
export function loadBoard(board, data) {
  if (!data || typeof data !== "object") {
    return { ok: false, error: "Invalid layout file." };
  }
  const list = Array.isArray(data.pieces)
    ? data.pieces
    : Array.isArray(data)
      ? data
      : null;
  if (!list) {
    return { ok: false, error: "Layout file has no pieces array." };
  }

  clearBoard(board);
  let maxN = 0;
  for (const raw of list) {
    if (!raw || !raw.type) continue;
    const piece = addPiece(
      board,
      normalizePieceType(raw.type),
      Number(raw.x) || 0,
      Number(raw.y) || 0,
      Number(raw.rotSteps) || 0,
      {
        flip: !!raw.flip,
        branchSide: raw.branchSide || "R",
        switchState: raw.switchState ?? 0,
      }
    );
    if (raw.id && typeof raw.id === "string") {
      // Keep generated id; optional restore not required for play
    }
    const m = /^p(\d+)$/.exec(piece.id);
    if (m) maxN = Math.max(maxN, Number(m[1]));
  }
  if (maxN > 0) {
    // nextId is module-private; bump via addPiece already incremented
  }
  rebuild(board);
  return { ok: true, pieceCount: board.pieces.length };
}

export function getPiece(board, id) {
  return board.pieces.find((p) => p.id === id);
}

export function rotatePiece(board, id, delta = 1) {
  const p = getPiece(board, id);
  if (!p) return;
  // Spin around the visible rail center, not the model origin (curve focus, etc.)
  rotateAroundVisualPivot(p, delta);
  rebuild(board);
}

export function flipPiece(board, id) {
  const p = getPiece(board, id);
  if (!p) return;
  flipAroundVisualPivot(p);
  rebuild(board);
}

/** Geometric L/R (or A/B) mirror — toggles branchSide. */
export function mirrorPiece(board, id) {
  const p = getPiece(board, id);
  if (!p) return;
  if (!isMirrorable(p.type)) return false;
  mirrorAroundVisualPivot(p);
  rebuild(board);
  return true;
}

export function toggleSwitch(board, id) {
  const p = getPiece(board, id);
  if (!p) return;
  const geo = worldGeometry(p);
  if (!geo.tpl.switchable) return;
  const max = geo.tpl.switchCount || 2;
  p.switchState = (p.switchState + 1) % max;
  rebuild(board);
}

export function movePiece(board, id, x, y) {
  const p = getPiece(board, id);
  if (!p) return;
  p.x = x;
  p.y = y;
  rebuild(board);
}

export function setPiecePose(board, id, x, y, rotSteps) {
  const p = getPiece(board, id);
  if (!p) return;
  p.x = x;
  p.y = y;
  if (rotSteps != null) p.rotSteps = ((rotSteps % 8) + 8) % 8;
  rebuild(board);
}

/** Rebuild world caches + connectivity. */
export function rebuild(board) {
  const connectors = [];
  const walls = [];
  const pathIndex = [];

  for (const piece of board.pieces) {
    const geo = worldGeometry(piece);
    for (const c of geo.connectors) connectors.push(c);
    for (const w of geo.walls) walls.push(w);
    for (const path of geo.paths) {
      // Filter inactive switch paths
      if (
        path.switchIndex != null &&
        !geo.tpl.bothPathsActive &&
        path.switchIndex !== piece.switchState
      ) {
        // Still index for drawing faint routes; mark inactive
        pathIndex.push({ ...path, active: false, piece });
        continue;
      }
      pathIndex.push({ ...path, active: true, piece });
    }
  }

  // Pair connectors (slightly forgiving so train graph stays continuous)
  const LINK_DIST = SNAP_DIST * 1.15;
  const LINK_FACE = SNAP_ANGLE * 1.85;
  const used = new Set();
  const pairs = [];
  for (let i = 0; i < connectors.length; i++) {
    if (used.has(i)) continue;
    let best = null;
    let bestD = LINK_DIST;
    for (let j = i + 1; j < connectors.length; j++) {
      if (used.has(j)) continue;
      const a = connectors[i];
      const b = connectors[j];
      if (a.pieceId === b.pieceId) continue;
      if (a.gender === b.gender) continue;
      const d = Math.hypot(a.wx - b.wx, a.wy - b.wy);
      if (d > bestD) continue;
      // Should face each other (~180°)
      const face = angleDiff(a.wang, b.wang + Math.PI);
      if (face > LINK_FACE) continue;
      bestD = d;
      best = j;
    }
    if (best != null) {
      used.add(i);
      used.add(best);
      pairs.push([connectors[i], connectors[best]]);
      connectors[i].linked = connectors[best];
      connectors[best].linked = connectors[i];
    }
  }

  board.connectors = connectors;
  board.walls = walls;
  board.pathIndex = pathIndex;
  board.graph = buildGraph(pathIndex, pairs, board);
}

function connKey(pieceId, cid) {
  return `${pieceId}:${cid}`;
}

function buildGraph(pathIndex, pairs, board) {
  // Nodes = connectors. Edges = paths (bidirectional) + pair links.
  const nodes = new Map();
  const ensure = (pieceId, cid, wx, wy, wang) => {
    const k = connKey(pieceId, cid);
    if (!nodes.has(k)) nodes.set(k, { key: k, pieceId, cid, wx, wy, wang, edges: [] });
    return nodes.get(k);
  };

  for (const path of pathIndex) {
    if (!path.active) continue;
    const pcs = board.pieces.find((p) => p.id === path.pieceId);
    const geo = worldGeometry(pcs);
    const ca = geo.connectors.find((c) => c.id === path.fromC);
    const cb = geo.connectors.find((c) => c.id === path.toC);
    if (!ca || !cb) continue;
    const na = ensure(path.pieceId, path.fromC, ca.wx, ca.wy, ca.wang);
    const nb = ensure(path.pieceId, path.toC, cb.wx, cb.wy, cb.wang);
    const edge = {
      pathId: `${path.pieceId}:${path.id}`,
      path,
      a: na.key,
      b: nb.key,
      length: path.length,
    };
    na.edges.push({ ...edge, to: nb.key, reverse: false });
    nb.edges.push({ ...edge, to: na.key, reverse: true });
  }

  // Zero-length link across connected pieces
  for (const [a, b] of pairs) {
    const na = ensure(a.pieceId, a.id, a.wx, a.wy, a.wang);
    const nb = ensure(b.pieceId, b.id, b.wx, b.wy, b.wang);
    const edge = {
      pathId: `link:${na.key}|${nb.key}`,
      path: null,
      link: true,
      a: na.key,
      b: nb.key,
      length: 0,
    };
    na.edges.push({ ...edge, to: nb.key, reverse: false });
    nb.edges.push({ ...edge, to: na.key, reverse: true });
  }

  return { nodes, pairs };
}

/**
 * Magnetic snap — translate only to join open ends.
 * - NO auto-rotate (uses ghost.rotSteps only)
 * - NO auto-flip (uses ghost.flip only)
 * - Medium magnet (~SNAP_DIST 38)
 * Prefers the free port pair whose ends are already closest.
 */
export function findSnap(board, ghost, magnetDist = SNAP_DIST) {
  let best = null;
  let bestScore = Infinity;

  const freeBoard = board.connectors.filter(
    (c) => !c.linked && c.pieceId !== ghost.id
  );
  if (freeBoard.length === 0) return null;

  const curPivot =
    ghost.pivotX != null && ghost.pivotY != null
      ? { x: ghost.pivotX, y: ghost.pivotY }
      : worldPivot(ghost);

  const flip = !!ghost.flip;
  const rotSteps = ((ghost.rotSteps % 8) + 8) % 8;
  const rotAng = rotStepsToRad(rotSteps);

  const tpl = buildTemplate(ghost.type, {
    flip,
    branchSide: ghost.branchSide || "R",
  });
  const localPiv = localPivotForPiece({
    type: ghost.type,
    flip,
    branchSide: ghost.branchSide || "R",
  });

  for (const local of tpl.connectors) {
    for (const bc of freeBoard) {
      if (local.gender === bc.gender) continue;

      // Keep current rotation — only accept if already facing (within tolerance)
      const outAng = normalizeAngle(local.ang + rotAng);
      const faceErr = angleDiff(outAng, bc.wang + Math.PI);
      if (faceErr > SNAP_ANGLE) continue;

      const rLoc = rotatePoint(local.x, local.y, rotAng);
      const ox = bc.wx - rLoc.x;
      const oy = bc.wy - rLoc.y;

      // Current end distance (before snap) — magnet gate
      const endDist = Math.hypot(
        ghost.x + rLoc.x - bc.wx,
        ghost.y + rLoc.y - bc.wy
      );
      if (endDist > magnetDist) continue;

      const verify = {
        type: ghost.type,
        x: ox,
        y: oy,
        rotSteps,
        flip,
        branchSide: ghost.branchSide || "R",
      };
      const vGeo = worldGeometry(verify);
      const vc = vGeo.connectors.find((c) => c.id === local.id);
      if (!vc) continue;
      const alignErr = Math.hypot(vc.wx - bc.wx, vc.wy - bc.wy);
      if (alignErr > 0.75) continue;

      const rPiv = rotatePoint(localPiv.x, localPiv.y, rotAng);
      const pivX = ox + rPiv.x;
      const pivY = oy + rPiv.y;
      const pivotJump = Math.hypot(pivX - curPivot.x, pivY - curPivot.y);

      // Prefer nearer ends; small penalty for large visual jumps
      const score = endDist * 0.7 + pivotJump * 0.25 + faceErr * 8;

      if (score < bestScore) {
        bestScore = score;
        best = {
          x: ox,
          y: oy,
          rotSteps,
          flip,
          snapped: true,
          to: bc,
          localId: local.id,
          pivotX: pivX,
          pivotY: pivY,
        };
      }
    }
  }

  return best;
}

/**
 * Magnetic snap for a multi-selection moved as a rigid group.
 * Translates the whole group (same dx, dy) so a free end on the selection
 * mates with a free end outside it. Internal joints (selected↔selected)
 * are ignored — they stay locked by the rigid move.
 *
 * Returns { dx, dy, dist, from, to } or null.
 */
export function findGroupSnap(board, selectedIds, magnetDist = SNAP_DIST) {
  const idSet =
    selectedIds instanceof Set ? selectedIds : new Set(selectedIds || []);
  if (idSet.size === 0) return null;

  const groupPorts = [];
  const outsidePorts = [];

  for (const piece of board.pieces) {
    const geo = worldGeometry(piece);
    const inGroup = idSet.has(piece.id);
    for (const c of geo.connectors) {
      if (inGroup) {
        // Internal joints (selected↔selected) stay locked by rigid move — skip.
        // Only free ports on the selection can magnet to the outside.
        if (c.linked) continue;
        groupPorts.push(c);
      } else {
        // Mate only with free ends outside the selection
        if (c.linked) continue;
        outsidePorts.push(c);
      }
    }
  }

  if (!groupPorts.length || !outsidePorts.length) return null;

  let best = null;
  let bestScore = Infinity;

  for (const g of groupPorts) {
    for (const o of outsidePorts) {
      if (g.gender === o.gender) continue;

      const faceErr = angleDiff(g.wang, o.wang + Math.PI);
      if (faceErr > SNAP_ANGLE) continue;

      const dx = o.wx - g.wx;
      const dy = o.wy - g.wy;
      const dist = Math.hypot(dx, dy);
      if (dist > magnetDist) continue;
      // Already aligned — no extra nudge needed
      if (dist < 0.6) continue;

      // Prefer closest free ends; mild face penalty
      const score = dist * 0.75 + faceErr * 10;
      if (score < bestScore) {
        bestScore = score;
        best = {
          dx,
          dy,
          dist,
          snapped: true,
          from: { pieceId: g.pieceId, id: g.id },
          to: { pieceId: o.pieceId, id: o.id },
        };
      }
    }
  }

  return best;
}

/**
 * Free connectors near a world point (for snap glow hints).
 */
export function nearbyFreeConnectors(board, x, y, radius = SNAP_DIST) {
  return board.connectors.filter(
    (c) => !c.linked && Math.hypot(c.wx - x, c.wy - y) < radius
  );
}

/** Hit-test piece under point (path proximity + levers). */
export function hitTestPiece(board, x, y) {
  // Levers first (R-14 has four)
  for (const piece of board.pieces) {
    const geo = worldGeometry(piece);
    const lvs = geo.levers?.length ? geo.levers : geo.lever ? [geo.lever] : [];
    for (const lv of lvs) {
      const d = Math.hypot(lv.x - x, lv.y - y);
      if (d < 16) return { pieceId: piece.id, lever: true };
    }
  }

  let best = null;
  let bestD = 36;
  for (const path of board.pathIndex) {
    const pts = path.points;
    for (let i = 1; i < pts.length; i++) {
      const res = distToSeg(x, y, pts[i - 1], pts[i]);
      if (res.d < bestD) {
        bestD = res.d;
        best = path.pieceId;
      }
    }
  }
  return best ? { pieceId: best, lever: false } : null;
}

/**
 * Closest active path sample to a point (for placing train / re-rail / hop).
 * maxDist defaults to 48 so placement is forgiving.
 */
export function closestPathPoint(board, x, y, maxDist = 48) {
  let best = null;
  let bestD = maxDist;
  for (const path of board.pathIndex) {
    if (!path.active) continue;
    const pts = path.points;
    if (!pts || pts.length < 2) continue;
    for (let i = 1; i < pts.length; i++) {
      const res = distToSeg(x, y, pts[i - 1], pts[i]);
      if (res.d < bestD) {
        bestD = res.d;
        let along = 0;
        for (let k = 1; k < i; k++) {
          along += Math.hypot(
            pts[k].x - pts[k - 1].x,
            pts[k].y - pts[k - 1].y
          );
        }
        along +=
          res.t *
          Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        const s = path.length > 0 ? along / path.length : 0;
        best = {
          path,
          s: Math.max(0, Math.min(1, s)),
          x: res.x,
          y: res.y,
          ang: Math.atan2(
            pts[i].y - pts[i - 1].y,
            pts[i].x - pts[i - 1].x
          ),
          dist: res.d,
        };
      }
    }
  }
  return best;
}

function distToSeg(px, py, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L2 = dx * dx + dy * dy || 1;
  let t = ((px - a.x) * dx + (py - a.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return { d: Math.hypot(px - x, py - y), t, x, y };
}

export function worldGeoFor(piece) {
  return worldGeometry(piece);
}
