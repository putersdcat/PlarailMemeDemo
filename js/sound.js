/**
 * Library-free Web Audio (no samples, no npm).
 *
 * Continuous motor = user's plastic gear-set graph:
 *   bandpass noise × square-wave gain modulation (tooth mesh)
 * Three fixed gear layers; tooth rate scales with train speed;
 * same timbre on/off rail; quieter off-rail via bus gain.
 */

let ctx = null;
let master = null;
let unlocked = false;

/** @type {null | { bus: GainNode, sets: GearSet[], sources: AudioScheduledSourceNode[] }} */
let motorNodes = null;
/** Relative motor bus level (see MOTOR_LEVEL_ON / MOTOR_LEVEL_OFF). */
let motorLevel = 1;
let lastSpeedNorm = 1;

/**
 * Base gear layers (user's working values at reference speed).
 * filterFrequency Hz, gearSpeed Hz (square mod), volume, toothAmount (mod depth).
 */
const GEAR_BASE = [
  { filterFrequency: 1500, gearSpeed: 14, volume: 0.03, toothAmount: 0.026 },
  { filterFrequency: 1600, gearSpeed: 18, volume: 0.025, toothAmount: 0.02 },
  { filterFrequency: 1400, gearSpeed: 22, volume: 0.015, toothAmount: 0.01 },
];

/**
 * Bus gain matches the user's master (0.18).
 * Each balance pass raises on/off by +0.62 (the original on−off gap):
 *   pass1: off 0.38→1.0, on 1.0→1.62
 *   pass2: off 1.0→1.62, on 1.62→2.24
 */
const MOTOR_BUS_BASE = 0.18;
const MOTOR_LEVEL_ON = 2.24;
const MOTOR_LEVEL_OFF = 1.62;

/** @typedef {{ noise: AudioBufferSourceNode, teeth: OscillatorNode, filter: BiquadFilterNode, gearVolume: GainNode, modulation: GainNode, base: typeof GEAR_BASE[0] }} GearSet */

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  // One-shots sit under master; motor has its own bus into master
  master.gain.value = 1;
  master.connect(ctx.destination);
  return ctx;
}

/** Must run inside a user gesture (click/key). */
export function unlockAudio() {
  const c = getCtx();
  if (!c) return false;
  unlocked = true;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
  return true;
}

export function isAudioReady() {
  return !!(unlocked && ctx && ctx.state !== "closed");
}

function ensureReady() {
  const c = getCtx();
  if (!c) return null;
  if (!unlocked) unlockAudio();
  if (c.state === "suspended") c.resume().catch(() => {});
  return unlocked ? c : null;
}

function makeNoise(seconds = 1) {
  const c = getCtx();
  const buffer = c.createBuffer(1, Math.floor(c.sampleRate * seconds), c.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.random() * 2 - 1;
  }
  return buffer;
}

/** Shared noise buffer so gear sets don't each allocate. */
let sharedNoise = null;
function getNoiseBuffer() {
  if (!sharedNoise) sharedNoise = makeNoise(1);
  return sharedNoise;
}

/**
 * One gear set from the user's addGearSet(filterFrequency, gearSpeed, volume, toothAmount).
 * @param {AudioContext} c
 * @param {AudioNode} dest
 * @param {typeof GEAR_BASE[0]} base
 * @returns {GearSet}
 */
function addGearSet(c, dest, base) {
  const noise = c.createBufferSource();
  noise.buffer = getNoiseBuffer();
  noise.loop = true;

  const filter = c.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = base.filterFrequency;
  filter.Q.value = 4;

  const gearVolume = c.createGain();
  // DC offset for AM; square teeth modulate this param
  gearVolume.gain.value = base.volume;

  const teeth = c.createOscillator();
  teeth.type = "square";
  teeth.frequency.value = base.gearSpeed;

  const modulation = c.createGain();
  modulation.gain.value = base.toothAmount;

  noise.connect(filter);
  filter.connect(gearVolume);
  gearVolume.connect(dest);

  teeth.connect(modulation);
  modulation.connect(gearVolume.gain);

  noise.start();
  teeth.start();

  return { noise, teeth, filter, gearVolume, modulation, base };
}

/**
 * Map speedNorm (≈ speed/140) → multiplier for tooth rate.
 * n=1 keeps user's 14/18/22 Hz; slower calmer, faster busier.
 */
function speedFactor(speedNorm) {
  const n = Math.max(0.4, Math.min(2.2, speedNorm));
  // ~0.55× at crawl … 1.0× at default 140 … ~1.75× at 280
  return 0.35 + 0.65 * n;
}

