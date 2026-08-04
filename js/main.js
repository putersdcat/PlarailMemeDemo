/**
 * Plarail meme-layout simulation — UI wiring & main loop.
 *
 * Controls:
 *   LEFT drag   — drag pieces from palette / move pieces on board (magnetic snap)
 *   LEFT click  — select piece; with palette tool active, place piece
 *   RIGHT click — place train on rail / toggle switch lever / rotate piece
 *   R / F       — rotate / flip selected or ghost
 *   Delete      — remove selected
 *   Space       — start/stop
 */

import {
  PIECE_META,
  UNIT,
  SNAP_DIST,
  worldPivot,
  originFromWorldPivot,
  isMirrorable,
} from "./geometry.js";
import {
  createBoard,
  addPiece,
  removePiece,
  clearBoard,
  rotatePiece,
  flipPiece,
  mirrorPiece,
  toggleSwitch,
  findSnap,
  hitTestPiece,
  closestPathPoint,
  getPiece,
  rebuild,
  serializeBoard,
  loadBoard,
} from "./track.js";
import {
  createTrain,
  placeTrainOnPath,
  startTrain,
  stopTrain,
  resetTrainHard,
  updateTrain,
  modeLabel,
  TrainMode,
} from "./train.js";
import { resizeCanvas, drawScene, drawPaletteIcon } from "./render.js";
import { loadMemeStyle, loadRealMemeTrack } from "./presets.js";

const canvas = document.getElementById("stage");
const badgeEl = document.getElementById("mode-badge");
const statusEl = document.getElementById("status-text");
const hintEl = document.getElementById("hint");
const btnStart = document.getElementById("btn-start");
const btnStop = document.getElementById("btn-stop");
const btnResetTrain = document.getElementById("btn-reset-train");
const speedSlider = document.getElementById("speed");

const board = createBoard();
const train = createTrain();
let trainPlaced = false;

let view = { w: 800, h: 600, camX: 0, camY: 0 };
let bounds = { minX: 40, minY: 40, maxX: 760, maxY: 560 };

let running = false;
/** @type {null | object} ghost piece pose while placing/moving */
let ghost = null;
/** @type {null | object} active pointer gesture */
let drag = null;
/** Selected palette type for click-to-place (null = none) */
let paletteTool = null;
/** When true, next left-drag places / moves the train */
let trainTool = false;
/** Multi-select set (ids). board.selectedId is primary for single-ops. */
let selectedIds = new Set();
/** Marquee rect in world space while box-selecting (or null). */
let marquee = null;
/** Train ghost while dragging train tool (world xy). */
let trainGhost = null;
let showWalls = false;
let lastT = performance.now();
let hidePieceId = null;
const LS_KEY = "plarail-real2sim-layout-v1";

// ── Palette (catalog order; HTML may be sparse — we build buttons in JS) ──
const paletteOrder = [
  "R01",
  "R02",
  "R03",
  "R04",
  "R07",
  "R08",
  "R10",
  "R105",
  "R11",
  "R12",
  "R13",
  "R14",
  "R17",
  "R20",
  "R21",
  "R22",
  "R23",
];

const paletteEl = document.getElementById("palette");

function refreshPaletteActive() {
  document.querySelectorAll(".piece-btn").forEach((btn) => {
    if (btn.dataset.tool === "train") {
      btn.classList.toggle("active", trainTool);
    } else {
      btn.classList.toggle("active", btn.dataset.type === paletteTool && !trainTool);
    }
  });
}

function setSelection(ids) {
  selectedIds = new Set(ids);
  board.selectedId = ids[0] || null;
}

function clearSelection() {
  selectedIds.clear();
  board.selectedId = null;
}

