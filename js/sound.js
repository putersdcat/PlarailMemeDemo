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
  master.gain.value = 0.55;
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

/** Clicky / click-train of noise impulses for plastic gears. */
function gearClickBuffer(sec = 1.0, clicksPerSec = 28) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  const period = Math.max(8, Math.floor(c.sampleRate / clicksPerSec));
  for (let i = 0; i < n; i++) {
    const phase = i % period;
    if (phase < 3) {
      // sharp plastic tick
      d[i] = (Math.random() * 2 - 1) * (1 - phase / 3) * 0.9;
    } else if (phase < 12) {
      d[i] = (Math.random() * 2 - 1) * 0.08 * Math.exp(-(phase - 3) / 4);
    } else {
      d[i] = (Math.random() * 2 - 1) * 0.015;
    }
  }
  return buf;
}

function beep({
  freq = 200,
  dur = 0.12,
  type = "triangle",
  vol = 0.2,
  slideTo = null,
}) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

function noiseBurst({ dur = 0.12, freq = 500, vol = 0.22, q = 0.8 }) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(Math.max(0.08, dur + 0.05));
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.03);
}

/**
 * Plastic gear grind: mid/high band noise + periodic clicks, not a low saw hum.
 */
export function startMotor(speedNorm = 1) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});

  if (motorNodes) {
    setMotorSpeed(speedNorm);
    return;
  }

  const n = Math.max(0.45, Math.min(2.2, speedNorm));

  // Layer 1: continuous plastic hiss (bandpass white noise)
  const hiss = c.createBufferSource();
  hiss.buffer = noiseBuffer(1.2);
  hiss.loop = true;
  const hissBp = c.createBiquadFilter();
  hissBp.type = "bandpass";
  hissBp.frequency.value = 1800;
  hissBp.Q.value = 0.7;
  const hissG = c.createGain();
  hissG.gain.value = 0.09;

  // Layer 2: gear tooth clicks
  const clicks = c.createBufferSource();
  clicks.buffer = gearClickBuffer(1.0, 26 * n);
  clicks.loop = true;
  const clickBp = c.createBiquadFilter();
  clickBp.type = "highpass";
  clickBp.frequency.value = 900;
  const clickG = c.createGain();
  clickG.gain.value = 0.16;

  // Layer 3: faint higher mesh tone (not sub-bass)
  const mesh = c.createOscillator();
  mesh.type = "square";
  mesh.frequency.value = 220 * n;
  const meshG = c.createGain();
  meshG.gain.value = 0.025;
  const meshHp = c.createBiquadFilter();
  meshHp.type = "highpass";
  meshHp.frequency.value = 150;

  const mix = c.createGain();
  mix.gain.value = 0.0001;

  hiss.connect(hissBp);
  hissBp.connect(hissG);
  hissG.connect(mix);

  clicks.connect(clickBp);
  clickBp.connect(clickG);
  clickG.connect(mix);

  mesh.connect(meshHp);
  meshHp.connect(meshG);
  meshG.connect(mix);

  mix.connect(master);

  hiss.start();
  clicks.start();
  mesh.start();

  const t = c.currentTime;
  mix.gain.setValueAtTime(0.0001, t);
  mix.gain.linearRampToValueAtTime(0.55, t + 0.12);

  motorNodes = {
    hiss,
    clicks,
    mesh,
    hissBp,
    clickG,
    meshG,
    mix,
    baseClickRate: 26,
  };
  setMotorSpeed(speedNorm);
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.45, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    // PlaybackRate on buffer sources = gear speed
    motorNodes.clicks.playbackRate.setTargetAtTime(n, t, 0.08);
    motorNodes.hiss.playbackRate.setTargetAtTime(0.85 + 0.25 * n, t, 0.1);
    motorNodes.mesh.frequency.setTargetAtTime(200 * n, t, 0.08);
    motorNodes.hissBp.frequency.setTargetAtTime(1400 + 600 * n, t, 0.1);
    motorNodes.clickG.gain.setTargetAtTime(0.12 + 0.08 * n, t, 0.1);
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
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  if (scrapeNodes) return;

  const src = c.createBufferSource();
  src.buffer = noiseBuffer(1);
  src.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1400;
  bp.Q.value = 0.55;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  src.connect(bp);
  bp.connect(gain);
  gain.connect(master);
  src.start();
  const t = c.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.12, t + 0.08);
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
  if (!unlocked) {
    unlockAudio();
  }
  if (!unlocked) return;

  if (kind === "edge") {
    noiseBurst({ dur: 0.28, freq: 220, vol: 0.45, q: 0.9 });
    beep({ freq: 140, dur: 0.22, type: "triangle", vol: 0.28, slideTo: 55 });
    beep({ freq: 90, dur: 0.18, type: "sine", vol: 0.12, slideTo: 40 });
  } else if (kind === "wall") {
    noiseBurst({ dur: 0.09, freq: 1100, vol: 0.28, q: 0.65 });
    beep({ freq: 380, dur: 0.06, type: "square", vol: 0.12, slideTo: 180 });
  } else {
    // derail — plastic clack (louder + brighter)
    noiseBurst({ dur: 0.12, freq: 900, vol: 0.38, q: 0.7 });
    noiseBurst({ dur: 0.08, freq: 1600, vol: 0.18, q: 1.1 });
    beep({ freq: 280, dur: 0.1, type: "triangle", vol: 0.18, slideTo: 90 });
  }
}

export function playRerail() {
  if (!unlocked) unlockAudio();
  if (!unlocked) return;
  beep({ freq: 720, dur: 0.07, type: "sine", vol: 0.16, slideTo: 360 });
  noiseBurst({ dur: 0.05, freq: 1200, vol: 0.12, q: 1.2 });
}

/**
 * Frame/state sync for loops + transition SFX.
 */
export function syncTrainAudio(state, mem = {}) {
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

  // Wall impact ticks (throttled) — uses train.wallHit from physics
  if (mode === "off_rail" && state.wallHit) {
    const now = performance.now();
    if (!mem.lastWallTick || now - mem.lastWallTick > 160) {
      playCollision("wall");
      mem.lastWallTick = now;
    }
  }

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
  beep({ freq: 880, dur: 0.08, type: "sine", vol: 0.15, slideTo: 660 });
}
