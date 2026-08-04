/**
 * Plarail piece geometry templates (local space) + transform helpers.
 *
 * Dimensional system (see plarail_r01_to_r17_table.md):
 *   1 unit = R-01 length = R-03 curve radius ≈ 216 mm (sim: UNIT px)
 */

export const UNIT = 96;
export const HALF = UNIT / 2;
/** Historical large curve radius (R-04 era) ≈ 1.4 units. */
export const LARGE_R = UNIT * 1.4;
export const TRACK_W = 40;
export const HALF_W = TRACK_W / 2;
/**
 * Magnetic snap distance (medium).
 * Was 56 (too grabby) then ~26 (too tight); ~38 is the compromise.
 */
export const SNAP_DIST = 38;
export const SNAP_ANGLE = (22 * Math.PI) / 180;
export const DEG45 = Math.PI / 4;
/** Plarail double-track centreline spacing ≈ 70 mm ≈ 0.32 unit. */
export const DOUBLE_GAP = UNIT * 0.32;

export const PIECE_TYPES = {
  R01: "R01", // straight — 1 unit
  R02: "R02", // half straight — 0.5 unit
  R03: "R03", // curve 45° — radius 1 unit
  R04: "R04", // large curve 45° — radius ~1.4 units (historical / meme)
  R07: "R07", // double-length straight — 2 units
  R08: "R08", // stop rail — 1 unit + stop bump
  R10: "R10", // U-turn 180°
  R11: "R11", // turnout L/R — ~1×1 footprint
  R12: "R12", // figure-8 point L/R
  R13: "R13", // single↔double point A/B (L/R)
  R14: "R14", // cross point
  R17: "R17", // three-way point
  R20: "R20", // 1/4 straight — 0.25 unit
  R21: "R21", // double curve 90° (2× R-03)
  R22: "R22", // Y-point
  R23: "R23", // wavy / meandering rail
  /**
   * R-10.5 — custom single 90° (alias of catalog R-21 geometry).
   */
  R105: "R105",
  // Legacy aliases (load mapping)
  R01L: "R07",
  R01S: "R08",
  R09: "R04",
  RY3: "R17",
  R90: "R105",
};

export const PIECE_META = {
  R01: { code: "R-01", name: "Straight", desc: "1 unit", mirrorable: false },
  R02: { code: "R-02", name: "Half Straight", desc: "0.5 unit", mirrorable: false },
  R03: {
    code: "R-03",
    name: "Curve 45°",
    desc: "Radius 1 unit · 🦄 gender · ⇋ bend L/R",
    mirrorable: true,
  },
  R04: {
    code: "R-04",
    name: "Large Curve",
    desc: "45°, r≈1.4 · 🦄 gender · ⇋ bend L/R",
    mirrorable: true,
  },
  R07: { code: "R-07", name: "Double Straight", desc: "2 units", mirrorable: false },
  R08: { code: "R-08", name: "Stop Rail", desc: "1 unit + stop bump", mirrorable: false },
  R10: {
    code: "R-10",
    name: "U-Turn",
    desc: "180° reverse · 🦄 gender · ⇋ side",
    mirrorable: true,
  },
  R11: {
    code: "R-11",
    name: "Turnout L/R",
    desc: "Straight + R-03 branch · ⇋ L/R",
    mirrorable: true,
  },
  R12: {
    code: "R-12",
    name: "Fig-8 Point L/R",
    desc: "Curved turnout · ⇋ L/R",
    mirrorable: true,
  },
  R13: {
    code: "R-13",
    name: "Single/Double Point",
    desc: "1→2 track · ⇋ A/B (L/R)",
    mirrorable: true,
  },
  R14: { code: "R-14", name: "Cross Point", desc: "2×R-07 + 4×R-10.5 walls", mirrorable: false },
  R17: {
    code: "R-17",
    name: "3-Way Point",
    desc: "R-07 + R-02 offset + 2×R-04",
    mirrorable: false,
  },
  R20: {
    code: "R-20",
    name: "1/4 Straight",
    desc: "0.25 unit",
    mirrorable: false,
  },
  R21: {
    code: "R-21",
    name: "Double Curve 90°",
    desc: "2× R-03 = 90° · ⇋ bend L/R",
    mirrorable: true,
  },
  R22: {
    code: "R-22",
    name: "Y-Point",
    desc: "Dual curve split",
    mirrorable: false,
  },
  R23: {
    code: "R-23",
    name: "Wavy Rail",
    desc: "S-curve meander · ⇋ L/R",
    mirrorable: true,
  },
  R105: {
    code: "R-10.5",
    name: "Curve 90°",
    desc: "Custom 90° r=1 · same as R-21",
    mirrorable: true,
  },
};

/** Types where ⇋ mirror (branchSide L/R) changes geometry. */
export function isMirrorable(type) {
  const t = normalizePieceType(type);
  return !!PIECE_META[t]?.mirrorable;
}

/** Normalize legacy type ids from older saves / code. */
export function normalizePieceType(type) {
  if (!type) return type;
  const map = {
    R01L: "R07",
    R01S: "R08",
    R09: "R04",
    RY3: "R17",
    R90: "R105",
    "R-10.5": "R105",
    R10_5: "R105",
  };
  return map[type] || type;
}

