/**
 * Library-free Web Audio synth (no samples, no npm).
 * Motor = plastic gear grind (same on carpet, quieter) · clacks on impact.
 */

let ctx = null;
let master = null;
let unlocked = false;

let motorNodes = null;
/** 1 = on-rail, ~0.45 = carpet / off-rail */
let motorLevel = 1;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.65;
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

function noiseBuffer(sec = 0.5) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Irregular plastic gear teeth: uneven spacing + gritty decay.
 * Mid-band energy, not a steady vacuum hiss.
 */
function gearClickBuffer(sec = 1.2, clicksPerSec = 22) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const basePeriod = Math.max(10, Math.floor(c.sampleRate / clicksPerSec));
  let next = 0;
  let i = 0;
  while (i < n) {
    // jittered tooth period (dynamic mesh, not metronome)
    const jitter = 0.72 + Math.random() * 0.56;
    const period = Math.floor(basePeriod * jitter);
    for (let p = 0; p < period && next + p < n; p++) {
      const idx = next + p;
      if (p < 2) {
        // plastic tooth impact
        d[idx] = (Math.random() * 2 - 1) * (1 - p / 2) * 0.95;
      } else if (p < 18) {
        // grinding grit after each tooth
        d[idx] =
          (Math.random() * 2 - 1) * 0.28 * Math.exp(-(p - 2) / 7) +
          (Math.random() * 2 - 1) * 0.04;
      } else {
        // quiet mesh between teeth
        d[idx] = (Math.random() * 2 - 1) * 0.03;
      }
    }
    next += period;
    i = next;
  }
  return buf;
}

/** Coarser slow grind layer under the clicks */
function gearGritBuffer(sec = 1.0) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    // brown-ish noise (more low-mid body, less white hiss)
    acc = acc * 0.92 + (Math.random() * 2 - 1) * 0.08;
    const click = i % 47 < 3 ? (Math.random() * 2 - 1) * 0.35 : 0;
    d[i] = acc * 0.85 + click + (Math.random() * 2 - 1) * 0.04;
  }
  return buf;
}

function ensureReady() {
  const c = getCtx();
  if (!c) return null;
  if (!unlocked) unlockAudio();
  if (c.state === "suspended") c.resume().catch(() => {});
  return unlocked ? c : null;
}

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
  src.buffer = noiseBuffer(Math.max(0.08, dur + 0.05));
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

/**
 * Plastic gear grind: irregular clicks + mid grit.
 * Avoid high bandpass hiss (reads as vacuum whine).
 */
export function startMotor(speedNorm = 1, level = 1) {
  const c = ensureReady();
  if (!c || !master) return;

  motorLevel = Math.max(0.15, Math.min(1, level));

  if (motorNodes) {
    setMotorSpeed(speedNorm);
    setMotorLevel(motorLevel);
    return;
  }

  const n = Math.max(0.5, Math.min(2.2, speedNorm));

  // Layer 1: mid plastic grit (body of the grind — not airy hiss)
  const grit = c.createBufferSource();
  grit.buffer = gearGritBuffer(1.0);
  grit.loop = true;
  const gritBp = c.createBiquadFilter();
  gritBp.type = "bandpass";
  gritBp.frequency.value = 780;
  gritBp.Q.value = 0.55;
  const gritLp = c.createBiquadFilter();
  gritLp.type = "lowpass";
  gritLp.frequency.value = 2400;
  const gritG = c.createGain();
  gritG.gain.value = 0.16;

  // Layer 2: irregular gear tooth clicks
  const clicks = c.createBufferSource();
  clicks.buffer = gearClickBuffer(1.2, 20 * n);
  clicks.loop = true;
  const clickBp = c.createBiquadFilter();
  clickBp.type = "bandpass";
  clickBp.frequency.value = 1100;
  clickBp.Q.value = 0.45;
  const clickLp = c.createBiquadFilter();
  clickLp.type = "lowpass";
  clickLp.frequency.value = 3200;
  const clickG = c.createGain();
  clickG.gain.value = 0.28;

  // Layer 3: very faint mid mesh (not a kHz vacuum tone)
  const mesh = c.createOscillator();
  mesh.type = "triangle";
  mesh.frequency.value = 180 * n;
  const meshLp = c.createBiquadFilter();
  meshLp.type = "lowpass";
  meshLp.frequency.value = 900;
  const meshHp = c.createBiquadFilter();
  meshHp.type = "highpass";
  meshHp.frequency.value = 120;
  const meshG = c.createGain();
  meshG.gain.value = 0.012;

  // Cut ultra-high vacuum air, keep a little low-mid body
  const motorHp = c.createBiquadFilter();
  motorHp.type = "highpass";
  motorHp.frequency.value = 180;
  motorHp.Q.value = 0.5;
  const motorLp = c.createBiquadFilter();
  motorLp.type = "lowpass";
  motorLp.frequency.value = 3800;
  motorLp.Q.value = 0.5;

  const mix = c.createGain();
  mix.gain.value = 0.0001;

  grit.connect(gritBp);
  gritBp.connect(gritLp);
  gritLp.connect(gritG);
  gritG.connect(motorHp);

  clicks.connect(clickBp);
  clickBp.connect(clickLp);
  clickLp.connect(clickG);
  clickG.connect(motorHp);

  mesh.connect(meshHp);
  meshHp.connect(meshLp);
  meshLp.connect(meshG);
  meshG.connect(motorHp);

  motorHp.connect(motorLp);
  motorLp.connect(mix);
  mix.connect(master);

  grit.start();
  clicks.start();
  mesh.start();

  const t = c.currentTime;
  const target = 0.58 * motorLevel;
  mix.gain.setValueAtTime(0.0001, t);
  mix.gain.linearRampToValueAtTime(target, t + 0.1);

  motorNodes = {
    grit,
    clicks,
    mesh,
    gritBp,
    gritG,
    clickG,
    meshG,
    mix,
    baseClickRate: 20,
  };
  setMotorSpeed(speedNorm);
  setMotorLevel(motorLevel);
}

