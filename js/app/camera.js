/**
 * Pure camera helpers: pan, zoom, fit, playfield bounds.
 * view = { w, h, camX, camY, scale } in CSS pixels / world units.
 */

export const SCALE_MIN = 0.32;
export const SCALE_MAX = 2.75;

export function createView(w = 800, h = 600) {
  return { w, h, camX: 0, camY: 0, scale: 1 };
}

export function viewScale(view) {
  return view.scale > 0 ? view.scale : 1;
}

export function clampScale(s, min = SCALE_MIN, max = SCALE_MAX) {
  return Math.max(min, Math.min(max, s));
}

/** Screen (CSS px relative to canvas) → world. */
export function screenToWorld(view, sx, sy) {
  const s = viewScale(view);
  return {
    x: sx / s + view.camX,
    y: sy / s + view.camY,
  };
}

/** World size of the viewport. */
export function worldViewportSize(view) {
  const s = viewScale(view);
  return { w: view.w / s, h: view.h / s };
}

/**
 * Zoom keeping the world point under (sx,sy) fixed.
 * Mutates view.
 */
export function zoomAtScreen(view, sx, sy, nextScale) {
  const before = screenToWorld(view, sx, sy);
  view.scale = clampScale(nextScale);
  const after = screenToWorld(view, sx, sy);
  view.camX += before.x - after.x;
  view.camY += before.y - after.y;
  return view;
}

/** Pan by screen-pixel delta (mutates view). */
export function panByScreen(view, dSx, dSy) {
  const s = viewScale(view);
  view.camX -= dSx / s;
  view.camY -= dSy / s;
  return view;
}

/**
 * Fit + center a world rect in the canvas (sets scale + pan).
 * @param {{minX:number,minY:number,maxX:number,maxY:number}} rect
 */
export function fitWorldRect(view, rect, pad = 40) {
  if (!rect || !(view.w > 0 && view.h > 0)) return view;
  const minX = Number(rect.minX) - pad;
  const minY = Number(rect.minY) - pad;
  const maxX = Number(rect.maxX) + pad;
  const maxY = Number(rect.maxY) + pad;
  const bw = Math.max(40, maxX - minX);
  const bh = Math.max(40, maxY - minY);
  const sx = view.w / bw;
  const sy = view.h / bh;
  view.scale = clampScale(Math.min(sx, sy));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  view.camX = cx - view.w / view.scale / 2;
  view.camY = cy - view.h / view.scale / 2;
  return view;
}

/** Playfield bounds in world space (dashed edge). padScreen is CSS px. */
export function playfieldBounds(view, padScreen = 20) {
  const s = viewScale(view);
  const pad = padScreen / s;
  const { w, h } = worldViewportSize(view);
  return {
    minX: view.camX + pad,
    minY: view.camY + pad,
    maxX: view.camX + w - pad,
    maxY: view.camY + h - pad,
  };
}

/**
 * World AABB of board walls/pieces.
 * @returns {{minX:number,minY:number,maxX:number,maxY:number}|null}
 */
export function computeBoardBounds(board, unit = 96) {
  if (board?.walls?.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const w of board.walls) {
      minX = Math.min(minX, w.x1, w.x2);
      minY = Math.min(minY, w.y1, w.y2);
      maxX = Math.max(maxX, w.x1, w.x2);
      maxY = Math.max(maxY, w.y1, w.y2);
    }
    if (Number.isFinite(minX)) return { minX, minY, maxX, maxY };
  }
  if (!board?.pieces?.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const pad = unit * 0.85;
  for (const p of board.pieces) {
    minX = Math.min(minX, p.x - pad);
    minY = Math.min(minY, p.y - pad);
    maxX = Math.max(maxX, p.x + pad);
    maxY = Math.max(maxY, p.y + pad);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

export function fitBoardToView(view, board, pad = 48, unit = 96) {
  const b = computeBoardBounds(board, unit);
  if (b) fitWorldRect(view, b, pad);
  return view;
}
