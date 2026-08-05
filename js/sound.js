/**
 * Library-free Web Audio synth (no samples, no npm).
 * Motor = plastic gear grind (same on carpet, quieter) · clacks on impact.
 */

let ctx = null;
let master = null;
let unlocked = false;

let motorNodes = null;
/** 1 = on-rail, ~0.42 = carpet / off-rail */
let motorLevel = 1;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.62;
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
 * Uneven plastic gear teeth — soft mid ticks + grit, no bright sizzle.
 * clicksPerSec ~ gear mesh rate.
 */
function gearClickBuffer(sec = 1.4, clicksPerSec = 18) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const basePeriod = Math.max(12, Math.floor(c.sampleRate / clicksPerSec));
  let next = 0;
  while (next < n) {
    // Heavy period jitter → living plastic mesh, not a metronome
    const period = Math.floor(basePeriod * (0.62 + Math.random() * 0.75));
    // Occasional double-tooth skip
    const skip = Math.random() < 0.08 ? Math.floor(period * 0.4) : 0;
    for (let p = 0; p < period && next + p < n; p++) {
      const idx = next + p;
      if (p < skip) {
        d[idx] = (Math.random() * 2 - 1) * 0.02;
      } else if (p - skip < 3) {
        const t = p - skip;
        // dull plastic knock (not a click-hihat)
        d[idx] = (Math.random() * 2 - 1) * (0.85 - t * 0.2);
      } else if (p - skip < 28) {
        const t = p - skip - 3;
        // grinding residue after each tooth
        d[idx] =
          (Math.random() * 2 - 1) * 0.22 * Math.exp(-t / 10) +
          (Math.random() * 2 - 1) * 0.03;
      } else {
        d[idx] = (Math.random() * 2 - 1) * 0.025;
      }
    }
    next += period;
  }
  return buf;
}

/** Slow plastic-on-plastic scuff under the gear teeth. */
function plasticScuffBuffer(sec = 1.2) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < n; i++) {
    const white = Math.random() * 2 - 1;
    // double-integrated → darker body
    b1 = b1 * 0.97 + white * 0.03;
    b2 = b2 * 0.94 + b1 * 0.06;
    // sparse micro-clacks in the scuff bed
    const tick = i % 73 < 2 ? white * 0.4 : 0;
    d[i] = b2 * 1.4 + tick * 0.35 + white * 0.02;
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
 * On-track motor: dual irregular plastic gears + dark scuff.
 * No oscillators / no high hiss (those read as vacuum whine).
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

  // --- Layer 1: dark plastic scuff bed ---
  const scuff = c.createBufferSource();
  scuff.buffer = plasticScuffBuffer(1.2);
  scuff.loop = true;
  const scuffBp = c.createBiquadFilter();
  scuffBp.type = "bandpass";
  scuffBp.frequency.value = 520;
  scuffBp.Q.value = 0.7;
  const scuffLp = c.createBiquadFilter();
  scuffLp.type = "lowpass";
  scuffLp.frequency.value = 1600;
  const scuffG = c.createGain();
  scuffG.gain.value = 0.2;

  // --- Layer 2: primary gear teeth ---
  const gearsA = c.createBufferSource();
  gearsA.buffer = gearClickBuffer(1.4, 16 * n);
  gearsA.loop = true;
  const gearsABp = c.createBiquadFilter();
  gearsABp.type = "bandpass";
  gearsABp.frequency.value = 780;
  gearsABp.Q.value = 0.55;
  const gearsALp = c.createBiquadFilter();
  gearsALp.type = "lowpass";
  gearsALp.frequency.value = 2200;
  const gearsAG = c.createGain();
  gearsAG.gain.value = 0.32;

  // --- Layer 3: second gear (different rate → phasing grind) ---
  const gearsB = c.createBufferSource();
  gearsB.buffer = gearClickBuffer(1.5, 23 * n);
  gearsB.loop = true;
  const gearsBBp = c.createBiquadFilter();
  gearsBBp.type = "bandpass";
  gearsBBp.frequency.value = 980;
  gearsBBp.Q.value = 0.5;
  const gearsBLp = c.createBiquadFilter();
  gearsBLp.type = "lowpass";
  gearsBLp.frequency.value = 2400;
  const gearsBG = c.createGain();
  gearsBG.gain.value = 0.2;

  // Master tone control — kill airy top, keep plastic mid
  const motorHp = c.createBiquadFilter();
  motorHp.type = "highpass";
  motorHp.frequency.value = 140;
  const motorLp = c.createBiquadFilter();
  motorLp.type = "lowpass";
  motorLp.frequency.value = 2400;
  motorLp.Q.value = 0.6;

  // Slow gain wobble so it feels mechanical, not a flat loop
  const lfo = c.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 3.2;
  const lfoG = c.createGain();
  lfoG.gain.value = 0.04;
  const mix = c.createGain();
  mix.gain.value = 0.0001;
  lfo.connect(lfoG);
  lfoG.connect(mix.gain);

  scuff.connect(scuffBp);
  scuffBp.connect(scuffLp);
  scuffLp.connect(scuffG);
  scuffG.connect(motorHp);

  gearsA.connect(gearsABp);
  gearsABp.connect(gearsALp);
  gearsALp.connect(gearsAG);
  gearsAG.connect(motorHp);

  gearsB.connect(gearsBBp);
  gearsBBp.connect(gearsBLp);
  gearsBLp.connect(gearsBG);
  gearsBG.connect(motorHp);

  motorHp.connect(motorLp);
  motorLp.connect(mix);
  mix.connect(master);

  scuff.start();
  gearsA.start();
  gearsB.start();
  lfo.start();

  const t = c.currentTime;
  const target = 0.72 * motorLevel;
  mix.gain.setValueAtTime(0.0001, t);
  mix.gain.linearRampToValueAtTime(target, t + 0.12);

  motorNodes = {
    scuff,
    gearsA,
    gearsB,
    lfo,
    scuffBp,
    scuffG,
    gearsAG,
    gearsBG,
    mix,
    lfoG,
  };
  setMotorSpeed(speedNorm);
  setMotorLevel(motorLevel);
}

