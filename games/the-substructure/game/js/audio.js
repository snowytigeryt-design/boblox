/* All sound is generated with WebAudio - no audio files needed.
   Positional sounds use a PannerNode (HRTF) so you can hear WHERE something is. */
let AC = null, master, noiseBuf, tensionPad, tensionGain, ambTimer = 6, whisperT = 14;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[(Math.random() * a.length) | 0];

function ctxOk() { return !!AC && AC.state !== 'closed'; }

function makeNoise(sec) {
  const b = AC.createBuffer(1, AC.sampleRate * sec, AC.sampleRate), d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.6 + last * 4; } // slightly "brown" noise
  return b;
}

function env(g, t, a, d, v) {
  g.gain.cancelScheduledValues(t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(v, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
}

/* a panner placed at world (x, y, z). Returns the node to connect sources into. */
function spatial(x, y, z, ref = 2.5) {
  const p = AC.createPanner();
  p.panningModel = 'HRTF'; p.distanceModel = 'inverse';
  p.refDistance = ref; p.maxDistance = 60; p.rolloffFactor = 1.5;
  setPos(p, x, y, z);
  p.connect(master);
  return p;
}
function setPos(p, x, y, z) {
  if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
}

function tone(f0, f1, dur, type, vol, dest, delay = 0, filt) {
  if (!ctxOk()) return;
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, Math.min(0.02, dur / 4), dur, vol);
  let node = o;
  if (filt) { const f = AC.createBiquadFilter(); f.type = filt[0]; f.frequency.value = filt[1]; o.connect(f); node = f; }
  node.connect(g).connect(dest || master);
  o.start(t); o.stop(t + dur + 0.1);
  return o;
}

function noise(dur, vol, freq, q, dest, delay = 0, type = 'bandpass', attack = 0.02) {
  if (!ctxOk()) return;
  const t = AC.currentTime + delay, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; s.loop = true;
  f.type = type; f.frequency.value = freq; f.Q.value = q || 1;
  env(g, t, attack, dur, vol);
  s.connect(f).connect(g).connect(dest || master);
  s.start(t, Math.random() * 1.5); s.stop(t + attack + dur + 0.1);
  return f;
}

export const Sound = {
  get ready() { return ctxOk(); },

  init() {
    if (AC) { if (AC.state === 'suspended') AC.resume(); return; }
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = 0.9;
    const comp = AC.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 6;
    master.connect(comp).connect(AC.destination);
    noiseBuf = makeNoise(3);

    // low drone (two detuned sines beating slowly)
    const dg = AC.createGain(); dg.gain.value = 0.05; dg.connect(master);
    [48, 48.7, 96.3].forEach((f, i) => { const o = AC.createOscillator(); o.frequency.value = f; o.type = i === 2 ? 'triangle' : 'sine'; const g = AC.createGain(); g.gain.value = i === 2 ? 0.25 : 1; o.connect(g).connect(dg); o.start(); });
    // air / ventilation rumble
    const ns = AC.createBufferSource(), nf = AC.createBiquadFilter(), ng = AC.createGain();
    ns.buffer = noiseBuf; ns.loop = true; nf.type = 'lowpass'; nf.frequency.value = 220; ng.gain.value = 0.16;
    const lfo = AC.createOscillator(), lg = AC.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 90; lfo.connect(lg).connect(nf.frequency); lfo.start();
    ns.connect(nf).connect(ng).connect(master); ns.start();
    // tension pad: dissonant, only audible when something is hunting you
    tensionGain = AC.createGain(); tensionGain.gain.value = 0;
    const tf = AC.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 520;
    tensionPad = [110, 116.5, 164.8].map((f) => { const o = AC.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(tf); o.start(); return o; });
    tf.connect(tensionGain).connect(master);
  },

  /* call every frame: listener = the player's ears */
  listener(x, z, yaw) {
    if (!ctxOk()) return;
    const L = AC.listener, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    if (L.positionX) {
      L.positionX.value = x; L.positionY.value = 1.6; L.positionZ.value = z;
      L.forwardX.value = fx; L.forwardY.value = 0; L.forwardZ.value = fz;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(x, 1.6, z); L.setOrientation(fx, 0, fz, 0, 1, 0); }
  },

  setTension(t) {
    if (!ctxOk()) return;
    tensionGain.gain.setTargetAtTime(Math.min(0.2, t * 0.2), AC.currentTime, 0.4);
    tensionPad.forEach((o, i) => o.frequency.setTargetAtTime([110, 116.5, 164.8][i] * (1 + t * 0.06), AC.currentTime, 1));
  },

  /* random creepy ambience; tension 0..1 makes it rarer while you are being hunted (silence = worse) */
  tick(dt, tension, px, pz) {
    if (!ctxOk()) return;
    ambTimer -= dt; whisperT -= dt;
    const around = (r) => { const a = Math.random() * 6.283; return [px + Math.cos(a) * r, pz + Math.sin(a) * r]; };
    if (ambTimer <= 0) {
      ambTimer = rand(7, 16) * (1 + tension);
      const k = pick(['groan', 'drip', 'bang', 'steps', 'knock', 'pipe']);
      const [x, z] = around(rand(10, 24));
      if (k === 'groan') this.groan(x, z);
      else if (k === 'drip') this.drip(px + rand(-4, 4), pz + rand(-4, 4));
      else if (k === 'bang') this.bang(x, z);
      else if (k === 'knock') this.knock(x, z);
      else if (k === 'pipe') this.pipe(x, z);
      else for (let i = 0; i < 5; i++) this.step(x, z, 0.35, 0.5, i * rand(0.38, 0.5));
    }
    if (whisperT <= 0) { whisperT = rand(22, 50); const [x, z] = around(rand(2, 5)); this.whisper(x, z); }
  },

  /* ---- UI / non-positional ---- */
  thump(v) { tone(70, 35, 0.18, 'sine', v); },
  heart(v) { this.thump(v); setTimeout(() => this.thump(v * 0.55), 170); },
  screech() { tone(900, 2300, 1.1, 'sawtooth', 0.17); noise(1, 0.22, 3200, 1.5); tone(120, 50, 1.2, 'square', 0.12); },
  scratch() { noise(0.5, 0.25, 5000, 2); },
  sting() { tone(466, 220, 0.9, 'sawtooth', 0.12, null, 0, ['lowpass', 1800]); tone(494, 233, 0.9, 'sawtooth', 0.11, null, 0, ['lowpass', 1800]); noise(0.35, 0.15, 900, 0.8); },
  creak(open) { noise(0.5, 0.18, open ? 700 : 500, 14); tone(open ? 160 : 230, open ? 230 : 150, 0.45, 'sawtooth', 0.04, null, 0, ['bandpass', 600]); },
  ownStep(run) { noise(0.09, run ? 0.3 : 0.14, run ? 260 : 190, 0.8, null, 0, 'lowpass', 0.004); },
  breathing(fast) { // your own breathing in the locker
    const d = fast ? 0.5 : 0.9;
    noise(d, 0.07, 700, 0.7, null, 0, 'bandpass', d * 0.45); noise(d, 0.06, 500, 0.7, null, d * 1.05, 'bandpass', d * 0.3);
  },

  /* ---- positional ---- */
  step(x, z, vol, weight = 1, delay = 0) {
    if (!ctxOk()) return;
    const p = spatial(x, 0.2, z);
    const f = 90 / (0.6 + weight * 0.6);
    tone(f * 1.6, f * 0.5, 0.2 * (0.7 + weight * 0.4), 'sine', vol * 1.6, p, delay);
    noise(0.08, vol * 0.5, 600 / (0.5 + weight * 0.5), 0.8, p, delay, 'bandpass', 0.003);
  },
  growl(x, z, big = 1) {
    if (!ctxOk()) return;
    const p = spatial(x, 1.4, z, 3);
    const o = tone(70 * big + 20, 38 * big + 10, 1.4, 'sawtooth', 0.34, p, 0, ['lowpass', 380]);
    if (o) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = rand(14, 24); lg.gain.value = 18; l.connect(lg).connect(o.frequency); l.start(); l.stop(AC.currentTime + 1.6); }
    noise(1.2, 0.25, 260, 3, p);
  },
  breath(x, z) { // something large breathing close by
    if (!ctxOk()) return;
    const p = spatial(x, 1.5, z, 1.5);
    noise(1.1, 0.22, 520, 0.9, p, 0, 'bandpass', 0.5); noise(1.0, 0.18, 380, 0.9, p, 1.3, 'bandpass', 0.4);
  },
  scream(x, z) { // a teammate dying somewhere else in the maze
    if (!ctxOk()) return;
    const p = spatial(x, 1.6, z, 4);
    const o = tone(500, 1500, 1.0, 'sawtooth', 0.28, p, 0, ['bandpass', 1400]);
    if (o) { const l = AC.createOscillator(), lg = AC.createGain(); l.frequency.value = 9; lg.gain.value = 120; l.connect(lg).connect(o.frequency); l.start(); l.stop(AC.currentTime + 1.2); }
    noise(0.9, 0.12, 2400, 2, p);
  },
  groan(x, z) { if (!ctxOk()) return; const p = spatial(x, 2, z, 3); tone(55, 38, 2.4, 'sawtooth', 0.2, p, 0, ['lowpass', 260]); tone(58, 41, 2.4, 'sawtooth', 0.15, p, 0.1, ['lowpass', 240]); },
  drip(x, z) { if (!ctxOk()) return; const p = spatial(x, 2.4, z, 1.5); tone(1700, 800, 0.1, 'sine', 0.14, p); tone(1200, 600, 0.12, 'sine', 0.06, p, 0.12); },
  bang(x, z) { if (!ctxOk()) return; const p = spatial(x, 1.5, z, 4); noise(0.7, 0.5, 220, 0.6, p, 0, 'lowpass', 0.004); tone(95, 35, 0.5, 'sine', 0.5, p); },
  knock(x, z) { if (!ctxOk()) return; const p = spatial(x, 1.4, z, 3); for (let i = 0; i < 3; i++) { tone(180, 90, 0.1, 'triangle', 0.4, p, i * 0.28); noise(0.06, 0.25, 900, 1, p, i * 0.28); } },
  pipe(x, z) { if (!ctxOk()) return; const p = spatial(x, 2.7, z, 3); noise(1.6, 0.18, 1400, 8, p, 0, 'bandpass', 0.3); tone(300, 280, 1.6, 'triangle', 0.04, p); },
  whisper(x, z) { // formant-ish noise very close to your ear
    if (!ctxOk()) return;
    const p = spatial(x, 1.6, z, 1);
    for (let i = 0; i < 6; i++) { const f = noise(rand(0.12, 0.3), 0.3, rand(1400, 3200), 5, p, i * rand(0.12, 0.2), 'bandpass', 0.05); if (f) f.frequency.setTargetAtTime(rand(900, 3600), AC.currentTime + i * 0.15, 0.08); }
  },
};
