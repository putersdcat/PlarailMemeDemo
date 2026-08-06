/**
 * Core off-rail physics: corner-redirect material + track slide regression.
 * These should fail loudly if corner thrash or wall-slide regressions return.
 */
import { test, assert, assertEq, assertApprox } from "./assert.mjs";
import {
  createTrain,
  updateTrain,
  TrainMode,
  cornerExitDir,
  pickCornerPair,
  wallSlideDir,
  playfieldWallSegments,
  resolvePlayfieldAabb,
  OFF_RAIL_DS,
} from "../js/train.js";
import { createBoard, rebuild } from "../js/track.js";

function makeOffRailTrain(x, y, ang, speed = 200) {
  const train = createTrain();
  train.mode = TrainMode.OFF_RAIL;
  train.speed = speed;
  train.x = x;
  train.y = y;
  train.ang = ang;
  train.vx = Math.cos(ang) * speed;
  train.vy = Math.sin(ang) * speed;
  train.offRailPreferAng = ang;
  train.reRailDistLeft = 99999;
  train.offRailDistAcc = 0;
  train.offRailStepsDone = 0;
  return train;
}

test("cornerExitDir: enter leftward on top → leave along free edge not into corner", () => {
  // Top normal (0,1) down into playfield, left normal (1,0) right into playfield
  // Inbound into top-left: left + up (uy negative if y-down)
  const { tx, ty } = cornerExitDir(0, 1, 1, 0, -1, -0.2, Math.PI);
  // Must not point into both walls (into top = up = -y, into left = -x)
  assert(tx * 0 + ty * 1 >= -0.05, `should not dive into top (ty=${ty})`);
  assert(tx * 1 + ty * 0 >= -0.05, `should not dive into left (tx=${tx})`);
  assert(Math.hypot(tx, ty) > 0.9, "unit-ish direction");
});

test("pickCornerPair only when cornerRedirect material + ~90°", () => {
  const hitsTrack = [
    { nx: 0, ny: 1, pen: 2, cornerRedirect: false },
    { nx: 1, ny: 0, pen: 1.5, cornerRedirect: false },
  ];
  assertEq(pickCornerPair(hitsTrack), null);

  const hitsWood = [
    { nx: 0, ny: 1, pen: 2, cornerRedirect: true },
    { nx: 1, ny: 0, pen: 1.5, cornerRedirect: true },
  ];
  const pair = pickCornerPair(hitsWood);
  assert(pair && pair.a && pair.b);

  // Parallel walls — not a corner
  const parallel = [
    { nx: 1, ny: 0, pen: 2, cornerRedirect: true },
    { nx: 0.99, ny: 0.1, pen: 1.5, cornerRedirect: true },
  ];
  // |dot| ~ 0.99 > CORNER_DOT_MAX
  assertEq(pickCornerPair(parallel), null);
});

test("wallSlideDir never reverses travel along a single wall", () => {
  // Wall normal +y (top), traveling right (+x)
  const a = wallSlideDir(0, 1, 1, 0, 0);
  assert(a.tx > 0.5, "continue right");
  // Traveling left
  const b = wallSlideDir(0, 1, -1, 0, Math.PI);
  assert(b.tx < -0.5, "continue left");
});

test("playfield segments carry cornerRedirect material", () => {
  const segs = playfieldWallSegments({ minX: 0, minY: 0, maxX: 100, maxY: 80 });
  assertEq(segs.length, 4);
  assert(segs.every((s) => s.cornerRedirect === true));
});

test("solid walls: mid-edge slide stays off_rail and keeps moving", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  // Head left into left wall mid-edge
  const train = makeOffRailTrain(40, 150, Math.PI, 220);
  const x0 = train.x;
  for (let i = 0; i < 180; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  assert(train.x > bounds.minX - 2, `inside box x=${train.x}`);
  // Should have traveled along the wall (changed y) or moved, not frozen at impact
  const moved = Math.hypot(train.x - x0, train.y - 150);
  assert(moved > OFF_RAIL_DS * 5, `expected motion along/away, moved=${moved}`);
});

test("solid walls: corner shot does not flap — leaves corner, stays off_rail", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  // Aim into top-left corner from inside
  const train = makeOffRailTrain(30, 30, (-3 * Math.PI) / 4, 240);
  const angs = [];
  let maxDistToCorner = 0;
  for (let i = 0; i < 300; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    assertEq(train.mode, TrainMode.OFF_RAIL);
    const d = Math.hypot(train.x - 0, train.y - 0);
    maxDistToCorner = Math.max(maxDistToCorner, d);
    angs.push(train.ang);
  }
  // Left the immediate corner neighborhood at some point (not stuck on vertex)
  assert(
    maxDistToCorner > 35,
    `should leave corner; maxDist=${maxDistToCorner}`
  );
  // Heading thrash: large frame-to-frame turns after the first moments
  let thrash = 0;
  const start = Math.floor(angs.length * 0.35);
  for (let i = start + 1; i < angs.length; i++) {
    let d = angs[i] - angs[i - 1];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 1.4) thrash++; // >~80° step = real flip-flop
  }
  const steps = angs.length - start - 1;
  assert(
    thrash < steps * 0.12,
    `too many heading flips: thrash=${thrash}/${steps}`
  );
});