function ensurePaletteButtons() {
  paletteEl.innerHTML = "";

  // ── Train asset (drag onto rails) ──
  {
    const btn = document.createElement("button");
    btn.className = "piece-btn train-btn";
    btn.type = "button";
    btn.dataset.tool = "train";
    btn.innerHTML = `
      <div class="train-icon" aria-hidden="true">🚂</div>
      <div class="meta">
        <strong>Train</strong>
        <span>Drag onto a rail · Start / Stop</span>
      </div>`;
    btn.addEventListener("click", (e) => {
      if (drag?.kind === "train" || drag?.suppressClick) return;
      trainTool = !trainTool;
      if (trainTool) paletteTool = null;
      refreshPaletteActive();
      setHint(
        trainTool
          ? "Train tool: left-drag onto a rail (or click a path). Start runs it."
          : "Train tool off."
      );
    });
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      trainTool = true;
      paletteTool = null;
      refreshPaletteActive();
      beginTrainDrag(e);
    });
    paletteEl.appendChild(btn);
  }

  for (const type of paletteOrder) {
    const meta = PIECE_META[type];
    if (!meta) continue;
    const btn = document.createElement("button");
    btn.className = "piece-btn";
    btn.type = "button";
    btn.dataset.type = type;
    btn.innerHTML = `
      <canvas width="72" height="52"></canvas>
      <div class="meta">
        <strong>${meta.code} ${meta.name}</strong>
        <span>${meta.desc}</span>
      </div>`;
    const c = btn.querySelector("canvas");
    c.width = 72;
    c.height = 52;
    drawPaletteIcon(c, type);

    btn.addEventListener("click", (e) => {
      if (drag?.kind === "palette" || drag?.suppressClick) return;
      trainTool = false;
      paletteTool = paletteTool === type ? null : type;
      refreshPaletteActive();
      setHint(
        paletteTool
          ? `Selected: ${meta.code} ${meta.name}. Left-drag to place · 🦄 gender · ⇋ L/R · box-drag empty to multi-select.`
          : "Palette selection cleared."
      );
    });
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      trainTool = false;
      paletteTool = type;
      refreshPaletteActive();
      beginPaletteDrag(type, e);
    });
    paletteEl.appendChild(btn);
  }
}
ensurePaletteButtons();

// ── Toolbar buttons ──
document.getElementById("btn-rotate").addEventListener("click", () => {
  if (ghost) {
    rotateGhost(1);
  } else {
    for (const id of selectedIds.size ? selectedIds : [board.selectedId]) {
      if (id) rotatePiece(board, id, 1);
    }
    persistLayout();
  }
});
document.getElementById("btn-flip").addEventListener("click", () => {
  if (ghost) {
    flipGhost();
  } else {
    for (const id of selectedIds.size ? selectedIds : [board.selectedId]) {
      if (id) flipPiece(board, id);
    }
    persistLayout();
  }
});
document.getElementById("btn-mirror").addEventListener("click", () => {
  if (ghost) {
    mirrorGhost();
  } else {
    let n = 0;
    for (const id of selectedIds.size ? selectedIds : [board.selectedId]) {
      if (!id) continue;
      const p = getPiece(board, id);
      if (p && isMirrorable(p.type) && mirrorPiece(board, id)) n++;
    }
    if (!n) setHint("No L/R variant in selection.");
    else setHint(`Mirrored ${n} piece(s).`);
    persistLayout();
  }
});
document.getElementById("btn-delete").addEventListener("click", () => {
  const ids = selectedIds.size
    ? [...selectedIds]
    : board.selectedId
      ? [board.selectedId]
      : [];
  for (const id of ids) removePiece(board, id);
  clearSelection();
  persistLayout();
  setHint(ids.length ? `Deleted ${ids.length} piece(s).` : "Nothing selected.");
});
document.getElementById("btn-clear").addEventListener("click", () => {
  clearBoard(board);
  resetTrainHard(train);
  trainPlaced = false;
  running = false;
  ghost = null;
  drag = null;
  hidePieceId = null;
  clearSelection();
  marquee = null;
  trainGhost = null;
  try {
    localStorage.removeItem(LS_KEY);
  } catch {
    /* ignore */
  }
  setHint("Board cleared.");
});
document.getElementById("btn-meme").addEventListener("click", () => {
  const info = loadRealMemeTrack(board);
  clearSelection();
  placeTrainAtHint(info.trainHint);
  persistLayout();
  setHint(info.note || "Meme track loaded.");
});
document.getElementById("btn-help").addEventListener("click", () => {
  document.getElementById("help-modal").classList.add("open");
});
document.getElementById("btn-help-close").addEventListener("click", () => {
  document.getElementById("help-modal").classList.remove("open");
});
document.getElementById("help-modal").addEventListener("click", (e) => {
  if (e.target.id === "help-modal") e.target.classList.remove("open");
});
document.getElementById("btn-walls").addEventListener("click", () => {
  showWalls = !showWalls;
});

// ── Save / Load layout JSON ──
document.getElementById("btn-save").addEventListener("click", () => {
  saveLayoutToFile();
});
document.getElementById("btn-load").addEventListener("click", () => {
  document.getElementById("file-load").click();
});
document.getElementById("file-load").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    applyLoadedLayout(data, file.name);
  } catch (err) {
    setHint(`Load failed: ${err.message || err}`);
  }
});