/** Gender swap only — does not reverse curve bend (use mirror for L/R). */
export function gendersForFlip(flip, g0 = "M", g1 = "F") {
  if (!flip) return [g0, g1];
  return [g0 === "M" ? "F" : "M", g1 === "M" ? "F" : "M"];
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function normalizeAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

export function angleDiff(a, b) {
  return Math.abs(normalizeAngle(a - b));
}

export function rotStepsToRad(steps) {
  return steps * DEG45;
}

export function rotatePoint(x, y, ang) {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  return { x: x * c - y * s, y: x * s + y * c };
}

export function transformPoint(local, piece) {
  const ang = rotStepsToRad(piece.rotSteps);
  const r = rotatePoint(local.x, local.y, ang);
  return { x: piece.x + r.x, y: piece.y + r.y };
}

export function transformDir(localAng, piece) {
  return normalizeAngle(localAng + rotStepsToRad(piece.rotSteps));
}

/**
 * Visual pivot in local space — center of the rail bed (path samples),
 * NOT the model origin (which for curves is the off-piece curvature center).
 */
export function localPivotFromTemplate(tpl) {
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const path of tpl.paths || []) {
    // Weight endpoints more so pivots sit on the rail rather than only mid-arc
    const pts = path.points;
    if (!pts?.length) continue;
    for (let i = 0; i < pts.length; i++) {
      const w = i === 0 || i === pts.length - 1 ? 2 : 1;
      sx += pts[i].x * w;
      sy += pts[i].y * w;
      n += w;
    }
  }
  if (n === 0 && tpl.connectors?.length) {
    for (const c of tpl.connectors) {
      sx += c.x;
      sy += c.y;
      n++;
    }
  }
  if (n === 0) return { x: 0, y: 0 };
  return { x: sx / n, y: sy / n };
}

export function localPivotForPiece(pieceLike) {
  const tpl = buildTemplate(pieceLike.type, {
    flip: !!pieceLike.flip,
    branchSide: pieceLike.branchSide || "R",
  });
  return localPivotFromTemplate(tpl);
}

/** World-space visual center of a placed piece. */
export function worldPivot(piece) {
  const lp = localPivotForPiece(piece);
  return transformPoint(lp, piece);
}

/**
 * Model origin (piece.x/y) such that the visual pivot sits at (wx, wy)
 * with the given rotation / flip.
 */
export function originFromWorldPivot(pieceLike, wx, wy) {
  const lp = localPivotForPiece(pieceLike);
  const ang = rotStepsToRad(pieceLike.rotSteps ?? 0);
  const r = rotatePoint(lp.x, lp.y, ang);
  return { x: wx - r.x, y: wy - r.y };
}

/**
 * Rotate piece by delta 45° steps around its visual pivot (keeps rail in place).
 * Mutates piece.x, piece.y, piece.rotSteps.
 */
export function rotateAroundVisualPivot(piece, deltaSteps = 1) {
  const piv = worldPivot(piece);
  piece.rotSteps = (((piece.rotSteps + deltaSteps) % 8) + 8) % 8;
  const o = originFromWorldPivot(piece, piv.x, piv.y);
  piece.x = o.x;
  piece.y = o.y;
  return piece;
}

/**
 * Gender flip only (🦄) — swaps M/F. Geometry (curve bend / L/R) unchanged.
 * Keeps visual pivot fixed in world space.
 */
export function flipAroundVisualPivot(piece) {
  const piv = worldPivot(piece);
  piece.flip = !piece.flip;
  const o = originFromWorldPivot(piece, piv.x, piv.y);
  piece.x = o.x;
  piece.y = o.y;
  return piece;
}

/**
 * Geometric mirror (⇋) — toggles branchSide L ↔ R for asymmetric pieces
 * (turnouts, curve bend side, single/double point A/B, etc.).
 * Keeps visual pivot fixed. No-op side effect for symmetric types.
 */
export function mirrorAroundVisualPivot(piece) {
  const piv = worldPivot(piece);
  piece.branchSide = piece.branchSide === "L" ? "R" : "L";
  const o = originFromWorldPivot(piece, piv.x, piv.y);
  piece.x = o.x;
  piece.y = o.y;
  return piece;
}

/** Sample an arc: center (cx,cy), radius, from a0→a1 (radians), n points. */
export function sampleArc(cx, cy, r, a0, a1, n = 12) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + (a1 - a0) * t;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

export function polylineLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    L += Math.hypot(dx, dy);
  }
  return L;
}

export function pointOnPolyline(pts, s) {
  // s in [0,1]
  if (pts.length < 2) return { x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0, ang: 0 };
  const total = polylineLength(pts);
  let dist = Math.max(0, Math.min(1, s)) * total;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x;
    const dy = pts[i].y - pts[i - 1].y;
    const seg = Math.hypot(dx, dy) || 1e-9;
    if (dist <= seg) {
      const t = dist / seg;
      return {
        x: pts[i - 1].x + dx * t,
        y: pts[i - 1].y + dy * t,
        ang: Math.atan2(dy, dx),
      };
    }
    dist -= seg;
  }
  const n = pts.length;
  const dx = pts[n - 1].x - pts[n - 2].x;
  const dy = pts[n - 1].y - pts[n - 2].y;
  return { x: pts[n - 1].x, y: pts[n - 1].y, ang: Math.atan2(dy, dx) };
}

/**
 * Build local-space template for a piece type.
 * connectors: { id, x, y, ang (outward along path exit), gender: 'M'|'F' }
 * paths: { id, points[], fromC, toC, kind }
 * walls: [{x1,y1,x2,y2}] outer plastic edges (open mouths omitted)
 */
export function buildTemplate(type, options = {}) {
  const flip = !!options.flip;
  // branchSide "L" = geometric mirror (left bend / left branch / B side)
  const mirror = options.branchSide === "L";
  const side = mirror ? -1 : 1;
  const t = normalizePieceType(type);

  switch (t) {
    case "R01":
      return straightTemplate(UNIT, flip, "R01");
    case "R02":
      return straightTemplate(HALF, flip, "R02");
    case "R20":
      return straightTemplate(UNIT * 0.25, flip, "R20");
    case "R03":
      return curveTemplate(flip, UNIT, DEG45, "R03", mirror);
    case "R04":
      return curveTemplate(flip, LARGE_R, DEG45, "R04", mirror);
    case "R07":
      return straightTemplate(UNIT * 2, flip, "R07");
    case "R08":
      return stopStraightTemplate(flip);
    case "R10":
      return uTurnTemplate(flip, mirror);
    case "R105":
    case "R21":
      // R-21 = 2× R-03 = 90° at unit radius (R-10.5 same geometry)
      return curveTemplate(flip, UNIT, Math.PI / 2, t === "R21" ? "R21" : "R105", mirror);
    case "R11":
      return turnoutTemplate(side, flip);
    case "R12":
      return figureEightPointTemplate(side, flip);
    case "R13":
      return singleDoublePointTemplate(side, flip);
    case "R14":
      return crossTemplate(flip);
    case "R17":
      return threeWayTemplate(flip);
    case "R22":
      return yPointTemplate(flip);
    case "R23":
      return wavyTemplate(flip, mirror);
    default:
      return straightTemplate(UNIT, flip, "R01");
  }
}

