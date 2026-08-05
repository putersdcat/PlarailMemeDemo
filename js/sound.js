/**
 * Library-free Web Audio synth (no samples, no npm).
 * Motor = tiny coffee grinder (burr + bean crunch), quieter on carpet.
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
  master.gain.value = 0.78;
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
 * Coffee-grinder burr: rapid hard mechanical teeth in wall-hit range.
 * Dense mid/high impulses with short grit tails — grindy, not airy.
 */
function burrBuffer(sec = 1.0, teethPerSec = 64) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const base = Math.max(5, Math.floor(c.sampleRate / teethPerSec));
  let next = 0;
  while (next < n) {
    // slight unevenness like a cheap plastic burr
    const period = Math.floor(base * (0.82 + Math.random() * 0.4));
    for (let p = 0; p < period && next + p < n; p++) {
      const idx = next + p;
      if (p === 0) {
        d[idx] = (Math.random() < 0.5 ? -1 : 1) * (0.85 + Math.random() * 0.15);
      } else if (p < 3) {
        d[idx] = (Math.random() * 2 - 1) * (0.7 * Math.exp(-p / 1.6));
      } else if (p < 18) {
        // longer grit tail = more grind
        d[idx] = (Math.random() * 2 - 1) * 0.22 * Math.exp(-(p - 3) / 6);
      } else {
        d[idx] = (Math.random() * 2 - 1) * 0.02;
      }
    }
    next += period;
  }
  return buf;
}

/**
 * Bean / plastic grit layer: chunkier impacts in the track-clack band.
 */
function crunchBuffer(sec = 1.2) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  let next = Math.floor(c.sampleRate * 0.015);
  while (next < n) {
    // irregular grit hits — denser than before
    const gap = Math.floor(c.sampleRate * (0.022 + Math.random() * 0.055));
    const dur = Math.floor(c.sampleRate * (0.003 + Math.random() * 0.01));
    for (let p = 0; p < dur && next + p < n; p++) {
      const env = Math.exp(-p / (dur * 0.3));
      d[next + p] += (Math.random() * 2 - 1) * env * (0.65 + Math.random() * 0.35);
    }
    // gravel after crunch
    for (let p = dur; p < dur + 55 && next + p < n; p++) {
      d[next + p] += (Math.random() * 2 - 1) * 0.12 * Math.exp(-(p - dur) / 14);
    }
    next += gap;
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
 * Tiny coffee grinder: fast burr + bean crunch + small motor whine.
 * Avoid continuous broadband hiss (leaf-blower).
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

  // --- Burr teeth (main character) — pitched into wall-hit / clack band ---
  const burr = c.createBufferSource();
  burr.buffer = burrBuffer(1.0, 70 * n);
  burr.loop = true;
  const burrBp = c.createBiquadFilter();
  burrBp.type = "bandpass";
  burrBp.frequency.value = 1700; // ~wall hit range
  burrBp.Q.value = 1.0;
  const burrHp = c.createBiquadFilter();
  burrHp.type = "highpass";
  burrHp.frequency.value = 650;
  const burrG = c.createGain();
  burrG.gain.value = 0.42;

  // --- Plastic grit / crunch (track-hit colour) ---
  const crunch = c.createBufferSource();
  crunch.buffer = crunchBuffer(1.2);
  crunch.loop = true;
  const crunchBp = c.createBiquadFilter();
  crunchBp.type = "bandpass";
  crunchBp.frequency.value = 1300;
  crunchBp.Q.value = 0.85;
  const crunchG = c.createGain();
  crunchG.gain.value = 0.34;

  // --- Small motor hum (supporting, higher than before) ---
  const motor = c.createOscillator();
  motor.type = "square";
  motor.frequency.value = 180 * n;
  const motorBp = c.createBiquadFilter();
  motorBp.type = "bandpass";
  motorBp.frequency.value = 360;
  motorBp.Q.value = 2.2;
  const motorG = c.createGain();
  motorG.gain.value = 0.035;

  // Harmonic ring of the burr cage — brighter grind overtone
  const ring = c.createOscillator();
  ring.type = "triangle";
  ring.frequency.value = 520 * n;
  const ringBp = c.createBiquadFilter();
  ringBp.type = "bandpass";
  ringBp.frequency.value = 1100;
  ringBp.Q.value = 2.8;
  const ringG = c.createGain();
  ringG.gain.value = 0.04;

  // Master: keep mid-high grit, still cut ultra-air
  const motorHp = c.createBiquadFilter();
  motorHp.type = "highpass";
  motorHp.frequency.value = 280;
  const motorLp = c.createBiquadFilter();
  motorLp.type = "lowpass";
  motorLp.frequency.value = 4200;

  const mix = c.createGain();
  mix.gain.value = 0.0001;

  burr.connect(burrHp);
  burrHp.connect(burrBp);
  burrBp.connect(burrG);
  burrG.connect(motorHp);

  crunch.connect(crunchBp);
  crunchBp.connect(crunchG);
  crunchG.connect(motorHp);

  motor.connect(motorBp);
  motorBp.connect(motorG);
  motorG.connect(motorHp);

  ring.connect(ringBp);
  ringBp.connect(ringG);
  ringG.connect(motorHp);

  motorHp.connect(motorLp);
  motorLp.connect(mix);
  mix.connect(master);

  burr.start();
  crunch.start();
  motor.start();
  ring.start();

  const t = c.currentTime;
  const target = 0.82 * motorLevel;
  mix.gain.setValueAtTime(0.0001, t);
  mix.gain.linearRampToValueAtTime(target, t + 0.08);

  motorNodes = {
    burr,
    crunch,
    motor,
    ring,
    burrBp,
    burrG,
    crunchG,
    motorG,
    ringG,
    mix,
  };
  setMotorSpeed(speedNorm);
  setMotorLevel(motorLevel);
}

