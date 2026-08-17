import {
  HALF_W,
  TRACK_W,
  angleDiff,
  normalizeAngle,
  pointOnPolyline,
} from "./geometry.js";
import {
  ANGLE_QUANTUM,
  COUPLER_LATERAL_LIMIT,
  COUPLER_DIST,
  FRONT_AXLE_OFFSET,
  FRONT_HITCH,
  POSITION_QUANTUM,
  REAR_AXLE_OFFSET,
  REAR_HITCH,
  TRAIN_LENGTH,
  TRAIN_RADIUS,
  WHEEL_RADIUS,
  TrainMode,
} from "./train/constants.js";

/** Machine-readable world contract version. */
export const WORLD_CONTRACT_VERSION = 1;
/** Maximum length of a sampled union-boundary segment. */
const BOUNDARY_STEP = 6;
const EPS = 1e-9;
const geometryCache = new WeakMap();

export function quantize(value, quantum = POSITION_QUANTUM) {
  if (!Number.isFinite(value)) return value;
  return Math.round(value / quantum) * quantum;
}

export function quantizeAngle(value) {
  return normalizeAngle(quantize(value, ANGLE_QUANTUM));
}

export function quantizePose(pose) {
  if (!pose) return pose;
  pose.x = quantize(pose.x);
  pose.y = quantize(pose.y);
  pose.ang = quantizeAngle(pose.ang || 0);
  if (Number.isFinite(pose.vx)) pose.vx = quantize(pose.vx);
  if (Number.isFinite(pose.vy)) pose.vy = quantize(pose.vy);
  if (Number.isFinite(pose.s)) pose.s = quantize(pose.s, 0.000001);
  if (Number.isFinite(pose.frontCouplerOffset)) {
    pose.frontCouplerOffset = quantize(
      Math.max(-COUPLER_LATERAL_LIMIT, Math.min(COUPLER_LATERAL_LIMIT, pose.frontCouplerOffset))
    );
  }
  if (Number.isFinite(pose.rearCouplerOffset)) {
    pose.rearCouplerOffset = quantize(
      Math.max(-COUPLER_LATERAL_LIMIT, Math.min(COUPLER_LATERAL_LIMIT, pose.rearCouplerOffset))
    );
  }
  return pose;
}

function roundForContract(value, digits = 3) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i];
    const b = points[j];
    const crosses =
      a.y > y !== b.y > y &&
      x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y || EPS) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function closestOnSegment(x, y, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)
  );
  const px = a.x + dx * t;
  const py = a.y + dy * t;
  return {
    x: px,
    y: py,
    t,
    dist: Math.hypot(x - px, y - py),
  };
}

function insideAnyPolygon(polys, x, y, ignoredPieceIds = null) {
  for (const poly of polys) {
    if (ignoredPieceIds?.has(poly.pieceId)) continue;
    if (pointInPolygon(x, y, poly.points)) return true;
  }
  return false;
}

/**
 * Convert overlapping renderer bed polygons into sampled exposed boundaries.
 * Internal turnout/cross seams are rejected by probing the outward side
 * against every other polygon in the union.
 */