function straightTemplate(len, flip, type) {
  const x0 = -len / 2;
  const x1 = len / 2;
  const g0 = flip ? "F" : "M";
  const g1 = flip ? "M" : "F";
  const path = [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
  ];
  // Side walls only — connector mouths stay open for derail / re-rail.
  const walls = outerWallsAlongPolyline(path, HALF_W, false, false);
  return {
    type: type || (len === UNIT ? PIECE_TYPES.R01 : PIECE_TYPES.R02),
    connectors: [
      { id: "a", x: x0, y: 0, ang: Math.PI, gender: g0 },
      { id: "b", x: x1, y: 0, ang: 0, gender: g1 },
    ],
    paths: [{ id: "main", points: path, fromC: "a", toC: "b" }],
    walls,
    bed: rectPoly(x0, -HALF_W, len, TRACK_W),
    webbingPolys: [offsetPolylinePoly(path, HALF_W)].filter(Boolean),
    color: null,
  };
}

/**
 * Curve arc. spanRad = 45° (R-03) or 90° (R-21 / R-10.5).
 * radius = UNIT or LARGE_R.
 *
 * 🦄 flip   = gender only (M↔F) — does NOT reverse the bend
 * ⇋ mirror = reverse arc (CW vs CCW) — L vs R bend
 * Center of curvature at origin; default (mirror=false) is CCW.
 */
function curveTemplate(
  flip,
  radius = UNIT,
  spanRad = DEG45,
  type = PIECE_TYPES.R03,
  mirror = false
) {
  const r = radius;
  const a0 = 0;
  const a1 = mirror ? -spanRad : spanRad;
  const nSamp = spanRad > DEG45 * 1.2 ? 24 : 16;
  const pts = sampleArc(0, 0, r, a0, a1, nSamp);

  // Path start tangent: CCW at a=0 is +Y; CW is -Y
  const startDir = mirror ? -Math.PI / 2 : Math.PI / 2;
  // At angle α, CCW tangent = α + π/2; CW = α - π/2
  const endDir = mirror ? a1 - Math.PI / 2 : a1 + Math.PI / 2;

  // Gender ONLY from flip — geometry independent
  const g0 = flip ? "F" : "M";
  const g1 = flip ? "M" : "F";

  const p0 = pts[0];
  const p1 = pts[pts.length - 1];

  const outerR = r + HALF_W;
  const innerR = Math.max(8, r - HALF_W);
  const outerPts = sampleArc(0, 0, outerR, a0, a1, nSamp);
  const innerPts = sampleArc(0, 0, innerR, a0, a1, nSamp);
  const walls = [];
  for (let i = 1; i < outerPts.length; i++) {
    walls.push({
      x1: outerPts[i - 1].x,
      y1: outerPts[i - 1].y,
      x2: outerPts[i].x,
      y2: outerPts[i].y,
    });
  }
  for (let i = 1; i < innerPts.length; i++) {
    walls.push({
      x1: innerPts[i - 1].x,
      y1: innerPts[i - 1].y,
      x2: innerPts[i].x,
      y2: innerPts[i].y,
    });
  }

  return {
    type,
    mirrorable: true,
    connectors: [
      {
        id: "a",
        x: p0.x,
        y: p0.y,
        ang: normalizeAngle(startDir + Math.PI),
        gender: g0,
      },
      { id: "b", x: p1.x, y: p1.y, ang: normalizeAngle(endDir), gender: g1 },
    ],
    paths: [{ id: "main", points: pts, fromC: "a", toC: "b" }],
    walls,
    webbingPolys: [offsetPolylinePoly(pts, HALF_W)].filter(Boolean),
    bed: null,
    color: null,
  };
}

/**
 * R-08 Stop Rail — 1 unit long with side stop/bump for wall glide.
 */
function stopStraightTemplate(flip) {
  const len = UNIT;
  const base = straightTemplate(len, flip, "R08");
  const bx0 = -len * 0.22;
  const bx1 = len * 0.22;
  const by0 = HALF_W;
  const by1 = HALF_W + 18;
  base.walls.push(
    { x1: bx0, y1: by0, x2: bx0, y2: by1 },
    { x1: bx0, y1: by1, x2: bx1, y2: by1 },
    { x1: bx1, y1: by1, x2: bx1, y2: by0 }
  );
  base.bump = true;
  return base;
}

/**
 * R-17 3分岐ポイントレール — same as stacking (user composite):
 *   1× R-07 double straight (2 units) for the through path
 *   1× R-02 half straight overlapping the INPUT end of the R-07
 *   2× R-04 large curves (45°, radius LARGE_R ≈ 1.4 unit) for L/R branches
 *
 * Hidden R-02 sits on the input end: throat is R-02 past the input mouth
 * (at x = −HALF). Branches leave early; long center run continues to exit.
 *
 *   input ── stem (0.5u = R-02) ── throat ─┬─ R-04 left
 *                                          ├─ center (1.5u)
 *                                          └─ R-04 right
 *                                          ── exit (R-07 far end)
 */
