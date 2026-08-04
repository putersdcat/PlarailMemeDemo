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
} from "./geometry.js";
import {
  createBoard,
  addPiece,
  removePiece,
  clearBoard,
  rotatePiece,
  flipPiece,
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
import { loadMemeStyle, loadOval } from "./presets.js";

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
let showWalls = false;
let lastT = performance.now();
let hidePieceId = null;

// ── Palette ──
const paletteOrder = [
  "R01",
  "R02",
  "R03",
  "R04",
  "R07",
  "R08",
  "R105",
  "R11",
  "R12",
  "R14",
  "R17",
];

function refreshPaletteActive() {
  document.querySelectorAll(".piece-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === paletteTool);
  });
}

for (const type of paletteOrder) {
  const btn = document.querySelector(`.piece-btn[data-type="${type}"]`);
  if (!btn) continue;
  const c = btn.querySelector("canvas");
  if (c) {
    c.width = 72;
    c.height = 52;
    drawPaletteIcon(c, type);
  }

  // Click = highlight active palette piece (for right-click stamp only)
  btn.addEventListener("click", (e) => {
    // Ignore click that ends a drag-from-palette
    if (drag?.kind === "palette" || drag?.suppressClick) return;
    paletteTool = paletteTool === type ? null : type;
    refreshPaletteActive();
    const meta = PIECE_META[type];
    setHint(
      paletteTool
        ? `Selected: ${meta.code} ${meta.name}. Left-drag from palette to place · Right-click empty canvas to stamp.`
        : "Palette selection cleared. Left-drag pieces from the palette to build."
    );
  });

  // Pointer drag from palette
  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    paletteTool = type;
    refreshPaletteActive();
    beginPaletteDrag(type, e);
  });
}

// ── Toolbar buttons ──
document.getElementById("btn-rotate").addEventListener("click", () => {
  if (ghost) {
    rotateGhost(1);
  } else if (board.selectedId) rotatePiece(board, board.selectedId, 1);
});
document.getElementById("btn-flip").addEventListener("click", () => {
  if (ghost) {
    flipGhost();
  } else if (board.selectedId) flipPiece(board, board.selectedId);
});
document.getElementById("btn-delete").addEventListener("click", () => {
  if (board.selectedId) {
    removePiece(board, board.selectedId);
    setHint("Piece deleted.");
  }
});
document.getElementById("btn-clear").addEventListener("click", () => {
  clearBoard(board);
  resetTrainHard(train);
  trainPlaced = false;
  running = false;
  ghost = null;
  drag = null;
  hidePieceId = null;
  setHint("Board cleared. Left-drag pieces from the palette, or pick a tool and click the canvas.");
});
document.getElementById("btn-meme").addEventListener("click", () => {
  const cx = view.w / 2 + view.camX;
  const cy = view.h / 2 + view.camY;
  const info = loadMemeStyle(board, cx, cy);
  placeTrainAtHint(info.trainHint);
  setHint(info.note || "Meme-style layout loaded.");
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
    const result = loadBoard(board, data);
    if (!result.ok) {
      setHint(result.error || "Could not load layout.");
      return;
    }
    running = false;
    resetTrainHard(train);
    trainPlaced = false;
    // Optional train restore
    if (data.train && data.train.x != null) {
      const hit = closestPathPoint(board, data.train.x, data.train.y);
      if (hit) {
        placeTrainOnPath(train, hit);
        trainPlaced = true;
      }
    }
    setHint(`Loaded ${result.pieceCount} pieces from ${file.name}.`);
    updateStatus();
  } catch (err) {
    setHint(`Load failed: ${err.message || err}`);
  }
});