function buildUnionBoundary(polys) {
  const segments = [];
  for (let polyIndex = 0; polyIndex < polys.length; polyIndex++) {
    const poly = polys[polyIndex];
    const points = poly.points || [];
    const open = new Set(poly.openEdges || []);
    for (let edge = 0; edge < points.length; edge++) {
      if (open.has(edge)) continue;
      const a = points[edge];
      const b = points[(edge + 1) % points.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.hypot(dx, dy);
      if (length < EPS) continue;
      const count = Math.max(1, Math.ceil(length / BOUNDARY_STEP));
      for (let part = 0; part < count; part++) {
        const t0 = part / count;
        const t1 = (part + 1) / count;
        const x1 = a.x + dx * t0;
        const y1 = a.y + dy * t0;
        const x2 = a.x + dx * t1;
        const y2 = a.y + dy * t1;
        const mx = (x1 + x2) * 0.5;
        const my = (y1 + y2) * 0.5;
        let nx = -dy / length;
        let ny = dx / length;
        // Pick the side outside this polygon without assuming winding order.
        if (pointInPolygon(mx + nx * 0.25, my + ny * 0.25, points)) {
          nx = -nx;
          ny = -ny;
        }
        // Boundary hidden inside another bed is an assembly seam, not a wall.
        let internal = false;
        const ox = mx + nx * 0.5;
        const oy = my + ny * 0.5;
        for (let otherIndex = 0; otherIndex < polys.length; otherIndex++) {
          if (otherIndex === polyIndex) continue;
          if (pointInPolygon(ox, oy, polys[otherIndex].points)) {
            internal = true;
            break;
          }
        }
        if (internal) continue;
        segments.push({
          x1,
          y1,
          x2,
          y2,
          nx,
          ny,
          pieceId: poly.pieceId,
          kind: poly.kind || "track-bed",
          minX: Math.min(x1, x2),
          minY: Math.min(y1, y2),
          maxX: Math.max(x1, x2),
          maxY: Math.max(y1, y2),
        });
      }
    }
  }
  return segments;
}

function solidGeometry(board) {
  const polys = board?.solidPolys || [];
  const cached = geometryCache.get(board);
  if (
    cached &&
    cached.sourcePolys === polys &&
    cached.polyCount === polys.length &&
    cached.pieceCount === (board?.pieces?.length || 0) &&
    cached.wallCount === (board?.walls?.length || 0)
  ) {
    return cached;
  }
  const value = {
    sourcePolys: polys,
    polys,
    boundary: buildUnionBoundary(polys),
    polyCount: polys.length,
    pieceCount: board?.pieces?.length || 0,
    wallCount: board?.walls?.length || 0,
  };
  geometryCache.set(board, value);
  return value;
}

export function worldSolidBoundary(board) {
  return solidGeometry(board).boundary;
}

/** Capsule samples used by both runtime collision and diagnostics. */
export function carCollisionCircles(pose) {
  const ang = pose?.ang || 0;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const coreHalf = Math.max(0, TRAIN_LENGTH * 0.5 - TRAIN_RADIUS);
  const offsets = [-coreHalf, -coreHalf * 0.5, 0, coreHalf * 0.5, coreHalf];
  return offsets.map((offset) => ({
    x: pose.x + ux * offset,
    y: pose.y + uy * offset,
    radius: TRAIN_RADIUS,
    offset,
  }));
}

export function carBodyExtents(ang = 0) {
  const coreHalf = Math.max(0, TRAIN_LENGTH * 0.5 - TRAIN_RADIUS);
  return {
    x: Math.abs(Math.cos(ang)) * coreHalf + TRAIN_RADIUS,
    y: Math.abs(Math.sin(ang)) * coreHalf + TRAIN_RADIUS,
  };
}

export function frontHitch(car) {
  const offset = Number.isFinite(car?.frontCouplerOffset)
    ? Math.max(-COUPLER_LATERAL_LIMIT, Math.min(COUPLER_LATERAL_LIMIT, car.frontCouplerOffset))
    : 0;
  const ux = Math.cos(car.ang || 0);
  const uy = Math.sin(car.ang || 0);
  return {
    x: car.x + ux * FRONT_HITCH - uy * offset,
    y: car.y + uy * FRONT_HITCH + ux * offset,
  };
}

export function rearHitch(car) {
  const offset = Number.isFinite(car?.rearCouplerOffset)
    ? Math.max(-COUPLER_LATERAL_LIMIT, Math.min(COUPLER_LATERAL_LIMIT, car.rearCouplerOffset))
    : 0;
  const ux = Math.cos(car.ang || 0);
  const uy = Math.sin(car.ang || 0);
  return {
    x: car.x - ux * REAR_HITCH - uy * offset,
    y: car.y - uy * REAR_HITCH + ux * offset,
  };
}

/**
 * Return the one open connector whose capture throat contains an aligned
 * car nose. Used identically by powered and follower collision checks.
 */
export function findOpenMouthPortal(board, pose) {
  if (!board || !pose) return null;
  const ang = pose.ang || 0;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const anchor = frontHitch(pose);
  const anchorX = anchor.x;
  const anchorY = anchor.y;
  for (const connector of board.connectors || []) {
    if (connector.linked) continue;
    const mx = Math.cos(connector.wang);
    const my = Math.sin(connector.wang);
    const inward = -(ux * mx + uy * my);
    if (inward < 0.7) continue;
    const dx = anchorX - connector.wx;
    const dy = anchorY - connector.wy;
    const longitudinal = dx * mx + dy * my;
    const lateral = Math.abs(dx * -my + dy * mx);
    if (
      longitudinal >=
        -(FRONT_HITCH - REAR_AXLE_OFFSET + TRAIN_RADIUS) &&
      longitudinal <= FRONT_HITCH &&
      // A portal is a centered rail throat, not a broad proximity trigger.
      // A lateral side scrape must still collide with the owning bed.
      lateral <= HALF_W
    ) {
      return connector;
    }
  }
  return null;
}

/** Outbound counterpart used after a rail exit from a known owning piece. */
export function findOpenMouthExitPortal(board, pose, sourcePieceId) {
  if (!board || !pose || !sourcePieceId) return null;
  const ang = pose.ang || 0;
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  for (const connector of board.connectors || []) {
    if (connector.pieceId !== sourcePieceId || connector.linked) continue;
    const mx = Math.cos(connector.wang);
    const my = Math.sin(connector.wang);
    if (ux * mx + uy * my < 0.7) continue;
    const dx = pose.x - connector.wx;
    const dy = pose.y - connector.wy;
    const longitudinal = dx * mx + dy * my;
    const lateral = Math.abs(dx * -my + dy * mx);
    if (
      longitudinal >= -FRONT_HITCH &&
      longitudinal <= FRONT_HITCH * 2.5 &&
      lateral <= HALF_W + 2
    ) {
      return connector;
    }
  }
  return null;
}

function connectorPlayfieldSide(connector, bounds) {
  if (!connector || !bounds) return null;
  const reach = HALF_W + 4;
  const distances = [
    { side: "top", value: Math.abs(connector.wy - bounds.minY) },
    { side: "right", value: Math.abs(connector.wx - bounds.maxX) },
    { side: "bottom", value: Math.abs(connector.wy - bounds.maxY) },
    { side: "left", value: Math.abs(connector.wx - bounds.minX) },
  ].sort((a, b) => a.value - b.value);
  return distances[0].value <= reach ? distances[0].side : null;
}

/**
 * Wall sides opened by an aligned mouth or a rail-owned path on the mouth's
 * piece. This lets track plastic meet the wall with no fake floor gap while
 * preserving full-body collision everywhere outside the finite portal.
 */
export function playfieldPortalSides(board, pose, bounds) {
  const sides = new Set();
  if (!board || !pose || !bounds) return sides;
  const inbound = findOpenMouthPortal(board, pose);
  const outbound = findOpenMouthExitPortal(
    board,
    pose,
    pose.openMouthPieceId
  );
  for (const connector of [inbound, outbound]) {
    const side = connectorPlayfieldSide(connector, bounds);
    if (side) sides.add(side);
  }
  // A lead rail exit carries a finite, topology-owned clearance window. A
  // coupled follower may be rotated by its pinned bar while its hull is still
  // crossing that same throat, so requiring its current front pin to rediscover
  // the mouth would falsely turn a valid corridor into a wall collision.
  // Never infer this from proximity alone: the state must name the source or
  // adjacent piece and the fixed-step window must still be positive.
  if (pose.openMouthClearSteps > 0) {
    const corridorPieces = new Set(
      [pose.openMouthPieceId, pose.openMouthAdjacentPieceId].filter(Boolean)
    );
    for (const connector of board.connectors || []) {
      if (connector.linked || !corridorPieces.has(connector.pieceId)) continue;
      const side = connectorPlayfieldSide(connector, bounds);
      if (side) sides.add(side);
    }
  }
  if (pose.mode === TrainMode.ON_RAIL && pose.pathRef?.pieceId) {
    for (const connector of board.connectors || []) {
      if (
        connector.linked ||
        connector.pieceId !== pose.pathRef.pieceId
      ) {
        continue;
      }
      const side = connectorPlayfieldSide(connector, bounds);
      if (side) sides.add(side);
    }
  }
  return sides;
}

export function couplerError(prev, car) {
  const a = rearHitch(prev);
  const b = frontHitch(car);
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Deepest full-body contact with the renderer-derived track solid union. */
export function trackBodyContact(pose, board, opts = {}) {
  if (!pose || !board) return null;
  const { polys, boundary } = solidGeometry(board);
  const ignoredPieceIds = new Set(
    [
      opts.ignorePieceId,
      ...(Array.isArray(opts.ignorePieceIds) ? opts.ignorePieceIds : []),
    ].filter(Boolean)
  );
  let deepest = null;
  for (const circle of carCollisionCircles(pose)) {
    const inside = insideAnyPolygon(
      polys,
      circle.x,
      circle.y,
      ignoredPieceIds
    );
    let nearest = null;
    for (const segment of boundary) {
      if (ignoredPieceIds.has(segment.pieceId)) continue;
      const reach = circle.radius + (inside ? TRAIN_LENGTH : 1);
      if (
        circle.x < segment.minX - reach ||
        circle.x > segment.maxX + reach ||
        circle.y < segment.minY - reach ||
        circle.y > segment.maxY + reach
      ) {
        continue;
      }
      const hit = closestOnSegment(
        circle.x,
        circle.y,
        { x: segment.x1, y: segment.y1 },
        { x: segment.x2, y: segment.y2 }
      );
      if (!nearest || hit.dist < nearest.dist) nearest = { ...hit, segment };
    }
    if (!nearest) continue;
    if (!inside && nearest.dist >= circle.radius) continue;
    let nx;
    let ny;
    let penetration;
    if (inside) {
      nx = nearest.segment.nx;
      ny = nearest.segment.ny;
      penetration = nearest.dist + circle.radius;
    } else if (nearest.dist > EPS) {
      nx = (circle.x - nearest.x) / nearest.dist;
      ny = (circle.y - nearest.y) / nearest.dist;
      penetration = circle.radius - nearest.dist;
    } else {
      nx = nearest.segment.nx;
      ny = nearest.segment.ny;
      penetration = circle.radius;
    }
    const contact = {
      penetration,
      nx,
      ny,
      x: nearest.x,
      y: nearest.y,
      circleOffset: circle.offset,
      pieceId: nearest.segment.pieceId,
      kind: nearest.segment.kind,
      inside,
    };
    if (!deepest || contact.penetration > deepest.penetration) {
      deepest = contact;
    }
  }
  return deepest;
}

/**
 * Operational off-rail contact used by the main-branch wall solver.
 *
 * Floor motion owns the compact front/rear axle circles against the exposed
 * wall segments. The long rendered capsule may overlap an inner rail-bed
 * polygon while it follows the open interior corridor; treating that visual
 * envelope as a full-body ejector is what caused the R-14 teleport.
 */
export function trackWheelContact(pose, board, opts = {}) {
  if (!pose || !board) return null;
  const ignoredPieceIds = new Set(
    [
      opts.ignorePieceId,
      ...(Array.isArray(opts.ignorePieceIds) ? opts.ignorePieceIds : []),
    ].filter(Boolean)
  );
  const ang = pose.ang || 0;
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const probes = [
    {
      x: pose.x + ca * FRONT_AXLE_OFFSET,
      y: pose.y + sa * FRONT_AXLE_OFFSET,
      offset: FRONT_AXLE_OFFSET,
    },
    {
      x: pose.x + ca * REAR_AXLE_OFFSET,
      y: pose.y + sa * REAR_AXLE_OFFSET,
      offset: REAR_AXLE_OFFSET,
    },
  ];
  let deepest = null;
  for (const probe of probes) {
    for (const wall of board.walls || []) {
      if (ignoredPieceIds.has(wall.pieceId)) continue;
      const hit = closestOnSegment(
        probe.x,
        probe.y,
        { x: wall.x1, y: wall.y1 },
        { x: wall.x2, y: wall.y2 }
      );
      if (hit.dist >= WHEEL_RADIUS) continue;
      let nx;
      let ny;
      if (hit.dist > EPS) {
        nx = (probe.x - hit.x) / hit.dist;
        ny = (probe.y - hit.y) / hit.dist;
      } else {
        const dx = wall.x2 - wall.x1;
        const dy = wall.y2 - wall.y1;
        const length = Math.hypot(dx, dy) || 1;
        nx = -dy / length;
        ny = dx / length;
      }
      const contact = {
        penetration: WHEEL_RADIUS - hit.dist,
        nx,
        ny,
        x: hit.x,
        y: hit.y,
        circleOffset: probe.offset,
        pieceId: wall.pieceId || null,
        kind: "track-wall",
        inside: false,
      };
      if (!deepest || contact.penetration > deepest.penetration) {
        deepest = contact;
      }
    }
  }
  return deepest;
}

export function bodyInsidePlayfield(pose, bounds, tolerance = 0) {
  if (!pose || !bounds) return true;
  const ext = carBodyExtents(pose.ang || 0);
  return (
    pose.x - ext.x >= bounds.minX - tolerance &&
    pose.x + ext.x <= bounds.maxX + tolerance &&
    pose.y - ext.y >= bounds.minY - tolerance &&
    pose.y + ext.y <= bounds.maxY + tolerance
  );
}

export function playfieldBodyContact(pose, bounds) {
  if (!pose || !bounds) return null;
  const ext = carBodyExtents(pose.ang || 0);
  const contacts = [];
  if (pose.x - ext.x < bounds.minX) {
    contacts.push({
      side: "left",
      nx: 1,
      ny: 0,
      penetration: bounds.minX - (pose.x - ext.x),
    });
  }
  if (pose.x + ext.x > bounds.maxX) {
    contacts.push({
      side: "right",
      nx: -1,
      ny: 0,
      penetration: pose.x + ext.x - bounds.maxX,
    });
  }
  if (pose.y - ext.y < bounds.minY) {
    contacts.push({
      side: "top",
      nx: 0,
      ny: 1,
      penetration: bounds.minY - (pose.y - ext.y),
    });
  }
  if (pose.y + ext.y > bounds.maxY) {
    contacts.push({
      side: "bottom",
      nx: 0,
      ny: -1,
      penetration: pose.y + ext.y - bounds.maxY,
    });
  }
  contacts.sort((a, b) => b.penetration - a.penetration);
  return contacts[0] || null;
}

/** Diagnostic overlap for conservative rectangular envelopes. */
export function carObbOverlap(a, b) {
  if (!a || !b) return null;
  const af = { x: Math.cos(a.ang || 0), y: Math.sin(a.ang || 0) };
  const as = { x: -af.y, y: af.x };
  const bf = { x: Math.cos(b.ang || 0), y: Math.sin(b.ang || 0) };
  const bs = { x: -bf.y, y: bf.x };
  const axes = [af, as, bf, bs];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const halfL = TRAIN_LENGTH * 0.5;
  const halfW = TRAIN_RADIUS;
  let minPen = Infinity;
  let bestAxis = null;
  for (const axis of axes) {
    const center = Math.abs(dx * axis.x + dy * axis.y);
    const ar =
      halfL * Math.abs(af.x * axis.x + af.y * axis.y) +
      halfW * Math.abs(as.x * axis.x + as.y * axis.y);
    const br =
      halfL * Math.abs(bf.x * axis.x + bf.y * axis.y) +
      halfW * Math.abs(bs.x * axis.x + bs.y * axis.y);
    const penetration = ar + br - center;
    if (penetration <= 0) return null;
    if (penetration < minPen) {
      minPen = penetration;
      const sign = dx * axis.x + dy * axis.y >= 0 ? 1 : -1;
      bestAxis = { x: axis.x * sign, y: axis.y * sign };
    }
  }
  return { penetration: minPen, nx: bestAxis.x, ny: bestAxis.y };
}

function capsuleCore(car) {
  const half = Math.max(0, TRAIN_LENGTH * 0.5 - TRAIN_RADIUS);
  const ux = Math.cos(car.ang || 0);
  const uy = Math.sin(car.ang || 0);
  return {
    a: { x: car.x - ux * half, y: car.y - uy * half },
    b: { x: car.x + ux * half, y: car.y + uy * half },
  };
}

function segmentDistance(a, b, c, d) {
  const orient = (p, q, r) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const onSegment = (p, q, r) =>
    q.x >= Math.min(p.x, r.x) - EPS &&
    q.x <= Math.max(p.x, r.x) + EPS &&
    q.y >= Math.min(p.y, r.y) - EPS &&
    q.y <= Math.max(p.y, r.y) + EPS;
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  const proper =
    ((o1 > EPS && o2 < -EPS) || (o1 < -EPS && o2 > EPS)) &&
    ((o3 > EPS && o4 < -EPS) || (o3 < -EPS && o4 > EPS));
  if (
    proper ||
    (Math.abs(o1) <= EPS && onSegment(a, c, b)) ||
    (Math.abs(o2) <= EPS && onSegment(a, d, b)) ||
    (Math.abs(o3) <= EPS && onSegment(c, a, d)) ||
    (Math.abs(o4) <= EPS && onSegment(c, b, d))
  ) {
    return 0;
  }
  return Math.min(
    closestOnSegment(a.x, a.y, c, d).dist,
    closestOnSegment(b.x, b.y, c, d).dist,
    closestOnSegment(c.x, c.y, a, b).dist,
    closestOnSegment(d.x, d.y, a, b).dist
  );
}

/**
 * Solid car hull used by physics: a rounded capsule matching the tapered
 * sprite far better than a full rectangular envelope at articulated bends.
 */
export function carBodyOverlap(a, b) {
  if (!a || !b) return null;
  const ca = capsuleCore(a);
  const cb = capsuleCore(b);
  const distance = segmentDistance(ca.a, ca.b, cb.a, cb.b);
  const penetration = TRAIN_RADIUS * 2 - distance;
  if (penetration <= 0) return null;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  dx /= length;
  dy /= length;
  return { penetration, nx: dx, ny: dy };
}

function poweredChain(train) {
  const cars = train?.cars || [];
  if (!cars.length) return [];
  let index = cars.findIndex(
    (car) => car.powered || car.id === train.poweredId
  );
  if (index < 0) index = 0;
  const chain = [cars[index]];
  for (let i = index + 1; i < cars.length && cars[i].coupled; i++) {
    chain.push(cars[i]);
  }
  return chain;
}

/** Invariants used identically by browser telemetry, CLI traces, and tests. */
export function inspectTrainState(board, train, bounds, opts = {}) {
  const cars = train?.cars?.length ? train.cars : train ? [train] : [];
  const chain = poweredChain(train);
  const couplers = [];
  let maxCouplerError = 0;
  for (let i = 1; i < chain.length; i++) {
    const error = couplerError(chain[i - 1], chain[i]);
    maxCouplerError = Math.max(maxCouplerError, error);
    couplers.push({
      from: chain[i - 1].id,
      to: chain[i].id,
      error: roundForContract(error, 6),
      ok: error <= (opts.couplerTolerance ?? 0.05),
    });
  }

  const overlaps = [];
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const hit = carBodyOverlap(cars[i], cars[j]);
      if (hit && hit.penetration > 0.05) {
        overlaps.push({
          a: cars[i].id || `car${i}`,
          b: cars[j].id || `car${j}`,
          penetration: roundForContract(hit.penetration),
        });
      }
    }
  }

  const escaped = [];
  const trackPenetrations = [];
  for (const car of cars) {
    const chainIndex = chain.findIndex((item) => item.id === car.id);
    const predecessor = chainIndex > 0 ? chain[chainIndex - 1] : null;
    const pinnedRailPredecessor =
      car.mode === TrainMode.OFF_RAIL &&
      predecessor?.mode === TrainMode.ON_RAIL &&
      predecessor.pathRef &&
      couplerError(predecessor, car) <= (opts.couplerTolerance ?? 0.05)
        ? predecessor
        : null;
    const portalPose = pinnedRailPredecessor
      ? {
          ...car,
          mode: TrainMode.ON_RAIL,
          pathRef: pinnedRailPredecessor.pathRef,
        }
      : car;
    if (opts.solidPlayfield && bounds && !bodyInsidePlayfield(car, bounds, 0.05)) {
      const hit = playfieldBodyContact(car, bounds);
      const portals = playfieldPortalSides(board, portalPose, bounds);
      if (!hit || !portals.has(hit.side)) {
        escaped.push({
          id: car.id || "lead",
          side: hit?.side || "unknown",
          penetration: roundForContract(hit?.penetration || 0),
        });
      }
    }
    if (car.mode === TrainMode.OFF_RAIL) {
      const inboundPortal = findOpenMouthPortal(board, car);
      const outboundPortal = findOpenMouthExitPortal(
        board,
        car,
        car.openMouthPieceId
      );
      const hit = trackWheelContact(car, board, {
        ignorePieceIds: [
          outboundPortal?.pieceId,
          inboundPortal?.pieceId,
          pinnedRailPredecessor?.pathRef?.pieceId,
          car.openMouthClearSteps > 0
            ? car.openMouthAdjacentPieceId
            : null,
        ].filter(Boolean),
      });
      if (hit && hit.penetration > 0.1) {
        trackPenetrations.push({
          id: car.id || "lead",
          pieceId: hit.pieceId,
          penetration: roundForContract(hit.penetration),
        });
      }
    }
  }

  const finite = cars.every((car) =>
    [car.x, car.y, car.ang, car.vx || 0, car.vy || 0].every(Number.isFinite)
  );
  return {
    ok:
      finite &&
      maxCouplerError <= (opts.couplerTolerance ?? 0.05) &&
      overlaps.length === 0 &&
      escaped.length === 0 &&
      trackPenetrations.length === 0,
    finite,
    maxCouplerError: roundForContract(maxCouplerError, 6),
    couplers,
    overlaps,
    escaped,
    trackPenetrations,
  };
}