function threeWayTemplate(flip) {
  // Through = full R-07 length (2 units), origin at R-07 center
  const through = UNIT * 2;
  const xIn = -through / 2; // -UNIT
  const xOut = through / 2; // +UNIT
  // Hidden R-02 on INPUT end: branch start = input + R-02 length
  const xThroat = xIn + HALF; // -HALF — matches physical R-02 + R-07 stack

  const stem = [
    { x: xIn, y: 0 },
    { x: xThroat, y: 0 },
  ];
  const centerRun = [
    { x: xThroat, y: 0 },
    { x: xOut, y: 0 },
  ];
  const cEnd = { x: xOut, y: 0 };

  // R-04 branch geometry: 45° arc, radius LARGE_R, start at throat
  // Screen y+ is down: left/up = -y, right/down = +y
  const r = LARGE_R;
  // Left/up (-y): center (xThroat, -r), a π/2 → π/2 − 45°
  const leftArc = sampleArc(
    xThroat,
    -r,
    r,
    Math.PI / 2,
    Math.PI / 2 - DEG45,
    16
  );
  leftArc[0] = { x: xThroat, y: 0 };
  // Right/down (+y): center (xThroat, +r), a −π/2 → −π/2 + 45°
  const rightArc = sampleArc(
    xThroat,
    r,
    r,
    -Math.PI / 2,
    -Math.PI / 2 + DEG45,
    16
  );
  rightArc[0] = { x: xThroat, y: 0 };

  const lEnd = leftArc[leftArc.length - 1];
  const rEnd = rightArc[rightArc.length - 1];
  const leftAngReal = Math.atan2(
    lEnd.y - leftArc[leftArc.length - 2].y,
    lEnd.x - leftArc[leftArc.length - 2].x
  );
  const rightAngReal = Math.atan2(
    rEnd.y - rightArc[rightArc.length - 2].y,
    rEnd.x - rightArc[rightArc.length - 2].x
  );

  const gA = flip ? "F" : "M";
  const gOut = flip ? "M" : "F";

  const leftPath = [...stem, ...leftArc.slice(1)];
  const rightPath = [...stem, ...rightArc.slice(1)];
  const centerPath = [...stem, ...centerRun.slice(1)];

  // Body = rail beds of R-07 through + two R-04 branches (same as composite)
  const webbingPolys = [
    offsetPolylinePoly(stem, HALF_W),
    offsetPolylinePoly(centerRun, HALF_W),
    offsetPolylinePoly(leftArc, HALF_W),
    offsetPolylinePoly(rightArc, HALF_W),
  ].filter(Boolean);

  const walls = [
    ...outerWallsAlongPolyline(stem, HALF_W, false, false),
    ...outerWallsAlongPolyline(centerRun, HALF_W, false, false),
    ...outerWallsAlongPolyline(leftArc, HALF_W, false, false),
    ...outerWallsAlongPolyline(rightArc, HALF_W, false, false),
  ];

  return {
    type: "R17",
    switchable: true,
    defaultSwitch: 1,
    switchCount: 3,
    connectors: [
      { id: "a", x: xIn, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: lEnd.x, y: lEnd.y, ang: leftAngReal, gender: gOut },
      { id: "c", x: cEnd.x, y: cEnd.y, ang: 0, gender: gOut },
      { id: "d", x: rEnd.x, y: rEnd.y, ang: rightAngReal, gender: gOut },
    ],
    paths: [
      { id: "left", points: leftPath, fromC: "a", toC: "b", switchIndex: 0 },
      {
        id: "center",
        points: centerPath,
        fromC: "a",
        toC: "c",
        switchIndex: 1,
      },
      { id: "right", points: rightPath, fromC: "a", toC: "d", switchIndex: 2 },
    ],
    walls,
    webbingPolys,
    bed: null,
    lever: { x: xThroat + 10, y: -HALF_W - 8 },
    color: null,
  };
}

/** Short arc as wall segments (for webbing fillets). */
function arcWall(cx, cy, r, a0, a1, n = 8) {
  const pts = sampleArc(cx, cy, r, a0, a1, n);
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    segs.push({
      x1: pts[i - 1].x,
      y1: pts[i - 1].y,
      x2: pts[i].x,
      y2: pts[i].y,
    });
  }
  return segs;
}

/**
 * R-11 ターンアウトレール (L/R).
 * Straight through = R-01 (1 unit). Branch = R-03 curve (45°, r=1) leaving
 * from mid-piece toward the branch side. Footprint ≈ 1×1 unit square.
 * side > 0 = R (branch +y / screen down), side < 0 = L (branch −y / up).
 * 🦄 flip = gender only; ⇋ mirror toggles side via branchSide.
 */
function turnoutTemplate(side, flip) {
  const len = UNIT;
  const x0 = -len / 2;
  const x1 = len / 2;
  const main = [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
  ];

  // Branch leaves at mid as R-03. side>+1 (R) → +y (screen down); L → −y.
  const r = UNIT;
  const cx = 0;
  const cy = side * r;
  // R: center (0,+r), a −π/2 → −π/4; L: center (0,−r), a π/2 → π/4
  const aStart = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  const aEnd = side > 0 ? -Math.PI / 4 : Math.PI / 4;
  const branchPts = sampleArc(cx, cy, r, aStart, aEnd, 16);
  branchPts[0] = { x: 0, y: 0 };

  const gA = flip ? "F" : "M";
  const gB = flip ? "M" : "F";
  const gC = flip ? "M" : "F"; // branch exit same gender family as through exit

  const bEnd = branchPts[branchPts.length - 1];
  const branchEndDir = side > 0 ? Math.PI / 4 : -Math.PI / 4;

  // Path from entry through split then along branch
  const branchPath = [
    { x: x0, y: 0 },
    { x: 0, y: 0 },
    ...branchPts.slice(1),
  ];
  const walls = [
    ...outerWallsAlongPolyline(main, HALF_W, false, false),
    ...outerWallsAlongPolyline(branchPts, HALF_W, false, false),
  ];

  return {
    type: "R11",
    switchable: true,
    mirrorable: true,
    defaultSwitch: 0,
    switchCount: 2,
    connectors: [
      { id: "a", x: x0, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: x1, y: 0, ang: 0, gender: gB },
      { id: "c", x: bEnd.x, y: bEnd.y, ang: branchEndDir, gender: gC },
    ],
    paths: [
      { id: "main", points: main, fromC: "a", toC: "b", switchIndex: 0 },
      {
        id: "branch",
        points: branchPath,
        fromC: "a",
        toC: "c",
        switchIndex: 1,
      },
    ],
    walls,
    webbingPolys: [
      offsetPolylinePoly(main, HALF_W),
      offsetPolylinePoly(branchPath, HALF_W),
    ].filter(Boolean),
    bed: null,
    lever: { x: 8, y: -side * (HALF_W + 12) },
    color: null,
  };
}