function buildSavePayload() {
  const payload = serializeBoard(board);
  if (trainPlaced) {
    payload.train = {
      x: train.x,
      y: train.y,
      ang: train.ang,
      mode: train.mode,
    };
  }
  payload.savedAt = new Date().toISOString();
  return payload;
}

function persistLayout() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(buildSavePayload()));
  } catch (err) {
    console.warn("localStorage save failed", err);
  }
}

function applyLoadedLayout(data, label = "layout") {
  const result = loadBoard(board, data);
  if (!result.ok) {
    setHint(result.error || "Could not load layout.");
    return false;
  }
  running = false;
  resetTrainHard(train);
  trainPlaced = false;
  clearSelection();
  if (data.train && data.train.x != null) {
    tryPlaceTrainAt(data.train.x, data.train.y);
  } else {
    // Auto-seat train on a sensible path so Start works immediately
    placeTrainAtHint({ x: 521, y: 366 });
  }
  persistLayout();
  setHint(`Loaded ${result.pieceCount} pieces from ${label}.`);
  updateStatus();
  return true;
}

/**
 * Save always uses a real browser download + localStorage.
 * (showSaveFilePicker was leaving a stuck file dialog and losing saves.)
 */
function saveLayoutToFile() {
  try {
    const payload = buildSavePayload();
    const json = JSON.stringify(payload, null, 2);
    const defaultName = `plarail-layout-${dateStamp()}.json`;
    persistLayout();
    downloadJsonFile(json, defaultName);
    setHint(
      `Saved ${board.pieces.length} pieces → Downloads/${defaultName} (+ browser autosave).`
    );
  } catch (err) {
    console.error("Save failed:", err);
    setHint(`Save failed: ${err?.message || err}`);
  }
}

/** Reliable blob download (must attach <a> for some browsers). */
function downloadJsonFile(json, filename) {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

function tryPlaceTrainAt(x, y, maxDist = 48) {
  const hit = closestPathPoint(board, x, y);
  if (hit && hit.dist <= maxDist) {
    placeTrainOnPath(train, hit);
    trainPlaced = true;
    running = false;
    train.mode = TrainMode.IDLE;
    return true;
  }
  // Free place off-rail (still visible; Start will slide)
  train.x = x;
  train.y = y;
  train.ang = 0;
  train.pathRef = null;
  train.mode = TrainMode.IDLE;
  trainPlaced = true;
  running = false;
  return false;
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

btnStart.addEventListener("click", () => {
  if (!trainPlaced) {
    // Auto-place on nearest path to center if possible
    const cx = view.camX + view.w / 2;
    const cy = view.camY + view.h / 2;
    if (!tryPlaceTrainAt(cx, cy, 2000)) {
      setHint("Drag 🚂 train onto a rail (or right-click a path), then Start.");
      return;
    }
  }
  if (train.mode === TrainMode.STOPPED) {
    setHint("Train hit the edge. Reset Train, place on rail, then Start.");
    return;
  }
  // If idle off-path, try re-snap under train body
  if (!train.pathRef) {
    tryPlaceTrainAt(train.x, train.y, 50);
  }
  if (startTrain(train)) {
    running = true;
    setHint("Running. Open ends derail; walls glide; canvas edge stops.");
  } else {
    setHint("Could not start — put the train on an active rail path first.");
  }
});
btnStop.addEventListener("click", () => {
  running = false;
  stopTrain(train);
});
btnResetTrain.addEventListener("click", () => {
  running = false;
  resetTrainHard(train);
  trainPlaced = false;
  setHint("Train cleared. Drag 🚂 onto a rail (or right-click path), then Start.");
  updateStatus();
});

speedSlider.addEventListener("input", () => {
  train.speed = Number(speedSlider.value);
});

// ── Stage pointer ──
canvas.addEventListener("pointerdown", onPointerDown);
// Window-level move so palette→canvas drags keep tracking
window.addEventListener("pointermove", onPointerMove);
window.addEventListener("pointerup", onPointerUp);
window.addEventListener("pointercancel", onPointerUp);
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

window.addEventListener("keydown", (e) => {
  if (e.key === "r" || e.key === "R") {
    document.getElementById("btn-rotate").click();
  } else if (e.key === "f" || e.key === "F") {
    document.getElementById("btn-flip").click();
  } else if (e.key === "m" || e.key === "M") {
    document.getElementById("btn-mirror").click();
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (
      document.activeElement === document.body ||
      document.activeElement === canvas ||
      !document.activeElement
    ) {
      e.preventDefault();
      document.getElementById("btn-delete").click();
    }
  } else if (e.key === " ") {
    e.preventDefault();
    if (running) {
      running = false;
      stopTrain(train);
    } else {
      btnStart.click();
    }
  } else if (e.key === "Escape") {
    cancelDrag();
    clearSelection();
    marquee = null;
    trainGhost = null;
    trainTool = false;
    paletteTool = null;
    refreshPaletteActive();
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setSelection(board.pieces.map((p) => p.id));
    setHint(`Selected all ${selectedIds.size} pieces.`);
  } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveLayoutToFile();
  }
});

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: e.clientX - rect.left + view.camX,
    y: e.clientY - rect.top + view.camY,
    sx: e.clientX - rect.left,
    sy: e.clientY - rect.top,
  };
}