/** Volume scale for same motor (1 on-rail, quieter on carpet). */
export function setMotorLevel(level = 1) {
  motorLevel = Math.max(0.12, Math.min(1, level));
  if (!motorNodes || !ctx) return;
  const t = ctx.currentTime;
  const target = 0.72 * motorLevel;
  try {
    motorNodes.mix.gain.cancelScheduledValues(t);
    // Keep LFO offset — set base then LFO continues into gain
    motorNodes.mix.gain.setTargetAtTime(target, t, 0.07);
    motorNodes.lfoG.gain.setTargetAtTime(0.035 * motorLevel, t, 0.08);
  } catch {
    /* ignore */
  }
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.5, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    // Gear mesh speeds up with train; keep grit a bit slower
    motorNodes.gearsA.playbackRate.setTargetAtTime(0.75 + 0.45 * n, t, 0.1);
    motorNodes.gearsB.playbackRate.setTargetAtTime(0.9 + 0.5 * n, t, 0.1);
    motorNodes.scuff.playbackRate.setTargetAtTime(0.7 + 0.35 * n, t, 0.12);
    motorNodes.scuffBp.frequency.setTargetAtTime(420 + 200 * n, t, 0.12);
    motorNodes.gearsAG.gain.setTargetAtTime(0.24 + 0.14 * n, t, 0.1);
    motorNodes.gearsBG.gain.setTargetAtTime(0.14 + 0.1 * n, t, 0.1);
    motorNodes.scuffG.gain.setTargetAtTime(0.14 + 0.1 * n, t, 0.1);
    // Faster LFO at speed = busier plastic rattle
    motorNodes.lfo.frequency.setTargetAtTime(2.4 + 2.2 * n, t, 0.15);
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
    for (const n of [nodes.scuff, nodes.gearsA, nodes.gearsB, nodes.lfo]) {
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
  /* no-op */
}

export function stopScrape() {
  /* no-op */
}

export function playCollision(kind = "derail") {
  ensureReady();
  if (!unlocked) return;

  if (kind === "edge") {
    noiseBurst({ dur: 0.32, freq: 280, vol: 0.6, q: 0.85 });
    noiseBurst({ dur: 0.18, freq: 700, vol: 0.28, q: 0.7 });
    beep({ freq: 180, dur: 0.24, type: "triangle", vol: 0.32, slideTo: 70 });
  } else if (kind === "wall") {
    noiseBurst({ dur: 0.07, freq: 1100, vol: 0.42, q: 0.75 });
    noiseBurst({ dur: 0.05, freq: 1800, vol: 0.18, q: 0.9 });
    beep({ freq: 460, dur: 0.05, type: "triangle", vol: 0.12, slideTo: 220 });
  } else {
    noiseBurst({ dur: 0.14, freq: 900, vol: 0.52, q: 0.7 });
    noiseBurst({ dur: 0.1, freq: 1500, vol: 0.24, q: 0.95 });
    beep({ freq: 300, dur: 0.12, type: "triangle", vol: 0.24, slideTo: 100 });
  }
}

export function playRerail() {
  ensureReady();
  if (!unlocked) return;
  beep({ freq: 680, dur: 0.07, type: "sine", vol: 0.2, slideTo: 360 });
  noiseBurst({ dur: 0.05, freq: 1100, vol: 0.14, q: 1.1 });
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
