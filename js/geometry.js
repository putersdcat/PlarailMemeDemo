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

export const PIECE_TYPES = {
  R01: "R01", // straight — 1 unit
  R02: "R02", // half straight — 0.5 unit
  R03: "R03", // curve 45° — radius 1 unit
  R04: "R04", // large curve 45° — radius ~1.4 units (historical)
  R07: "R07", // double-length straight — 2 units
  R08: "R08", // stop rail — 1 unit + stop bump
  R11: "R11", // turnout — ~1×1 footprint
  R12: "R12", // figure-8 / Y point
  R14: "R14", // cross point — ~1×1 footprint, solid body
  R17: "R17", // three-way point — ~1 unit long
  // Convenience (not a catalog SKU): single 90° at standard radius = two R-03
  R90: "R90",
  // Legacy aliases (load mapping)
  R01L: "R07",
  R01S: "R08",
  R09: "R04",
  RY3: "R17",
};

export const PIECE_META = {
  R01: { code: "R-01", name: "Straight", desc: "1 unit" },
  R02: { code: "R-02", name: "Half Straight", desc: "0.5 unit" },
  R03: { code: "R-03", name: "Curve 45°", desc: "Radius 1 unit" },
  R04: { code: "R-04", name: "Large Curve", desc: "45°, radius ~1.4 unit" },
  R07: { code: "R-07", name: "Double Straight", desc: "2 units long" },
  R08: { code: "R-08", name: "Stop Rail", desc: "1 unit + stop bump" },
  R11: { code: "R-11", name: "Turnout", desc: "~1×1 unit" },
  R12: { code: "R-12", name: "Y-Point / Fig-8", desc: "Dual curve branch" },
  R14: { code: "R-14", name: "Cross Point", desc: "1×1 unit, solid body" },
  R17: { code: "R-17", name: "3-Way Point", desc: "~1 unit long, 1→3" },
  R90: { code: "R-90*", name: "Curve 90°", desc: "2×R-03 (sim only)" },
};

