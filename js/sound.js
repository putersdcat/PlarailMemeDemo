/**
 * Library-free Web Audio synth (no samples, no npm).
 * Motor loop on rails · scrape off-rail · one-shot clacks.
 */

let ctx = null;
let master = null;
let unlocked = false;

let motorNodes = null; // { osc, gain, filter, lfo, lfoG, pulse }
let scrapeNodes = null;

function getCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.4;
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

function noiseBuffer(sec = 0.4) {
  const c = getCtx();
  const n = Math.max(1, Math.floor(c.sampleRate * sec));
  const buf = c.createBuffer(1, n, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function beep({ freq = 200, dur = 0.12, type = "triangle", vol = 0.12, slideTo = null }) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo != null) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  }
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

function noiseBurst({ dur = 0.12, freq = 500, vol = 0.14, q = 0.8 }) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const t = c.currentTime;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(Math.max(0.05, dur + 0.05));
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = freq;
  bp.Q.value = q;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export function startMotor(speedNorm = 1) {
  const c = getCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});

  if (motorNodes) {
    setMotorSpeed(speedNorm);
    return;
  }

  const n = Math.max(0.4, Math.min(2, speedNorm));
  const osc = c.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 52 * n;

  const pulse = c.createOscillator();
  pulse.type = "square";
  pulse.frequency.value = 8 * n;
  const pulseG = c.createGain();
  pulseG.gain.value = 0.0; // depth set via modulation path

  // Simple: dual osc through lowpass
  const osc2 = c.createOscillator();
  osc2.type = "triangle";
  osc2.frequency.value = 104 * n;
  const g2 = c.createGain();
  g2.gain.value = 0.15;

  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 320;
  filter.Q.value = 0.8;

  const gain = c.createGain();
  gain.gain.value = 0.0001;

  osc.connect(filter);
  osc2.connect(g2);
  g2.connect(filter);
  filter.connect(gain);
  gain.connect(master);

  osc.start();
  osc2.start();
  pulse.start();

  const t = c.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.14, t + 0.15);

  motorNodes = { osc, osc2, g2, filter, gain, pulse, pulseG };
  setMotorSpeed(speedNorm);
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorNodes || !ctx) return;
  const n = Math.max(0.4, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    motorNodes.osc.frequency.setTargetAtTime(50 * n, t, 0.06);
    motorNodes.osc2.frequency.setTargetAtTime(100 * n, t, 0.06);
    motorNodes.filter.frequency.setTargetAtTime(240 + 140 * n, t, 0.08);
  } catch {
    /* ignore */
  }
}

export function stopMotor() {
  if (!motorNodes || !ctx) return;
  const { osc, osc2, gain, pulse } = motorNodes;
  const t = ctx.currentTime;
  try {
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(Math.max(0.0001, gain.gain.value), t);
    gain.gain.linearRampToValueAtTime(0.0001, t + 0.12);
  } catch {
    /* ignore */
  }
  motorNodes = null;
  setTimeout(() => {
    for (const n of [osc, osc2, pulse]) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      gain.disconnect();
    } catch {
      /* ignore */
    }
  }, 180);
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
  bp.frequency.value = 850;
  bp.Q.value = 0.5;
  const gain = c.createGain();
  gain.gain.value = 0.0001;
  src.connect(bp);
  bp.connect(gain);
  gain.connect(master);
  src.start();
  const t = c.currentTime;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.linearRampToValueAtTime(0.05, t + 0.1);
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
  if (!unlocked) return;
  if (kind === "edge") {
    noiseBurst({ dur: 0.22, freq: 160, vol: 0.22, q: 1.1 });
    beep({ freq: 95, dur: 0.2, type: "triangle", vol: 0.14, slideTo: 40 });
  } else if (kind === "wall") {
    noiseBurst({ dur: 0.08, freq: 680, vol: 0.1, q: 0.7 });
    beep({ freq: 240, dur: 0.07, type: "square", vol: 0.05, slideTo: 120 });
  } else {
    // derail
    noiseBurst({ dur: 0.14, freq: 420, vol: 0.18, q: 0.85 });
    beep({ freq: 170, dur: 0.12, type: "triangle", vol: 0.1, slideTo: 60 });
  }
}

export function playRerail() {
  if (!unlocked) return;
  beep({ freq: 540, dur: 0.08, type: "sine", vol: 0.08, slideTo: 300 });
}

/**
 * Frame/state sync for loops + transition SFX.
 * @param {{ running: boolean, mode: string, wallGlide?: boolean, speed?: number }} state
 * @param {{ prevMode?: string, wasGliding?: boolean }} mem
 */
export function syncTrainAudio(state, mem = {}) {
  if (!unlocked) return;
  const mode = state.mode;
  const running = !!state.running;
  const prev = mem.prevMode;

  if (prev && prev !== mode) {
    if (mode === "off_rail" && prev === "on_rail") {
      playCollision("derail");
    } else if (mode === "stopped") {
      playCollision("edge");
      stopMotor();
      stopScrape();
    } else if (mode === "on_rail" && prev === "off_rail") {
      playRerail();
    }
  }

  if (mode === "off_rail" && state.wallGlide && !mem.wasGliding) {
    playCollision("wall");
  }
  mem.wasGliding = !!(mode === "off_rail" && state.wallGlide);

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

/** Immediate test chirp (debug / prove audio works). */
export function playTestBlip() {
  unlockAudio();
  beep({ freq: 660, dur: 0.1, type: "sine", vol: 0.12, slideTo: 440 });
}
