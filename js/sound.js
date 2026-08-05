/**
 * Library-free Web Audio synth (no samples, no npm).
 * Motor = plastic gear grind · scrape off-rail · loud clacks on impact.
 */

let ctx = null;
let master = null;
let unlocked = false;

let motorNodes = null;
let scrapeNodes = null;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  // Slightly hotter master so one-shots cut through
  master.gain.value = 0.7;
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
 * Plastic gear tooth train: sharp mid/high ticks + quiet grit between.
 * No low-frequency content — that reads as a "fart" hum.
 */
function gearClickBuffer(sec = 1.0, clicksPerSec = 32) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const period = Math.max(6, Math.floor(c.sampleRate / clicksPerSec));
  for (let i = 0; i < n; i++) {
    const phase = i % period;
    if (phase < 2) {
      // hard plastic tick
      d[i] = (Math.random() * 2 - 1) * (1 - phase / 2);
    } else if (phase < 8) {
      // short decay grit
      d[i] = (Math.random() * 2 - 1) * 0.12 * Math.exp(-(phase - 2) / 3);
    } else {
      // faint gear-mesh hiss between teeth
      d[i] = (Math.random() * 2 - 1) * 0.02;
    }
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
 * Plastic gear grind: mid/high band noise + tooth clicks.
 * No low saw/square — that was the "fart" motor.
 */
export function startMotor(speedNorm = 1) {
  const c = ensureReady();
  if (!c || !master) return;

  if (motorNodes) {
    setMotorSpeed(speedNorm);
    return;
  }

  const n = Math.max(0.5, Math.min(2.2, speedNorm));

  // Layer 1: continuous plastic hiss (mid-high bandpass)
  const hiss = c.createBufferSource();
  hiss.buffer = noiseBuffer(1.2);
  hiss.loop = true;
  const hissBp = c.createBiquadFilter();
  hissBp.type = "bandpass";
  hissBp.frequency.value = 2200;
  hissBp.Q.value = 0.9;
  const hissHp = c.createBiquadFilter();
  hissHp.type = "highpass";
  hissHp.frequency.value = 700;
  const hissG = c.createGain();
  hissG.gain.value = 0.11;

  // Layer 2: gear tooth clicks (the main character)
  const clicks = c.createBufferSource();
  clicks.buffer = gearClickBuffer(1.0, 30 * n);
  clicks.loop = true;
  const clickBp = c.createBiquadFilter();
  clickBp.type = "bandpass";
  clickBp.frequency.value = 1600;
  clickBp.Q.value = 0.6;
  const clickHp = c.createBiquadFilter();
  clickHp.type = "highpass";
  clickHp.frequency.value = 900;
  const clickG = c.createGain();
  clickG.gain.value = 0.22;

  // Layer 3: thin high mesh chatter (kHz range, not sub-bass)
  const mesh = c.createOscillator();
  mesh.type = "triangle";
  mesh.frequency.value = 980 * n;
  const meshHp = c.createBiquadFilter();
  meshHp.type = "highpass";
  meshHp.frequency.value = 600;
  const meshG = c.createGain();
  meshG.gain.value = 0.018;

  // Master motor highpass — strip anything fart-adjacent
  const motorHp = c.createBiquadFilter();
  motorHp.type = "highpass";
  motorHp.frequency.value = 550;
  motorHp.Q.value = 0.7;

  const mix = c.createGain();
  mix.gain.value = 0.0001;

  hiss.connect(hissBp);
  hissBp.connect(hissHp);
  hissHp.connect(hissG);
  hissG.connect(motorHp);

  clicks.connect(clickBp);
  clickBp.connect(clickHp);
  clickHp.connect(clickG);
  clickG.connect(motorHp);

  mesh.connect(meshHp);
  meshHp.connect(meshG);
  meshG.connect(motorHp);

  motorHp.connect(mix);
  mix.connect(master);

  hiss.start();
  clicks.start();
  mesh.start();

  const t = c.currentTime;
  mix.gain.setValueAtTime(0.0001, t);
  mix.gain.linearRampToValueAtTime(0.65, t + 0.1);

  motorNodes = {
    hiss,
    clicks,
    mesh,
    hissBp,
    clickG,
    meshG,
    mix,
    baseClickRate: 30,
  };
  setMotorSpeed(speedNorm);
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.5, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    motorNodes.clicks.playbackRate.setTargetAtTime(n, t, 0.08);
    motorNodes.hiss.playbackRate.setTargetAtTime(0.9 + 0.2 * n, t, 0.1);
    motorNodes.mesh.frequency.setTargetAtTime(900 + 200 * n, t, 0.08);
    motorNodes.hissBp.frequency.setTargetAtTime(1800 + 700 * n, t, 0.1);
    motorNodes.clickG.gain.setTargetAtTime(0.16 + 0.1 * n, t, 0.1);
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
    for (const n of [nodes.hiss, nodes.clicks, nodes.mesh]) {
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

export function startScrape() {
  const c = ensureReady();
  if (!c || !master) return;
  if (scrapeNodes) return;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(1);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1800;
  bp.Q.value = 0.6;
  const hp = c.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 600;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  src.connect(bp);
  bp.connect(hp);
  hp.connect(gain);
  gain.connect(master);
  src.start();
  const t = c.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.2, t + 0.06);
  scrapeNodes = { src, bp, gain };
}

export function stopScrape() {
  if (!scrapeNodes || !ctx) return;
  const { src, gain } = scrapeNodes;
  const t = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.1);
  } catch {
    /* ignore */
  }
  scrapeNodes = null;
  setTimeout(() => {
    try {
      src.stop();
      src.disconnect();
      gain.disconnect();
    } catch {
      /* ignore */
    }
  }, 150);
}

