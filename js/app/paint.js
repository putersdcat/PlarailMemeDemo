/**
 * One-shot paint bucket: pick a color swatch, click a piece once.
 */
import { normalizePieceColor } from "../track.js";

/** @type {null | "blue"|"green"|"red"|"gray"} */
let paintColor = null;

/**
 * @param {{
 *   canvas: HTMLCanvasElement,
 *   setHint: (s: string) => void,
 *   onArm?: () => void,
 * }} deps
 */
export function createPaintController(deps) {
  const { canvas, setHint, onArm } = deps;

  function refreshSwatches() {
    document.querySelectorAll(".paint-swatch").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.color === paintColor);
    });
    canvas.classList.toggle("paint-cursor", !!paintColor);
  }

  function setPaintMode(color) {
    const next = color ? normalizePieceColor(color) : null;
    paintColor = paintColor === next ? null : next;
    refreshSwatches();
    if (paintColor) {
      onArm?.();
      setHint(
        `Paint: ${paintColor}. Click a track piece once to color it.`
      );
    } else {
      setHint("Paint cancelled.");
    }
  }

  function clearPaintMode() {
    if (!paintColor) return;
    paintColor = null;
    refreshSwatches();
  }

  function getPaintColor() {
    return paintColor;
  }

  function isPainting() {
    return !!paintColor;
  }

  /** Apply paint to a piece; returns true if applied. */
  function applyToPiece(piece) {
    if (!paintColor || !piece) return false;
    piece.color = normalizePieceColor(paintColor);
    const painted = piece.color;
    clearPaintMode();
    setHint(`Painted piece ${painted}.`);
    return true;
  }

  function bindUi() {
    document.querySelectorAll(".paint-swatch").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setPaintMode(btn.dataset.color);
      });
    });
  }

  return {
    setPaintMode,
    clearPaintMode,
    getPaintColor,
    isPainting,
    applyToPiece,
    bindUi,
    refreshSwatches,
  };
}