/**
 * R-12 8の字ポイントレール (L/R) — figure-8 / curved turnout.
 * Both routes are R-03-radius curves: “through” continues one way, branch the other.
 * Catalog sells L and R; ⇋ toggles side.
 */
function figureEightPointTemplate(side, flip) {
  const r = UNIT;
  // Entry short stem then two curved exits (one “main” softer, one branch)
  // Geometry: shared entry at (−HALF*0.5, 0), split at origin.
  // Main: curves with branch side (same as R-11 branch style) but BOTH are curves.
  // Through curve: center (0, side*r) going the opposite of branch so one goes up one down? 
  // Catalog figure-8 point: one path is straighter-ish curve continuing, one diverges.
  // Practical model: main = 45° curve to +x bent toward −side, branch = 45° to +x bent toward +side
  // Actually classic R-12: looks like a Y of two curves from one stem — but L/R means only one branch side.
  // Real R-12 L: stem + curve through + curve branch on one side for figure-8.
  // Simpler accurate-enough model used by builders:
  //   - Main path: R-03 curve (45°) 
  //   - Branch: another R-03 curve diverging more sharply
  // Use: stem from (−0.5u,0) to (0,0), then:
  //   main: arc center (0, −side*r) → ends at 45° (same as R-11 branch but as "main")
  //   branch: arc that goes more to the side — second 45° with center further

  const stem = [
    { x: -HALF * 0.85, y: 0 },
    { x: 0, y: 0 },
  ];

  // Main curve (continues mostly forward, bends to −side)
  const mainCy = side * r; // bend opposite of "branch" label
  const mainA0 = side > 0 ? -Math.PI / 2 : Math.PI / 2;
  const mainA1 = side > 0 ? -Math.PI / 2 + DEG45 : Math.PI / 2 - DEG45;
  const mainArc = sampleArc(0, mainCy, r, mainA0, mainA1, 14);
  mainArc[0] = { x: 0, y: 0 };

  // Branch curve (bends to +side)
  const brCy = -side * r;
  const brA0 = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const brA1 = side > 0 ? Math.PI / 2 - DEG45 : -Math.PI / 2 + DEG45;
  const brArc = sampleArc(0, brCy, r, brA0, brA1, 14);
  brArc[0] = { x: 0, y: 0 };

  const mEnd = mainArc[mainArc.length - 1];
  const bEnd = brArc[brArc.length - 1];
  const mainEndDir = side > 0 ? Math.PI / 4 : -Math.PI / 4;
  const brEndDir = side > 0 ? -Math.PI / 4 : Math.PI / 4;

  const gA = flip ? "F" : "M";
  const gOut = flip ? "M" : "F";

  const mainPath = [...stem, ...mainArc.slice(1)];
  const branchPath = [...stem, ...brArc.slice(1)];

  return {
    type: "R12",
    switchable: true,
    mirrorable: true,
    defaultSwitch: 0,
    switchCount: 2,
    connectors: [
      { id: "a", x: stem[0].x, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: mEnd.x, y: mEnd.y, ang: mainEndDir, gender: gOut },
      { id: "c", x: bEnd.x, y: bEnd.y, ang: brEndDir, gender: gOut },
    ],
    paths: [
      { id: "main", points: mainPath, fromC: "a", toC: "b", switchIndex: 0 },
      { id: "branch", points: branchPath, fromC: "a", toC: "c", switchIndex: 1 },
    ],
    walls: [
      ...outerWallsAlongPolyline(stem, HALF_W, false, false),
      ...outerWallsAlongPolyline(mainArc, HALF_W, false, false),
      ...outerWallsAlongPolyline(brArc, HALF_W, false, false),
    ],
    webbingPolys: [
      offsetPolylinePoly(mainPath, HALF_W),
      offsetPolylinePoly(branchPath, HALF_W),
    ].filter(Boolean),
    bed: null,
    lever: { x: -4, y: -side * (HALF_W + 10) },
    color: null,
  };
}

/**
 * R-13 単線・複線ポイントレール (A/B = L/R).
 * Single-track in → two parallel tracks out (double-track spacing).
 * One path nearly straight; other S-curves out to DOUBLE_GAP.
 * Length ≈ 1 unit. ⇋ toggles which side the diverging track sits on.
 */
function singleDoublePointTemplate(side, flip) {
  const len = UNIT;
  const x0 = -len / 2;
  const x1 = len / 2;
  const gap = DOUBLE_GAP;

  // Through stays on y=0 (single → “inner” of double)
  const main = [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
  ];

  // Diverging path: smooth S from (x0,0) to (x1, side*gap), ending parallel (+x)
  const branch = sampleSBend(x0, 0, x1, side * gap, 20);

  const bEnd = branch[branch.length - 1];
  // End tangent ≈ +x
  const bi = branch.length - 1;
  const branchEndDir = Math.atan2(
    branch[bi].y - branch[bi - 1].y,
    branch[bi].x - branch[bi - 1].x
  );

  const gA = flip ? "F" : "M";
  const gOut = flip ? "M" : "F";

  return {
    type: "R13",
    switchable: true,
    mirrorable: true,
    defaultSwitch: 0,
    switchCount: 2,
    connectors: [
      { id: "a", x: x0, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: x1, y: 0, ang: 0, gender: gOut },
      { id: "c", x: bEnd.x, y: bEnd.y, ang: branchEndDir, gender: gOut },
    ],
    paths: [
      { id: "main", points: main, fromC: "a", toC: "b", switchIndex: 0 },
      { id: "branch", points: branch, fromC: "a", toC: "c", switchIndex: 1 },
    ],
    walls: [
      ...outerWallsAlongPolyline(main, HALF_W, false, false),
      ...outerWallsAlongPolyline(branch, HALF_W, false, false),
    ],
    webbingPolys: [
      offsetPolylinePoly(main, HALF_W),
      offsetPolylinePoly(branch, HALF_W),
    ].filter(Boolean),
    bed: null,
    lever: { x: 0, y: -side * (HALF_W + 10) },
    color: null,
  };
}