/**
 * Create a ghost whose *visual rail center* sits at (pivotX, pivotY).
 * piece.x/y is the model origin (may be curvature center for curves).
 */
function makeGhostAtPivot(type, pivotX, pivotY, extra = {}) {
  const g = {
    id: extra.id || "ghost",
    type,
    x: 0,
    y: 0,
    rotSteps: extra.rotSteps ?? 0,
    flip: !!extra.flip,
    branchSide: extra.branchSide || "R",
    switchState: extra.switchState ?? 0,
    snapped: false,
    pivotX,
    pivotY,
  };
  const o = originFromWorldPivot(g, pivotX, pivotY);
  g.x = o.x;
  g.y = o.y;
  return g;
}

/** Keep visual pivot fixed while rotating the ghost 45°. */
function rotateGhost(delta = 1) {
  if (!ghost) return;
  const piv =
    ghost.pivotX != null
      ? { x: ghost.pivotX, y: ghost.pivotY }
      : worldPivot(ghost);
  ghost.rotSteps = (((ghost.rotSteps + delta) % 8) + 8) % 8;
  const o = originFromWorldPivot(ghost, piv.x, piv.y);
  ghost.x = o.x;
  ghost.y = o.y;
  ghost.pivotX = piv.x;
  ghost.pivotY = piv.y;
  applyGhostSnap();
}

function flipGhost() {
  if (!ghost) return;
  const piv =
    ghost.pivotX != null
      ? { x: ghost.pivotX, y: ghost.pivotY }
      : worldPivot(ghost);
  // Gender only — geometry (curve bend) unchanged
  ghost.flip = !ghost.flip;
  const o = originFromWorldPivot(ghost, piv.x, piv.y);
  ghost.x = o.x;
  ghost.y = o.y;
  ghost.pivotX = piv.x;
  ghost.pivotY = piv.y;
  applyGhostSnap();
  setHint(
    `Gender ${ghost.flip ? "flipped (F↔M)" : "default (M→F)"}. Use ⇋ / M for L/R bend.`
  );
}

/** Geometric L/R mirror for ghost (branchSide). */
function mirrorGhost() {
  if (!ghost) return;
  if (!isMirrorable(ghost.type)) {
    setHint(
      `${PIECE_META[ghost.type]?.code || ghost.type} has no L/R variant (symmetric).`
    );
    return;
  }
  const piv =
    ghost.pivotX != null
      ? { x: ghost.pivotX, y: ghost.pivotY }
      : worldPivot(ghost);
  ghost.branchSide = ghost.branchSide === "L" ? "R" : "L";
  const o = originFromWorldPivot(ghost, piv.x, piv.y);
  ghost.x = o.x;
  ghost.y = o.y;
  ghost.pivotX = piv.x;
  ghost.pivotY = piv.y;
  applyGhostSnap();
  setHint(`Mirror → ${ghost.branchSide === "L" ? "L / A" : "R / B"} side.`);
}

/** Move ghost so visual center follows (px, py), then snap. */
function setGhostPivot(px, py) {
  if (!ghost) return;
  ghost.pivotX = px;
  ghost.pivotY = py;
  const o = originFromWorldPivot(ghost, px, py);
  ghost.x = o.x;
  ghost.y = o.y;
}

function beginPaletteDrag(type, e) {
  const p = canvasPoint(e);
  ghost = makeGhostAtPivot(type, p.x, p.y);
  drag = {
    kind: "palette",
    type,
    pointerId: e.pointerId,
    moved: false,
    startX: e.clientX,
    startY: e.clientY,
  };
  hidePieceId = null;
  try {
    btnOrCanvasCapture(e);
  } catch (_) {
    /* ignore */
  }
  canvas.classList.add("dragging");
  applyGhostSnap();
}