function pathEndpointDiagnostics(path, connectors) {
  const from = connectors.find(
    (connector) =>
      connector.pieceId === path.pieceId && connector.id === path.fromC
  );
  const to = connectors.find(
    (connector) =>
      connector.pieceId === path.pieceId && connector.id === path.toC
  );
  if (!from || !to || path.points.length < 2) return null;
  const first = path.points[0];
  const second = path.points[1];
  const last = path.points[path.points.length - 1];
  const penultimate = path.points[path.points.length - 2];
  const startAng = Math.atan2(second.y - first.y, second.x - first.x);
  const endAng = Math.atan2(last.y - penultimate.y, last.x - penultimate.x);
  return {
    pathKey: `${path.pieceId}:${path.id}`,
    startPositionError: roundForContract(
      Math.hypot(first.x - from.wx, first.y - from.wy),
      6
    ),
    endPositionError: roundForContract(
      Math.hypot(last.x - to.wx, last.y - to.wy),
      6
    ),
    startAngleErrorDeg: roundForContract(
      (angleDiff(startAng + Math.PI, from.wang) * 180) / Math.PI,
      4
    ),
    endAngleErrorDeg: roundForContract(
      (angleDiff(endAng, to.wang) * 180) / Math.PI,
      4
    ),
  };
}