test("solid walls: all four corners escape without STOPPED", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const shots = [
    { x: 25, y: 25, ang: (-3 * Math.PI) / 4 }, // top-left
    { x: 375, y: 25, ang: -Math.PI / 4 }, // top-right
    { x: 375, y: 275, ang: Math.PI / 4 }, // bottom-right
    { x: 25, y: 275, ang: (3 * Math.PI) / 4 }, // bottom-left
  ];
  for (const s of shots) {
    const train = makeOffRailTrain(s.x, s.y, s.ang, 220);
    for (let i = 0; i < 200; i++) {
      updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    }
    assertEq(train.mode, TrainMode.OFF_RAIL);
    assert(train.x >= bounds.minX - 2 && train.x <= bounds.maxX + 2);
    assert(train.y >= bounds.minY - 2 && train.y <= bounds.maxY + 2);
  }
});

test("resolvePlayfieldAabb: vertical wall keeps slide, kills into-wall only", () => {
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const R = 9;
  // On right wall, heading down — must keep uy, kill any +ux
  let r = resolvePlayfieldAabb(400 - R, 150, 0.5, 1, Math.PI / 2, bounds, R);
  assert(r.x <= 400 - R + 0.01, "seated on right");
  assert(r.ux <= 0.01, "no into-right velocity");
  assert(r.uy > 0.9, `keep sliding down, uy=${r.uy}`);

  // On right wall, heading up
  r = resolvePlayfieldAabb(400 - R, 150, 0, -1, -Math.PI / 2, bounds, R);
  assert(r.uy < -0.9, `keep sliding up, uy=${r.uy}`);

  // On left wall, heading down
  r = resolvePlayfieldAabb(R, 150, 0, 1, Math.PI / 2, bounds, R);
  assert(r.ux >= -0.01, "no into-left");
  assert(r.uy > 0.9, "slide down on left");

  // Head-on into right wall at exact boundary (equality trap)
  r = resolvePlayfieldAabb(400 - R, 150, 1, 0, 0, bounds, R);
  assert(Math.abs(r.ux) < 0.1, "kill head-on into right");
  assert(Math.abs(r.uy) > 0.9, `must inject vertical slide, got uy=${r.uy} ang=${r.ang}`);
});

test("resolvePlayfieldAabb: BR corner from vertical does not jam", () => {
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const R = 9;
  // Exactly on BR seat, still trying to go down (the old stuck case)
  const r = resolvePlayfieldAabb(400 - R, 300 - R, 0, 1, Math.PI / 2, bounds, R);
  assert(r.uy <= 0.01, `must kill down into bottom, uy=${r.uy}`);
  // Should leave along free axis (left or up)
  assert(
    (r.ux < -0.9 && Math.abs(r.uy) < 0.1) || (r.uy < -0.9 && Math.abs(r.ux) < 0.1),
    `free-axis exit expected, got ux=${r.ux} uy=${r.uy}`
  );
});

test("solid walls: ride full right wall down then around BR without freeze", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const train = makeOffRailTrain(391, 40, Math.PI / 2, 220);
  const ys = [];
  const angs = [];
  for (let i = 0; i < 350; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    assertEq(train.mode, TrainMode.OFF_RAIL);
    ys.push(train.y);
    angs.push(train.ang);
  }
  // Reached bottom region
  assert(Math.max(...ys) > 250, `should reach bottom, maxY=${Math.max(...ys)}`);
  // Late motion still changing position (not frozen)
  const lateX = [];
  const t2x = train.x;
  for (let i = 0; i < 40; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    lateX.push(train.x);
  }
  assert(
    Math.abs(train.x - t2x) > 5 || new Set(lateX.map((v) => v.toFixed(0))).size > 2,
    `frozen after vertical ride: x=${train.x} y=${train.y} ang=${train.ang}`
  );
});