function btnOrCanvasCapture(e) {
  if (e.currentTarget?.setPointerCapture) {
    e.currentTarget.setPointerCapture(e.pointerId);
  } else {
    canvas.setPointerCapture?.(e.pointerId);
  }
}

function onPointerDown(e) {
  const p = canvasPoint(e);

  // Pan: middle button or Alt+left
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    drag = { kind: "pan", lx: e.clientX, ly: e.clientY };
    canvas.setPointerCapture?.(e.pointerId);
    return;
  }

  // ── RIGHT CLICK: train first (on rails), then switch / rotate ──
  if (e.button === 2) {
    e.preventDefault();
    handleRightClick(p);
    return;
  }

  if (e.button !== 0) return;

  canvas.setPointerCapture?.(e.pointerId);

  // Train tool click / drag on canvas
  if (trainTool) {
    beginTrainDrag(e, p);
    return;
  }

  // Hit-test piece / lever
  const hit = hitTestPiece(board, p.x, p.y);

  // Left on lever still toggles
  if (hit?.lever) {
    toggleSwitch(board, hit.pieceId);
    setSelection([hit.pieceId]);
    setHint("Switch toggled (yellow lever).");
    return;
  }

  // Left drag existing piece(s)
  if (hit?.pieceId) {
    const piece = getPiece(board, hit.pieceId);
    if (!piece) return;

    // Shift-click adds/removes from multi-select
    if (e.shiftKey) {
      if (selectedIds.has(piece.id)) selectedIds.delete(piece.id);
      else selectedIds.add(piece.id);
      board.selectedId = piece.id;
      setHint(`Selection: ${selectedIds.size} piece(s).`);
      return;
    }

    // If clicking outside current multi-selection, select only this
    if (!selectedIds.has(piece.id)) {
      setSelection([piece.id]);
    } else {
      board.selectedId = piece.id;
    }

    // Multi-move when 2+ selected
    if (selectedIds.size > 1) {
      const origins = {};
      for (const id of selectedIds) {
        const pc = getPiece(board, id);
        if (pc) origins[id] = { x: pc.x, y: pc.y };
      }
      drag = {
        kind: "multi-move",
        origins,
        startWx: p.x,
        startWy: p.y,
        pointerId: e.pointerId,
        moved: false,
        startX: e.clientX,
        startY: e.clientY,
      };
      canvas.classList.add("dragging");
      setHint(`Moving ${selectedIds.size} pieces…`);
      return;
    }

    // Single-piece move (ghost + snap)
    hidePieceId = piece.id;
    const piv = worldPivot(piece);
    ghost = makeGhostAtPivot(piece.type, piv.x, piv.y, {
      id: piece.id,
      rotSteps: piece.rotSteps,
      flip: piece.flip,
      branchSide: piece.branchSide,
      switchState: piece.switchState,
    });
    board.pieces = board.pieces.filter((q) => q.id !== piece.id);
    rebuild(board);

    drag = {
      kind: "move",
      pieceId: piece.id,
      pieceSnapshot: { ...piece },
      dx: p.x - piv.x,
      dy: p.y - piv.y,
      pointerId: e.pointerId,
      moved: false,
      startX: e.clientX,
      startY: e.clientY,
    };
    canvas.classList.add("dragging");
    applyGhostSnap();
    return;
  }

  // Empty canvas: start marquee multi-select
  if (!e.shiftKey) clearSelection();
  marquee = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
  drag = {
    kind: "marquee",
    pointerId: e.pointerId,
    moved: false,
    startX: e.clientX,
    startY: e.clientY,
    additive: !!e.shiftKey,
  };
}

function handleRightClick(p) {
  // PRIORITY: place train on rail (even when over a piece body)
  const pathHit = closestPathPoint(board, p.x, p.y);
  if (pathHit && pathHit.dist < 32) {
    placeTrainOnPath(train, pathHit);
    trainPlaced = true;
    running = false;
    setHint("Train on rail. Press Start (or Space).");
    updateStatus();
    return;
  }

  const hit = hitTestPiece(board, p.x, p.y);

  if (hit?.lever) {
    toggleSwitch(board, hit.pieceId);
    setSelection([hit.pieceId]);
    setHint("Switch toggled.");
    return;
  }

  // Right-click piece → rotate 45°
  if (hit?.pieceId) {
    setSelection([hit.pieceId]);
    rotatePiece(board, hit.pieceId, 1);
    persistLayout();
    setHint("Rotated 45°. F=gender · M=mirror · Del=delete.");
    return;
  }

  // Right-click empty + palette selection → stamp piece
  if (paletteTool) {
    ghost = makeGhostAtPivot(paletteTool, p.x, p.y);
    applyGhostSnap();
    commitGhostPlace();
    persistLayout();
    setHint("Piece stamped.");
    return;
  }

  setHint(
    "Right-click rail → train · piece → rotate · empty+palette → stamp · lever → switch."
  );
}

