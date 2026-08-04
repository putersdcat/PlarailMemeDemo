/**
 * Plarail piece geometry templates (local space) + transform helpers.
 * Scale: UNIT ≈ full R-01 length (matches curve radius).
 */

export const UNIT = 96;
export const HALF = UNIT / 2;
/** Larger / shallower curve radius (≈ 2× standard) for big outer loops. */
export const LARGE_R = UNIT * 2;
export const TRACK_W = 40;
export const HALF_W = TRACK_W / 2;
/** Magnetic snap: open ends within this distance pull together (forgiving). */
export const SNAP_DIST = 56;
export const SNAP_ANGLE = (25 * Math.PI) / 180;
export const DEG45 = Math.PI / 4;

export const PIECE_TYPES = {
  R01: "R01", // standard straight
  R01L: "R01L", // long straight (2×)
  R01S: "R01S", // long straight + stop bump-out (collision / shape)
  R02: "R02",
  R03: "R03", // 45° standard curve
  R90: "R90", // 90° quarter-circle (long sharper turn)
  R09: "R09", // large / shallow 45° curve
  R11: "R11",
  R12: "R12",
  R14: "R14",
  RY3: "RY3", // 1→3 Y-split, outers 90° apart
};

export const PIECE_META = {
  R01: { code: "R-01", name: "Straight", desc: "Full-length rail" },
  R01L: { code: "R-L", name: "Long Straight", desc: "2× length" },
  R01S: { code: "R-Stop", name: "Stop Straight", desc: "Long + side bump-out" },
  R02: { code: "R-02", name: "Half Straight", desc: "1/2 length" },
  R03: { code: "R-03", name: "Curve 45°", desc: "Standard curve" },
  R90: { code: "R-90", name: "Curve 90°", desc: "Quarter turn (sharper)" },
  R09: { code: "R-09", name: "Large Curve", desc: "Shallower 45° (2× R)" },
  R11: { code: "R-11", name: "Turnout", desc: "Straight + branch" },
  R12: { code: "R-12", name: "Y-Point", desc: "Figure-8 / dual curve" },
  R14: { code: "R-14", name: "Cross Point", desc: "4-way + corner webbing" },
  RY3: { code: "Y-3", name: "3-Way Y", desc: "1→3, outers at 90°" },
};

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

  switch (type) {
    case PIECE_TYPES.R01:
      return straightTemplate(UNIT, flip, PIECE_TYPES.R01);
    case PIECE_TYPES.R01L:
      return straightTemplate(UNIT * 2, flip, PIECE_TYPES.R01L);
    case PIECE_TYPES.R01S:
      return stopStraightTemplate(flip);
    case PIECE_TYPES.R02:
      return straightTemplate(HALF, flip, PIECE_TYPES.R02);
    case PIECE_TYPES.R03:
      return curveTemplate(flip, UNIT, DEG45, PIECE_TYPES.R03);
    case PIECE_TYPES.R90:
      return curveTemplate(flip, UNIT, Math.PI / 2, PIECE_TYPES.R90);
    case PIECE_TYPES.R09:
      return curveTemplate(flip, LARGE_R, DEG45, PIECE_TYPES.R09);
    case PIECE_TYPES.R11:
      return turnoutTemplate(branchSide, flip);
    case PIECE_TYPES.R12:
      return yPointTemplate(flip);
    case PIECE_TYPES.R14:
      return crossTemplate(flip);
    case PIECE_TYPES.RY3:
      return threeWayTemplate(flip);
    default:
      return straightTemplate(UNIT, flip, PIECE_TYPES.R01);
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
 * Long straight with a lateral “station / stop” bump-out on one side.
 * Same connector length as 2× straight; bump adds wall geometry for edge gliding.
 */
function stopStraightTemplate(flip) {
  const len = UNIT * 2;
  const base = straightTemplate(len, flip, PIECE_TYPES.R01S);
  // Bump on +Y side (or -Y if flip for visual variety — keep +Y in local)
  const bx0 = -len * 0.18;
  const bx1 = len * 0.18;
  const by0 = HALF_W;
  const by1 = HALF_W + 22;
  // Outer perimeter of bump as wall segments
  base.walls.push(
    { x1: bx0, y1: by0, x2: bx0, y2: by1 },
    { x1: bx0, y1: by1, x2: bx1, y2: by1 },
    { x1: bx1, y1: by1, x2: bx1, y2: by0 }
  );
  // Rounded-ish bump front/back fillets
  const fillet = sampleArc(bx0, by0, 10, Math.PI / 2, Math.PI, 4);
  for (let i = 1; i < fillet.length; i++) {
    base.walls.push({
      x1: fillet[i - 1].x,
      y1: fillet[i - 1].y,
      x2: fillet[i].x,
      y2: fillet[i].y,
    });
  }
  base.bump = true;
  return base;
}

/**
 * 1→3 three-way point.
 * Stem (in) from west; three exits: left, center, right.
 * Outer left & right exit headings are 90° apart (±45° from centerline).
 * Left/right use standard-radius arcs so geometry matches Plarail branch radius.
 */
function threeWayTemplate(flip) {
  const stemLen = HALF;
  const stem = [
    { x: -stemLen, y: 0 },
    { x: 0, y: 0 },
  ];
  // Use slightly tighter branch radius so the piece is compact but outers land at ±45°
  const r = UNIT * 0.85;
  // Left: arc 45° → exit heading +45°; angle between L and R outers = 90°
  const left = sampleArc(0, r, r, -Math.PI / 2, -Math.PI / 2 + DEG45, 14);
  left[0] = { x: 0, y: 0 };
  const right = sampleArc(0, -r, r, Math.PI / 2, Math.PI / 2 - DEG45, 14);
  right[0] = { x: 0, y: 0 };
  // Center: longer straight so all three exits feel like full paths out
  const center = [
    { x: 0, y: 0 },
    { x: UNIT * 0.75, y: 0 },
  ];

  const lEnd = left[left.length - 1];
  const rEnd = right[right.length - 1];
  const cEnd = center[center.length - 1];

  const gA = flip ? "F" : "M";
  const gOut = flip ? "M" : "F";

  // Webbing between arms — outer envelope arcs so free train can glide corners
  const webWalls = [
    ...curveSideWalls(0, r, r, -Math.PI / 2, -Math.PI / 2 + DEG45, HALF_W),
    ...curveSideWalls(0, -r, r, Math.PI / 2, Math.PI / 2 - DEG45, HALF_W),
    ...outerWallsAlongPolyline(stem, HALF_W, false, false),
    ...outerWallsAlongPolyline(center, HALF_W, false, false),
    // Fillet between left and center arms
    ...arcWall(lEnd.x * 0.35, lEnd.y * 0.35, HALF_W * 1.2, Math.PI * 0.15, -Math.PI * 0.15, 6),
    // Fillet between right and center
    ...arcWall(rEnd.x * 0.35, rEnd.y * 0.35, HALF_W * 1.2, -Math.PI * 0.15, Math.PI * 0.15, 6),
  ];

  return {
    type: PIECE_TYPES.RY3,
    switchable: true,
    defaultSwitch: 1,
    switchCount: 3,
    connectors: [
      { id: "a", x: stem[0].x, y: 0, ang: Math.PI, gender: gA },
      { id: "b", x: lEnd.x, y: lEnd.y, ang: Math.PI / 4, gender: gOut },
      { id: "c", x: cEnd.x, y: cEnd.y, ang: 0, gender: gOut },
      { id: "d", x: rEnd.x, y: rEnd.y, ang: -Math.PI / 4, gender: gOut },
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
        id: "center",
        points: [...stem, ...center.slice(1)],
        fromC: "a",
        toC: "c",
        switchIndex: 1,
      },
      {
        id: "right",
        points: [...stem, ...right.slice(1)],
        fromC: "a",
        toC: "d",
        switchIndex: 2,
      },
    ],
    walls: webWalls,
    bed: null,
    lever: { x: -12, y: -20 },
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

function crossTemplate(flip) {
  // Plus-shaped cross (R-14 style) with rounded corner webbing.
  // The four inner corners get fillet arcs so an off-rail train can glide
  // around the junction interior edges — critical for the meme recover path.
  const len = UNIT * 0.9;
  const hw = HALF_W * 0.9;
  const h = [
    { x: -len / 2, y: 0 },
    { x: len / 2, y: 0 },
  ];
  const v = [
    { x: 0, y: -len / 2 },
    { x: 0, y: len / 2 },
  ];
  const g = (m) => (flip ? (m === "M" ? "F" : "M") : m);

  // Webbing: quarter-circle fillets in each of the four corner pockets.
  // Outer edge of webbing sits at ~hw from both axes (rounded plastic between arms).
  const webR = hw * 1.15;
  // Centers of fillets sit at (±hw, ±hw) from origin, arcs face outward into each quadrant.
  const webs = [
    // NE: from north arm outer to east arm outer
    ...arcWall(hw, -hw, webR, Math.PI, Math.PI / 2, 10),
    // SE
    ...arcWall(hw, hw, webR, -Math.PI / 2, 0, 10),
    // SW
    ...arcWall(-hw, hw, webR, 0, Math.PI / 2, 10),
    // NW
    ...arcWall(-hw, -hw, webR, Math.PI / 2, Math.PI, 10),
  ];

  // Also keep side walls of the arms (open mouths)
  const armWalls = [
    ...outerWallsAlongPolyline(h, hw, false, false),
    ...outerWallsAlongPolyline(v, hw, false, false),
  ];

  return {
    type: PIECE_TYPES.R14,
    switchable: true,
    defaultSwitch: 0,
    bothPathsActive: true,
    connectors: [
      { id: "w", x: -len / 2, y: 0, ang: Math.PI, gender: g("M") },
      { id: "e", x: len / 2, y: 0, ang: 0, gender: g("F") },
      { id: "n", x: 0, y: -len / 2, ang: -Math.PI / 2, gender: g("M") },
      { id: "s", x: 0, y: len / 2, ang: Math.PI / 2, gender: g("F") },
    ],
    paths: [
      { id: "horiz", points: h, fromC: "w", toC: "e" },
      { id: "vert", points: v, fromC: "n", toC: "s" },
    ],
    walls: [...armWalls, ...webs],
    // Draw helper: rounded webbing for renderer
    webbing: [
      { cx: hw, cy: -hw, r: webR, a0: Math.PI, a1: Math.PI / 2 },
      { cx: hw, cy: hw, r: webR, a0: -Math.PI / 2, a1: 0 },
      { cx: -hw, cy: hw, r: webR, a0: 0, a1: Math.PI / 2 },
      { cx: -hw, cy: -hw, r: webR, a0: Math.PI / 2, a1: Math.PI },
    ],
    bed: null,
    lever: { x: 16, y: -16 },
    color: null,
  };
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
  return { tpl, connectors, paths, walls, lever };
}
