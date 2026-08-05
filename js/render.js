/**
 * Canvas rendering for track, train, ghosts, HUD helpers.
 */

import {
  HALF_W,
  TRACK_W,
  UNIT,
  worldGeometry,
  worldPivot,
} from "./geometry.js";
import { worldGeoFor } from "./track.js";
import {
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  FRONT_AXLE_OFFSET,
  TrainMode,
} from "./train.js";

const RAIL_BLUE = "#3a8fd6";
const RAIL_BLUE_DARK = "#2a6fa8";
const RAIL_TIE = "#2f78b5";
const FLOOR = "#e8e4dc";
const FLOOR_LINE = "#d9d3c8";
const SELECT = "#f0c040";

export function resizeCanvas(canvas) {
  const parent = canvas.parentElement;
  const dpr = window.devicePixelRatio || 1;
  const w = parent.clientWidth;
  const h = parent.clientHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h, dpr };
}

export function drawScene(ctx, view, board, train, ghost, opts = {}) {
  const { w, h, camX, camY } = view;
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Floor
  ctx.fillStyle = FLOOR;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = FLOOR_LINE;
  ctx.lineWidth = 1;
  const grid = 48;
  const ox = -((camX % grid) + grid) % grid;
  const oy = -((camY % grid) + grid) % grid;
  ctx.beginPath();
  for (let x = ox; x < w; x += grid) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
  }
  for (let y = oy; y < h; y += grid) {
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
  }
  ctx.stroke();

  ctx.translate(-camX, -camY);

  // Soft playfield edge
  if (opts.bounds) {
    const b = opts.bounds;
    ctx.strokeStyle = "rgba(220, 80, 80, 0.35)";
    ctx.lineWidth = 3;
    ctx.setLineDash([8, 6]);
    ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    ctx.setLineDash([]);
  }

  const freeIds = new Set(
    board.connectors.filter((c) => !c.linked).map((c) => `${c.pieceId}:${c.id}`)
  );
  const multi =
    opts.selectedIds instanceof Set
      ? opts.selectedIds
      : new Set(opts.selectedIds || []);

  // Pieces (skip the one being dragged if ghost represents it)
  for (const piece of board.pieces) {
    if (opts.hidePieceId && piece.id === opts.hidePieceId) continue;
    const selected =
      multi.has(piece.id) || piece.id === board.selectedId;
    drawPiece(ctx, piece, selected, {
      freeConnectorIds: freeIds,
    });
  }

  // Debug walls
  if (opts.showWalls) {
    ctx.strokeStyle = "rgba(200, 40, 40, 0.55)";
    ctx.lineWidth = 1.5;
    for (const wseg of board.walls) {
      ctx.beginPath();
      ctx.moveTo(wseg.x1, wseg.y1);
      ctx.lineTo(wseg.x2, wseg.y2);
      ctx.stroke();
    }
  }

  // Ghost (palette place or moving piece preview)
  if (ghost) {
    ctx.globalAlpha = ghost.snapped ? 0.85 : 0.5;
    drawPiece(ctx, ghost, true, {
      highlightPorts: true,
      snapped: !!ghost.snapped,
    });
    ctx.globalAlpha = 1;
  }

  // Marquee box-select
  if (opts.marquee) {
    const m = opts.marquee;
    const x = Math.min(m.x0, m.x1);
    const y = Math.min(m.y0, m.y1);
    const rw = Math.abs(m.x1 - m.x0);
    const rh = Math.abs(m.y1 - m.y0);
    ctx.fillStyle = "rgba(58, 143, 214, 0.12)";
    ctx.strokeStyle = "rgba(58, 143, 214, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.fillRect(x, y, rw, rh);
    ctx.strokeRect(x, y, rw, rh);
    ctx.setLineDash([]);
  }

  // Train ghost while placing / dragging (piece-like)
  if (opts.trainGhost) {
    const g = opts.trainGhost;
    ctx.save();
    ctx.globalAlpha = g.onRail ? 0.95 : 0.4;
    const ang = g.ang || 0;
    const ghostTrain = {
      x: g.onRail ? g.x - Math.cos(ang) * FRONT_AXLE_OFFSET : g.x,
      y: g.onRail ? g.y - Math.sin(ang) * FRONT_AXLE_OFFSET : g.y,
      ang,
      mode: TrainMode.IDLE,
      selected: true,
    };
    drawTrain(ctx, ghostTrain);
    if (g.onRail) {
      ctx.strokeStyle = "rgba(80, 200, 120, 0.95)";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(g.x, g.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      // Direction chevron at nose
      ctx.fillStyle = "rgba(80, 200, 120, 0.9)";
      ctx.beginPath();
      const nx = Math.cos(ang);
      const ny = Math.sin(ang);
      const tipX = g.x + nx * 28;
      const tipY = g.y + ny * 28;
      ctx.moveTo(tipX, tipY);
      ctx.lineTo(tipX - nx * 12 + ny * 7, tipY - ny * 12 - nx * 7);
      ctx.lineTo(tipX - nx * 12 - ny * 7, tipY - ny * 12 + nx * 7);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  } else if (opts.trainVisible && train) {
    drawTrain(ctx, train);
  }

  ctx.restore();
}

/** Map piece.color key → fill hex (blue default). */
const PAINT = {
  blue: RAIL_BLUE,
  green: "#3d9e5c",
  red: "#c94c4c",
  gray: "#7a828c",
};

function piecePaintHex(piece) {
  const key = piece?.color && PAINT[piece.color] ? piece.color : "blue";
  return PAINT[key];
}

export function drawPiece(ctx, piece, selected = false, opts = {}) {
  const geo = worldGeometry(piece);
  const color = piecePaintHex(piece);

  // Solid body webbing (R-14 plate, R-17 leg fills) under rails
  if (geo.tpl.webbingPolys?.length) {
    drawWebbingPolys(ctx, piece, geo.tpl.webbingPolys, color);
  } else if (geo.tpl.webbing) {
    drawWebbing(ctx, piece, geo.tpl.webbing, color);
  }

  // Stop-rail bump
  if (geo.tpl.bump) {
    drawStopBump(ctx, piece, color);
  }

  // Draw each path as rail bed
  for (const path of geo.paths) {
    const active =
      path.switchIndex == null ||
      geo.tpl.bothPathsActive ||
      path.switchIndex === (piece.switchState ?? 0);
    drawRailPolyline(ctx, path.points, active, selected, color);
  }

  // Connectors — free ends slightly larger / brighter for snap targets
  for (const c of geo.connectors) {
    const free = opts.freeConnectorIds?.has?.(`${piece.id}:${c.id}`);
    drawConnector(ctx, c.wx, c.wy, c.wang, c.gender, free || opts.highlightPorts);
  }

  // Yellow levers
  if (geo.tpl.switchable) {
    const lvs = geo.levers?.length ? geo.levers : geo.lever ? [geo.lever] : [];
    for (const lv of lvs) {
      ctx.beginPath();
      ctx.fillStyle = "#f0c040";
      ctx.strokeStyle = "#a67c00";
      ctx.lineWidth = 1.5;
      ctx.arc(lv.x, lv.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (geo.lever) {
      ctx.fillStyle = "#333";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(piece.switchState ?? 0), geo.lever.x, geo.lever.y);
    }
  }

  // Selection / snap rings at the *visual* rail center (not model origin)
  const piv =
    piece.pivotX != null
      ? { x: piece.pivotX, y: piece.pivotY }
      : worldPivot(piece);

  if (selected) {
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.arc(piv.x, piv.y, 12, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (opts.snapped) {
    ctx.strokeStyle = "#5cb85c";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(piv.x, piv.y, 14, 0, Math.PI * 2);
    ctx.stroke();
  }
}

function drawRailPolyline(ctx, pts, active, selected, color = null) {
  if (pts.length < 2) return;

  const bed = color || RAIL_BLUE;
  const edge = shade(bed, -0.18);

  // Bed
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = active ? bed : withAlpha(bed, 0.28);
  ctx.lineWidth = TRACK_W;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();

  // Edge lines
  ctx.strokeStyle = active ? edge : withAlpha(edge, 0.25);
  ctx.lineWidth = 2;
  strokeOffsetPolyline(ctx, pts, HALF_W - 1);
  strokeOffsetPolyline(ctx, pts, -(HALF_W - 1));

  // Running rails
  ctx.strokeStyle = active ? "#1a4a72" : "rgba(26,74,114,0.2)";
  ctx.lineWidth = 2;
  strokeOffsetPolyline(ctx, pts, 6);
  strokeOffsetPolyline(ctx, pts, -6);

  // Center dashed
  if (active) {
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (selected) {
    ctx.strokeStyle = SELECT;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    strokeOffsetPolyline(ctx, pts, HALF_W + 3);
    strokeOffsetPolyline(ctx, pts, -(HALF_W + 3));
    ctx.setLineDash([]);
  }
}

function withAlpha(hex, a) {
  const c = hexToRgb(hex);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function shade(hex, amt) {
  const c = hexToRgb(hex);
  const f = (v) => Math.max(0, Math.min(255, Math.round(v + amt * 255)));
  return `rgb(${f(c.r)},${f(c.g)},${f(c.b)})`;
}

function strokeOffsetPolyline(ctx, pts, offset) {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    let tx, ty;
    if (i === 0) {
      tx = pts[1].x - pts[0].x;
      ty = pts[1].y - pts[0].y;
    } else if (i === pts.length - 1) {
      tx = pts[i].x - pts[i - 1].x;
      ty = pts[i].y - pts[i - 1].y;
    } else {
      tx = pts[i + 1].x - pts[i - 1].x;
      ty = pts[i + 1].y - pts[i - 1].y;
    }
    const L = Math.hypot(tx, ty) || 1;
    const nx = -ty / L;
    const ny = tx / L;
    const x = pts[i].x + nx * offset;
    const y = pts[i].y + ny * offset;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

function drawConnector(ctx, x, y, ang, gender, emphasize = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  if (emphasize) {
    ctx.beginPath();
    ctx.fillStyle = "rgba(92, 184, 92, 0.35)";
    ctx.arc(0, 0, 12, 0, Math.PI * 2);
    ctx.fill();
  }
  if (gender === "M") {
    ctx.fillStyle = emphasize ? "#7dffa0" : "#f5d76e";
    ctx.fillRect(0, -5, 9, 10);
    ctx.strokeStyle = emphasize ? "#2d8a4e" : "#a68b2c";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(0, -5, 9, 10);
  } else {
    ctx.fillStyle = emphasize ? "#5a6570" : "#5a6570";
    ctx.fillRect(-4, -6, 7, 12);
    ctx.strokeStyle = emphasize ? "#7dffa0" : "#2a3038";
    ctx.lineWidth = 1.2;
    ctx.strokeRect(-4, -6, 7, 12);
  }
  ctx.restore();
}

/**
 * Top-down white bullet / Shinkansen (matches meme freeze-frame):
 * long white body, pointed nose = front (+x), black cockpit glass, blue chin.
 */
export function drawTrain(ctx, train) {
  const { x, y, ang, mode } = train;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);

  // Slightly longer/narrower silhouette than the old “bus” body
  const L = TRAIN_LENGTH * 1.12;
  const R = TRAIN_RADIUS * 0.92;
  const nose = L * 0.52; // tip of pointed front
  const tail = -L * 0.48;

  // Selection halo
  if (train.selected) {
    ctx.strokeStyle = "rgba(240, 192, 64, 0.9)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(0, 0, L * 0.52, R + 7, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft ground shadow
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.beginPath();
  ctx.ellipse(1.5, 3.5, L * 0.46, R * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();

  // ── Bullet outline path (rear rounded, nose pointed) ──
  const bodyPath = () => {
    ctx.beginPath();
    // Start mid-left (rear top), go clockwise-ish along outline
    ctx.moveTo(tail + 6, -R);
    // roof line to windshield
    ctx.lineTo(L * 0.12, -R);
    // taper into pointed nose (top half)
    ctx.quadraticCurveTo(L * 0.28, -R * 0.95, L * 0.38, -R * 0.55);
    ctx.quadraticCurveTo(L * 0.46, -R * 0.2, nose, 0);
    // bottom half of nose
    ctx.quadraticCurveTo(L * 0.46, R * 0.2, L * 0.38, R * 0.55);
    ctx.quadraticCurveTo(L * 0.28, R * 0.95, L * 0.12, R);
    // rear underside
    ctx.lineTo(tail + 6, R);
    ctx.quadraticCurveTo(tail - 1, R * 0.7, tail - 1, 0);
    ctx.quadraticCurveTo(tail - 1, -R * 0.7, tail + 6, -R);
    ctx.closePath();
  };

  // White body fill (subtle length gradient)
  const grd = ctx.createLinearGradient(tail, 0, nose, 0);
  grd.addColorStop(0, "#eef1f4");
  grd.addColorStop(0.35, "#ffffff");
  grd.addColorStop(0.85, "#f7f9fb");
  grd.addColorStop(1, "#e8eef4");
  bodyPath();
  ctx.fillStyle = grd;
  ctx.fill();
  ctx.strokeStyle = "#c5ccd4";
  ctx.lineWidth = 1.15;
  ctx.stroke();

  // Soft top highlight (roof panel)
  ctx.save();
  bodyPath();
  ctx.clip();
  const roofG = ctx.createLinearGradient(0, -R, 0, R);
  roofG.addColorStop(0, "rgba(255,255,255,0.55)");
  roofG.addColorStop(0.45, "rgba(255,255,255,0)");
  roofG.addColorStop(1, "rgba(200,210,220,0.25)");
  ctx.fillStyle = roofG;
  ctx.fillRect(tail - 4, -R - 2, L + 12, R * 2 + 4);

  // Centre roof equipment / hatch (grey strip from photo)
  ctx.fillStyle = "rgba(170, 180, 190, 0.75)";
  roundRect(ctx, tail + 10, -2.6, L * 0.38, 5.2, 2);
  ctx.fill();
  ctx.fillStyle = "rgba(120, 130, 140, 0.55)";
  roundRect(ctx, tail + 14, -1.5, L * 0.12, 3, 1.2);
  ctx.fill();
  ctx.restore();

  // ── Blue chin / nose accent under cockpit (Shinkansen-like) ──
  ctx.fillStyle = "#2a6cb0";
  ctx.beginPath();
  ctx.moveTo(L * 0.22, R * 0.55);
  ctx.quadraticCurveTo(L * 0.36, R * 0.75, L * 0.42, R * 0.35);
  ctx.quadraticCurveTo(L * 0.48, R * 0.1, nose - 1, 0);
  ctx.quadraticCurveTo(L * 0.44, R * 0.15, L * 0.34, R * 0.62);
  ctx.quadraticCurveTo(L * 0.26, R * 0.72, L * 0.22, R * 0.55);
  ctx.closePath();
  ctx.fill();
  // thin blue edge line on both sides near nose
  ctx.strokeStyle = "#3a7ec4";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(L * 0.18, -R * 0.75);
  ctx.quadraticCurveTo(L * 0.32, -R * 0.9, L * 0.4, -R * 0.35);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(L * 0.18, R * 0.75);
  ctx.quadraticCurveTo(L * 0.32, R * 0.9, L * 0.4, R * 0.35);
  ctx.stroke();

  // ── Black cockpit windshield (signature of the freeze-frame) ──
  ctx.fillStyle = "#1a1e24";
  ctx.beginPath();
  // Trapezoid / rounded diamond glass on the sloping nose
  ctx.moveTo(L * 0.16, -R * 0.42);
  ctx.lineTo(L * 0.3, -R * 0.5);
  ctx.quadraticCurveTo(L * 0.38, -R * 0.15, L * 0.4, 0);
  ctx.quadraticCurveTo(L * 0.38, R * 0.15, L * 0.3, R * 0.5);
  ctx.lineTo(L * 0.16, R * 0.42);
  ctx.quadraticCurveTo(L * 0.14, 0, L * 0.16, -R * 0.42);
  ctx.closePath();
  ctx.fill();
  // glass sheen
  const glassG = ctx.createLinearGradient(L * 0.18, -R * 0.3, L * 0.36, R * 0.3);
  glassG.addColorStop(0, "rgba(90, 140, 180, 0.35)");
  glassG.addColorStop(0.5, "rgba(40, 50, 60, 0.1)");
  glassG.addColorStop(1, "rgba(20, 25, 30, 0.4)");
  ctx.fillStyle = glassG;
  ctx.fill();
  ctx.strokeStyle = "rgba(30, 40, 50, 0.85)";
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Tiny headlights on the pointed tip
  ctx.fillStyle = "#f0f4f8";
  ctx.beginPath();
  ctx.arc(nose - 3.5, -2.2, 1.3, 0, Math.PI * 2);
  ctx.arc(nose - 3.5, 2.2, 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 230, 120, 0.85)";
  ctx.beginPath();
  ctx.arc(nose - 3.2, -2.2, 0.7, 0, Math.PI * 2);
  ctx.arc(nose - 3.2, 2.2, 0.7, 0, Math.PI * 2);
  ctx.fill();

  // Subtle passenger window row (side, top-down = thin dark ovals)
  ctx.fillStyle = "rgba(55, 70, 85, 0.35)";
  for (let i = 0; i < 4; i++) {
    const wx = tail + 12 + i * 7.5;
    ctx.beginPath();
    ctx.ellipse(wx, -R * 0.55, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(wx, R * 0.55, 2.4, 1.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mode ring (status)
  if (mode === TrainMode.OFF_RAIL) {
    ctx.strokeStyle = "rgba(230,162,60,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
    ctx.stroke();
  } else if (mode === TrainMode.STOPPED) {
    ctx.strokeStyle = "rgba(226,85,85,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R + 7, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();
}

function transformLocal(lx, ly, piece) {
  const a = (piece.rotSteps * Math.PI) / 4;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: piece.x + lx * c - ly * s, y: piece.y + lx * s + ly * c };
}

function drawWebbing(ctx, piece, webs, color = RAIL_BLUE) {
  ctx.fillStyle = withAlpha(color, 0.55);
  ctx.strokeStyle = withAlpha(shade(color, -0.25), 0.5);
  ctx.lineWidth = 1;
  for (const w of webs) {
    const n = 12;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const la = w.a0 + (w.a1 - w.a0) * t;
      const lx = w.cx + w.r * Math.cos(la);
      const ly = w.cy + w.r * Math.sin(la);
      const p = transformLocal(lx, ly, piece);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    const corner = transformLocal(w.cx, w.cy, piece);
    ctx.lineTo(corner.x, corner.y);
    ctx.closePath();
    ctx.fill();
  }
}

function drawWebbingPolys(ctx, piece, polys, color = RAIL_BLUE) {
  ctx.fillStyle = withAlpha(color, 0.9);
  ctx.strokeStyle = withAlpha(shade(color, -0.22), 0.7);
  ctx.lineWidth = 1.25;
  for (const poly of polys) {
    if (!poly?.length) continue;
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      const p = transformLocal(poly[i].x, poly[i].y, piece);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function drawStopBump(ctx, piece, color = RAIL_BLUE) {
  // R-08 stop bump on +Y of a 1-unit straight
  const len = UNIT;
  const bx0 = -len * 0.22;
  const bx1 = len * 0.22;
  const by0 = HALF_W * 0.9;
  const by1 = HALF_W + 18;
  const corners = [
    { x: bx0, y: by0 },
    { x: bx0, y: by1 },
    { x: bx1, y: by1 },
    { x: bx1, y: by0 },
  ].map((p) => transformLocal(p.x, p.y, piece));
  ctx.fillStyle = withAlpha(color, 0.85);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i].x, corners[i].y);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = withAlpha(shade(color, -0.25), 0.5);
  ctx.stroke();
}

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Tiny palette preview. */
export function drawPaletteIcon(canvas, type) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "#1e2229";
  ctx.fillRect(0, 0, w, h);

  const piece = {
    id: "icon",
    type,
    x: 0,
    y: 0,
    rotSteps: 0,
    flip: false,
    branchSide: "R",
    switchState: 0,
  };

  const scale =
    type === "R04"
      ? 0.14
      : type === "R10" || type === "R21" || type === "R105"
        ? 0.16
        : type === "R07" || type === "R23"
          ? 0.16
          : type === "R17" ||
              type === "R12" ||
              type === "R13" ||
              type === "R14" ||
              type === "R11" ||
              type === "R22"
            ? 0.18
            : type === "R20"
              ? 0.4
              : 0.28;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.scale(scale, scale);
  if (
    type === "R04" ||
    type === "R03" ||
    type === "R105" ||
    type === "R21" ||
    type === "R10"
  ) {
    ctx.translate(
      -UNIT *
        (type === "R04"
          ? 0.9
          : type === "R105" || type === "R21" || type === "R10"
            ? 0.7
            : 0.55),
      0
    );
  }
  drawPiece(ctx, piece, false);
  ctx.restore();
}
