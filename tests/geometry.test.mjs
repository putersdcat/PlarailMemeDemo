import { test, assert, assertEq, assertApprox } from "./assert.mjs";
import {
  UNIT,
  HALF,
  buildTemplate,
  normalizeAngle,
  angleDiff,
  pointOnPolyline,
  polylineLength,
  normalizePieceType,
  isMirrorable,
  worldGeometry,
} from "../js/geometry.js";

test("UNIT / HALF constants", () => {
  assertEq(UNIT, 96);
  assertEq(HALF, 48);
});

test("normalizePieceType maps legacy ids", () => {
  assertEq(normalizePieceType("R90"), "R105");
  assertEq(normalizePieceType("RY3"), "R17");
  assertEq(normalizePieceType("R01"), "R01");
});

test("R01 straight: length UNIT, opposite genders", () => {
  const t = buildTemplate("R01", { flip: false });
  assertEq(t.connectors.length, 2);
  assertEq(t.connectors[0].gender, "M");
  assertEq(t.connectors[1].gender, "F");
  const len = polylineLength(t.paths[0].points);
  assertApprox(len, UNIT, 0.01);
});

test("R01 flip swaps genders only", () => {
  const a = buildTemplate("R01", { flip: false });
  const b = buildTemplate("R01", { flip: true });
  assertEq(a.connectors[0].gender, "M");
  assertEq(b.connectors[0].gender, "F");
  assertEq(a.connectors[1].gender, "F");
  assertEq(b.connectors[1].gender, "M");
  // Geometry ends stay the same
  assertApprox(a.connectors[0].x, b.connectors[0].x, 0.01);
  assertApprox(a.connectors[1].x, b.connectors[1].x, 0.01);
});

test("R03 curve gender flip keeps path endpoints", () => {
  const a = buildTemplate("R03", { flip: false, branchSide: "R" });
  const b = buildTemplate("R03", { flip: true, branchSide: "R" });
  const pa = a.paths[0].points;
  const pb = b.paths[0].points;
  assertApprox(pa[0].x, pb[0].x, 0.01);
  assertApprox(pa[0].y, pb[0].y, 0.01);
  assertApprox(pa[pa.length - 1].x, pb[pb.length - 1].x, 0.01);
  assertApprox(pa[pa.length - 1].y, pb[pb.length - 1].y, 0.01);
  assertEq(a.connectors[0].gender, "M");
  assertEq(b.connectors[0].gender, "F");
});

test("R03 mirror (branchSide L) reverses bend", () => {
  const r = buildTemplate("R03", { branchSide: "R" });
  const l = buildTemplate("R03", { branchSide: "L" });
  const re = r.paths[0].points[r.paths[0].points.length - 1];
  const le = l.paths[0].points[l.paths[0].points.length - 1];
  assert(Math.abs(re.y + le.y) < 1e-6 || Math.sign(re.y) !== Math.sign(le.y) || Math.abs(re.y) < 1e-6,
    "mirror should flip curve side");
  // endpoints y should be opposite signs for 45° arcs
  assertApprox(re.y, -le.y, 0.01);
});

test("isMirrorable for curves and turnouts", () => {
  assert(isMirrorable("R03"));
  assert(isMirrorable("R11"));
  assert(isMirrorable("R13"));
  assert(!isMirrorable("R01"));
  assert(!isMirrorable("R14"));
});

test("R11 L/R branch on opposite sides", () => {
  const r = buildTemplate("R11", { branchSide: "R" });
  const l = buildTemplate("R11", { branchSide: "L" });
  const rc = r.connectors.find((c) => c.id === "c");
  const lc = l.connectors.find((c) => c.id === "c");
  assert(rc && lc, "branch connector c");
  assert(Math.sign(rc.y) !== Math.sign(lc.y) || Math.abs(rc.y) < 1e-6);
});

test("R17 has 4 connectors and 3 switch paths", () => {
  const t = buildTemplate("R17");
  assertEq(t.connectors.length, 4);
  assertEq(t.paths.length, 3);
  assert(t.switchable);
  assertEq(t.switchCount, 3);
});

test("R20 is quarter unit", () => {
  const t = buildTemplate("R20");
  const len = polylineLength(t.paths[0].points);
  assertApprox(len, UNIT * 0.25, 0.01);
});

test("pointOnPolyline endpoints", () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
  ];
  const a = pointOnPolyline(pts, 0);
  const b = pointOnPolyline(pts, 1);
  assertApprox(a.x, 0);
  assertApprox(b.x, 100);
  assertApprox(a.ang, 0);
});

test("angleDiff wraps", () => {
  assertApprox(angleDiff(0, Math.PI * 2), 0, 1e-9);
  assert(angleDiff(0, Math.PI) > 3);
});

test("worldGeometry maps connectors to world", () => {
  const piece = {
    id: "t1",
    type: "R01",
    x: 100,
    y: 50,
    rotSteps: 0,
    flip: false,
    branchSide: "R",
  };
  const g = worldGeometry(piece);
  assertEq(g.connectors.length, 2);
  assertApprox(g.connectors[0].wx, 100 - UNIT / 2, 0.01);
  assertApprox(g.connectors[0].wy, 50, 0.01);
});
