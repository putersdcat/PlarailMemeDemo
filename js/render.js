/**
 * Canvas rendering for track, train, ghosts, HUD helpers.
 */

import { UNIT } from "./geometry.js";
import { FRONT_AXLE_OFFSET, TrainMode } from "./train.js";
import { drawTrain, drawPaletteTrainIcon } from "./render/draw-train.js";
export { drawTrain, drawPaletteTrainIcon } from "./render/draw-train.js";
import { drawPiece } from "./render/draw-piece.js";
export { drawPiece } from "./render/draw-piece.js";

const FLOOR = "#e8e4dc";
const FLOOR_LINE = "#d9d3c8";
/** Solid playfield “wood” — blond/light brown, a few shades darker than floor */
const WOOD = "#c9a66b";
const WOOD_EDGE = "#b08d52";

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
  const scale = view.scale > 0 ? view.scale : 1;
  const solidPlayfield = !!(opts.solidPlayfield && opts.bounds);
  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // Outside playfield: wood when solid walls on; otherwise full floor
  ctx.fillStyle = solidPlayfield ? WOOD : FLOOR;
  ctx.fillRect(0, 0, w, h);

  // World transform: zoom then pan
  ctx.scale(scale, scale);
  ctx.translate(-camX, -camY);

  const worldW = w / scale;
  const worldH = h / scale;
  const grid = 48;

  // Inner playfield floor + grid
  if (opts.bounds) {
    const b = opts.bounds;
    const bw = b.maxX - b.minX;
    const bh = b.maxY - b.minY;
    if (solidPlayfield) {
      ctx.fillStyle = FLOOR;
      ctx.fillRect(b.minX, b.minY, bw, bh);
    }
    ctx.save();
    if (solidPlayfield) {
      ctx.beginPath();
      ctx.rect(b.minX, b.minY, bw, bh);
      ctx.clip();
    }
    ctx.strokeStyle = FLOOR_LINE;
    ctx.lineWidth = 1 / scale;
    const x0 = Math.floor(b.minX / grid) * grid;
    const y0 = Math.floor(b.minY / grid) * grid;
    const x1 = solidPlayfield ? b.maxX : camX + worldW;
    const y1 = solidPlayfield ? b.maxY : camY + worldH;
    const gx0 = solidPlayfield ? x0 : Math.floor(camX / grid) * grid;
    const gy0 = solidPlayfield ? y0 : Math.floor(camY / grid) * grid;
    ctx.beginPath();
    for (let x = gx0; x < x1 + grid; x += grid) {
      ctx.moveTo(x, solidPlayfield ? b.minY : camY);
      ctx.lineTo(x, solidPlayfield ? b.maxY : camY + worldH);
    }
    for (let y = gy0; y < y1 + grid; y += grid) {
      ctx.moveTo(solidPlayfield ? b.minX : camX, y);
      ctx.lineTo(solidPlayfield ? b.maxX : camX + worldW, y);
    }
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.strokeStyle = FLOOR_LINE;
    ctx.lineWidth = 1 / scale;
    const x0 = Math.floor(camX / grid) * grid;
    const y0 = Math.floor(camY / grid) * grid;
    ctx.beginPath();
    for (let x = x0; x < camX + worldW + grid; x += grid) {
      ctx.moveTo(x, camY);
      ctx.lineTo(x, camY + worldH);
    }
    for (let y = y0; y < camY + worldH + grid; y += grid) {
      ctx.moveTo(camX, y);
      ctx.lineTo(camX + worldW, y);
    }
    ctx.stroke();
  }

  // Playfield edge: solid wood rim, or soft dashed red danger line
  if (opts.bounds) {
    const b = opts.bounds;
    if (solidPlayfield) {
      ctx.strokeStyle = WOOD_EDGE;
      ctx.lineWidth = 10 / scale;
      ctx.lineJoin = "round";
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.strokeStyle = WOOD;
      ctx.lineWidth = 4 / scale;
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
    } else {
      ctx.strokeStyle = "rgba(220, 80, 80, 0.35)";
      ctx.lineWidth = 3 / scale;
      ctx.setLineDash([8 / scale, 6 / scale]);
      ctx.strokeRect(b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
      ctx.setLineDash([]);
    }
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