function beginTrainDrag(e, worldP) {
  const p = worldP || canvasPoint(e);
  trainGhost = { x: p.x, y: p.y, onRail: false };
  drag = {
    kind: "train",
    pointerId: e.pointerId,
    moved: false,
    startX: e.clientX,
    startY: e.clientY,
  };
  canvas.classList.add("dragging");
  // If started from palette, may need to track over canvas
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  updateTrainGhost(p.x, p.y);
}

function updateTrainGhost(x, y) {
  const hit = closestPathPoint(board, x, y);
  if (hit && hit.dist < 40) {
    trainGhost = {
      x: hit.x,
      y: hit.y,
      ang: hit.ang,
      onRail: true,
      hit,
    };
  } else {
    trainGhost = { x, y, ang: 0, onRail: false, hit: null };
  }
}

function onPointerMove(e) {
  if (!drag && !ghost && !trainGhost) return;
  const p = canvasPoint(e);

  if (drag?.kind === "pan") {
    view.camX -= e.clientX - drag.lx;
    view.camY -= e.clientY - drag.ly;
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    return;
  }

  if (drag) {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (dist > 4) drag.moved = true;
  }

  if (drag?.kind === "train") {
    updateTrainGhost(p.x, p.y);
    return;
  }

  if (drag?.kind === "marquee") {
    marquee = {
      x0: marquee.x0,
      y0: marquee.y0,
      x1: p.x,
      y1: p.y,
    };
    return;
  }

  if (drag?.kind === "multi-move") {
    const dx = p.x - drag.startWx;
    const dy = p.y - drag.startWy;
    for (const id of Object.keys(drag.origins)) {
      const pc = getPiece(board, id);
      const o = drag.origins[id];
      if (pc && o) {
        pc.x = o.x + dx;
        pc.y = o.y + dy;
      }
    }
    rebuild(board);
    return;
  }

  if (drag?.kind === "palette" || drag?.kind === "move") {
    if (!ghost) return;
    if (drag.kind === "move") {
      setGhostPivot(p.x - drag.dx, p.y - drag.dy);
    } else {
      setGhostPivot(p.x, p.y);
    }
    applyGhostSnap();
  }
}

function applyGhostSnap() {
  if (!ghost) return;
  // Ensure pivot mirrors current origin if missing
  if (ghost.pivotX == null || ghost.pivotY == null) {
    const piv = worldPivot(ghost);
    ghost.pivotX = piv.x;
    ghost.pivotY = piv.y;
  }

  const snap = findSnap(board, ghost, SNAP_DIST);
  if (snap) {
    ghost.x = snap.x;
    ghost.y = snap.y;
    ghost.rotSteps = snap.rotSteps;
    ghost.flip = snap.flip;
    ghost.snapped = true;
    if (snap.pivotX != null) {
      ghost.pivotX = snap.pivotX;
      ghost.pivotY = snap.pivotY;
    } else {
      const piv = worldPivot(ghost);
      ghost.pivotX = piv.x;
      ghost.pivotY = piv.y;
    }
  } else {
    ghost.snapped = false;
  }
}

function commitGhostPlace() {
  if (!ghost) return null;
  const piece = addPiece(board, ghost.type, ghost.x, ghost.y, ghost.rotSteps, {
    flip: ghost.flip,
    branchSide: ghost.branchSide,
    switchState: ghost.switchState,
  });
  setSelection([piece.id]);
  ghost = null;
  hidePieceId = null;
  persistLayout();
  return piece;
}

function commitGhostMove() {
  if (!ghost || !drag?.pieceSnapshot) return;
  const snap = drag.pieceSnapshot;
  const piece = addPiece(board, snap.type, ghost.x, ghost.y, ghost.rotSteps, {
    flip: ghost.flip,
    branchSide: snap.branchSide,
    switchState: snap.switchState,
  });
  setSelection([piece.id]);
  ghost = null;
  hidePieceId = null;
  persistLayout();
}

