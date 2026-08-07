import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, assert, assertEq } from "./assert.mjs";
import { createBoard, rebuild } from "../js/track.js";
import { createIo } from "../js/app/io.js";

const root = join(fileURLToPath(new URL("..", import.meta.url)));

test("saved legacy consist loads aligned and does not restore stale coordinates", () => {
  const saved = JSON.parse(
    readFileSync(
      join(root, "notenough-plarail-layout-20260807-0735.json"),
      "utf8"
    )
  );
  const board = createBoard();
  const train = {};
  let placed = false;
  let prepared = false;
  let placedCars = null;
  let placedMeta = null;
  let restored = false;
  let appliedSpeed = null;
  let fitPad = null;

  const io = createIo({
    board,
    train,
    getTrainPlaced: () => placed,
    setTrainPlaced: (value) => {
      placed = value;
    },
    setRunning: () => {},
    resetTrainHard: () => {},
    clearSelection: () => {},
    setHint: () => {},
    updateStatus: () => {},
    fitBoardToView: (pad) => {
      fitPad = pad;
    },
    applySpeed: (value) => {
      appliedSpeed = value;
    },
    tryPlaceTrainAt: () => false,
    placeTrainAtHint: () => {},
    prepareLoadedLayout: (data) => {
      prepared = true;
      const minY = Math.min(
        ...board.pathIndex
          .filter((path) => path.active)
          .flatMap((path) => path.points.map((point) => point.y))
      );
      const dy = 36 - minY;
      for (const piece of board.pieces) piece.y += dy;
      rebuild(board);
      return {
        ...data,
        train: {
          ...data.train,
          y: data.train.y + dy,
        },
      };
    },
    placeLayoutCars: (cars, meta) => {
      placedCars = cars;
      placedMeta = meta;
      return true;
    },
    restoreTrainState: () => {
      restored = true;
    },
    serializeTrainCars: () => null,
    lsKey: "plarail-test-saved-track",
  });

  assert(io.applyLoadedLayout(saved, "saved track"));
  assert(prepared, "saved layout preparation should run after board load");
  assertEq(board.pieces.length, saved.pieces.length);
  const minY = Math.min(
    ...board.pathIndex
      .filter((path) => path.active)
      .flatMap((path) => path.points.map((point) => point.y))
  );
  assert(Math.abs(minY - 36) < 1e-6, `north rail should align at y=36, got ${minY}`);
  assertEq(placedCars.length, 3);
  assertEq(placedCars.map((car) => car.id).join(","), "lead,mid1,trail1");
  assertEq(placedCars[1].kind, "mid");
  assertEq(placedCars[2].facing, -1);
  assertEq(placedMeta.y, saved.train.y + (36 - (-78.39999999999992)));
  assert(!restored, "legacy consist metadata must not restore stale runtime pose");
  assertEq(appliedSpeed, 200);
  assertEq(fitPad, 18, "solid saved layout should use the tight wall fit");
});