/** Serializable topology + geometry contract; no class instances or Maps. */
export function buildWorldContract(board, bounds = null) {
  const boundary = worldSolidBoundary(board);
  const links = [];
  const seen = new Set();
  for (const connector of board?.connectors || []) {
    if (!connector.linked) continue;
    const ends = [
      `${connector.pieceId}:${connector.id}`,
      `${connector.linked.pieceId}:${connector.linked.id}`,
    ].sort();
    const key = ends.join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ a: ends[0], b: ends[1] });
  }
  const openMouths = (board?.connectors || [])
    .filter((connector) => !connector.linked)
    .map((connector) => ({
      key: `${connector.pieceId}:${connector.id}`,
      x: roundForContract(connector.wx),
      y: roundForContract(connector.wy),
      outwardAngle: roundForContract(connector.wang, 6),
      gender: connector.gender,
    }));
  const paths = (board?.pathIndex || []).map((path) => ({
    key: `${path.pieceId}:${path.id}`,
    pieceId: path.pieceId,
    active: !!path.active,
    from: `${path.pieceId}:${path.fromC}`,
    to: `${path.pieceId}:${path.toC}`,
    length: roundForContract(path.length),
    points: path.points.map((point) => [
      roundForContract(point.x),
      roundForContract(point.y),
    ]),
  }));
  const endpointDiagnostics = (board?.pathIndex || [])
    .map((path) => pathEndpointDiagnostics(path, board.connectors || []))
    .filter(Boolean);
  return {
    schema: "plarail-world-contract",
    version: WORLD_CONTRACT_VERSION,
    coordinates: {
      units: "simulation-pixels",
      xAxis: "right",
      yAxis: "down",
      positionQuantum: POSITION_QUANTUM,
      angleQuantumRadians: ANGLE_QUANTUM,
    },
    dimensions: {
      trackWidth: TRACK_W,
      trackHalfWidth: HALF_W,
      carLength: TRAIN_LENGTH,
      carHalfWidth: TRAIN_RADIUS,
      nominalCenterSpacing: COUPLER_DIST,
      coupling: "coincident-pin-tips",
    },
    playfield: bounds
      ? Object.fromEntries(
          Object.entries(bounds).map(([key, value]) => [
            key,
            roundForContract(value),
          ])
        )
      : null,
    pieces: (board?.pieces || []).map((piece) => ({
      id: piece.id,
      type: piece.type,
      x: roundForContract(piece.x),
      y: roundForContract(piece.y),
      rotationSteps: piece.rotSteps,
      mirrored: piece.branchSide === "L",
      genderFlipped: !!piece.flip,
      switchState: piece.switchState ?? 0,
    })),
    topology: { links, openMouths },
    paths,
    collision: {
      source: "renderer-solid-polygon-union",
      polygonCount: board?.solidPolys?.length || 0,
      exposedBoundarySegments: boundary.length,
    },
    diagnostics: {
      endpointDiagnostics,
      endpointFailures: endpointDiagnostics.filter(
        (item) =>
          item.startPositionError > 0.01 ||
          item.endPositionError > 0.01 ||
          item.startAngleErrorDeg > 4 ||
          item.endAngleErrorDeg > 4
      ),
    },
  };
}

