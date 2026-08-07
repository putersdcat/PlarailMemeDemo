/**
 * Save / load / localStorage persistence for layouts.
 */
import { serializeBoard, loadBoard } from "../track.js";

/**
 * @param {{
 *   board: object,
 *   train: object,
 *   getTrainPlaced: () => boolean,
 *   setTrainPlaced: (v: boolean) => void,
 *   setRunning: (v: boolean) => void,
 *   tryPlaceTrainAt: (x: number, y: number, maxDist?: number) => boolean,
 *   placeTrainSnapshot?: (snapshot: object) => boolean,
 *   restoreTrainState?: (snapshot: object) => boolean,
 *   placeTrainAtHint: (hint: object) => void,
 *   resetTrainHard: Function,
 *   applySpeed: (speed: number|string) => void,
 *   fitBoardToView: (pad?: number) => void,
 *   setHint: Function,
 *   updateStatus: Function,
 *   prepareLoadedLayout?: (data: object) => object,
 *   clearSelection: Function,
 *   lsKey: string,
 *   defaultSpeed?: number,
 * }} deps
 */
export function createIo(deps) {
  const {
    board,
    train,
    getTrainPlaced,
    setTrainPlaced,
    setRunning,
    tryPlaceTrainAt,
    placeTrainAtHint,
    resetTrainHard,
    applySpeed,
    fitBoardToView,
    setHint,
    updateStatus,
    prepareLoadedLayout,
    clearSelection,
    lsKey,
    defaultSpeed = 210,
  } = deps;

  function buildSavePayload() {
    const payload = serializeBoard(board);
    if (getTrainPlaced()) {
      payload.train = {
        x: train.x,
        y: train.y,
        ang: train.ang,
        mode: train.mode,
        speed: train.speed,
        s: train.s,
        dir: train.dir,
        vx: train.vx,
        vy: train.vy,
        poweredId: train.poweredId,
        selectedCarId: train.selectedCarId,
        pathRef: train.pathRef
          ? {
              pieceId: train.pathRef.pieceId,
              pathId: train.pathRef.pathId,
            }
          : null,
        offRailPreferAng: train.offRailPreferAng,
        offRailDistAcc: train.offRailDistAcc,
        offRailStepsDone: train.offRailStepsDone,
        reRailDistLeft: train.reRailDistLeft,
        reRailCooldown: train.reRailCooldown,
        openMouthClearSteps: train.openMouthClearSteps,
        cornerLockSteps: train.cornerLockSteps,
        cornerLockUx: train.cornerLockUx,
        cornerLockUy: train.cornerLockUy,
      };
      // Each car is its own entity (no consist template)
      if (typeof deps.serializeTrainCars === "function") {
        const cars = deps.serializeTrainCars(train);
        if (cars?.length) payload.train.cars = cars;
      } else if (train.cars?.length) {
        payload.train.cars = train.cars.map((c) => ({
          id: c.id,
          role: c.role,
          kind: c.kind,
          facing: c.facing,
          coupled: !!c.coupled,
          powered: !!c.powered,
          x: c.x,
          y: c.y,
          ang: c.ang,
          mode: c.mode,
        }));
      }
    }
    payload.speed = train.speed;
    payload.savedAt = new Date().toISOString();
    return payload;
  }

  function persistLayout() {
    if (typeof globalThis.localStorage?.setItem !== "function") return;
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
    // A saved file may need the same board alignment/feature setup as a
    // built-in preset. The callback runs after loadBoard so it can inspect
    // rebuilt paths/walls, and may return a shifted, normalized data copy.
    const loadedData =
      typeof prepareLoadedLayout === "function"
        ? prepareLoadedLayout(data) || data
        : data;
    const trainData = loadedData.train ? { ...loadedData.train } : null;
    let convertedLegacyConsist = false;
    // Older saved tracks used `train.consist` instead of live `train.cars`.
    // Convert that metadata at the persistence boundary so the rest of the
    // loader always exercises the separate-car placement path.
    if (
      trainData &&
      !Array.isArray(trainData.cars) &&
      Array.isArray(trainData.consist) &&
      trainData.consist.length
    ) {
      convertedLegacyConsist = true;
      trainData.cars = trainData.consist.map((spec, index, all) => {
        const kind = spec?.kind || (spec?.role === "mid" ? "mid" : "engine");
        const isLead = index === 0;
        const isTrail =
          spec?.role === "trail" ||
          (!isLead && kind === "engine" && index === all.length - 1);
        return {
          ...spec,
          id:
            spec?.id ||
            (isLead ? "lead" : isTrail ? "trail1" : `mid${index}`),
          role: spec?.role || (isLead ? "lead" : isTrail ? "trail" : "mid"),
          kind,
          powered: isLead || !!spec?.powered,
          coupled: isLead ? true : spec?.coupled !== false,
          facing:
            spec?.facing ?? (isTrail && kind === "engine" ? -1 : 1),
          mode: spec?.mode || "on_rail",
        };
      });
    }
    if (trainData) loadedData.train = trainData;
    setRunning(false);
    resetTrainHard(train);
    setTrainPlaced(false);
    clearSelection();
    let trainWasPlaced = false;
    if (trainData?.cars?.length && typeof deps.placeLayoutCars === "function") {
      // Restore separate car entities (coupled as saved)
      const ok = deps.placeLayoutCars(trainData.cars, trainData);
      trainWasPlaced = !!ok;
      setTrainPlaced(trainWasPlaced);
    } else if (trainData && trainData.x != null) {
      const canPlaceFree =
        (trainData.mode === "off_rail" || trainData.mode === "stopped") &&
        typeof deps.placeTrainSnapshot === "function";
      trainWasPlaced = canPlaceFree
        ? !!deps.placeTrainSnapshot(trainData)
        : !!tryPlaceTrainAt(trainData.x, trainData.y);
    } else {
      placeTrainAtHint({ x: 528.73, y: 653 });
      trainWasPlaced = getTrainPlaced();
    }
    const hasSavedCarPoses =
      Array.isArray(trainData?.cars) &&
      trainData.cars.some(
        (car) => Number.isFinite(car?.x) && Number.isFinite(car?.y)
      );
    const hasRuntimeState =
      !!trainData &&
      !convertedLegacyConsist &&
      (hasSavedCarPoses ||
        trainData.mode === "off_rail" ||
        trainData.mode === "stopped" ||
        !!trainData.pathRef);
    if (
      trainWasPlaced &&
      hasRuntimeState &&
      typeof deps.restoreTrainState === "function"
    ) {
      deps.restoreTrainState(trainData);
    }
    applySpeed(
      trainData?.speed ?? loadedData.speed ?? defaultSpeed
    );
    persistLayout();
    fitBoardToView(
      loadedData?.solidPlayfield || loadedData?.northAlign ? 18 : 48
    );
    setHint(`Loaded ${result.pieceCount} pieces from ${label}.`);
    updateStatus();
    return true;
  }

  function dateStamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(
      d.getHours()
    )}${p(d.getMinutes())}`;
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
    document
      .getElementById("file-load")
      ?.addEventListener("change", async (e) => {
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
  };
}