async function saveLayoutToFile() {
  try {
    const payload = serializeBoard(board);
    // Optional train snapshot
    if (trainPlaced) {
      payload.train = {
        x: train.x,
        y: train.y,
        ang: train.ang,
        mode: train.mode,
      };
    }
    const json = JSON.stringify(payload, null, 2);
    const defaultName = `plarail-layout-${dateStamp()}.json`;

    // File System Access API (Chrome/Edge secure contexts). Abort = user cancel only.
    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: defaultName,
          types: [
            {
              description: "Plarail layout JSON",
              accept: { "application/json": [".json"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(json);
        await writable.close();
        setHint(
          `Saved layout (${board.pieces.length} pieces) to ${handle.name}.`
        );
        return;
      } catch (err) {
        if (err?.name === "AbortError") {
          setHint("Save cancelled.");
          return;
        }
        // Not supported / permission / etc. → download fallback
        console.warn("showSaveFilePicker failed, using download:", err);
      }
    }

    downloadJsonFile(json, defaultName);
    setHint(
      `Downloaded ${defaultName} (${board.pieces.length} pieces). Check Downloads folder.`
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
  // Revoke after click has been processed
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

function dateStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

btnStart.addEventListener("click", () => {
  if (!trainPlaced) {
    setHint("Right-click a rail path to place the train, then Start.");
    return;
  }
  if (train.mode === TrainMode.STOPPED) {
    setHint("Train hit the edge. Reset Train, right-click a rail to place, then Start.");
    return;
  }
  if (startTrain(train)) {
    running = true;
    setHint("Running. Open ends derail; walls deflect free train; canvas edge stops it.");
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
  setHint("Train cleared. Right-click a rail to place it, then Start.");
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
    if (ghost) {
      rotateGhost(1);
    } else if (board.selectedId) rotatePiece(board, board.selectedId, 1);
  } else if (e.key === "f" || e.key === "F") {
    if (ghost) {
      flipGhost();
    } else if (board.selectedId) flipPiece(board, board.selectedId);
  } else if (e.key === "Delete" || e.key === "Backspace") {
    if (
      board.selectedId &&
      (document.activeElement === document.body ||
        document.activeElement === canvas)
    ) {
      e.preventDefault();
      removePiece(board, board.selectedId);
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
    board.selectedId = null;
    paletteTool = null;
    refreshPaletteActive();
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
  ghost.flip = !ghost.flip;
  const o = originFromWorldPivot(ghost, piv.x, piv.y);
  ghost.x = o.x;
  ghost.y = o.y;
  ghost.pivotX = piv.x;
  ghost.pivotY = piv.y;
  applyGhostSnap();
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

  // ── RIGHT CLICK: train / switch / rotate ──
  if (e.button === 2) {
    e.preventDefault();
    handleRightClick(p);
    return;
  }

  if (e.button !== 0) return;

  canvas.setPointerCapture?.(e.pointerId);

  // Hit-test piece / lever
  const hit = hitTestPiece(board, p.x, p.y);

  // Left on lever still toggles (convenient)
  if (hit?.lever) {
    toggleSwitch(board, hit.pieceId);
    board.selectedId = hit.pieceId;
    setHint("Switch toggled (yellow lever). Right-click also works.");
    return;
  }

  // Left drag existing piece
  if (hit?.pieceId) {
    const piece = getPiece(board, hit.pieceId);
    board.selectedId = hit.pieceId;
    hidePieceId = piece.id;
    const piv = worldPivot(piece);
    ghost = makeGhostAtPivot(piece.type, piv.x, piv.y, {
      id: piece.id,
      rotSteps: piece.rotSteps,
      flip: piece.flip,
      branchSide: piece.branchSide,
      switchState: piece.switchState,
    });
    // Free its ports for re-snap
    board.pieces = board.pieces.filter((q) => q.id !== piece.id);
    rebuild(board);

    drag = {
      kind: "move",
      pieceId: piece.id,
      pieceSnapshot: { ...piece },
      // Grab offset relative to visual center
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

  // Left-click empty: deselect only (no spawn)
  board.selectedId = null;
}

function handleRightClick(p) {
  const hit = hitTestPiece(board, p.x, p.y);

  if (hit?.lever) {
    toggleSwitch(board, hit.pieceId);
    board.selectedId = hit.pieceId;
    setHint("Switch toggled.");
    return;
  }

  // Right-click piece → rotate 45°
  if (hit?.pieceId) {
    board.selectedId = hit.pieceId;
    rotatePiece(board, hit.pieceId, 1);
    setHint("Rotated 45° (right-click piece). F flips · Del deletes.");
    return;
  }

  // Right-click path → place train
  const pathHit = closestPathPoint(board, p.x, p.y);
  if (pathHit && pathHit.dist < 40) {
    placeTrainOnPath(train, pathHit);
    trainPlaced = true;
    running = false;
    setHint("Train placed. Press Start (or Space).");
    updateStatus();
    return;
  }

  // Right-click empty + palette selection → stamp piece (optional place)
  if (paletteTool) {
    ghost = makeGhostAtPivot(paletteTool, p.x, p.y);
    applyGhostSnap();
    commitGhostPlace();
    setHint("Piece stamped (right-click). Left-drag from palette also works.");
    return;
  }

  setHint(
    "Right-click: rail → train · piece → rotate · empty + palette select → stamp · lever → switch."
  );
}

function onPointerMove(e) {
  if (!drag && !ghost) return;
  const p = canvasPoint(e);

  if (drag?.kind === "pan") {
    view.camX -= e.clientX - drag.lx;
    view.camY -= e.clientY - drag.ly;
    drag.lx = e.clientX;
    drag.ly = e.clientY;
    return;
  }

  if (drag?.kind === "palette" || drag?.kind === "move") {
    const dist = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
    if (dist > 4) drag.moved = true;

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
  board.selectedId = piece.id;
  ghost = null;
  hidePieceId = null;
  return piece;
}

function commitGhostMove() {
  if (!ghost || !drag?.pieceSnapshot) return;
  const snap = drag.pieceSnapshot;
  // Re-insert at ghost pose
  const piece = addPiece(board, snap.type, ghost.x, ghost.y, ghost.rotSteps, {
    flip: ghost.flip,
    branchSide: snap.branchSide,
    switchState: snap.switchState,
  });
  // Preserve id stability not required; selection:
  board.selectedId = piece.id;
  ghost = null;
  hidePieceId = null;
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
    return;
  }

  if (drag.kind === "pan") {
    drag = null;
    return;
  }

  if (drag.kind === "palette") {
    if (ghost) {
      // Only place if pointer is over stage-ish or moved
      const rect = canvas.getBoundingClientRect();
      const over =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (over || drag.moved) {
        commitGhostPlace();
        setHint(
          ghost?.snapped || true
            ? "Piece placed. Green glow = snap ready while dragging near open ends."
            : "Piece placed."
        );
        // fix: ghost already null after commit
        setHint(
          "Piece placed. Drag near open ends to snap · Right-click rail for train."
        );
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
        // Simple click-select: put piece back exactly where it was
        const s = drag.pieceSnapshot;
        addPiece(board, s.type, s.x, s.y, s.rotSteps, {
          flip: s.flip,
          branchSide: s.branchSide,
          switchState: s.switchState,
        });
        board.selectedId = board.pieces[board.pieces.length - 1]?.id;
        setHint("Selected. Left-drag to move · Right-click to rotate · Del to delete.");
      } else {
        commitGhostMove();
        setHint("Piece moved. Magnetic snap joins open ends when they get close.");
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
  const mode = trainPlaced ? modeLabel(train.mode) : "No train";
  const tool = paletteTool ? PIECE_META[paletteTool]?.code || paletteTool : "—";
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

// Initial empty-friendly state + simple oval so something works out of the box
{
  const cx = view.w / 2;
  const cy = view.h / 2;
  const info = loadOval(board, cx, cy);
  placeTrainAtHint(info.trainHint);
  setHint(
    "Left-drag track from palette · Right-click rail for train · Save/Load JSON for your layouts · Start to run."
  );
}

function frame(t) {
  const dt = Math.min(0.033, (t - lastT) / 1000);
  lastT = t;

  if (running) {
    updateTrain(train, board, dt, bounds);
    if (train.mode === TrainMode.STOPPED) {
      running = false;
      setHint(
        "Train left the playfield. Reset Train, right-click a rail, then Start."
      );
    }
  }

  updateBounds();
  updateStatus();

  const ctx = canvas.getContext("2d");
  drawScene(ctx, view, board, train, ghost, {
    bounds,
    showWalls,
    trainVisible: trainPlaced,
    hidePieceId,
  });

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

window.__sim = {
  board,
  train,
  get running() {
    return running;
  },
  get trainPlaced() {
    return trainPlaced;
  },
  get view() {
    return view;
  },
  findSnap,
};