/** Smooth S-bend from (x0,y0) to (x1,y1) with horizontal end tangents. */
function sampleSBend(x0, y0, x1, y1, n = 18) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // Smoothstep for lateral offset; linear in x
    const s = t * t * (3 - 2 * t);
    pts.push({
      x: x0 + (x1 - x0) * t,
      y: y0 + (y1 - y0) * s,
    });
  }
  return pts;
}

/**
 * R-22 Yポイントレール — dual curved split (both sides).
 */
function yPointTemplate(flip) {
  const r = UNIT;
  const stem = [
    { x: -HALF * 0.6, y: 0 },
    { x: 0, y: 0 },
  ];
  const left = sampleArc(0, r, r, -Math.PI / 2, -Math.PI / 2 + DEG45, 12);
  left[0] = { x: 0, y: 0 };
  const right = sampleArc(0, -r, r, Math.PI / 2, Math.PI / 2 - DEG45, 12);
  right[0] = { x: 0, y: 0 };

  const lEnd = left[left.length - 1];
  const rEnd = right[right.length - 1];
  const leftEndDir = Math.PI / 4;
  const rightEndDir = -Math.PI / 4;

  const gA = flip ? "F" : "M";
  const gB = flip ? "M" : "F";
  const gC = flip ? "M" : "F";

  const leftPath = [...stem, ...left.slice(1)];
  const rightPath = [...stem, ...right.slice(1)];
  return {
    type: "R22",
    switchable: true,
    defaultSwitch: 0,
    switchCount: 2,
    connectors: [
      { id: "a", x: stem[0].x, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: lEnd.x, y: lEnd.y, ang: leftEndDir, gender: gB },
      { id: "c", x: rEnd.x, y: rEnd.y, ang: rightEndDir, gender: gC },
    ],
    paths: [
      { id: "left", points: leftPath, fromC: "a", toC: "b", switchIndex: 0 },
      { id: "right", points: rightPath, fromC: "a", toC: "c", switchIndex: 1 },
    ],
    walls: [
      ...outerWallsAlongPolyline(stem, HALF_W, false, false),
      ...outerWallsAlongPolyline(left, HALF_W, false, false),
      ...outerWallsAlongPolyline(right, HALF_W, false, false),
    ],
    webbingPolys: [
      offsetPolylinePoly(stem, HALF_W),
      offsetPolylinePoly(left, HALF_W),
      offsetPolylinePoly(right, HALF_W),
    ].filter(Boolean),
    bed: null,
    lever: { x: -6, y: -HALF_W - 8 },
    color: null,
  };
}

/**
 * R-10 Uターンレール — 180° reverse (semicircle).
 * Ends face opposite ways; train reverses heading. ⇋ flips which way the U opens.
 */
function uTurnTemplate(flip, mirror) {
  const r = UNIT;
  // Open toward −y when !mirror, +y when mirror
  const a0 = mirror ? 0 : Math.PI;
  const a1 = mirror ? Math.PI : 0;
  const pts = sampleArc(0, 0, r, a0, a1, 24);
  const p0 = pts[0];
  const p1 = pts[pts.length - 1];

  // Tangents at semicircle ends
  // a=π point (−r,0): CCW tangent is −Y if going π→0? path π→0 is CW decreasing...
  // sampleArc from a0 to a1: for !mirror a0=π a1=0, going through (0,r) top if y-up... 
  // Our y+ is down. a=π/2 is (0,r) = screen down.
  // !mirror: π → 0 via π/2: starts (−r,0) ends (r,0) through (0,+r) bottom of screen.
  const startDir = mirror ? Math.PI / 2 : -Math.PI / 2;
  const endDir = mirror ? Math.PI / 2 : -Math.PI / 2;
  // Outward connector angles (pointing out of the piece)
  // At start: coming from path direction startDir; outward opposite entry = startDir+π for port a
  // Port "a" at p0 faces outward against path start
  const angA = normalizeAngle(startDir + Math.PI);
  const angB = normalizeAngle(endDir);

  const g0 = flip ? "F" : "M";
  const g1 = flip ? "M" : "F";

  const outerR = r + HALF_W;
  const innerR = Math.max(8, r - HALF_W);
  const outerPts = sampleArc(0, 0, outerR, a0, a1, 24);
  const innerPts = sampleArc(0, 0, innerR, a0, a1, 24);
  const walls = [];
  for (let i = 1; i < outerPts.length; i++) {
    walls.push({
      x1: outerPts[i - 1].x,
      y1: outerPts[i - 1].y,
      x2: outerPts[i].x,
      y2: outerPts[i].y,
    });
  }
  for (let i = 1; i < innerPts.length; i++) {
    walls.push({
      x1: innerPts[i - 1].x,
      y1: innerPts[i - 1].y,
      x2: innerPts[i].x,
      y2: innerPts[i].y,
    });
  }

  return {
    type: "R10",
    mirrorable: true,
    connectors: [
      { id: "a", x: p0.x, y: p0.y, ang: angA, gender: g0 },
      { id: "b", x: p1.x, y: p1.y, ang: angB, gender: g1 },
    ],
    paths: [{ id: "main", points: pts, fromC: "a", toC: "b" }],
    walls,
    webbingPolys: [offsetPolylinePoly(pts, HALF_W)].filter(Boolean),
    bed: null,
    color: null,
  };
}

