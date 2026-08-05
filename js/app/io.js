/**
 * Save / load / localStorage persistence for layouts.
 */
import { serializeBoard, loadBoard, closestPathPoint } from "../track.js";

/**
 * @param {{
 *   board: object,
 *   train: object,
 *   getTrainPlaced: () => boolean,
 *   setTrainPlaced: (v: boolean) => void,
 *   placeTrainOnPath: Function,
 *   resetTrainHard: Function,
 *   tryPlaceTrainAt: Function,
 *   placeTrainAtHint: Function,
 *   setHint: Function,
 *   updateStatus: Function,
 *   clearSelection: Function,
 *   lsKey: string,
 * }} deps
 */
export function createIo(deps) {
  const {
    board,
    train,
    getTrainPlaced,
    setTrainPlaced,
    placeTrainOnPath,
    resetTrainHard,
    tryPlaceTrainAt,
    placeTrainAtHint,
    setHint,
    updateStatus,
    clearSelection,
    lsKey,
  } = deps;

  let runningFlag = null; // set by host if needed

  function setRunningRef(ref) {
    runningFlag = ref;
  }

  function buildSavePayload() {
    const payload = serializeBoard(board);
    if (getTrainPlaced()) {
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
      localStorage.setItem(lsKey, JSON.stringify(buildSavePayload()));
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
    if (runningFlag) runningFlag.value = false;
    resetTrainHard(train);
    setTrainPlaced(false);
    clearSelection();
    if (data.train && data.train.x != null) {
      tryPlaceTrainAt(data.train.x, data.train.y);
    } else {
      placeTrainAtHint({ x: 528.73, y: 653 });
    }
    persistLayout();
    setHint(`Loaded ${result.pieceCount} pieces from ${label}.`);
    updateStatus();
    return true;
  }

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

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

  function tryLoadAutosave() {
    try {
      const raw = localStorage.getItem(lsKey);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data?.pieces?.length) return false;
      return applyLoadedLayout(data, "autosave");
    } catch (err) {
      console.warn("autosave load failed", err);
      return false;
    }
  }

  function bindFileUi() {
    document.getElementById("btn-save")?.addEventListener("click", () => {
      saveLayoutToFile();
    });
    document.getElementById("btn-load")?.addEventListener("click", () => {
      document.getElementById("file-load")?.click();
    });
    document.getElementById("file-load")?.addEventListener("change", async (e) => {
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
  }

  return {
    buildSavePayload,
    persistLayout,
    applyLoadedLayout,
    saveLayoutToFile,
    tryLoadAutosave,
    bindFileUi,
    setRunningRef,
  };
}