export function playCollision(kind = "derail") {
  ensureReady();
  if (!unlocked) return;

  if (kind === "edge") {
    // Soft thud into playfield border
    noiseBurst({ dur: 0.32, freq: 280, vol: 0.7, q: 0.85 });
    noiseBurst({ dur: 0.18, freq: 700, vol: 0.35, q: 0.7 });
    beep({ freq: 180, dur: 0.24, type: "triangle", vol: 0.4, slideTo: 70 });
  } else if (kind === "wall") {
    // Short plastic tick against a rail wall
    noiseBurst({ dur: 0.07, freq: 1400, vol: 0.55, q: 0.8 });
    noiseBurst({ dur: 0.05, freq: 2400, vol: 0.28, q: 1.0 });
    beep({ freq: 520, dur: 0.05, type: "square", vol: 0.18, slideTo: 260 });
  } else {
    // derail — bright plastic clack
    noiseBurst({ dur: 0.14, freq: 1100, vol: 0.65, q: 0.75 });
    noiseBurst({ dur: 0.1, freq: 1900, vol: 0.35, q: 1.0 });
    beep({ freq: 340, dur: 0.12, type: "triangle", vol: 0.32, slideTo: 110 });
    beep({ freq: 680, dur: 0.06, type: "square", vol: 0.12, slideTo: 400 });
  }
}

export function playRerail() {
  ensureReady();
  if (!unlocked) return;
  beep({ freq: 780, dur: 0.08, type: "sine", vol: 0.28, slideTo: 400 });
  noiseBurst({ dur: 0.06, freq: 1400, vol: 0.22, q: 1.2 });
}

/**
 * Frame/state sync for loops + transition SFX.
 */
export function syncTrainAudio(state, mem = {}) {
  // Keep trying to resume if suspended (gesture may have unlocked flag early)
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
      stopScrape();
    } else if (mode === "on_rail" && prev === "off_rail") {
      playRerail();
    }
  }

  // Wall impact ticks — rising edge or sustained contact (throttled)
  if (mode === "off_rail" && state.wallHit) {
    const now = performance.now();
    const firstContact = !mem.wasWallHit;
    const cooldown = firstContact ? 40 : 200;
    if (!mem.lastWallTick || now - mem.lastWallTick > cooldown) {
      playCollision("wall");
      mem.lastWallTick = now;
    }
  }
  mem.wasWallHit = !!(mode === "off_rail" && state.wallHit);

  const speedNorm = (state.speed || 140) / 140;
  if (running && mode === "on_rail") {
    startMotor(speedNorm);
    stopScrape();
  } else if (running && mode === "off_rail") {
    stopMotor();
    startScrape();
  } else {
    stopMotor();
    stopScrape();
  }

  mem.prevMode = mode;
}

export function playTestBlip() {
  unlockAudio();
  beep({ freq: 880, dur: 0.08, type: "sine", vol: 0.2, slideTo: 660 });
}