/** Normalize legacy type ids from older saves / code. */
export function normalizePieceType(type) {
  if (!type) return type;
  const map = {
    R01L: "R07",
    R01S: "R08",
    R09: "R04",
    RY3: "R17",
    R90: "R90",
  };
  return map[type] || type;
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
 * Flip piece while keeping visual pivot fixed in world space.
 */
export function flipAroundVisualPivot(piece) {
  const piv = worldPivot(piece);
  piece.flip = !piece.flip;
  // After flip, local pivot may shift (curves reverse); re-anchor
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
  const branchSide = options.branchSide === "L" ? -1 : 1; // for R11
  const t = normalizePieceType(type);

  switch (t) {
    case "R01":
      return straightTemplate(UNIT, flip, "R01");
    case "R02":
      return straightTemplate(HALF, flip, "R02");
    case "R03":
      return curveTemplate(flip, UNIT, DEG45, "R03");
    case "R04":
      return curveTemplate(flip, LARGE_R, DEG45, "R04");
    case "R07":
      return straightTemplate(UNIT * 2, flip, "R07");
    case "R08":
      return stopStraightTemplate(flip);
    case "R90":
      return curveTemplate(flip, UNIT, Math.PI / 2, "R90");
    case "R11":
      return turnoutTemplate(branchSide, flip);
    case "R12":
      return yPointTemplate(flip);
    case "R14":
      return crossTemplate(flip);
    case "R17":
      return threeWayTemplate(flip);
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
    color: null,
  };
}

/**
 * Curve arc. spanRad = 45° (R-03/R-09) or 90° (R-90 quarter turn).
 * radius = UNIT or LARGE_R. Center of curvature at origin; flip → CW.
 */
function curveTemplate(flip, radius = UNIT, spanRad = DEG45, type = PIECE_TYPES.R03) {
  const r = radius;
  const a0 = 0;
  const a1 = flip ? -spanRad : spanRad;
  const nSamp = spanRad > DEG45 * 1.2 ? 24 : type === PIECE_TYPES.R09 ? 20 : 16;
  const pts = sampleArc(0, 0, r, a0, a1, nSamp);

  // Path start tangent (CCW at a=0 is +Y); end tangent at a1
  const startDir = flip ? -Math.PI / 2 : Math.PI / 2;
  // At angle α, CCW tangent ang = α + π/2; CW = α - π/2
  const endDir = flip ? a1 - Math.PI / 2 : a1 + Math.PI / 2;

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
 * R-17 Three-way Point (2014–2025 product).
 * Overall length ≈ **1 unit** (official). Stem + center through = 1 unit.
 * Left/right branch with R-03-compatible radius; outers ~90° apart.
 * Footprint fits roughly in a 1×1 unit box.
 */
function threeWayTemplate(flip) {
  // Through path: full 1 unit
  const xIn = -UNIT / 2;
  const xOut = UNIT / 2;
  // Throat (branch origin) slightly past mid toward the exit side
  const xThroat = -UNIT * 0.05;

  const stem = [
    { x: xIn, y: 0 },
    { x: xThroat, y: 0 },
  ];
  const center = [
    { x: xThroat, y: 0 },
    { x: xOut, y: 0 },
  ];

  // Branch radius so 45° arcs stay inside ~1 unit footprint
  const r = UNIT * 0.55;
  const left = sampleArc(
    xThroat,
    r,
    r,
    -Math.PI / 2,
    -Math.PI / 2 + DEG45,
    14
  );
  left[0] = { x: xThroat, y: 0 };
  const right = sampleArc(
    xThroat,
    -r,
    r,
    Math.PI / 2,
    Math.PI / 2 - DEG45,
    14
  );
  right[0] = { x: xThroat, y: 0 };

  const lEnd = left[left.length - 1];
  const rEnd = right[right.length - 1];
  const cEnd = center[center.length - 1];

  const gA = flip ? "F" : "M";
  const gOut = flip ? "M" : "F";

  const leftPath = [...stem, ...left.slice(1)];
  const rightPath = [...stem, ...right.slice(1)];
  const centerPath = [...stem, ...center.slice(1)];

  const walls = [
    ...outerWallsAlongPolyline(stem, HALF_W, false, false),
    ...outerWallsAlongPolyline(center, HALF_W, false, false),
    ...curveSideWalls(
      xThroat,
      r,
      r,
      -Math.PI / 2,
      -Math.PI / 2 + DEG45,
      HALF_W
    ),
    ...curveSideWalls(
      xThroat,
      -r,
      r,
      Math.PI / 2,
      Math.PI / 2 - DEG45,
      HALF_W
    ),
  ];

  // Solid body fill between the three legs (simple polys for renderer)
  const webbingPolys = [
    [
      { x: xThroat, y: 0 },
      { x: lEnd.x * 0.5 + xThroat * 0.5, y: lEnd.y * 0.5 },
      { x: (xThroat + xOut) * 0.5, y: HALF_W * 0.85 },
      { x: (xThroat + xOut) * 0.45, y: 0 },
    ],
    [
      { x: xThroat, y: 0 },
      { x: rEnd.x * 0.5 + xThroat * 0.5, y: rEnd.y * 0.5 },
      { x: (xThroat + xOut) * 0.5, y: -HALF_W * 0.85 },
      { x: (xThroat + xOut) * 0.45, y: 0 },
    ],
  ];

  return {
    type: "R17",
    switchable: true,
    defaultSwitch: 1,
    switchCount: 3,
    connectors: [
      { id: "a", x: xIn, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: lEnd.x, y: lEnd.y, ang: Math.PI / 4, gender: gOut },
      { id: "c", x: cEnd.x, y: cEnd.y, ang: 0, gender: gOut },
      { id: "d", x: rEnd.x, y: rEnd.y, ang: -Math.PI / 4, gender: gOut },
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
    lever: { x: xThroat + UNIT * 0.08, y: 0 },
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

function turnoutTemplate(side, flip) {
  // Main straight + curved branch (R-03 radius) leaving mid-ish toward branch.
  // Classic: straight through, curve diverges from one end region.
  const len = UNIT;
  const x0 = -len / 2;
  const x1 = len / 2;
  const main = [
    { x: x0, y: 0 },
    { x: x1, y: 0 },
  ];

  // Branch: from near center toward curved exit matching R-03
  // Arc center offset so branch starts at origin area and curves 45°.
  // Start branch at (0,0) path along +x then curve... 
  // Simpler: branch from x=0 along curve with center at (0, -side*UNIT) so it arcs to 45°.
  const r = UNIT;
  const cx = 0;
  const cy = -side * r;
  // Arc from angle (side>0? π/2 : -π/2) ... 
  // For side=+1 (right/bottom in screen y+): center (0, -r), start at (0,0) which is angle π/2 from center
  // angle of point relative to center: atan2(y-cy, x-cx)
  // start (0,0): atan2(r, 0) = π/2 for cy=-r
  // end after 45° toward +x: angle goes to π/2 - 45° = π/4 for right branch (side=+1, decreasing angle for clockwise from center)
  const aStart = side > 0 ? Math.PI / 2 : -Math.PI / 2;
  const aEnd = side > 0 ? Math.PI / 4 : -Math.PI / 4;
  const branchPts = sampleArc(cx, cy, r, aStart, aEnd, 14);
  // Ensure first point is exactly (0,0)
  branchPts[0] = { x: 0, y: 0 };

  const gA = flip ? "F" : "M";
  const gB = flip ? "M" : "F";
  const gC = flip ? "F" : "M";

  const bEnd = branchPts[branchPts.length - 1];
  // Outward at branch end: tangent
  const endDir =
    side > 0
      ? Math.atan2(
          Math.cos(aEnd), // d/da of (cx + r cos a) with da along path
          -Math.sin ? 0 : 0
        )
      : 0;
  // For center (cx,cy), point (cx+r cos a, cy + r sin a)
  // da along path from aStart to aEnd (decreasing for side>0):
  // derivative ( -r sin a, r cos a ) * a'
  // a' < 0 for side>0: dir = (sin a, -cos a)
  // at aEnd=π/4: (sin π/4, -cos π/4) = (√2/2, -√2/2) ang = -π/4
  const branchEndDir = side > 0 ? -Math.PI / 4 : Math.PI / 4;

  const walls = [
    ...outerWallsAlongPolyline(main, HALF_W, false, false),
    ...curveSideWalls(cx, cy, r, aStart, aEnd, HALF_W),
  ];

  return {
    type: PIECE_TYPES.R11,
    switchable: true,
    defaultSwitch: 0, // 0 = main, 1 = branch
    connectors: [
      { id: "a", x: x0, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: x1, y: 0, ang: 0, gender: gB },
      { id: "c", x: bEnd.x, y: bEnd.y, ang: branchEndDir, gender: gC },
    ],
    paths: [
      { id: "main", points: main, fromC: "a", toC: "b", switchIndex: 0 },
      {
        id: "branch",
        points: [{ x: x0, y: 0 }, ...branchPts],
        fromC: "a",
        toC: "c",
        switchIndex: 1,
      },
      // reverse-friendly aliases handled in graph
    ],
    walls,
    bed: null,
    lever: { x: 8, y: -side * 18 },
  };
}

function yPointTemplate(flip) {
  // Two 45° curves from a shared stem — figure-8 style Y.
  const r = UNIT;
  // Stem short straight then split
  const stem = [
    { x: -HALF * 0.6, y: 0 },
    { x: 0, y: 0 },
  ];
  const aL0 = Math.PI / 2;
  const aL1 = Math.PI / 2 + DEG45;
  const aR0 = -Math.PI / 2;
  const aR1 = -Math.PI / 2 - DEG45;
  // Left branch center (0, r), start (0,0)
  const left = sampleArc(0, r, r, -Math.PI / 2, -Math.PI / 2 + DEG45, 12);
  left[0] = { x: 0, y: 0 };
  // Right branch center (0, -r)
  const right = sampleArc(0, -r, r, Math.PI / 2, Math.PI / 2 - DEG45, 12);
  right[0] = { x: 0, y: 0 };

  const lEnd = left[left.length - 1];
  const rEnd = right[right.length - 1];
  // End dirs
  // left: center (0,r), a from -π/2 to -π/2+π/4 = -π/4
  // point (r cos a, r + r sin a); da>0 tangent (-r sin a, r cos a)
  // at a=-π/4: (r √2/2, r cos(-π/4)) dir ang = atan2(cos(-π/4), -sin(-π/4)) = atan2(√2/2, √2/2)=π/4
  const leftEndDir = Math.PI / 4;
  const rightEndDir = -Math.PI / 4;

  const gA = flip ? "F" : "M";
  const gB = flip ? "M" : "F";
  const gC = flip ? "M" : "F";

  return {
    type: PIECE_TYPES.R12,
    switchable: true,
    defaultSwitch: 0,
    connectors: [
      { id: "a", x: stem[0].x, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: lEnd.x, y: lEnd.y, ang: leftEndDir, gender: gB },
      { id: "c", x: rEnd.x, y: rEnd.y, ang: rightEndDir, gender: gC },
    ],
    paths: [
      {
        id: "left",
        points: [...stem, ...left.slice(1)],
        fromC: "a",
        toC: "b",
        switchIndex: 0,
      },
      {
        id: "right",
        points: [...stem, ...right.slice(1)],
        fromC: "a",
        toC: "c",
        switchIndex: 1,
      },
    ],
    walls: [
      ...curveSideWalls(0, r, r, -Math.PI / 2, -Math.PI / 2 + DEG45, HALF_W),
      ...curveSideWalls(0, -r, r, Math.PI / 2, Math.PI / 2 - DEG45, HALF_W),
      ...outerWallsAlongPolyline(stem, HALF_W, false, false),
    ],
    bed: null,
    lever: { x: -6, y: -16 },
  };
}

/**
 * R-14 Crossing Point — overall footprint ≈ **1 × 1 unit**.
 *
 * Real piece is a solid blue plate with two rail routes crossing and thick
 * plastic body (webbing) between the arms. Sim approach:
 *   1. Rail paths: W–E and N–S through the square (centerlines).
 *   2. Body: single solid rounded-square / diamond plate (webbingPolys).
 *   3. Walls: outer perimeter of that plate so off-rail trains glide around
 *      the whole piece (not tiny broken fillets at corners).
 *
 * Ports sit at mid-edges of the 1-unit square (compatible with straights).
 */
function crossTemplate(flip) {
  // Edge-to-edge through center = 1 unit
  const half = UNIT / 2;
  const hw = HALF_W;

  const h = [
    { x: -half, y: 0 },
    { x: half, y: 0 },
  ];
  const v = [
    { x: 0, y: -half },
    { x: 0, y: half },
  ];
  const g = (m) => (flip ? (m === "M" ? "F" : "M") : m);

  // Outer body radius: fills most of the 1×1 square, leaving rail mouths open
  // Mouth half-width ≈ hw; body extends to ~half - small margin on axes, fuller in diagonals
  const bodyOuter = half - 2; // nearly full unit square
  // Rounded-square outline (superellipse-ish) for solid webbing body
  const bodyPoly = roundedSquarePoly(bodyOuter, 0.65, 32);

  // Outer walls = closed body perimeter (primary off-rail glide surface)
  const bodyWalls = [];
  for (let i = 0; i < bodyPoly.length; i++) {
    const a = bodyPoly[i];
    const b = bodyPoly[(i + 1) % bodyPoly.length];
    bodyWalls.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  }

  // Rail groove side walls (inner guidance when scraping past tracks)
  const railWalls = [
    ...outerWallsAlongPolyline(h, hw * 0.85, false, false),
    ...outerWallsAlongPolyline(v, hw * 0.85, false, false),
  ];

  // Open mouth notches: remove perimeter segments near port centers so
  // trains can enter/exit the paths (cutouts on the body wall list)
  const openWalls = bodyWalls.filter((seg) => {
    const mx = (seg.x1 + seg.x2) / 2;
    const my = (seg.y1 + seg.y2) / 2;
    // Near a port if close to axis and near the rim
    const nearW = Math.abs(my) < hw * 1.1 && mx < -half * 0.75;
    const nearE = Math.abs(my) < hw * 1.1 && mx > half * 0.75;
    const nearN = Math.abs(mx) < hw * 1.1 && my < -half * 0.75;
    const nearS = Math.abs(mx) < hw * 1.1 && my > half * 0.75;
    return !(nearW || nearE || nearN || nearS);
  });

  const leverD = half * 0.32;
  return {
    type: "R14",
    switchable: true,
    defaultSwitch: 0,
    bothPathsActive: true,
    connectors: [
      { id: "w", x: -half, y: 0, ang: Math.PI, gender: g("M") },
      { id: "e", x: half, y: 0, ang: 0, gender: g("F") },
      { id: "n", x: 0, y: -half, ang: -Math.PI / 2, gender: g("M") },
      { id: "s", x: 0, y: half, ang: Math.PI / 2, gender: g("F") },
    ],
    paths: [
      { id: "horiz", points: h, fromC: "w", toC: "e" },
      { id: "vert", points: v, fromC: "n", toC: "s" },
    ],
    walls: [...openWalls, ...railWalls],
    // One solid plate = the webbing between all cross sections
    webbingPolys: [bodyPoly],
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

/** Rounded square / soft diamond poly, radius ~r, power k (lower = more diamond). */
function roundedSquarePoly(r, k = 0.7, n = 32) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 4; // flat toward axes? start offset
    // Use axis-aligned rounded square: max-norm blend
    const c = Math.cos(a);
    const s = Math.sin(a);
    const m = Math.pow(Math.abs(c), 2 / k) + Math.pow(Math.abs(s), 2 / k);
    const scale = r / Math.pow(m, k / 2);
    pts.push({ x: scale * c, y: scale * s });
  }
  return pts;
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
