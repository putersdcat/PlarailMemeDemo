/**
 * Library-free synthesized audio (Web Audio API only).
 * No external deps, no sample files.
 *
 * - Motor loop while the train runs on rails
 * - Softer scrape while off-rail / wall-gliding
 * - One-shot clacks for derail / wall / edge stop
 */

let ctx = null;
let master = null;
let unlocked = false;

// Motor graph
let motorGain = null;
let motorOscA = null;
let motorOscB = null;
let motorLfo = null;
let motorLfoGain = null;
let motorFilter = null;
let motorRunning = false;

// Off-rail scrape
let scrapeGain = null;
let scrapeNoise = null;
let scrapeFilter = null;
let scrapeRunning = false;

function ensureCtx() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

/** Call from any user gesture so browsers allow audio. */
export function unlockAudio() {
  const c = ensureCtx();
  if (!c) return;
  if (c.state === "suspended") {
    c.resume().catch(() => {});
  }
  unlocked = true;
}

export function isAudioReady() {
  return unlocked && ctx && ctx.state === "running";
}

function noiseBuffer(seconds = 1) {
  const c = ensureCtx();
  const n = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, n, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Start continuous on-rail motor (low hum + pulse).
 * speedNorm: ~0.4–2 from speed slider (optional).
 */
export function startMotor(speedNorm = 1) {
  const c = ensureCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});

  if (motorRunning) {
    setMotorSpeed(speedNorm);
    return;
  }

  motorFilter = c.createBiquadFilter();
  motorFilter.type = "lowpass";
  motorFilter.frequency.value = 280;
  motorFilter.Q.value = 0.7;

  motorGain = c.createGain();
  motorGain.gain.value = 0.0001;

  motorOscA = c.createOscillator();
  motorOscA.type = "sawtooth";
  motorOscA.frequency.value = 48 * speedNorm;

  motorOscB = c.createOscillator();
  motorOscB.type = "square";
  motorOscB.frequency.value = 96 * speedNorm;
  const bGain = c.createGain();
  bGain.gain.value = 0.12;

  // Subtle amplitude pulse (wheel / joint feel)
  motorLfo = c.createOscillator();
  motorLfo.type = "sine";
  motorLfo.frequency.value = 6 * speedNorm;
  motorLfoGain = c.createGain();
  motorLfoGain.gain.value = 0.04;

  motorOscA.connect(motorFilter);
  motorOscB.connect(bGain);
  bGain.connect(motorFilter);
  motorFilter.connect(motorGain);
  motorLfo.connect(motorLfoGain);
  motorLfoGain.connect(motorGain.gain);
  motorGain.connect(master);

  motorOscA.start();
  motorOscB.start();
  motorLfo.start();

  const t = c.currentTime;
  motorGain.gain.setValueAtTime(0.0001, t);
  motorGain.gain.exponentialRampToValueAtTime(0.11, t + 0.12);
  // LFO modulates around base — keep base above zero via setValueAtTime after ramp
  motorGain.gain.setValueAtTime(0.11, t + 0.13);

  motorRunning = true;
  setMotorSpeed(speedNorm);
}

export function setMotorSpeed(speedNorm = 1) {
  if (!motorRunning || !ctx) return;
  const n = Math.max(0.35, Math.min(2.2, speedNorm));
  const t = ctx.currentTime;
  try {
    motorOscA.frequency.setTargetAtTime(46 * n, t, 0.05);
    motorOscB.frequency.setTargetAtTime(92 * n, t, 0.05);
    motorLfo.frequency.setTargetAtTime(5.5 * n, t, 0.05);
    if (motorFilter) {
      motorFilter.frequency.setTargetAtTime(220 + 120 * n, t, 0.08);
    }
  } catch {
    /* ignore */
  }
}

export function stopMotor() {
  if (!motorRunning || !ctx) return;
  const c = ctx;
  const t = c.currentTime;
  try {
    motorGain.gain.cancelScheduledValues(t);
    motorGain.gain.setValueAtTime(Math.max(0.0001, motorGain.gain.value), t);
    motorGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
  } catch {
    /* ignore */
  }
  const gainNode = motorGain;
  const nodes = [motorOscA, motorOscB, motorLfo];
  motorRunning = false;
  motorOscA = motorOscB = motorLfo = motorLfoGain = motorFilter = motorGain = null;
  setTimeout(() => {
    for (const n of nodes) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      gainNode?.disconnect();
    } catch {
      /* ignore */
    }
  }, 150);
}