function distToPath(x, y, path) {
  let best = Infinity;
  for (let i = 1; i < path.points.length; i++) {
    best = Math.min(
      best,
      closestOnSegment(x, y, path.points[i - 1], path.points[i]).dist
    );
  }
  return best;
}

/** Deterministic text rendering for agents, CI artifacts, and bug reports. */
export function renderWorldAscii(board, train, bounds, opts = {}) {
  const width = Math.max(24, opts.width || 96);
  const height = Math.max(12, opts.height || 36);
  let world = bounds;
  if (!world) {
    const points = (board?.pathIndex || []).flatMap((path) => path.points);
    if (!points.length) world = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    else {
      world = {
        minX: Math.min(...points.map((point) => point.x)) - 40,
        minY: Math.min(...points.map((point) => point.y)) - 40,
        maxX: Math.max(...points.map((point) => point.x)) + 40,
        maxY: Math.max(...points.map((point) => point.y)) + 40,
      };
    }
  }
  const dx = (world.maxX - world.minX) / width;
  const dy = (world.maxY - world.minY) / height;
  const rows = [];
  const cars = train?.cars?.length ? train.cars : train ? [train] : [];
  for (let row = 0; row < height; row++) {
    let line = "";
    const y = world.minY + (row + 0.5) * dy;
    for (let col = 0; col < width; col++) {
      const x = world.minX + (col + 0.5) * dx;
      let char = " ";
      if (insideAnyPolygon(solidGeometry(board).polys, x, y)) char = "#";
      for (const path of board?.pathIndex || []) {
        if (distToPath(x, y, path) <= Math.max(1.5, Math.min(dx, dy) * 0.3)) {
          char = path.active ? "=" : ".";
          break;
        }
      }
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        if (
          Math.abs(car.x - x) <= dx * 0.65 &&
          Math.abs(car.y - y) <= dy * 0.65
        ) {
          char = i < 10 ? String(i) : "T";
        }
      }
      line += char;
    }
    rows.push(line);
  }
  const legend = cars
    .map(
      (car, index) =>
        `${index}=${car.id || (index === 0 ? "lead" : `car${index}`)}:${car.mode}`
    )
    .join(" ");
  return [
    `world x=[${roundForContract(world.minX)},${roundForContract(world.maxX)}] y=[${roundForContract(world.minY)},${roundForContract(world.maxY)}]`,
    `legend #=solid-track ==active-rail .=inactive-rail ${legend}`,
    `+${"-".repeat(width)}+`,
    ...rows.map((row) => `|${row}|`),
    `+${"-".repeat(width)}+`,
  ].join("\n");
}