/**
 * Same motor on rails and carpet; level scales bus gain only.
 * @param {number} speedNorm roughly train.speed / 140
 * @param {number} level MOTOR_LEVEL_ON / MOTOR_LEVEL_OFF (bus multiplier)
 */
export function startMotor(speedNorm = 1, level = MOTOR_LEVEL_ON) {
  const c = ensureReady();
  if (!c || !master) return;

  lastSpeedNorm = speedNorm;
  motorLevel = Math.max(0.12, Math.min(3, level));

  if (motorNodes) {
    setMotorSpeed(speedNorm);
    setMotorLevel(motorLevel);
    return;
  }

  const bus = c.createGain();
  bus.gain.value = 0.0001;
  bus.connect(master);

  /** @type {GearSet[]} */
  const sets = [];
  /** @type {AudioScheduledSourceNode[]} */
  const sources = [];

  for (const base of GEAR_BASE) {
    const set = addGearSet(c, bus, base);
    sets.push(set);
    sources.push(set.noise, set.teeth);
  }

  motorNodes = { bus, sets, sources };

  const t = c.currentTime;
  const target = MOTOR_BUS_BASE * motorLevel;
  bus.gain.setValueAtTime(0.0001, t);
  bus.gain.linearRampToValueAtTime(target, t + 0.08);

  setMotorSpeed(speedNorm);
  setMotorLevel(motorLevel);
}

/** Volume scale for same motor (higher on-rail, quieter off-rail). */
export function setMotorLevel(level = MOTOR_LEVEL_ON) {
  motorLevel = Math.max(0.12, Math.min(3, level));
  if (!motorNodes || !ctx) return;
  const t = ctx.currentTime;
  const target = MOTOR_BUS_BASE * motorLevel;
  try {
    motorNodes.bus.gain.cancelScheduledValues(t);
    motorNodes.bus.gain.setTargetAtTime(target, t, 0.06);
  } catch {
    /* ignore */
  }
}

/** Scale tooth mesh rate (and slight filter brighten) with train speed. */
export function setMotorSpeed(speedNorm = 1) {
  lastSpeedNorm = speedNorm;
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.4, Math.min(2.2, speedNorm));
  const sf = speedFactor(n);
  const t = ctx.currentTime;

  try {
    for (const set of motorNodes.sets) {
      const { base } = set;
      // User's gearSpeed is the square-wave tooth rate
      set.teeth.frequency.setTargetAtTime(base.gearSpeed * sf, t, 0.08);
      // Slight brighten when faster (still same character)
      set.filter.frequency.setTargetAtTime(
        base.filterFrequency * (0.92 + 0.12 * n),
        t,
        0.1
      );
      // Keep AM depth stable; volume offset can breathe a little with speed
      set.gearVolume.gain.setTargetAtTime(
        base.volume * (0.9 + 0.12 * n),
        t,
        0.1
      );
      set.modulation.gain.setTargetAtTime(base.toothAmount, t, 0.1);
    }
  } catch {
    /* ignore */
  }
}

export function stopMotor() {
  if (!motorNodes || !ctx) return;
  const nodes = motorNodes;
  const t = ctx.currentTime;
  try {
    nodes.bus.gain.cancelScheduledValues(t);
    nodes.bus.gain.setValueAtTime(Math.max(0.0001, nodes.bus.gain.value), t);
    nodes.bus.gain.linearRampToValueAtTime(0.0001, t + 0.08);
  } catch {
    /* ignore */
  }
  motorNodes = null;
  setTimeout(() => {
    for (const s of nodes.sources) {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      nodes.bus.disconnect();
    } catch {
      /* ignore */
    }
  }, 120);
}

// ── One-shots (derail / wall / edge / re-rail) ─────────────────────

function beep({
  freq = 200,
  dur = 0.12,
  type = "triangle",
  vol = 0.2,
  slideTo = null,
}) {
  const c = ensureReady();
  if (!c || !master) return;
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 80;
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(hp);
  hp.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noiseBurst({ dur = 0.12, freq = 500, vol = 0.22, q = 0.8 }) {
  const c = ensureReady();
  if (!c || !master) return;
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = makeNoise(Math.max(0.08, dur + 0.05));
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 120;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.003);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(hp);
  hp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.03);
}