function restoreMoveIfCancel() {
  if (drag?.kind === "move" && drag.pieceSnapshot && hidePieceId) {
    const s = drag.pieceSnapshot;
    // If piece was removed and not re-added yet
    if (!getPiece(board, s.id) && !board.pieces.find((p) => p.id === s.id)) {
      // addPiece creates new id — just place snapshot fields
      addPiece(board, s.type, s.x, s.y, s.rotSteps, {
        flip: s.flip,
        branchSide: s.branchSide,
        switchState: s.switchState,
      });
    }
  }
}

function cancelDrag() {
  if (drag?.kind === "move") {
    // Restore original piece if still lifted
    if (hidePieceId && drag.pieceSnapshot) {
      const s = drag.pieceSnapshot;
      if (!board.pieces.some((p) => p.x === s.x && p.y === s.y && p.type === s.type)) {
        // only if we haven't committed
      }
      // Always re-add snapshot if missing
      const exists = board.pieces.find(
        (p) =>
          p.type === s.type &&
          Math.hypot(p.x - s.x, p.y - s.y) < 1 &&
          p.rotSteps === s.rotSteps
      );
      if (!exists && hidePieceId) {
        addPiece(board, s.type, s.x, s.y, s.rotSteps, {
          flip: s.flip,
          branchSide: s.branchSide,
          switchState: s.switchState,
        });
      }
    }
  }
  ghost = null;
  drag = null;
  hidePieceId = null;
  canvas.classList.remove("dragging");
  rebuild(board);
}

function onPointerUp(e) {
  if (!drag) {
    ghost = null;
    trainGhost = null;
    return;
  }

  if (drag.kind === "pan") {
    drag = null;
    return;
  }

  if (drag.kind === "train") {
    const p = canvasPoint(e);
    updateTrainGhost(p.x, p.y);
    if (trainGhost?.onRail && trainGhost.hit) {
      placeTrainOnPath(train, trainGhost.hit);
      trainPlaced = true;
      running = false;
      setHint("Train on rails. Press Start (or Space).");
    } else if (trainGhost) {
      tryPlaceTrainAt(trainGhost.x, trainGhost.y, 40);
      setHint(
        trainPlaced
          ? "Train near rails — drag closer for a clean snap, then Start."
          : "Drop the train on a blue rail path."
      );
    }
    trainGhost = null;
    drag = { suppressClick: true };
    setTimeout(() => {
      if (drag?.suppressClick) drag = null;
    }, 0);
    canvas.classList.remove("dragging");
    updateStatus();
    return;
  }

  if (drag.kind === "marquee") {
    if (drag.moved && marquee) {
      const minX = Math.min(marquee.x0, marquee.x1);
      const maxX = Math.max(marquee.x0, marquee.x1);
      const minY = Math.min(marquee.y0, marquee.y1);
      const maxY = Math.max(marquee.y0, marquee.y1);
      const ids = [];
      for (const pc of board.pieces) {
        const piv = worldPivot(pc);
        if (piv.x >= minX && piv.x <= maxX && piv.y >= minY && piv.y <= maxY) {
          ids.push(pc.id);
        }
      }
      if (drag.additive) {
        for (const id of ids) selectedIds.add(id);
        board.selectedId = ids[0] || board.selectedId;
      } else {
        setSelection(ids);
      }
      setHint(
        selectedIds.size
          ? `Selected ${selectedIds.size} piece(s). Drag any to move all · Del deletes.`
          : "No pieces in box."
      );
    } else if (!drag.moved && !drag.additive) {
      clearSelection();
    }
    marquee = null;
    drag = null;
    canvas.classList.remove("dragging");
    return;
  }

  if (drag.kind === "multi-move") {
    persistLayout();
    setHint(`Moved ${selectedIds.size} pieces.`);
    drag = null;
    canvas.classList.remove("dragging");
    rebuild(board);
    return;
  }

  if (drag.kind === "palette") {
    if (ghost) {
      const rect = canvas.getBoundingClientRect();
      const over =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (over || drag.moved) {
        commitGhostPlace();
        setHint("Piece placed. Drag near open ends to snap · 🚂 for train.");
      } else {
        ghost = null;
      }
    }
    drag = { suppressClick: true };
    setTimeout(() => {
      if (drag?.suppressClick) drag = null;
    }, 0);
    canvas.classList.remove("dragging");
    hidePieceId = null;
    return;
  }

  if (drag.kind === "move") {
    if (ghost && drag.pieceSnapshot) {
      if (!drag.moved) {
        const s = drag.pieceSnapshot;
        const piece = addPiece(board, s.type, s.x, s.y, s.rotSteps, {
          flip: s.flip,
          branchSide: s.branchSide,
          switchState: s.switchState,
        });
        setSelection([piece.id]);
        setHint("Selected. Drag to move · box-drag empty for multi-select.");
      } else {
        commitGhostMove();
        setHint("Piece moved.");
      }
    } else {
      restoreMoveIfCancel();
    }
    drag = null;
    hidePieceId = null;
    ghost = null;
    canvas.classList.remove("dragging");
    rebuild(board);
    return;
  }

  drag = null;
  canvas.classList.remove("dragging");
}

