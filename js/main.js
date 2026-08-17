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
  findGroupSnap,
  hitTestPiece,
  closestPathPoint,
  getPiece,
  rebuild,
  normalizePieceColor,
  rotateSelectionAboutCenter,
} from "./track.js";
import {
  createTrain,
  placeTrainOnPath,
  snapTrainToPoint,
  flipTrainDirection,
  hitTestTrain,
  startTrain,
  stopTrain,
  resetTrainHard,
  updateTrain,
  restoreTrainSnapshot,
  createTrainTelemetry,
  modeLabel,
  TrainMode,
  ensureConsist,
  ensureSingleEngine,
  placeFollowers,
  seatConsistOnPath,
  threeCarConsistSpec,
  setActiveEngine,
  hitTestCar,
  uncoupleCar,
  tryRecoupleCar,
  spawnFreeCar,
  snapCarPoseToHit,
  MAX_MID_CARS,
  COUPLER_DIST,
  countMidCars,
  getTrainInsertionTargets,
  clearTrainCars,
  removeCar,
  placeLayoutCars,
  serializeTrainCars,
  SOLID_PLAYFIELD_FIT_PAD,
} from "./train.js";
import { resizeCanvas, drawScene, drawPaletteIcon, drawPaletteTrainIcon } from "./render.js";
import {
  loadRealMemeTrack,
  TRACK_CATALOG,
  getTrackById,
  trackIdFromSearch,
} from "./presets.js";
import {
  unlockAudio,
  syncTrainAudio,
  setMotorSpeed,
  startMotor,
  stopMotor,
} from "./sound.js";
import { createPaintController } from "./app/paint.js";
import { createIo } from "./app/io.js";
import {
  buildWorldPersistence,
  prepareLoadedWorld,
} from "./app/world-persistence.js";
import {
  createView,
  viewScale as camViewScale,
  screenToWorld,
  zoomAtScreen,
  panByScreen,
  playfieldBounds,
  solidPlayfieldBounds,
  fitBoardToView as camFitBoard,
  fitWorldRect as camFitWorldRect,
} from "./app/camera.js";
import {
  buildWorldContract,
  inspectTrainState,
  renderWorldAscii,
} from "./world-model.js";
import { analyzeTrainTrace } from "./train/trace-analysis.js";
import {
  t,
  hasKey,
  initI18n,
  onLocaleChange,
  rememberHint,
} from "./i18n.js";

initI18n();

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

const telemetryDebug = (() => {
  try {
    const query = new URLSearchParams(window.location.search);
    return (
      query.has("debug") ||
      query.get("telemetry") === "1" ||
      localStorage.getItem("plarail-debug-telemetry") === "1"
    );
  } catch {
    return false;
  }
})();
const trainTelemetry = createTrainTelemetry({
  enabled: telemetryDebug,
  maxFrames: 3600,
  maxEvents: 24000,
});