/** Volume scale for same motor (1 on-rail, quieter on carpet). */
export function setMotorLevel(level = 1) {
  motorLevel = Math.max(0.12, Math.min(1, level));
  if (!motorNodes || !ctx) return;
  const t = ctx.currentTime;
  const target = 0.58 * motorLevel;
  try {
    motorNodes.mix.gain.cancelScheduledValues(t);
    motorNodes.mix.gain.setTargetAtTime(target, t, 0.06);
  } catch {
    /* ignore */
  }
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.5, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    motorNodes.clicks.playbackRate.setTargetAtTime(0.85 + 0.35 * n, t, 0.08);
    motorNodes.grit.playbackRate.setTargetAtTime(0.75 + 0.4 * n, t, 0.1);
    motorNodes.mesh.frequency.setTargetAtTime(140 + 80 * n, t, 0.08);
    motorNodes.gritBp.frequency.setTargetAtTime(620 + 280 * n, t, 0.1);
    motorNodes.clickG.gain.setTargetAtTime(0.2 + 0.12 * n, t, 0.1);
    motorNodes.gritG.gain.setTargetAtTime(0.12 + 0.08 * n, t, 0.1);
  } catch {
    /* ignore */
  }
}

export function stopMotor() {
  if (!motorNodes || !ctx) return;
  const nodes = motorNodes;
  const t = ctx.currentTime;
  try {
    nodes.mix.gain.cancelScheduledValues(t);
    nodes.mix.gain.setValueAtTime(Math.max(0.0001, nodes.mix.gain.value), t);
    nodes.mix.gain.linearRampToValueAtTime(0.0001, t + 0.1);
  } catch {
    /* ignore */
  }
  motorNodes = null;
  setTimeout(() => {
    for (const n of [nodes.grit, nodes.clicks, nodes.mesh]) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      nodes.mix.disconnect();
    } catch {
      /* ignore */
    }
  }, 160);
}

/** @deprecated carpet uses quieter motor now */
export function startScrape() {
  /* no-op — carpet uses startMotor(..., quieter) */
}

export function stopScrape() {
  /* no-op */
}

export function playCollision(kind = "derail") {
  ensureReady();
  if (!unlocked) return;

  if (kind === "edge") {
    noiseBurst({ dur: 0.32, freq: 280, vol: 0.65, q: 0.85 });
    noiseBurst({ dur: 0.18, freq: 700, vol: 0.3, q: 0.7 });
    beep({ freq: 180, dur: 0.24, type: "triangle", vol: 0.35, slideTo: 70 });
  } else if (kind === "wall") {
    noiseBurst({ dur: 0.07, freq: 1200, vol: 0.48, q: 0.75 });
    noiseBurst({ dur: 0.05, freq: 2000, vol: 0.22, q: 0.9 });
    beep({ freq: 480, dur: 0.05, type: "triangle", vol: 0.14, slideTo: 240 });
  } else {
    noiseBurst({ dur: 0.14, freq: 950, vol: 0.58, q: 0.7 });
    noiseBurst({ dur: 0.1, freq: 1600, vol: 0.28, q: 0.95 });
    beep({ freq: 320, dur: 0.12, type: "triangle", vol: 0.28, slideTo: 100 });
  }
}

export function playRerail() {
  ensureReady();
  if (!unlocked) return;
  beep({ freq: 720, dur: 0.07, type: "sine", vol: 0.22, slideTo: 380 });
  noiseBurst({ dur: 0.05, freq: 1200, vol: 0.16, q: 1.1 });
}

/**
 * Frame/state sync for loops + transition SFX.
 * On-rail and carpet use the same motor; carpet is quieter.
 */
export function syncTrainAudio(state, mem = {}) {
  if (ctx && ctx.state === "suspended" && unlocked) {
    ctx.resume().catch(() => {});
  }
  if (!unlocked) return;

  const mode = state.mode;
  const running = !!state.running;
  const prev = mem.prevMode;

  if (prev && prev !== mode) {
    if (mode === "off_rail" && (prev === "on_rail" || prev === "idle")) {
      playCollision("derail");
    } else if (mode === "stopped") {
      playCollision("edge");
      stopMotor();
    } else if (mode === "on_rail" && prev === "off_rail") {
      playRerail();
    }
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
    startMotor(speedNorm, 1);
  } else if (running && mode === "off_rail") {
    // Same plastic grind, quieter on carpet
    startMotor(speedNorm, 0.42);
  } else {
    stopMotor();
  }

  mem.prevMode = mode;
}

export function playTestBlip() {
  unlockAudio();
  beep({ freq: 880, dur: 0.08, type: "sine", vol: 0.18, slideTo: 660 });
}
