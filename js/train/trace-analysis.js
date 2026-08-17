const DEFAULT_VIOLATIONS = new Set([
  "consist_stall",
  "coupler_violation",
  "solid_body_overlap",
  "playfield_escape",
  "track_body_penetration",
  "pose_discontinuity",
  "rail_bed_violation",
  "lead_path_pose_divergence",
  "car_path_pose_divergence",
]);

function angleDelta(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function countBy(items, key) {
  const counts = {};
  for (const item of items) {
    const value = item[key] ?? "unknown";
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

/** Pure JSON-in/JSON-out analysis used by CLI, tests, and browser hooks. */
export function analyzeTrainTrace(trace, opts = {}) {
  const frames = trace?.frames || [];
  const events = trace?.events || [];
  const cars = {};
  let maxCouplerError = 0;
  let badInvariantFrames = 0;

  for (const frame of frames) {
    const beforeCars = new Map(
      (frame.before?.cars || []).map((car) => [car.id, car])
    );
    for (const car of frame.after?.cars || []) {
      const prior = beforeCars.get(car.id);
      const stats = cars[car.id] || {
        maxStep: 0,
        maxStepFrame: null,
        maxTurn: 0,
        maxTurnFrame: null,
        modes: {},
        paths: {},
      };
      if (prior) {
        const step = Math.hypot(car.x - prior.x, car.y - prior.y);
        const turn = angleDelta(car.ang, prior.ang);
        if (step > stats.maxStep) {
          stats.maxStep = step;
          stats.maxStepFrame = frame.frame;
        }
        if (turn > stats.maxTurn) {
          stats.maxTurn = turn;
          stats.maxTurnFrame = frame.frame;
        }
      }
      stats.modes[car.mode] = (stats.modes[car.mode] || 0) + 1;
      const path = car.pathKey || "floor";
      stats.paths[path] = (stats.paths[path] || 0) + 1;
      cars[car.id] = stats;
    }
    const invariants = frame.after?.invariants;
    if (invariants) {
      maxCouplerError = Math.max(
        maxCouplerError,
        invariants.maxCouplerError || 0
      );
      if (!invariants.ok) badInvariantFrames++;
    }
  }

  for (const stats of Object.values(cars)) {
    stats.maxStep = Number(stats.maxStep.toFixed(3));
    stats.maxTurn = Number(stats.maxTurn.toFixed(6));
  }

  const violationSet = opts.violationTypes
    ? new Set(opts.violationTypes)
    : DEFAULT_VIOLATIONS;
  const violations = events.filter((event) => violationSet.has(event.type));
  const transitions = events.filter((event) =>
    [
      "rail_exit",
      "car_rail_exit",
      "lead_rerail",
      "follower_rerail",
      "mode_transition",
      "car_mode_transition",
    ].includes(event.type)
  );

  return {
    frames: frames.length,
    eventCount: events.length,
    eventCounts: countBy(events, "type"),
    finalMode: frames.at(-1)?.after?.mode ?? null,
    finalCars:
      frames.at(-1)?.after?.cars?.map((car) => ({
        id: car.id,
        mode: car.mode,
        pathKey: car.pathKey,
        x: car.x,
        y: car.y,
        ang: car.ang,
      })) || [],
    cars,
    maxCouplerError: Number(maxCouplerError.toFixed(6)),
    badInvariantFrames,
    violationCount: violations.length,
    violationCounts: countBy(violations, "type"),
    violations: violations.slice(0, opts.maxViolations ?? 100),
    transitions,
    droppedFrames: trace?.droppedFrames || 0,
    droppedEvents: trace?.droppedEvents || 0,
  };
}

export function importantTraceFrames(trace, limit = 16) {
  const priority = new Set([
    "rail_exit",
    "car_rail_exit",
    "lead_rerail",
    "follower_rerail",
    "consist_stall",
    "pose_discontinuity",
    "coupler_violation",
    "playfield_escape",
    "track_body_penetration",
  ]);
  const numbers = [];
  const seen = new Set();
  for (const event of trace?.events || []) {
    if (!priority.has(event.type) || seen.has(event.frame)) continue;
    seen.add(event.frame);
    numbers.push(event.frame);
    if (numbers.length >= limit) break;
  }
  if (trace?.frames?.length && !seen.has(0)) numbers.unshift(0);
  const last = trace?.frames?.at(-1)?.frame;
  if (last != null && !seen.has(last)) numbers.push(last);
  return numbers.slice(0, limit);
}
