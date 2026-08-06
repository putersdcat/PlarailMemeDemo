/**
 * Track piece drawing (rails, connectors, webbing, levers).
 */
import {
  HALF_W,
  TRACK_W,
  UNIT,
  worldGeometry,
  worldPivot,
} from "../geometry.js";

const RAIL_BLUE = "#3a8fd6";
const SELECT = "#f0c040";

const PAINT = {
  blue: "#3a8fd6",
  green: "#3d9e5c",
  red: "#c94c4c",
  yellow: "#e0b833",
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