/** Volume scale for same motor (1 on-rail, quieter on carpet). */
export function setMotorLevel(level = 1) {
  motorLevel = Math.max(0.12, Math.min(1, level));
  if (!motorNodes || !ctx) return;
  const t = ctx.currentTime;
  const target = 0.82 * motorLevel;
  try {
    motorNodes.mix.gain.cancelScheduledValues(t);
    motorNodes.mix.gain.setTargetAtTime(target, t, 0.05);
  } catch {
    /* ignore */
  }
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.5, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    // Faster grind = faster burr + pitch up into clack band
    motorNodes.burr.playbackRate.setTargetAtTime(0.95 + 0.55 * n, t, 0.08);
    motorNodes.crunch.playbackRate.setTargetAtTime(0.9 + 0.5 * n, t, 0.1);
    motorNodes.motor.frequency.setTargetAtTime(150 + 90 * n, t, 0.08);
    motorNodes.ring.frequency.setTargetAtTime(450 + 220 * n, t, 0.08);
    motorNodes.burrBp.frequency.setTargetAtTime(1450 + 550 * n, t, 0.1);
    motorNodes.burrG.gain.setTargetAtTime(0.32 + 0.18 * n, t, 0.08);
    motorNodes.crunchG.gain.setTargetAtTime(0.26 + 0.14 * n, t, 0.1);
    motorNodes.motorG.gain.setTargetAtTime(0.022 + 0.02 * n, t, 0.1);
    motorNodes.ringG.gain.setTargetAtTime(0.028 + 0.022 * n, t, 0.1);
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
    nodes.mix.gain.linearRampToValueAtTime(0.0001, t + 0.08);
  } catch {
    /* ignore */
  }
  motorNodes = null;
  setTimeout(() => {
    for (const n of [nodes.burr, nodes.crunch, nodes.motor, nodes.ring]) {
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
  }, 140);
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