test("solid walls: ride full left wall up without 180 jam", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const train = makeOffRailTrain(9, 250, -Math.PI / 2, 220);
  let minY = train.y;
  for (let i = 0; i < 200; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    minY = Math.min(minY, train.y);
    assertEq(train.mode, TrainMode.OFF_RAIL);
  }
  assert(minY < 80, `should climb left wall toward top, minY=${minY}`);
  // Heading should stay roughly vertical while on left, or become horizontal after corner
  // — never sit still with nose into the wall for long
  const x0 = train.x;
  const y0 = train.y;
  for (let i = 0; i < 30; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  assert(
    Math.hypot(train.x - x0, train.y - y0) > 8,
    `stuck after left-wall climb: ${train.x},${train.y}`
  );
});

test("solid walls: 90° mid-edge hit aligns parallel and keeps moving", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  // Head straight into bottom wall mid-span
  const train = makeOffRailTrain(200, 250, Math.PI / 2, 220);
  for (let i = 0; i < 90; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  // Carriage should be roughly parallel to bottom wall (heading ±X)
  assert(
    Math.abs(Math.cos(train.ang)) > 0.85,
    `expected parallel to bottom, ang=${train.ang}`
  );
  // Not frozen at impact point
  const x0 = train.x;
  for (let i = 0; i < 60; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  assert(Math.abs(train.x - x0) > 10, `should slide along wall, dx=${train.x - x0}`);
});

test("solid walls: 45° into wall ends up sliding aligned", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const train = makeOffRailTrain(200, 240, Math.PI / 4, 220);
  for (let i = 0; i < 120; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  // After contact, should be nearly axis-aligned to a wall (0, ±90, 180)
  const a = ((train.ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const nearAxis =
    Math.min(a, Math.abs(a - Math.PI / 2), Math.abs(a - Math.PI), Math.abs(a - 1.5 * Math.PI), Math.abs(a - 2 * Math.PI)) < 0.35;
  assert(nearAxis, `expected wall-aligned heading, ang=${train.ang}`);
});

test("solid walls: slide along bottom into BR does not freeze (rear-axle trap)", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  // Same failure mode as the user screenshot path: along floor into lower-right
  const train = makeOffRailTrain(200, 290, 0, 280);
  const samples = [];
  for (let i = 0; i < 400; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (i % 40 === 0) samples.push({ x: train.x, y: train.y, ang: train.ang });
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  // Must not sit frozen at one pose for the whole second half
  const late = samples.slice(5);
  const xs = new Set(late.map((s) => s.x.toFixed(0)));
  const ys = new Set(late.map((s) => s.y.toFixed(0)));
  assert(
    xs.size > 1 || ys.size > 1,
    `frozen near BR: ${JSON.stringify(late.slice(-3))}`
  );
  // And should not remain pinned in the BR pocket forever
  const dCorner = Math.hypot(train.x - 400, train.y - 300);
  assert(dCorner > 25, `still pinned in BR pocket d=${dCorner}`);
});

test("solid walls: slide along right into BR does not freeze", () => {
  const board = createBoard();
  rebuild(board);
  const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 300 };
  const train = makeOffRailTrain(390, 150, Math.PI / 2, 280);
  const positions = [];
  for (let i = 0; i < 400; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: true });
    if (i >= 200 && i % 20 === 0) positions.push([train.x, train.y]);
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  const uniq = new Set(positions.map(([x, y]) => `${x.toFixed(0)},${y.toFixed(0)}`));
  assert(uniq.size >= 3, `stuck on right/BR: ${[...uniq].join(" | ")}`);
});

test("track-style walls (no cornerRedirect): single wall slide still stable", () => {
  // Synthetic long horizontal wall (no cornerRedirect) — like track plastic
  const board = createBoard();
  board.walls = [
    { x1: 0, y1: 100, x2: 500, y2: 100 }, // no cornerRedirect
  ];
  const train = makeOffRailTrain(100, 95, 0, 180); // head right, slightly above wall
  // Prefer into the wall from above (normal will point up if center above)
  train.y = 108; // below segment if y-down... segment y=100, center 108 is below → normal +y
  train.ang = 0;
  train.vx = 180;
  train.vy = 0;
  train.offRailPreferAng = 0;
  const bounds = { minX: -500, minY: -500, maxX: 1000, maxY: 1000 };
  const ang0 = [];
  for (let i = 0; i < 120; i++) {
    updateTrain(train, board, 1 / 60, bounds, { solidPlayfield: false });
    ang0.push(train.ang);
  }
  assertEq(train.mode, TrainMode.OFF_RAIL);
  // Should keep roughly sliding horizontally (no 90° thrash)
  let flips = 0;
  for (let i = 1; i < ang0.length; i++) {
    let d = ang0[i] - ang0[i - 1];
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    if (Math.abs(d) > 1.0) flips++;
  }
  assert(flips < 10, `track wall thrash flips=${flips}`);
});
