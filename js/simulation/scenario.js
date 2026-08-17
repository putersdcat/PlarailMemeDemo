import {
  closestPathPoint,
  createBoard,
  loadBoard,
} from "../track.js";
import {
  createView,
  fitBoardToView,
  playfieldBounds,
  solidPlayfieldBounds,
} from "../app/camera.js";
import {
  createTrain,
  createTrainTelemetry,
  placeLayoutCars,
  placeTrainOnPath,
  SOLID_PLAYFIELD_FIT_PAD,
  startTrain,
  TrainMode,
  updateTrain,
} from "../train.js";
import { angleDiff } from "../geometry.js";
import { prepareLoadedWorld } from "../app/world-persistence.js";

function legacyCars(consist) {
  return (consist || []).map((spec, index, all) => {
    const kind = spec?.kind || (spec?.role === "mid" ? "mid" : "engine");
    const lead = index === 0;
    const trail =
      spec?.role === "trail" ||
      (!lead && kind === "engine" && index === all.length - 1);
    return {
      ...spec,
      id: spec?.id || (lead ? "lead" : trail ? "trail1" : `mid${index}`),
      role: spec?.role || (lead ? "lead" : trail ? "trail" : "mid"),
      kind,
      powered: lead || !!spec?.powered,
      coupled: lead ? true : spec?.coupled !== false,
      facing: spec?.facing ?? (trail && kind === "engine" ? -1 : 1),
      mode: spec?.mode || TrainMode.ON_RAIL,
    };
  });
}

function travelDirection(hint, hit) {
  if (!hint || !Number.isFinite(hint.ang)) return 1;
  return angleDiff(hint.ang, hit.ang) <=
    angleDiff(hint.ang, hit.ang + Math.PI)
    ? 1
    : -1;
}

/** Build browser-equivalent board/train/bounds from any layout JSON object. */
export function createLayoutScenario(data, opts = {}) {
  if (!data || typeof data !== "object") {
    throw new Error("Scenario layout must be an object");
  }
  const board = createBoard();
  const loaded = loadBoard(board, data);
  if (!loaded.ok) throw new Error(loaded.error || "Could not load layout");
  const prepared = prepareLoadedWorld(
    board,
    data,
    opts.northPathY ?? 36
  );
  const loadedData = prepared.data;

  const solidPlayfield =
    opts.solidPlayfield != null
      ? !!opts.solidPlayfield
      : loadedData.solidPlayfield !== false;
  const trainData = loadedData.train
    ? structuredClone(loadedData.train)
    : null;

  const train = createTrain();
  const hint = trainData || { x: 0, y: 0, ang: 0, speed: 210 };
  const hit = closestPathPoint(board, hint.x, hint.y, opts.seatRadius ?? 160);
  if (!hit) throw new Error("No active rail found near the scenario train hint");
  const dir = travelDirection(hint, hit);
  const cars = trainData?.cars?.length
    ? trainData.cars
    : legacyCars(trainData?.consist);
  if (cars.length) {
    placeLayoutCars(train, cars, board, { seatHit: hit, dir });
  } else {
    placeTrainOnPath(train, hit, { dir, board });
  }
  train.speed = Number(trainData?.speed ?? loadedData.speed ?? 210) || 210;

  const view = createView(opts.viewportWidth ?? 1546, opts.viewportHeight ?? 645);
  fitBoardToView(
    view,
    board,
    solidPlayfield ? SOLID_PLAYFIELD_FIT_PAD : opts.fitPad ?? 48,
    96
  );
  const bounds =
    prepared.playfieldBounds ||
    (solidPlayfield
      ? solidPlayfieldBounds(view, board, opts.wallPadScreen ?? 20)
      : playfieldBounds(view, opts.wallPadScreen ?? 20));

  if (opts.start !== false && !startTrain(train)) {
    throw new Error(`Could not start scenario train (mode=${train.mode})`);
  }
  return {
    board,
    train,
    view,
    bounds,
    solidPlayfield,
    northShift: prepared.dy,
    loadedPieces: loaded.pieceCount,
    layout: loadedData,
  };
}

/** Deterministically advance a scenario and return standard telemetry JSON. */
export function runLayoutScenario(scenario, opts = {}) {
  const frames = Math.max(1, Number(opts.frames ?? 900) || 900);
  const dt = Number(opts.dt ?? 1 / 60) || 1 / 60;
  const telemetry =
    opts.telemetry ||
    createTrainTelemetry({
      enabled: true,
      maxFrames: frames + 2,
      maxEvents: Math.max(100, frames * (opts.eventsPerFrame ?? 32)),
    });
  telemetry.setEnabled(true);
  for (let frame = 0; frame < frames; frame++) {
    updateTrain(
      scenario.train,
      scenario.board,
      dt,
      scenario.bounds,
      {
        solidPlayfield: scenario.solidPlayfield,
        telemetry,
      }
    );
    opts.onFrame?.(frame, scenario, telemetry);
    if (
      opts.stopOnTerminal !== false &&
      [TrainMode.STOPPED, TrainMode.STALLED].includes(scenario.train.mode)
    ) {
      break;
    }
  }
  return telemetry.snapshot();
}
