/**
 * Unit tests for demo loop cut helpers (real shipped js/app/demo-loop.js).
 */
import { test, assert, assertEq } from "./assert.mjs";
import {
  angDiff,
  nearStart,
  loopCloseState,
} from "../js/app/demo-loop.js";

const start = { x: 100, y: 200, ang: 0 };

test("angDiff wraps across ±π", () => {
  assert(angDiff(0, Math.PI * 2) < 1e-9);
  assert(angDiff(0.1, -0.1) < 0.21);
  assert(angDiff(Math.PI - 0.01, -Math.PI + 0.01) < 0.05);
});

test("nearStart accepts close pose same heading", () => {
  assert(nearStart({ x: 110, y: 205, ang: 0.05 }, start, 40, 0.85));
});

test("nearStart accepts flipped heading", () => {
  assert(nearStart({ x: 105, y: 200, ang: Math.PI }, start, 40, 0.85));
});

test("nearStart rejects far pose", () => {
  assert(!nearStart({ x: 400, y: 200, ang: 0 }, start, 40, 0.85));
});

test("loopCloseState requires leave-then-return and min time", () => {
  // Immediately at start after re-rail: not away yet
  let st = loopCloseState({
    pose: { x: 100, y: 200, ang: 0 },
    start,
    afterRerailMs: 10_000,
    sawAwayAfterRerail: false,
    minMs: 6000,
    awayDist: 140,
  });
  assertEq(st.close, false);
  assertEq(st.away, false);

  // Far from start: marks away, still not close
  st = loopCloseState({
    pose: { x: 400, y: 200, ang: 0 },
    start,
    afterRerailMs: 10_000,
    sawAwayAfterRerail: false,
    minMs: 6000,
    awayDist: 140,
  });
  assertEq(st.away, true);
  assertEq(st.close, false);

  // Returned after away + enough time
  st = loopCloseState({
    pose: { x: 108, y: 202, ang: 0.02 },
    start,
    afterRerailMs: 10_000,
    sawAwayAfterRerail: true,
    minMs: 6000,
    awayDist: 140,
    posTol: 40,
  });
  assertEq(st.close, true);

  // Too soon after re-rail even if near and was away
  st = loopCloseState({
    pose: { x: 108, y: 202, ang: 0 },
    start,
    afterRerailMs: 1000,
    sawAwayAfterRerail: true,
    minMs: 6000,
  });
  assertEq(st.close, false);
});