/** Light plastic scrape while sliding off-rail. */
export function startScrape() {
  const c = ensureCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  if (scrapeRunning) return;

  const buf = noiseBuffer(1.5);
  scrapeNoise = c.createBufferSource();
  scrapeNoise.buffer = buf;
  scrapeNoise.loop = true;

  scrapeFilter = c.createBiquadFilter();
  scrapeFilter.type = "bandpass";
  scrapeFilter.frequency.value = 900;
  scrapeFilter.Q.value = 0.6;

  scrapeGain = c.createGain();
  scrapeGain.gain.value = 0.0001;

  scrapeNoise.connect(scrapeFilter);
  scrapeFilter.connect(scrapeGain);
  scrapeGain.connect(master);
  scrapeNoise.start();

  const t = c.currentTime;
  scrapeGain.gain.setValueAtTime(0.0001, t);
  scrapeGain.gain.exponentialRampToValueAtTime(0.045, t + 0.08);
  scrapeRunning = true;
}

export function stopScrape() {
  if (!scrapeRunning || !ctx) return;
  const t = ctx.currentTime;
  try {
    scrapeGain.gain.cancelScheduledValues(t);
    scrapeGain.gain.setValueAtTime(Math.max(0.0001, scrapeGain.gain.value), t);
    scrapeGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  } catch {
    /* ignore */
  }
  const n = scrapeNoise;
  const g = scrapeGain;
  scrapeRunning = false;
  scrapeNoise = scrapeFilter = scrapeGain = null;
  setTimeout(() => {
    try {
      n?.stop();
      n?.disconnect();
      g?.disconnect();
    } catch {
      /* ignore */
    }
  }, 160);
}

/** One-shot: leave rails / hit plastic. */
export function playCollision(kind = "derail") {
  const c = ensureCtx();
  if (!c || !unlocked) return;
  if (c.state === "suspended") c.resume().catch(() => {});

  const t0 = c.currentTime;
  // Noise burst
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(0.25);
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  const g = c.createGain();
  g.gain.value = 0.0001;

  // Tonal thunk
  const osc = c.createOscillator();
  osc.type = "triangle";
  const og = c.createGain();
  og.gain.value = 0.0001;

  if (kind === "edge") {
    bp.frequency.value = 180;
    bp.Q.value = 1.2;
    osc.frequency.setValueAtTime(90, t0);
    osc.frequency.exponentialRampToValueAtTime(40, t0 + 0.18);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.12, t0 + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
  } else if (kind === "wall") {
    bp.frequency.value = 700;
    bp.Q.value = 0.8;
    osc.frequency.setValueAtTime(220, t0);
    osc.frequency.exponentialRampToValueAtTime(110, t0 + 0.08);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.1);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.06, t0 + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  } else {
    // derail — plastic clack
    bp.frequency.value = 450;
    bp.Q.value = 0.9;
    osc.frequency.setValueAtTime(160, t0);
    osc.frequency.exponentialRampToValueAtTime(55, t0 + 0.14);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.09, t0 + 0.006);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
  }

  src.connect(bp);
  bp.connect(g);
  g.connect(master);
  osc.connect(og);
  og.connect(master);
  src.start(t0);
  osc.start(t0);
  src.stop(t0 + 0.3);
  osc.stop(t0 + 0.3);
}

/** Small re-rail click. */
export function playRerail() {
  const c = ensureCtx();
  if (!c || !unlocked) return;
  const t0 = c.currentTime;
  const osc = c.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(520, t0);
  osc.frequency.exponentialRampToValueAtTime(280, t0 + 0.07);
  const g = c.createGain();
  g.gain.value = 0.0001;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.07, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
  osc.connect(g);
  g.connect(master);
  osc.start(t0);
  osc.stop(t0 + 0.1);
}

/**
 * Sync loops to sim state. Call once per frame (or on mode change).
 * @param {{ running: boolean, mode: string, wallGlide?: boolean, speed?: number }} state
 * @param {{ prevMode?: string }} mem — pass a mutable object to track transitions
 */
export function syncTrainAudio(state, mem = {}) {
  if (!unlocked) return;
  const mode = state.mode;
  const running = !!state.running;
  const prev = mem.prevMode;

  // Transitions
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

  // One soft tick when first contacting a wall while off-rail (not a spam loop)
  if (mode === "off_rail" && state.wallGlide && !mem.wasGliding) {
    playCollision("wall");
  }
  mem.wasGliding = !!(mode === "off_rail" && state.wallGlide);

  // Loops
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