export function playCollision(kind = "derail") {
  ensureReady();
  if (!unlocked) return;

  if (kind === "edge") {
    noiseBurst({ dur: 0.32, freq: 280, vol: 0.55, q: 0.85 });
    noiseBurst({ dur: 0.18, freq: 700, vol: 0.24, q: 0.7 });
    beep({ freq: 180, dur: 0.24, type: "triangle", vol: 0.28, slideTo: 70 });
  } else if (kind === "wall") {
    // another ~10% quieter (0.342→0.308, etc.)
    noiseBurst({ dur: 0.07, freq: 1100, vol: 0.308, q: 0.75 });
    noiseBurst({ dur: 0.05, freq: 1800, vol: 0.13, q: 0.9 });
    beep({ freq: 460, dur: 0.05, type: "triangle", vol: 0.081, slideTo: 220 });
  } else {
    // derail / off-track drop — another ~10% quieter
    noiseBurst({ dur: 0.14, freq: 900, vol: 0.389, q: 0.7 });
    noiseBurst({ dur: 0.1, freq: 1500, vol: 0.178, q: 0.95 });
    beep({ freq: 300, dur: 0.12, type: "triangle", vol: 0.162, slideTo: 100 });
  }
}

export function playRerail() {
  ensureReady();
  if (!unlocked) return;
  beep({ freq: 680, dur: 0.07, type: "sine", vol: 0.18, slideTo: 360 });
  noiseBurst({ dur: 0.05, freq: 1100, vol: 0.12, q: 1.1 });
}

/**
 * Pure per-car mode transition detector (no AudioContext).
 * Thump = derail/off; tap = re-rail/on. Used by syncTrainAudio + tests.
 *
 * @param {Array<{id:string,mode:string}>} cars
 * @param {Record<string,string>} prevMap previous car id → mode
 * @returns {{ events: Array<{id:string,kind:'derail'|'rerail'}>, carModes: Record<string,string> }}
 */
export function carModeSoundEvents(cars, prevMap = {}) {
  const events = [];
  const carModes = { ...prevMap };
  const seen = new Set();
  for (const car of cars || []) {
    if (!car?.id) continue;
    seen.add(car.id);
    const mode = car.mode || "idle";
    const prev = carModes[car.id];
    if (prev && prev !== mode) {
      if (
        mode === "off_rail" &&
        (prev === "on_rail" || prev === "idle")
      ) {
        events.push({ id: car.id, kind: "derail" });
      } else if (mode === "on_rail" && prev === "off_rail") {
        events.push({ id: car.id, kind: "rerail" });
      }
    }
    carModes[car.id] = mode;
  }
  // Drop modes for cars that no longer exist
  for (const id of Object.keys(carModes)) {
    if (!seen.has(id)) delete carModes[id];
  }
  return { events, carModes };
}

/**
 * Frame sync: gear motor + one-shots.
 * Derail thump / re-rail tap fire per car (each solid unit is its own entity).
 * Train-level mode still drives motor and edge/wall for the powered body.
 */
export function syncTrainAudio(state, mem = {}) {
  if (ctx && ctx.state === "suspended" && unlocked) {
    ctx.resume().catch(() => {});
  }
  if (!unlocked) return;

  const mode = state.mode;
  const running = !!state.running;
  const prev = mem.prevMode;

  // Per-car thump (off) / tap (on). Prefer car list when present so mid/trail
  // each make their own sound; fall back to train body for single-engine.
  const cars = state.cars;
  if (cars?.length) {
    const { events, carModes } = carModeSoundEvents(cars, mem.carModes || {});
    mem.carModes = carModes;
    for (const ev of events) {
      if (ev.kind === "derail") playCollision("derail");
      else if (ev.kind === "rerail") playRerail();
    }
  } else if (prev && prev !== mode) {
    if (mode === "off_rail" && (prev === "on_rail" || prev === "idle")) {
      playCollision("derail");
    } else if (mode === "on_rail" && prev === "off_rail") {
      playRerail();
    }
  }

  if (prev && prev !== mode && mode === "stopped") {
    playCollision("edge");
    stopMotor();
  }

  if (mode === "off_rail" && state.wallHit) {
    const now = performance.now();
    const firstContact = !mem.wasWallHit;
    const cooldown = firstContact ? 40 : 220;
    if (!mem.lastWallTick || now - mem.lastWallTick > cooldown) {
      playCollision("wall");
      mem.lastWallTick = now;
    }
  }
  mem.wasWallHit = !!(mode === "off_rail" && state.wallHit);

  const speedNorm = (state.speed || 140) / 140;
  if (running && mode === "on_rail") {
    startMotor(speedNorm, MOTOR_LEVEL_ON);
  } else if (running && mode === "off_rail") {
    startMotor(speedNorm, MOTOR_LEVEL_OFF);
  } else {
    stopMotor();
  }

  mem.prevMode = mode;
}

export function playTestBlip() {
  unlockAudio();
  beep({ freq: 880, dur: 0.08, type: "sine", vol: 0.18, slideTo: 660 });
}