/** Camera: scale is CSS-px per world unit (1 = 1:1). */
let view = createView(800, 600);
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
/** Debug: draw track wall segments */
let showWalls = false;
/** Feature: solid wood playfield border — bounce instead of STOPPED */
let solidPlayfield = false;
/** Stable world-space collision walls, independent of camera pan/zoom/resize. */
let fixedPlayfieldBounds = null;
const SOLID_WALLS_LS = "plarail-solid-playfield";
let lastT = performance.now();
let hidePieceId = null;
/** Mutable audio transition memory for syncTrainAudio */
const audioMem = { prevMode: null, lastWallTick: 0 };
/** Bump when shipping a new gold-standard default so old autosaves don't win. */
const LS_KEY = "plarail-real2sim-layout-v8-saved-track-speed210";

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
    if (btn.dataset.tool === "active-engine") {
      btn.classList.toggle("active", trainTool && carTool === "active-engine");
    } else if (btn.dataset.tool === "passive-engine") {
      btn.classList.toggle("active", trainTool && carTool === "passive-engine");
    } else if (btn.dataset.tool === "midcar") {
      btn.classList.toggle("active", trainTool && carTool === "mid");
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

/** carTool: null | "active-engine" | "passive-engine" | "mid" */
let carTool = null;

function ensurePaletteButtons() {
  paletteEl.innerHTML = "";

  // ── Active engine (the one powered side) ──
  {
    const btn = document.createElement("button");
    btn.className = "piece-btn train-btn";
    btn.type = "button";
    btn.dataset.tool = "active-engine";
    btn.innerHTML = `
      <canvas class="train-icon-canvas" width="72" height="52" aria-hidden="true"></canvas>
      <div class="meta">
        <strong>${t("palette.activeEngine")}</strong>
        <span>${t("palette.activeEngineDesc")}</span>
      </div>`;
    drawPaletteTrainIcon(btn.querySelector("canvas"), "active");
    btn.addEventListener("click", (e) => {
      if (drag?.kind === "train" || drag?.suppressClick) return;
      trainTool = !trainTool;
      carTool = trainTool ? "active-engine" : null;
      if (trainTool) paletteTool = null;
      refreshPaletteActive();
      setHint(trainTool ? "palette.activeEngineOn" : "palette.activeEngineOff");
    });
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      trainTool = true;
      carTool = "active-engine";
      paletteTool = null;
      refreshPaletteActive();
      beginTrainDrag(e, null, {
        carKind: "engine",
        powerIntent: "active",
      });
    });
    paletteEl.appendChild(btn);
  }

  // ── Passive engine (unpowered end or parked unit) ──
  {
    const btn = document.createElement("button");
    btn.className = "piece-btn train-btn";
    btn.type = "button";
    btn.dataset.tool = "passive-engine";
    btn.innerHTML = `
      <canvas class="train-icon-canvas" width="72" height="52" aria-hidden="true"></canvas>
      <div class="meta">
        <strong>${t("palette.passiveEngine")}</strong>
        <span>${t("palette.passiveEngineDesc")}</span>
      </div>`;
    drawPaletteTrainIcon(btn.querySelector("canvas"), "passive");
    btn.addEventListener("click", (e) => {
      if (drag?.kind === "train" || drag?.suppressClick) return;
      const on = carTool !== "passive-engine";
      trainTool = on;
      carTool = on ? "passive-engine" : null;
      if (on) paletteTool = null;
      refreshPaletteActive();
      setHint(on ? "palette.passiveEngineOn" : "palette.passiveEngineOff");
    });
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      trainTool = true;
      carTool = "passive-engine";
      paletteTool = null;
      refreshPaletteActive();
      beginTrainDrag(e, null, {
        carKind: "engine",
        powerIntent: "passive",
      });
    });
    paletteEl.appendChild(btn);
  }

  // ── Middle car (drag onto rails like engine) ──
  {
    const btn = document.createElement("button");
    btn.className = "piece-btn train-btn";
    btn.type = "button";
    btn.dataset.tool = "midcar";
    btn.innerHTML = `
      <canvas class="train-icon-canvas" width="72" height="52" aria-hidden="true"></canvas>
      <div class="meta">
        <strong>${t("palette.mid")}</strong>
        <span>${t("palette.midDesc")}</span>
      </div>`;
    drawPaletteTrainIcon(btn.querySelector("canvas"), "mid");
    btn.addEventListener("click", (e) => {
      if (drag?.kind === "train" || drag?.suppressClick) return;
      const on = carTool !== "mid";
      trainTool = on;
      carTool = on ? "mid" : null;
      if (on) paletteTool = null;
      refreshPaletteActive();
      setHint(on ? "palette.midOn" : "palette.midOff");
    });
    btn.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      trainTool = true;
      carTool = "mid";
      paletteTool = null;
      refreshPaletteActive();
      beginTrainDrag(e, null, { carKind: "mid" });
    });
    paletteEl.appendChild(btn);
  }

  for (const type of paletteOrder) {
    const meta = PIECE_META[type];
    if (!meta) continue;
    const copy = pieceCopy(type);
    const btn = document.createElement("button");
    btn.className = "piece-btn";
    btn.type = "button";
    btn.dataset.type = type;
    btn.innerHTML = `
      <canvas width="72" height="52"></canvas>
      <div class="meta">
        <strong>${copy.code} ${copy.name}</strong>
        <span>${copy.desc}</span>
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
          ? "palette.pieceSelected"
          : "palette.cleared",
        paletteTool ? { code: copy.code, name: copy.name } : undefined
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
    const ids = selectedIds.size
      ? [...selectedIds]
      : board.selectedId
        ? [board.selectedId]
        : [];
    if (ids.length > 1) {
      // Rigid group rotate about shared visual-pivot centroid
      rotateSelectionAboutCenter(board, ids, 1);
      setHint("hint.rotatedGroup", { count: ids.length });
    } else {
      for (const id of ids) {
        if (id) rotatePiece(board, id, 1);
      }
    }
    persistLayout();
  }
});
document.getElementById("btn-flip").addEventListener("click", () => {
  if (ghost) {
    flipGhost();
  } else if (
    trainPlaced &&
    train.selectedCarId &&
    train.cars?.some((c) => c.id === train.selectedCarId && c.kind === "engine")
  ) {
    // Gender control on a selected engine → make it the powered unit
    const ok = setActiveEngine(train, train.selectedCarId);
    train.selected = true;
    clearSelection();
    setHint(ok ? "hint.powerSwitched" : "hint.powerSwitchFail");
  } else if (trainPlaced && (train.selected || (!board.selectedId && selectedIds.size === 0))) {
    // Flip train travel direction when train is the selection target
    flipTrainDirection(train, board);
    train.selected = true;
    clearSelection();
    setHint(train.dir > 0 ? "hint.trainForward" : "hint.trainReverse");
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
    if (!n) setHint("hint.noMirror");
    else setHint("hint.mirrored", { count: n });
    persistLayout();
  }
});
document.getElementById("btn-delete").addEventListener("click", () => {
  // Delete selected rolling stock (remove from world — not just uncouple)
  if (trainPlaced && (train.selected || train.selectedCarId)) {
    const id =
      train.selectedCarId ||
      train.poweredId ||
      train.cars?.[0]?.id ||
      null;
    if (id) {
      const r = removeCar(train, id);
      if (r.cleared) {
        trainPlaced = false;
        running = false;
        setHint("hint.trainDeleted");
        updateStatus();
        return;
      }
      if (r.removed) {
        setHint("hint.carDeleted");
        updateStatus();
        return;
      }
    }
    // Whole-train clear if selection is the powered body without car id
    if (train.selected && train.cars?.length) {
      clearTrainCars(train);
      trainPlaced = false;
      running = false;
      setHint("hint.trainCleared");
      updateStatus();
      return;
    }
  }
  const ids = selectedIds.size
    ? [...selectedIds]
    : board.selectedId
      ? [board.selectedId]
      : [];
  for (const id of ids) removePiece(board, id);
  clearSelection();
  persistLayout();
  setHint(
    ids.length ? "hint.deletedPieces" : "hint.nothingSelected",
    ids.length ? { count: ids.length } : undefined
  );
});
document.getElementById("btn-clear").addEventListener("click", () => {
  if (
    !window.confirm(t("confirm.clearBoard"))
  ) {
    return;
  }
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
  setHint("hint.boardCleared");
});
// Built-in track dropdown + Load
const trackSelect = document.getElementById("track-select");
fillTrackSelect();

/**
 * Shift layout so the northern-most *rail path* sits near targetMinY
 * (close to the solid top wall after a tight fit).
 */
function northAlignBoardToWall(targetMinY = 36) {
  if (!board.pieces.length) return 0;
  rebuild(board);
  let minY = Infinity;
  for (const path of board.pathIndex || []) {
    if (!path.active || !path.points?.length) continue;
    for (const pt of path.points) minY = Math.min(minY, pt.y);
  }
  if (!Number.isFinite(minY)) {
    for (const w of board.walls || []) minY = Math.min(minY, w.y1, w.y2);
  }
  if (!Number.isFinite(minY)) {
    for (const p of board.pieces) minY = Math.min(minY, p.y);
  }
  if (!Number.isFinite(minY)) return 0;
  const dy = targetMinY - minY;
  if (Math.abs(dy) < 0.5) return 0;
  for (const p of board.pieces) p.y += dy;
  rebuild(board);
  return dy;
}

/** Find a path hit for train seat — fall back to any active path midpoint. */
function findTrainSeatHit(hint, maxDist = 120) {
  if (hint) {
    const hit = closestPathPoint(board, hint.x, hint.y, maxDist);
    if (hit) return hit;
  }
  // Fallback: first active path mid-sample
  for (const path of board.pathIndex || []) {
    if (!path.active || !path.points?.length) continue;
    const mid = path.points[Math.floor(path.points.length / 2)];
    if (!mid) continue;
    const hit = closestPathPoint(board, mid.x, mid.y, 40);
    if (hit) return hit;
  }
  return null;
}

function applyTrackLoadInfo(info) {
  // Always separate entities — never a hard-coded multi-car template
  train.consistSpec = null;
  train.cars = null;
  fixedPlayfieldBounds = info?.playfieldBounds
    ? { ...info.playfieldBounds }
    : null;
  // Explicit true/false so switching back from arntenoughrails turns walls off
  if (info && Object.prototype.hasOwnProperty.call(info, "solidPlayfield")) {
    setSolidPlayfield(!!info.solidPlayfield);
  }
  // Not-enough-rails: pin north *path* edge tight under the solid top wall
  let dy = 0;
  if (info?.northAlign || info?.solidPlayfield) {
    dy = northAlignBoardToWall(36);
  }
  clearSelection();
  // Shift train hint with the layout so seat lands on the moved rails
  const hint = info.trainHint
    ? {
        ...info.trainHint,
        y: (info.trainHint.y ?? 0) + dy,
        x: info.trainHint.x,
      }
    : null;
  // Shift any saved car poses with north-align
  const carsList = (info?.cars || []).map((c) =>
    c && c.y != null ? { ...c, y: c.y + dy } : { ...c }
  );
  const hit = findTrainSeatHit(hint, 160);
  if (hit || insertion) {
    let dir = 1;
    if (hint && typeof hint.ang === "number") {
      const d1 = Math.abs(
        ((hint.ang - hit.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      );
      const d2 = Math.abs(
        ((hint.ang - (hit.ang + Math.PI) + Math.PI * 3) % (Math.PI * 2)) -
          Math.PI
      );
      if (d2 < d1) dir = -1;
    }
    if (carsList.length > 0) {
      // Layout cars are distinct entities placed + coupled on the path
      placeLayoutCars(train, carsList, board, { seatHit: hit, dir });
      train.consistSpec = null;
    } else {
      // Single engine only
      placeTrainOnPath(train, hit, {
        dir,
        hardReset: false,
        board,
      });
    }
    trainPlaced = true;
  } else {
    trainPlaced = false;
    setHint("track.noRail");
  }
  applySpeed(info.speed ?? info.trainHint?.speed ?? 210);
  // Tight fit so north rails sit near the wood wall (re-rail geometry)
  fitBoardToView(
    info?.northAlign || info?.solidPlayfield
      ? SOLID_PLAYFIELD_FIT_PAD
      : 48
  );
  persistLayout();
}

function loadSelectedTrack() {
  const id = trackSelect?.value || TRACK_CATALOG[0]?.id;
  const entry = getTrackById(id);
  if (!entry?.load) {
    setHint("track.noneSelected");
    return;
  }
  const info = entry.load(board);
  applyTrackLoadInfo(info);
  const trackName = hasKey(`track.${entry.id}`) ? t(`track.${entry.id}`) : entry.name;
  if (hasKey(`track.note.${entry.id}`)) {
    setHint(`track.note.${entry.id}`, { count: info.pieceCount, name: trackName });
  } else {
    setHint("track.loadedGeneric", { name: trackName });
  }
}

document.getElementById("btn-load-track")?.addEventListener("click", () => {
  loadSelectedTrack();
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

function setSolidPlayfield(on) {
  solidPlayfield = !!on;
  if (!solidPlayfield) fixedPlayfieldBounds = null;
  const btn = document.getElementById("btn-solid-walls");
  if (btn) {
    btn.classList.toggle("active", solidPlayfield);
    btn.setAttribute("aria-pressed", solidPlayfield ? "true" : "false");
    btn.title = solidPlayfield ? t("ui.solidWallsOn") : t("ui.solidWallsOff");
  }
  try {
    localStorage.setItem(SOLID_WALLS_LS, solidPlayfield ? "1" : "0");
  } catch {
    /* ignore */
  }
  setHint(solidPlayfield ? "hint.wallsOn" : "hint.wallsOff");
}

document.getElementById("btn-solid-walls")?.addEventListener("click", () => {
  setSolidPlayfield(!solidPlayfield);
  if (solidPlayfield) fitBoardToView(SOLID_PLAYFIELD_FIT_PAD);
  else updateBounds();
  persistLayout();
});
try {
  if (localStorage.getItem(SOLID_WALLS_LS) === "1") setSolidPlayfield(true);
} catch {
  /* ignore */
}

document.getElementById("btn-fit")?.addEventListener("click", () => {
  fitBoardToView(48);
  setHint("hint.fittedPan");
});

document.getElementById("btn-fit-toolbar")?.addEventListener("click", () => {
  fitBoardToView(48);
  setHint("hint.fittedPan");
});

// ── Paint swatches (one-shot paint bucket) ──
const paint = createPaintController({
  canvas,
  setHint: (t) => setHint(t),
  onArm: () => {
    trainTool = false;
    paletteTool = null;
    refreshPaletteActive();
  },
});
paint.bindUi();
const clearPaintMode = () => paint.clearPaintMode();

function applySpeed(speed) {
  const n = Number(speed);
  if (!Number.isFinite(n)) return;
  const clamped = Math.max(60, Math.min(280, Math.round(n / 10) * 10));
  train.speed = clamped;
  if (speedSlider) speedSlider.value = String(clamped);
  setMotorSpeed(train.speed / 140);
}

function tryPlaceTrainAt(x, y, maxDist = 48) {
  const hit = closestPathPoint(board, x, y, maxDist);
  if (hit) {
    placeTrainOnPath(train, hit, { keepDir: true, dir: train.dir || 1 });
    trainPlaced = true;
    running = false;
    return true;
  }
  return false;
}

function placeTrainSnapshot(snapshot) {
  if (!snapshot || !Number.isFinite(snapshot.x) || !Number.isFinite(snapshot.y)) {
    return false;
  }
  train.x = snapshot.x;
  train.y = snapshot.y;
  train.ang = Number.isFinite(snapshot.ang) ? snapshot.ang : train.ang;
  train.mode = snapshot.mode || TrainMode.IDLE;
  train.pathRef = null;
  ensureSingleEngine(train);
  return true;
}

function placeTrainAtHint(hint, opts = {}) {
  if (!hint && !opts.forceAny) return;
  const hit = findTrainSeatHit(hint, opts.maxDist ?? 160);
  if (hit) {
    let dir = 1;
    if (hint && typeof hint.ang === "number" && Number.isFinite(hint.ang)) {
      const d1 = Math.abs(
        ((hint.ang - hit.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      );
      const d2 = Math.abs(
        ((hint.ang - (hit.ang + Math.PI) + Math.PI * 3) % (Math.PI * 2)) -
          Math.PI
      );
      dir = d1 <= d2 ? 1 : -1;
    }
    placeTrainOnPath(train, hit, {
      dir,
      hardReset: !!opts.hardReset,
      board,
    });
    // placeTrainOnPath already path-seats multi-car; only hard-hitch if no board path
    if (train.cars?.length > 1 && train.pathRef) {
      seatConsistOnPath(train, board);
    } else if (train.cars?.length > 1) {
      placeFollowers(train, { hard: true, onRail: false, board: null });
    }
    trainPlaced = true;
    train.selected = false;
    running = false;
    updateStatus();
  }
}

function setHint(keyOrText, vars) {
  if (hasKey(keyOrText)) {
    rememberHint(keyOrText, vars);
    hintEl.textContent = t(keyOrText, vars);
    return;
  }
  hintEl.textContent = keyOrText ?? "";
}

function localizedMode(mode) {
  const key = `mode.${mode}`;
  return hasKey(key) ? t(key) : modeLabel(mode);
}

function pieceCopy(type) {
  const meta = PIECE_META[type] || {};
  return {
    code: meta.code || type,
    name: hasKey(`piece.${type}.name`) ? t(`piece.${type}.name`) : meta.name || type,
    desc: hasKey(`piece.${type}.desc`) ? t(`piece.${type}.desc`) : meta.desc || "",
  };
}

function fillTrackSelect() {
  if (!trackSelect) return;
  const current = trackSelect.value;
  trackSelect.innerHTML = "";
  for (const entry of TRACK_CATALOG) {
    const opt = document.createElement("option");
    opt.value = entry.id;
    opt.textContent = hasKey(`track.${entry.id}`)
      ? t(`track.${entry.id}`)
      : entry.name;
    trackSelect.appendChild(opt);
  }
  if (current) trackSelect.value = current;
}

function refreshSolidWallTitle() {
  const btn = document.getElementById("btn-solid-walls");
  if (!btn) return;
  btn.title = solidPlayfield ? t("ui.solidWallsOn") : t("ui.solidWallsOff");
}

onLocaleChange(() => {
  fillTrackSelect();
  ensurePaletteButtons();
  refreshPaletteActive();
  refreshSolidWallTitle();
  updateStatus();
});

// ── Save / Load (app/io.js) ──
const io = createIo({
  board,
  train,
  getTrainPlaced: () => trainPlaced,
  setTrainPlaced: (v) => {
    trainPlaced = v;
  },
  setRunning: (v) => {
    running = v;
  },
  tryPlaceTrainAt,
  placeTrainAtHint,
  resetTrainHard,
  applySpeed,
  fitBoardToView: (pad = 48) => fitBoardToView(pad),
  setHint,
  updateStatus,
  prepareLoadedLayout: (data) => {
    const prepared = prepareLoadedWorld(board, data, 36);
    fixedPlayfieldBounds = prepared.playfieldBounds;
    if (
      data &&
      Object.prototype.hasOwnProperty.call(data, "solidPlayfield")
    ) {
      setSolidPlayfield(!!data.solidPlayfield);
    }
    return prepared.data;
  },
  clearSelection,
  lsKey: LS_KEY,
  defaultSpeed: 210,
  serializeTrainCars: () => serializeTrainCars(train),
  placeTrainSnapshot,
  restoreTrainState: (snapshot) => restoreTrainSnapshot(train, board, snapshot),
  getSolidPlayfield: () => solidPlayfield,
  getWorldPersistence: () =>
    buildWorldPersistence(board, fixedPlayfieldBounds),
  solidFitPad: SOLID_PLAYFIELD_FIT_PAD,
  placeLayoutCars: (cars, trainMeta) => {
    const hit = findTrainSeatHit(
      trainMeta
        ? { x: trainMeta.x, y: trainMeta.y, ang: trainMeta.ang }
        : null,
      160
    );
    if (
      !hit &&
      (!Number.isFinite(cars?.[0]?.x) || !Number.isFinite(cars?.[0]?.y))
    )
      return false;
    let dir = 1;
    if (trainMeta?.ang != null && hit) {
      const d1 = Math.abs(
        ((trainMeta.ang - hit.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI
      );
      const d2 = Math.abs(
        ((trainMeta.ang - (hit.ang + Math.PI) + Math.PI * 3) %
          (Math.PI * 2)) -
          Math.PI
      );
      if (d2 < d1) dir = -1;
    }
    placeLayoutCars(train, cars, board, {
      seatHit: hit || null,
      dir,
      preserveSavedState: cars.some(
        (car) => Number.isFinite(car?.x) && Number.isFinite(car?.y)
      ),
    });
    train.consistSpec = null;
    if (trainMeta?.speed != null) train.speed = trainMeta.speed;
    return !!(train.cars?.length);
  },
});
const {
  buildSavePayload,
  persistLayout,
  applyLoadedLayout,
  saveLayoutToFile,
  tryLoadAutosave,
  bindFileUi,
} = io;
bindFileUi();

btnStart.addEventListener("click", () => {
  unlockAudio();
  if (!trainPlaced) {
    const s = viewScale();
    const cx = view.camX + view.w / s / 2;
    const cy = view.camY + view.h / s / 2;
    if (!tryPlaceTrainAt(cx, cy, 2000)) {
      setHint("hint.dragTrainStart");
      return;
    }
  }
  if (train.mode === TrainMode.STOPPED) {
    setHint("hint.hitEdge");
    return;
  }
  if (!train.pathRef && train.mode !== TrainMode.OFF_RAIL) {
    if (!tryPlaceTrainAt(train.x, train.y, 56)) {
      setHint("hint.notOnRail");
      return;
    }
  }
  if (startTrain(train)) {
    running = true;
    train.selected = false;
    startMotor(train.speed / 140);
    setHint("hint.running");
  } else {
    setHint("hint.couldNotStart");
  }
});
btnStop.addEventListener("click", () => {
  unlockAudio();
  running = false;
  stopTrain(train);
  stopMotor();
  setHint("hint.paused");
  updateStatus();
});
btnResetTrain.addEventListener("click", () => {
  running = false;
  resetTrainHard(train); // clears cars + consistSpec (no auto multi rebuild)
  trainPlaced = false;
  setHint("hint.resetTrain");
  updateStatus();
});

speedSlider.addEventListener("input", () => {
  applySpeed(speedSlider.value);
  persistLayout();
});
// Initial speed: 75% of max (280 → 210)
applySpeed(speedSlider?.value ?? 210);

// Unlock Web Audio on first pointer / key (browser autoplay policy)
function armAudioUnlock() {
  unlockAudio();
  window.removeEventListener("pointerdown", armAudioUnlock, true);
  window.removeEventListener("keydown", armAudioUnlock, true);
}
window.addEventListener("pointerdown", armAudioUnlock, true);
window.addEventListener("keydown", armAudioUnlock, true);

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
      stopMotor();
      setHint("hint.paused");
      updateStatus();
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
    clearPaintMode();
    refreshPaletteActive();
  } else if (e.key === "a" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    setSelection(board.pieces.map((p) => p.id));
    setHint("hint.selectedAll", { count: selectedIds.size });
  } else if (e.key === "s" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveLayoutToFile();
  } else if (e.key === "0" && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    fitBoardToView(48);
    setHint("hint.fitted");
  }
});

function viewScale() {
  return camViewScale(view);
}

function canvasPoint(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;
  const w = screenToWorld(view, sx, sy);
  return { x: w.x, y: w.y, sx, sy };
}

function zoomAt(sx, sy, nextScale) {
  zoomAtScreen(view, sx, sy, nextScale);
  updateBounds();
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
    color: normalizePieceColor(extra.color),
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
  setHint(ghost.flip ? "hint.genderFlipped" : "hint.genderDefault");
}

/** Geometric L/R mirror for ghost (branchSide). */
function mirrorGhost() {
  if (!ghost) return;
  if (!isMirrorable(ghost.type)) {
    setHint("hint.noLrVariant", {
      code: PIECE_META[ghost.type]?.code || ghost.type,
    });
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
  setHint(ghost.branchSide === "L" ? "hint.mirrorSideL" : "hint.mirrorSideR");
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

  // ── RIGHT CLICK: piece rotate / switch only (never place train) ──
  if (e.button === 2) {
    e.preventDefault();
    handleRightClick(p);
    return;
  }

  if (e.button !== 0) return;

  canvas.setPointerCapture?.(e.pointerId);

  // Paint bucket: next piece click applies color once, then exits paint mode
  if (paint.isPainting()) {
    unlockAudio();
    const hitPaint = hitTestPiece(board, p.x, p.y);
    if (hitPaint?.pieceId && !hitPaint.lever) {
      const piece = getPiece(board, hitPaint.pieceId);
      if (piece && paint.applyToPiece(piece)) {
        persistLayout();
        return;
      }
    }
    paint.clearPaintMode();
    setHint("paint.cancelledClick");
    return;
  }

  // Train tool from palette — place/move like a piece
  if (trainTool) {
    beginTrainDrag(e, p);
    return;
  }

  // Click existing train / car body first (select + drag along track)
  if (trainPlaced) {
    const carHit = hitTestCar(train, p.x, p.y);
    if (carHit || hitTestTrain(train, p.x, p.y, trainPlaced)) {
      running = false;
      stopTrain(train);
      train.selected = true;
      train.selectedCarId = carHit?.id || train.poweredId || train.cars?.[0]?.id || null;
      // Mark selection on cars
      if (train.cars) {
        for (const c of train.cars) c.selected = c.id === train.selectedCarId;
      }
      clearSelection();
      beginTrainDrag(e, p, {
        fromExisting: true,
        carId: train.selectedCarId,
      });
      const powered =
        train.cars?.find((c) => c.powered)?.id || train.poweredId || "lead";
      setHint("hint.carSelected", {
        id: train.selectedCarId || "lead",
        powered,
      });
      return;
    }
  }
  train.selected = false;
  train.selectedCarId = null;
  if (train.cars) for (const c of train.cars) c.selected = false;

  // Hit-test piece / lever
  const hit = hitTestPiece(board, p.x, p.y);

  // Left on lever still toggles
  if (hit?.lever) {
    toggleSwitch(board, hit.pieceId);
    setSelection([hit.pieceId]);
    setHint("hint.switchToggledLever");
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
      setHint("hint.selectionCount", { count: selectedIds.size });
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
      setHint("hint.movingPieces", { count: selectedIds.size });
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
      color: piece.color,
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

/**
 * Right-click is ONLY for track edits — never places the train
 * (train is placed like a piece via 🚂 drag / click).
 */
function handleRightClick(p) {
  const hit = hitTestPiece(board, p.x, p.y);

  if (hit?.lever) {
    toggleSwitch(board, hit.pieceId);
    setSelection([hit.pieceId]);
    setHint("hint.switchToggled");
    return;
  }

  // Right-click piece → rotate 45°
  if (hit?.pieceId) {
    setSelection([hit.pieceId]);
    rotatePiece(board, hit.pieceId, 1);
    persistLayout();
    setHint("hint.rotated45");
    return;
  }

  // Right-click empty + palette selection → stamp piece
  if (paletteTool) {
    ghost = makeGhostAtPivot(paletteTool, p.x, p.y);
    applyGhostSnap();
    commitGhostPlace();
    persistLayout();
    setHint("hint.stamped");
    return;
  }

  setHint("hint.rightClickHelp");
}

function beginTrainDrag(e, worldP, opts = {}) {
  const p = worldP || canvasPoint(e);
  const tool = opts.powerIntent
    ? `${opts.powerIntent}-engine`
    : carTool;
  const carKind =
    opts.carKind || (tool === "mid" ? "mid" : "engine");
  const powerIntent =
    opts.powerIntent ||
    (tool === "active-engine"
      ? "active"
      : tool === "passive-engine"
        ? "passive"
        : null);
  running = false;
  stopTrain(train);
  trainGhost = {
    x: p.x,
    y: p.y,
    onRail: false,
    dir: train.dir || 1,
    carKind,
    powerIntent,
  };
  drag = {
    kind: "train",
    pointerId: e.pointerId,
    moved: false,
    startX: e.clientX,
    startY: e.clientY,
    fromExisting: !!opts.fromExisting,
    carKind,
    powerIntent,
    carId: opts.carId || null,
  };
  canvas.classList.add("dragging");
  try {
    canvas.setPointerCapture?.(e.pointerId);
  } catch {
    /* ignore */
  }
  updateTrainGhost(p.x, p.y);
}

function updateTrainGhost(x, y) {
  const hit = closestPathPoint(board, x, y, 52);
  const dir = train.dir || 1;
  const carKind = drag?.carKind || trainGhost?.carKind || "engine";
  const powerIntent = drag?.powerIntent || trainGhost?.powerIntent || "active";
  const insertionTargets =
    train.cars?.length && !drag?.fromExisting
      ? getTrainInsertionTargets(train, board)
      : [];
  const nearestInsertion = insertionTargets
    .map((target) => ({
      target,
      distance: Math.hypot(target.x - x, target.y - y),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  const insertion =
    nearestInsertion &&
    nearestInsertion.target.onRail &&
    nearestInsertion.distance <= COUPLER_DIST * 0.72
      ? nearestInsertion.target
      : null;
  const previewHit = insertion?.hit || hit;
  if (hit) {
    const ang = insertion
      ? insertion.ang
      : dir > 0
        ? hit.ang
        : hit.ang + Math.PI;
    trainGhost = {
      x: previewHit.x,
      y: previewHit.y,
      ang,
      onRail: !!previewHit,
      hit: previewHit,
      cursorHit: hit,
      dir,
      carKind,
      powerIntent,
      fromExisting: !!drag?.fromExisting,
      carId: drag?.carId || null,
      insertionTargets,
      insertion,
      insertAfterCarId: insertion?.afterCarId || null,
    };
  } else {
    trainGhost = {
      x,
      y,
      ang: train.ang || 0,
      onRail: false,
      hit: null,
      dir,
      carKind,
      powerIntent,
      fromExisting: !!drag?.fromExisting,
      carId: drag?.carId || null,
      insertionTargets,
      insertion,
      insertAfterCarId: insertion?.afterCarId || null,
    };
  }
}

function onPointerMove(e) {
  if (!drag && !ghost && !trainGhost) return;
  const p = canvasPoint(e);

  if (drag?.kind === "pan") {
    panByScreen(view, e.clientX - drag.lx, e.clientY - drag.ly);
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
    // Rigid group translate from drag origins
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

    // Snap free ends of the selection to free ends outside it
    // (internal joints stay locked by the rigid move)
    const gsnap = findGroupSnap(board, selectedIds, SNAP_DIST);
    if (gsnap) {
      for (const id of Object.keys(drag.origins)) {
        const pc = getPiece(board, id);
        if (pc) {
          pc.x += gsnap.dx;
          pc.y += gsnap.dy;
        }
      }
      rebuild(board);
      drag.snapped = true;
    } else {
      drag.snapped = false;
    }
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
    color: ghost.color,
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
    color: snap.color,
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
        color: s.color,
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
          color: s.color,
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
      const kind = drag.carKind || carTool || "engine";
      const powerIntent = drag.powerIntent || "active";
      if (kind === "mid" && !drag.fromExisting) {
        if (countMidCars(train) >= MAX_MID_CARS) {
          setHint("hint.midLimit", { max: MAX_MID_CARS });
        } else {
          if (!train.cars?.length) train.cars = [];
          // Drop layout template so free mid is never absorbed into a forced consist
          train.consistSpec = null;
          const car = spawnFreeCar(
            train,
            "mid",
            trainGhost.hit.x,
            trainGhost.hit.y,
            trainGhost.ang || 0
          );
          if (!car) {
            setHint("hint.midLimit", { max: MAX_MID_CARS });
          } else {
            snapCarPoseToHit(car, trainGhost.hit, train.dir || 1);
            car.coupled = false;
            // Auto-link if dropped near the powered chain tail
            const linked = tryRecoupleCar(
              train,
              car.id,
              COUPLER_DIST * 1.35,
              board,
              trainGhost.insertAfterCarId
            );
            const rejected = !linked && !!car.placementRejected;
            if (rejected) removeCar(train, car.id);
            trainPlaced = true;
            train.selected = true;
            train.selectedCarId = car.id;
            setHint(
              rejected
                ? "hint.midRejected"
                : linked
                ? "hint.midCoupled"
                : "hint.midFree",
              { count: countMidCars(train), max: MAX_MID_CARS }
            );
          }
        }
      } else if (drag.fromExisting && drag.carId && train.cars) {
        // Re-seat a selected car
        const car = train.cars.find((c) => c.id === drag.carId);
        if (car && !car.powered) {
          snapCarPoseToHit(car, trainGhost.hit, train.dir || 1);
          if (
            tryRecoupleCar(
              train,
              car.id,
              COUPLER_DIST * 1.35,
              board,
              trainGhost.insertAfterCarId
            )
          ) {
            setHint("hint.carRecoupled");
          } else {
            setHint("hint.carReseated");
          }
        } else {
          // Powered engine re-seat — preserve consist state (uncoupled cars, active engine)
          placeTrainOnPath(train, trainGhost.hit, {
            dir: train.dir || 1,
            keepDir: true,
            board,
          });
          setHint("hint.engineOnRails");
        }
        trainPlaced = true;
        train.selected = true;
      } else if (
        !drag.fromExisting &&
        kind === "engine" &&
        powerIntent === "passive" &&
        !train.cars?.length
      ) {
        // Parked/passive stock may be placed before an active engine. It is
        // inert until an active engine is added and explicitly coupled.
        const eng = spawnFreeCar(
          train,
          "engine",
          trainGhost.hit.x,
          trainGhost.hit.y,
          trainGhost.ang || 0,
          { powered: false }
        );
        if (eng) {
          snapCarPoseToHit(eng, trainGhost.hit, train.dir || 1);
          eng.powered = false;
          eng.coupled = false;
          eng.facing = -1;
          trainPlaced = true;
          train.selected = true;
          train.selectedCarId = eng.id;
          setHint("hint.passiveParked");
        }
      } else if (
        !drag.fromExisting &&
        kind === "engine" &&
        train.cars?.length
      ) {
        // Extra engine from palette — free unit (trail), never rebuild multi template
        train.consistSpec = null;
        const eng = spawnFreeCar(
          train,
          "engine",
          trainGhost.hit.x,
          trainGhost.hit.y,
          trainGhost.ang || 0,
          { powered: false }
        );
        if (eng) {
          snapCarPoseToHit(eng, trainGhost.hit, train.dir || 1);
          eng.coupled = false;
          eng.powered = false;
          eng.facing = -1;
          const linked = tryRecoupleCar(
            train,
            eng.id,
            COUPLER_DIST * 1.35,
            board,
            trainGhost.insertAfterCarId
          );
          const rejected = !linked && !!eng.placementRejected;
          if (rejected) removeCar(train, eng.id);
          const madeActive =
            !rejected && powerIntent === "active"
              ? setActiveEngine(train, eng.id)
              : false;
          trainPlaced = true;
          train.selected = true;
          train.selectedCarId = eng.id;
          setHint(
            rejected
              ? "hint.engineRejected"
              : powerIntent === "active"
              ? madeActive
                ? linked
                  ? "hint.activeCoupled"
                  : "hint.activeParkedPrev"
                : "hint.activeFail"
              : linked
                ? "hint.passiveCoupled"
                : "hint.passiveFree"
          );
        }
      } else {
        // First engine place alone — never auto-append mid/trail
        train.consistSpec = null;
        train.cars = null;
        placeTrainOnPath(train, trainGhost.hit, {
          dir: train.dir || 1,
          keepDir: true,
          hardReset: false,
          board,
        });
        // Guarantee single unit (layout template must never reappear here)
        if (train.cars?.length !== 1) {
          ensureSingleEngine(train);
          train.cars[0].mode = TrainMode.ON_RAIL;
          train.cars[0].pathRef = train.pathRef;
          train.cars[0].s = train.s;
          train.cars[0].dir = train.dir;
          train.cars[0].x = train.x;
          train.cars[0].y = train.y;
          train.cars[0].ang = train.ang;
        }
        train.consistSpec = null;
        trainPlaced = true;
        train.selected = true;
        train.selectedCarId = train.cars[0]?.id || "lead";
        running = false;
        clearSelection();
        setHint("hint.engineAlone");
      }
      running = false;
      clearSelection();
    } else {
      setHint("hint.dropOnRail");
    }
    trainGhost = null;
    trainTool = false;
    carTool = null;
    refreshPaletteActive();
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
        selectedIds.size ? "hint.boxSelected" : "hint.boxEmpty",
        selectedIds.size ? { count: selectedIds.size } : undefined
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
    setHint(
      drag.snapped ? "hint.movedSnapped" : "hint.movedPieces",
      { count: selectedIds.size }
    );
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
        setHint("hint.piecePlaced");
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
          color: s.color,
        });
        setSelection([piece.id]);
        setHint("hint.pieceSelected");
      } else {
        commitGhostMove();
        setHint("hint.pieceMoved");
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

function updateStatus() {
  const mode = trainPlaced
    ? running
      ? localizedMode(train.mode)
      : `${localizedMode(train.mode)}${train.pathRef ? "" : t("status.offPath")}`
    : t("status.noTrain");
  const tool = trainTool
    ? t("status.trainTool")
    : paletteTool
      ? PIECE_META[paletteTool]?.code || paletteTool
      : selectedIds.size > 1
        ? t("status.sel", { count: selectedIds.size })
        : "—";
  statusEl.innerHTML = t("status.line", {
    count: board.pieces.length,
    tool,
    state: mode,
  });

  badgeEl.className = "badge";
  if (!trainPlaced) {
    badgeEl.innerHTML = t("badge.build");
  } else if (train.mode === TrainMode.ON_RAIL && running) {
    badgeEl.classList.add("ok");
    badgeEl.innerHTML = t("badge.onRails");
  } else if (train.mode === TrainMode.OFF_RAIL) {
    badgeEl.classList.add("warn");
    badgeEl.innerHTML = t("badge.offRails");
  } else if (train.mode === TrainMode.STOPPED) {
    badgeEl.classList.add("danger");
    badgeEl.innerHTML = t("badge.stopped");
  } else {
    badgeEl.innerHTML = t("badge.generic", { mode: localizedMode(train.mode) });
  }
}

function updateBounds() {
  bounds =
    solidPlayfield && fixedPlayfieldBounds
      ? { ...fixedPlayfieldBounds }
      : playfieldBounds(view, 20);
}

/** Last canvas size we auto-fitted for (skip thrash on tiny resizes). */
let lastAutoFit = { w: 0, h: 0 };

function onResize() {
  const r = resizeCanvas(canvas);
  view.w = r.w;
  view.h = r.h;
  updateBounds();
  // Big layout change (rotate phone, open sidebar, etc.) → keep track framed
  const dw = Math.abs(r.w - lastAutoFit.w);
  const dh = Math.abs(r.h - lastAutoFit.h);
  if (
    board.pieces?.length &&
    lastAutoFit.w > 0 &&
    (dw > 140 || dh > 140)
  ) {
    fitBoardToView(solidPlayfield ? SOLID_PLAYFIELD_FIT_PAD : 48);
  } else if (lastAutoFit.w === 0 && r.w > 0) {
    lastAutoFit = { w: r.w, h: r.h };
  }
}

window.addEventListener("resize", onResize);
// visualViewport catches mobile browser chrome show/hide better than window.resize alone
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onResize);
  window.visualViewport.addEventListener("scroll", onResize);
}
// Stage size changes when the sidebar opens/closes (grid reflow)
if (typeof ResizeObserver !== "undefined" && canvas?.parentElement) {
  const ro = new ResizeObserver(() => onResize());
  ro.observe(canvas.parentElement);
}
onResize();

// Wheel / trackpad zoom toward cursor
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.11;
    zoomAt(sx, sy, viewScale() * factor);
  },
  { passive: false }
);

// Light pinch-zoom for touch (two fingers)
let pinch = null;
canvas.addEventListener(
  "touchstart",
  (e) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinch = {
        dist: Math.hypot(dx, dy),
        scale: viewScale(),
        mx: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        my: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      };
    }
  },
  { passive: true }
);
canvas.addEventListener(
  "touchmove",
  (e) => {
    if (!pinch || e.touches.length !== 2) return;
    e.preventDefault();
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.hypot(dx, dy);
    if (pinch.dist < 8) return;
    const rect = canvas.getBoundingClientRect();
    const sx = pinch.mx - rect.left;
    const sy = pinch.my - rect.top;
    zoomAt(sx, sy, pinch.scale * (dist / pinch.dist));
  },
  { passive: false }
);
canvas.addEventListener(
  "touchend",
  () => {
    pinch = null;
  },
  { passive: true }
);

// ── Collapsible left sidebar ──
const SIDEBAR_LS = "plarail-sidebar-collapsed";
const appEl = document.getElementById("app");
const btnSidebarToggle = document.getElementById("btn-sidebar-toggle");
const btnSidebarOpen = document.getElementById("btn-sidebar-open");

function setSidebarCollapsed(collapsed) {
  if (!appEl) return;
  appEl.classList.toggle("sidebar-collapsed", !!collapsed);
  if (btnSidebarToggle) {
    btnSidebarToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    btnSidebarToggle.title = collapsed ? "Show sidebar" : "Collapse sidebar";
    btnSidebarToggle.setAttribute(
      "aria-label",
      collapsed ? "Show sidebar" : "Collapse sidebar"
    );
  }
  if (btnSidebarOpen) {
    btnSidebarOpen.hidden = !collapsed;
    btnSidebarOpen.setAttribute("aria-expanded", collapsed ? "false" : "true");
  }
  try {
    localStorage.setItem(SIDEBAR_LS, collapsed ? "1" : "0");
  } catch {
    /* ignore */
  }
  // Let the CSS width transition finish, then refit the canvas
  requestAnimationFrame(() => {
    onResize();
    setTimeout(onResize, 300);
  });
}

function toggleSidebar() {
  setSidebarCollapsed(!appEl?.classList.contains("sidebar-collapsed"));
}

btnSidebarToggle?.addEventListener("click", toggleSidebar);

/** Narrow viewports: default sidebar collapsed so the stage gets space. */
function preferCollapsedSidebar() {
  return window.matchMedia("(max-width: 900px)").matches;
}

{
  let collapsed = false;
  try {
    const stored = localStorage.getItem(SIDEBAR_LS);
    if (stored === "1") collapsed = true;
    else if (stored === "0") collapsed = false;
    else collapsed = preferCollapsedSidebar();
  } catch {
    collapsed = preferCollapsedSidebar();
  }
  setSidebarCollapsed(collapsed);
}

window.matchMedia("(max-width: 900px)").addEventListener("change", (ev) => {
  // Only auto-collapse when entering narrow; don't force-open on wide
  if (ev.matches) setSidebarCollapsed(true);
});
btnSidebarOpen?.addEventListener("click", () => setSidebarCollapsed(false));

function fitWorldRect(rect, pad = 40) {
  camFitWorldRect(view, rect, pad);
  updateBounds();
}

function fitBoardToView(pad = 48) {
  camFitBoard(view, board, pad, UNIT);
  if (solidPlayfield && !fixedPlayfieldBounds) {
    fixedPlayfieldBounds = solidPlayfieldBounds(view, board, 20);
  }
  updateBounds();
  lastAutoFit = { w: view.w, h: view.h };
}

/** Demo / recording hooks (camera fit, mode probes). */
window.__plarailDemo = {
  getView: () => ({ ...view }),
  getMode: () => train.mode,
  /** World pose for loop-cut / demos (x,y,ang,s,mode). */
  getTrainPose: () => ({
    x: train.x,
    y: train.y,
    ang: train.ang,
    s: train.s,
    mode: train.mode,
    speed: train.speed,
    pieceId: train.pathRef?.pieceId ?? null,
    pathId: train.pathRef?.pathId ?? null,
  }),
  getTelemetry: () => trainTelemetry.snapshot(),
  analyzeTelemetry: () => analyzeTrainTrace(trainTelemetry.snapshot()),
  getWorldContract: () => buildWorldContract(board, bounds),
  inspectWorld: () =>
    inspectTrainState(board, train, bounds, { solidPlayfield }),
  renderWorldAscii: (opts = {}) =>
    renderWorldAscii(board, train, bounds, opts),
  clearTelemetry: () => trainTelemetry.clear(),
  setTelemetryDebug(enabled) {
    trainTelemetry.setEnabled(enabled);
    try {
      localStorage.setItem("plarail-debug-telemetry", enabled ? "1" : "0");
    } catch {
      /* ignore */
    }
  },
  isRunning: () => running,
  setSidebarCollapsed,
  fitWorldRect,
  fitBoardToView,
  /** Hide chrome for clean capture. */
  setRecordChrome(hidden) {
    document.getElementById("app")?.classList.toggle("demo-record", !!hidden);
    onResize();
  },
  /** Start / stop without needing visible toolbar buttons. */
  start() {
    unlockAudio();
    if (!trainPlaced) {
      const s = viewScale();
      const cx = view.camX + view.w / s / 2;
      const cy = view.camY + view.h / s / 2;
      if (!tryPlaceTrainAt(cx, cy, 2000)) return false;
    }
    if (train.mode === TrainMode.STOPPED) return false;
    if (
      !train.pathRef &&
      train.mode !== TrainMode.OFF_RAIL &&
      !tryPlaceTrainAt(train.x, train.y, 56)
    )
      return false;
    if (startTrain(train)) {
      running = true;
      train.selected = false;
      startMotor(train.speed / 140);
      setHint("hint.running");
      updateStatus();
      return true;
    }
    return false;
  },
  stop() {
    running = false;
    stopTrain(train);
    stopMotor();
    setHint("hint.paused");
    updateStatus();
  },
};

// Startup: ?track= / ?layout= deep link → else autosave → else real meme track
{
  const requestedId = trackIdFromSearch(window.location.search);
  const requested = requestedId ? getTrackById(requestedId) : null;
  if (requested?.load) {
    if (trackSelect) trackSelect.value = requested.id;
    const info = requested.load(board);
    applyTrackLoadInfo(info);
    if (hasKey(`track.note.${requested.id}`)) {
      setHint(`track.note.${requested.id}`, { count: info.pieceCount });
    } else {
      setHint("track.loadedGeneric", {
        name: hasKey(`track.${requested.id}`)
          ? t(`track.${requested.id}`)
          : requested.name,
      });
    }
  } else {
    const loaded = tryLoadAutosave();
    if (!loaded) {
      const info = loadRealMemeTrack(board);
      placeTrainAtHint(info.trainHint);
      applySpeed(info.speed ?? info.trainHint?.speed ?? 210);
      persistLayout();
      setHint("track.note.real-meme", { count: info.pieceCount });
    } else {
      setHint("track.restoredAutosave");
    }
  }
  // Fit whole track after layout settles (sidebar width, canvas size)
  requestAnimationFrame(() => {
    onResize();
    fitBoardToView(solidPlayfield ? SOLID_PLAYFIELD_FIT_PAD : 48);
  });
  console.info("[Plarail] build 20260817 — aren't enough rails + ?track= deep links");
}

function frame(t) {
  const dt = Math.min(0.033, (t - lastT) / 1000);
  lastT = t;

  if (running) {
    updateTrain(train, board, dt, bounds, {
      solidPlayfield,
      telemetry: trainTelemetry,
    });
    if (train.mode === TrainMode.STOPPED) {
      running = false;
      setHint(solidPlayfield ? "hint.stoppedSolid" : "hint.stoppedEdge");
    }
  }

  // Synthesized train audio (Web Audio — no external libs).
  // Pass per-car modes so each unit thumps off-rail and taps on re-rail.
  syncTrainAudio(
    {
      running,
      mode: train.mode,
      wallHit: !!train.wallHit,
      wallGlide: !!train.wallHit,
      speed: train.speed,
      cars: train.cars
        ? train.cars.map((c) => ({ id: c.id, mode: c.mode }))
        : null,
    },
    audioMem
  );

  updateBounds();
  updateStatus();

  const ctx = canvas.getContext("2d");
  const recordChrome = document.getElementById("app")?.classList.contains("demo-record");
  drawScene(ctx, view, board, train, ghost, {
    // Hide playfield chrome during demo capture for a cleaner still/video
    bounds: recordChrome ? null : bounds,
    solidPlayfield: recordChrome ? false : solidPlayfield,
    showWalls: recordChrome ? false : showWalls,
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
  telemetry: trainTelemetry,
  getTelemetry: () => trainTelemetry.snapshot(),
  analyzeTelemetry: () => analyzeTrainTrace(trainTelemetry.snapshot()),
  getWorldContract: () => buildWorldContract(board, bounds),
  inspectWorld: () =>
    inspectTrainState(board, train, bounds, { solidPlayfield }),
  renderWorldAscii: (opts = {}) =>
    renderWorldAscii(board, train, bounds, opts),
  clearTelemetry: () => trainTelemetry.clear(),
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