/**
 * R-23 まがレール — wavy / meandering S over ~1.5 units.
 */
function wavyTemplate(flip, mirror) {
  const len = UNIT * 1.5;
  const amp = UNIT * 0.22 * (mirror ? -1 : 1);
  const x0 = -len / 2;
  const x1 = len / 2;
  const n = 24;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = x0 + (x1 - x0) * t;
    // Full S: sin(2π t) 
    const y = amp * Math.sin(t * Math.PI * 2);
    pts.push({ x, y });
  }
  const g0 = flip ? "F" : "M";
  const g1 = flip ? "M" : "F";
  const p0 = pts[0];
  const p1 = pts[pts.length - 1];
  // End tangents approximately +x
  const a0 = Math.atan2(pts[1].y - pts[0].y, pts[1].x - pts[0].x);
  const a1 = Math.atan2(
    pts[pts.length - 1].y - pts[pts.length - 2].y,
    pts[pts.length - 1].x - pts[pts.length - 2].x
  );

  return {
    type: "R23",
    mirrorable: true,
    connectors: [
      { id: "a", x: p0.x, y: p0.y, ang: normalizeAngle(a0 + Math.PI), gender: g0 },
      { id: "b", x: p1.x, y: p1.y, ang: a1, gender: g1 },
    ],
    paths: [{ id: "main", points: pts, fromC: "a", toC: "b" }],
    walls: outerWallsAlongPolyline(pts, HALF_W, false, false),
    webbingPolys: [offsetPolylinePoly(pts, HALF_W)].filter(Boolean),
    bed: null,
    color: null,
  };
}

/**
 * R-14 = same footprint as stacking 2× R-07 + 4× R-10.5.
 *
 * TRACK: dead-straight + (two R-07 centerlines), ports at (±1u, 0) / (0, ±1u).
 * OUTER WALLS / WEBBING: four R-10.5 rail beds (¼-circle, radius 1 unit)
 * with centers at the outer corners (±1u, ±1u). That is the arch perimeter
 * from the composite — not a solid square, not diagonal rails.
 */
function crossTemplate(flip) {
  const arm = UNIT; // center → each port = 1 unit
  const hw = HALF_W;
  const r = UNIT; // R-10.5 path radius
  const n = 18;
  const g = (m) => (flip ? (m === "M" ? "F" : "M") : m);

  // Straight arms (2× R-07 through the middle)
  const pathH = [
    { x: -arm, y: 0 },
    { x: arm, y: 0 },
  ];
  const pathV = [
    { x: 0, y: -arm },
    { x: 0, y: arm },
  ];

  // Four R-10.5 centerlines: each quarter-circle from one arm tip to the next.
  // Centers at outer corners of the 2u×2u square; path radius = arm = UNIT.
  // NE: (arm,0) → (0,-arm)   center (arm,-arm)  angles π/2 → π
  // SE: (arm,0) → (0, arm)   center (arm, arm)   angles -π/2 → -π
  // SW: (-arm,0) → (0, arm)  center (-arm, arm)  angles -π/2 → 0
  // NW: (-arm,0) → (0,-arm)  center (-arm,-arm)  angles π/2 → 0
  // Note: H tips (arm,0)/(-arm,0) are shared by two arcs each — same as composite joints.
  const arcNE = sampleArc(arm, -arm, r, Math.PI / 2, Math.PI, n);
  const arcSE = sampleArc(arm, arm, r, -Math.PI / 2, -Math.PI, n);
  const arcSW = sampleArc(-arm, arm, r, -Math.PI / 2, 0, n);
  const arcNW = sampleArc(-arm, -arm, r, Math.PI / 2, 0, n);

  // Force exact port endpoints
  arcNE[0] = { x: arm, y: 0 };
  arcNE[arcNE.length - 1] = { x: 0, y: -arm };
  arcSE[0] = { x: arm, y: 0 };
  arcSE[arcSE.length - 1] = { x: 0, y: arm };
  arcSW[0] = { x: -arm, y: 0 };
  arcSW[arcSW.length - 1] = { x: 0, y: arm };
  arcNW[0] = { x: -arm, y: 0 };
  arcNW[arcNW.length - 1] = { x: 0, y: -arm };

  // Solid plastic = straight rail beds + four R-10.5 rail beds only
  const webbingPolys = [
    offsetPolylinePoly(pathH, hw),
    offsetPolylinePoly(pathV, hw),
    offsetPolylinePoly(arcNE, hw),
    offsetPolylinePoly(arcSE, hw),
    offsetPolylinePoly(arcSW, hw),
    offsetPolylinePoly(arcNW, hw),
  ].filter(Boolean);

  // Glide walls = outer edges of straights + outer edges of the four corner arcs
  const walls = [
    ...outerWallsAlongPolyline(pathH, hw, false, false),
    ...outerWallsAlongPolyline(pathV, hw, false, false),
    ...outerWallsAlongPolyline(arcNE, hw, false, false),
    ...outerWallsAlongPolyline(arcSE, hw, false, false),
    ...outerWallsAlongPolyline(arcSW, hw, false, false),
    ...outerWallsAlongPolyline(arcNW, hw, false, false),
  ];

  const leverD = arm * 0.2;
  return {
    type: "R14",
    switchable: true,
    defaultSwitch: 0,
    bothPathsActive: true,
    connectors: [
      { id: "w", x: -arm, y: 0, ang: Math.PI, gender: g("M") },
      { id: "e", x: arm, y: 0, ang: 0, gender: g("F") },
      { id: "n", x: 0, y: -arm, ang: -Math.PI / 2, gender: g("M") },
      { id: "s", x: 0, y: arm, ang: Math.PI / 2, gender: g("F") },
    ],
    // Train only uses the straight cross (dead straight track)
    paths: [
      { id: "horiz", points: pathH, fromC: "w", toC: "e" },
      { id: "vert", points: pathV, fromC: "n", toC: "s" },
    ],
    walls,
    webbingPolys,
    bed: null,
    levers: [
      { x: leverD, y: -leverD },
      { x: leverD, y: leverD },
      { x: -leverD, y: leverD },
      { x: -leverD, y: -leverD },
    ],
    lever: { x: leverD, y: -leverD },
    color: null,
  };
}