function placeTrainAtHint(hint) {
  if (!hint) return;
  const hit = closestPathPoint(board, hint.x, hint.y);
  if (hit) {
    placeTrainOnPath(train, hit);
    trainPlaced = true;
    running = false;
    updateStatus();
  }
}

function setHint(text) {
  hintEl.textContent = text;
}

function updateStatus() {
  const mode = trainPlaced
    ? running
      ? modeLabel(train.mode)
      : `${modeLabel(train.mode)}${train.pathRef ? "" : " (off path)"}`
    : "No train";
  const tool = trainTool
    ? "🚂 Train"
    : paletteTool
      ? PIECE_META[paletteTool]?.code || paletteTool
      : selectedIds.size > 1
        ? `${selectedIds.size} sel`
        : "—";
  statusEl.innerHTML = `Pieces: <em>${board.pieces.length}</em> · Tool: <em>${tool}</em> · State: <em>${mode}</em>`;

  badgeEl.className = "badge";
  if (!trainPlaced) {
    badgeEl.innerHTML = `Mode: <strong>Build</strong>`;
  } else if (train.mode === TrainMode.ON_RAIL && running) {
    badgeEl.classList.add("ok");
    badgeEl.innerHTML = `Mode: <strong>On rails</strong>`;
  } else if (train.mode === TrainMode.OFF_RAIL) {
    badgeEl.classList.add("warn");
    badgeEl.innerHTML = `Mode: <strong>Off rails</strong> — sliding on floor / edges`;
  } else if (train.mode === TrainMode.STOPPED) {
    badgeEl.classList.add("danger");
    badgeEl.innerHTML = `Mode: <strong>Stopped</strong> — hit canvas edge · reset train`;
  } else {
    badgeEl.innerHTML = `Mode: <strong>${modeLabel(train.mode)}</strong>`;
  }
}

function updateBounds() {
  const pad = 20;
  bounds = {
    minX: view.camX + pad,
    minY: view.camY + pad,
    maxX: view.camX + view.w - pad,
    maxY: view.camY + view.h - pad,
  };
}

function onResize() {
  const r = resizeCanvas(canvas);
  view.w = r.w;
  view.h = r.h;
  updateBounds();
}

window.addEventListener("resize", onResize);
onResize();

// Startup: localStorage autosave → else real meme track (never the circle)
{
  let loaded = false;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (data?.pieces?.length) {
        loaded = applyLoadedLayout(data, "autosave");
      }
    }
  } catch (err) {
    console.warn("autosave load failed", err);
  }
  if (!loaded) {
    const info = loadRealMemeTrack(board);
    placeTrainAtHint(info.trainHint);
    persistLayout();
    setHint(
      info.note ||
        "Real-2-Sim meme track loaded. 🚂 drag train · box-select · Save JSON downloads + autosaves."
    );
  } else {
    setHint(
      "Restored autosaved layout. 🚂 train · box-select multi-move · Save downloads JSON."
    );
  }
}

function frame(t) {
  const dt = Math.min(0.033, (t - lastT) / 1000);
  lastT = t;

  if (running) {
    updateTrain(train, board, dt, bounds);
    if (train.mode === TrainMode.STOPPED) {
      running = false;
      setHint(
        "Train left the playfield. Reset Train, place on rail, then Start."
      );
    }
  }

  updateBounds();
  updateStatus();

  const ctx = canvas.getContext("2d");
  drawScene(ctx, view, board, train, ghost, {
    bounds,
    showWalls,
    trainVisible: trainPlaced || !!trainGhost,
    hidePieceId,
    selectedIds,
    marquee,
    trainGhost,
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.__sim = {
  board,
  train,
  serialize: () => buildSavePayload(),
  save: saveLayoutToFile,
  persist: persistLayout,
  get running() {
    return running;
  },
  get trainPlaced() {
    return trainPlaced;
  },
  get view() {
    return view;
  },
  get selectedIds() {
    return [...selectedIds];
  },
  findSnap,
};
