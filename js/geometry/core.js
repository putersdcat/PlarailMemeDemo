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