/** Bowed path from a→b (still used by R-17 side legs). */
function sampleBowedPath(a, b, bow, n = 16) {
  const pts = [];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  const px = -dy / L;
  const py = dx / L;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const s = 4 * t * (1 - t);
    pts.push({
      x: a.x + dx * t + px * bow * s,
      y: a.y + dy * t + py * bow * s,
    });
  }
  pts[0] = { ...a };
  pts[pts.length - 1] = { ...b };
  return pts;
}

/**
 * Capsule polygon around a polyline (left side then reverse right side).
 * Used as solid rail-bed / plastic body for multi-leg pieces.
 */
function offsetPolylinePoly(pts, halfW) {
  if (!pts || pts.length < 2) return null;
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    let tx;
    let ty;
    if (i === 0) {
      tx = pts[1].x - pts[0].x;
      ty = pts[1].y - pts[0].y;
    } else if (i === pts.length - 1) {
      tx = pts[i].x - pts[i - 1].x;
      ty = pts[i].y - pts[i - 1].y;
    } else {
      tx = pts[i + 1].x - pts[i - 1].x;
      ty = pts[i + 1].y - pts[i - 1].y;
    }
    const L = Math.hypot(tx, ty) || 1;
    const nx = -ty / L;
    const ny = tx / L;
    left.push({ x: pts[i].x + nx * halfW, y: pts[i].y + ny * halfW });
    right.push({ x: pts[i].x - nx * halfW, y: pts[i].y - ny * halfW });
  }
  return [...left, ...right.reverse()];
}

function rectPoly(x, y, w, h) {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

function outerWallsAlongPolyline(pts, halfW, capStart, capEnd) {
  // Build left/right offsets and optional caps
  const left = [];
  const right = [];
  for (let i = 0; i < pts.length; i++) {
    let tx, ty;
    if (i === 0) {
      tx = pts[1].x - pts[0].x;
      ty = pts[1].y - pts[0].y;
    } else if (i === pts.length - 1) {
      tx = pts[i].x - pts[i - 1].x;
      ty = pts[i].y - pts[i - 1].y;
    } else {
      tx = pts[i + 1].x - pts[i - 1].x;
      ty = pts[i + 1].y - pts[i - 1].y;
    }
    const L = Math.hypot(tx, ty) || 1;
    const nx = -ty / L;
    const ny = tx / L;
    left.push({ x: pts[i].x + nx * halfW, y: pts[i].y + ny * halfW });
    right.push({ x: pts[i].x - nx * halfW, y: pts[i].y - ny * halfW });
  }
  const segs = [];
  for (let i = 1; i < left.length; i++) {
    segs.push({ x1: left[i - 1].x, y1: left[i - 1].y, x2: left[i].x, y2: left[i].y });
  }
  for (let i = 1; i < right.length; i++) {
    segs.push({
      x1: right[i - 1].x,
      y1: right[i - 1].y,
      x2: right[i].x,
      y2: right[i].y,
    });
  }
  if (capStart) {
    segs.push({
      x1: left[0].x,
      y1: left[0].y,
      x2: right[0].x,
      y2: right[0].y,
    });
  }
  if (capEnd) {
    const i = left.length - 1;
    segs.push({
      x1: left[i].x,
      y1: left[i].y,
      x2: right[i].x,
      y2: right[i].y,
    });
  }
  return segs;
}

/** Drop end-cap walls so connector mouths stay open for free travel / re-entry. */
function sideWallsOnly(segs) {
  // outerWallsAlongPolyline adds caps last; keep only side segs — but we don't know count.
  // Instead: pass capStart/End false from callers. This is a no-op filter for safety.
  return segs;
}

function curveSideWalls(cx, cy, r, a0, a1, halfW) {
  const outer = sampleArc(cx, cy, r + halfW, a0, a1, 14);
  const inner = sampleArc(cx, cy, Math.max(4, r - halfW), a0, a1, 14);
  const segs = [];
  for (let i = 1; i < outer.length; i++) {
    segs.push({
      x1: outer[i - 1].x,
      y1: outer[i - 1].y,
      x2: outer[i].x,
      y2: outer[i].y,
    });
  }
  for (let i = 1; i < inner.length; i++) {
    segs.push({
      x1: inner[i - 1].x,
      y1: inner[i - 1].y,
      x2: inner[i].x,
      y2: inner[i].y,
    });
  }
  return segs;
}

/** World-space geometry cache for a placed piece. */
export function worldGeometry(piece) {
  const tpl = buildTemplate(piece.type, {
    flip: piece.flip,
    branchSide: piece.branchSide || "R",
  });
  const connectors = tpl.connectors.map((c) => {
    const p = transformPoint(c, piece);
    return {
      ...c,
      wx: p.x,
      wy: p.y,
      wang: transformDir(c.ang, piece),
      pieceId: piece.id,
    };
  });
  const paths = tpl.paths.map((path) => {
    const pts = path.points.map((pt) => transformPoint(pt, piece));
    return {
      ...path,
      pieceId: piece.id,
      points: pts,
      length: polylineLength(pts),
    };
  });
  const walls = tpl.walls.map((w) => {
    const p1 = transformPoint({ x: w.x1, y: w.y1 }, piece);
    const p2 = transformPoint({ x: w.x2, y: w.y2 }, piece);
    return { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, pieceId: piece.id };
  });
  let lever = null;
  if (tpl.lever) {
    const p = transformPoint(tpl.lever, piece);
    lever = { x: p.x, y: p.y };
  }
  const levers = (tpl.levers || (tpl.lever ? [tpl.lever] : [])).map((lv) => {
    const p = transformPoint(lv, piece);
    return { x: p.x, y: p.y };
  });
  return { tpl, connectors, paths, walls, lever, levers };
}
