// Procedural lofi-jazz ambience, generated live with the Web Audio API.
// No audio files, so no licensing issues and nothing to download.
//
// Layers: warm electric-piano chords (ii-V-I-vi in C), soft swung drums,
// sleepy bass, sparse melody, vinyl crackle and a quiet cafe murmur.

import type { Mood } from "./moods.ts";

const STEPS_PER_BAR = 16;

/** Tempo for each mood. BEAT = one quarter note, STEP = one 16th, SWING = how late off-beat 16ths land. */
const TEMPO: Record<Mood, { bpm: number; swing: number }> = {
  dusk: { bpm: 74, swing: 0.16 },
  rain: { bpm: 58, swing: 0.05 },
  bossa: { bpm: 104, swing: 0 },
};

export const stepSeconds = (mood: Mood = "dusk") => 60 / TEMPO[mood].bpm / 4;

const mtof = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

type Chord = { bass: number; notes: number[] };

// 8-bar loop. Voicings are "rootless" jazz shapes (the bass plays the root).
const DUSK_PROGRESSION: Chord[] = [
  { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
  { bass: 43, notes: [53, 57, 59, 64] }, // G13
  { bass: 36, notes: [52, 55, 59, 62] }, // Cmaj9
  { bass: 45, notes: [55, 59, 60, 64] }, // Am9
  { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
  { bass: 43, notes: [53, 57, 59, 64] }, // G13
  { bass: 36, notes: [52, 55, 59, 62] }, // Cmaj9
  { bass: 45, notes: [55, 61, 65] }, // A7b13 turnaround
];

const DUSK_SCALE = [62, 64, 65, 67, 69, 71, 72, 74]; // D dorian

// Rainy Midnight Keys: slow A-minor piano.
const RAIN_PROGRESSION: Chord[] = [
  { bass: 45, notes: [55, 59, 60, 64] }, // Am9
  { bass: 41, notes: [57, 60, 64, 67] }, // Fmaj9
  { bass: 36, notes: [52, 55, 59, 62] }, // Cmaj9
  { bass: 43, notes: [53, 57, 59, 64] }, // G13
  { bass: 45, notes: [55, 59, 60, 64] }, // Am9
  { bass: 41, notes: [57, 60, 64, 67] }, // Fmaj9
  { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
  { bass: 40, notes: [56, 59, 62, 65] }, // E7b9
];
const RAIN_SCALE = [69, 72, 74, 76, 79, 81]; // A minor pentatonic, up high

// Morning Bossa: bright C major with a bossa clave.
const BOSSA_PROGRESSION: Chord[] = [
  { bass: 36, notes: [52, 55, 59, 62] }, // Cmaj9
  { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
  { bass: 43, notes: [53, 57, 59, 64] }, // G13
  { bass: 36, notes: [52, 55, 59, 62] }, // Cmaj9
  { bass: 45, notes: [55, 59, 60, 64] }, // Am9
  { bass: 38, notes: [54, 57, 60, 64] }, // D9
  { bass: 38, notes: [53, 57, 60, 64] }, // Dm9
  { bass: 43, notes: [53, 57, 59, 64] }, // G13
];
const BOSSA_SCALE = [72, 74, 76, 79, 81, 84]; // C major pentatonic
const BOSSA_CLAVE = [0, 3, 6, 10, 12]; // 16th-note steps that get a rim click

export type Graph = {
  ctx: BaseAudioContext;
  music: GainNode; // chords + melody (goes through the echo)
  low: GainNode; // bass
  drums: GainNode;
  amb: GainNode; // crackle, murmur, clinks
  wobble: GainNode; // slow pitch drift ("tape wow")
  master: GainNode;
  noise: AudioBuffer;
  delay: DelayNode; // the echo (retimed per mood)
  feedback: GainNode;
};

export function buildGraph(ctx: BaseAudioContext): Graph {
  const master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 3;
  comp.attack.value = 0.01;
  comp.release.value = 0.25;
  comp.connect(master);

  // Dark "tape" tone for the musical layers.
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 3000;
  tone.Q.value = 0.4;
  tone.connect(comp);

  // Soft dotted-eighth echo for space.
  const delay = ctx.createDelay(1);
  delay.delayTime.value = (60 / TEMPO.dusk.bpm) * 0.75;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 1400;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.32;
  const wet = ctx.createGain();
  wet.gain.value = 0.3;
  delay.connect(echoTone);
  echoTone.connect(feedback);
  feedback.connect(delay);
  echoTone.connect(wet);
  wet.connect(tone);

  const music = ctx.createGain();
  music.gain.value = 0.9;
  music.connect(tone);
  music.connect(delay);

  const low = ctx.createGain();
  low.gain.value = 0.9;
  low.connect(comp);

  const drumTone = ctx.createBiquadFilter();
  drumTone.type = "lowpass";
  drumTone.frequency.value = 4500;
  drumTone.connect(comp);
  const drums = ctx.createGain();
  drums.gain.value = 0.8;
  drums.connect(drumTone);

  const amb = ctx.createGain();
  amb.gain.value = 1;
  amb.connect(master);

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.35;
  const wobble = ctx.createGain();
  wobble.gain.value = 6; // cents
  lfo.connect(wobble);
  lfo.start();

  const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  return { ctx, music, low, drums, amb, wobble, master, noise, delay, feedback };
}

/** Retime the echo for a mood (a dotted eighth), a little longer and wetter for the rainy keys. */
export function applyMoodToGraph(g: Graph, mood: Mood, when = g.ctx.currentTime) {
  g.delay.delayTime.setTargetAtTime((60 / TEMPO[mood].bpm) * 0.75, when, 0.05);
  g.feedback.gain.setTargetAtTime(mood === "rain" ? 0.45 : 0.32, when, 0.05);
}

// ---------------------------------------------------------------- voices

function tine(g: Graph, when: number, note: number, dur: number, vel: number) {
  const { ctx } = g;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, when);
  out.gain.exponentialRampToValueAtTime(vel, when + 0.012);
  out.gain.exponentialRampToValueAtTime(vel * 0.35, when + 0.4);
  out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  out.connect(g.music);
  const f = mtof(note);
  const parts: [OscillatorType, number, number][] = [
    ["sine", 1, 1],
    ["triangle", 1, 0.3],
    ["sine", 2, 0.16],
  ];
  for (const [type, mult, level] of parts) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    g.wobble.connect(o.detune);
    const pg = ctx.createGain();
    pg.gain.value = level;
    o.connect(pg);
    pg.connect(out);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
}

function pluck(g: Graph, when: number, note: number, vel: number) {
  const { ctx } = g;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, when);
  out.gain.exponentialRampToValueAtTime(vel, when + 0.006);
  out.gain.exponentialRampToValueAtTime(0.0001, when + 0.9);
  out.connect(g.music);
  for (const [type, mult, level] of [["sine", 1, 1], ["triangle", 2, 0.15]] as [OscillatorType, number, number][]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(note) * mult;
    g.wobble.connect(o.detune);
    const pg = ctx.createGain();
    pg.gain.value = level;
    o.connect(pg);
    pg.connect(out);
    o.start(when);
    o.stop(when + 0.95);
  }
}

function bass(g: Graph, when: number, note: number, dur: number, vel: number) {
  const { ctx } = g;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 450;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, when);
  out.gain.exponentialRampToValueAtTime(vel, when + 0.015);
  out.gain.exponentialRampToValueAtTime(vel * 0.5, when + dur * 0.5);
  out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  lp.connect(out);
  out.connect(g.low);
  for (const [type, mult, level] of [["triangle", 1, 1], ["sine", 2, 0.25]] as [OscillatorType, number, number][]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(note) * mult;
    const pg = ctx.createGain();
    pg.gain.value = level;
    o.connect(pg);
    pg.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
}

function noiseSource(g: Graph, when: number, dur: number) {
  const s = g.ctx.createBufferSource();
  s.buffer = g.noise;
  s.loop = true;
  s.start(when, Math.random() * 1.5);
  s.stop(when + dur);
  return s;
}

function kick(g: Graph, when: number, vel: number) {
  const { ctx } = g;
  const o = ctx.createOscillator();
  o.type = "sine";
  o.frequency.setValueAtTime(130, when);
  o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
  const e = ctx.createGain();
  e.gain.setValueAtTime(vel * 0.9, when);
  e.gain.exponentialRampToValueAtTime(0.0001, when + 0.3);
  o.connect(e);
  e.connect(g.drums);
  o.start(when);
  o.stop(when + 0.32);
}

function snare(g: Graph, when: number, vel: number) {
  const { ctx } = g;
  const n = noiseSource(g, when, 0.25);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 1900;
  bp.Q.value = 0.7;
  const e = ctx.createGain();
  e.gain.setValueAtTime(vel * 0.32, when);
  e.gain.exponentialRampToValueAtTime(0.0001, when + 0.17);
  n.connect(bp);
  bp.connect(e);
  e.connect(g.drums);
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.value = 185;
  const oe = ctx.createGain();
  oe.gain.setValueAtTime(vel * 0.25, when);
  oe.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
  o.connect(oe);
  oe.connect(g.drums);
  o.start(when);
  o.stop(when + 0.12);
}

function hat(g: Graph, when: number, vel: number, open = false) {
  const { ctx } = g;
  const n = noiseSource(g, when, 0.3);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 7000;
  const e = ctx.createGain();
  const d = open ? 0.22 : 0.045;
  e.gain.setValueAtTime(vel * 0.16, when);
  e.gain.exponentialRampToValueAtTime(0.0001, when + d);
  n.connect(hp);
  hp.connect(e);
  e.connect(g.drums);
}

function clink(g: Graph, when: number) {
  const { ctx } = g;
  const base = 2800 + Math.random() * 1600;
  for (const [mult, level] of [[1, 1], [1.51, 0.5]] as [number, number][]) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = base * mult;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, when);
    e.gain.exponentialRampToValueAtTime(0.012 * level, when + 0.004);
    e.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);
    o.connect(e);
    e.connect(g.amb);
    o.start(when);
    o.stop(when + 0.3);
  }
}

function shaker(g: Graph, when: number, vel: number) {
  const { ctx } = g;
  const n = noiseSource(g, when, 0.12);
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 6500;
  bp.Q.value = 1.2;
  const e = ctx.createGain();
  e.gain.setValueAtTime(0.0001, when);
  e.gain.exponentialRampToValueAtTime(vel * 0.1, when + 0.01);
  e.gain.exponentialRampToValueAtTime(0.0001, when + 0.07);
  n.connect(bp);
  bp.connect(e);
  e.connect(g.drums);
}

function rim(g: Graph, when: number, vel: number) {
  const { ctx } = g;
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(1250, when);
  o.frequency.exponentialRampToValueAtTime(800, when + 0.03);
  const e = ctx.createGain();
  e.gain.setValueAtTime(vel * 0.16, when);
  e.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(e);
  e.connect(g.drums);
  o.start(when);
  o.stop(when + 0.06);
}

/** A soft, dark piano-ish key with a long tail (Rainy Midnight Keys). */
function key(g: Graph, when: number, note: number, dur: number, vel: number) {
  const { ctx } = g;
  const out = ctx.createGain();
  out.gain.setValueAtTime(0.0001, when);
  out.gain.exponentialRampToValueAtTime(vel, when + 0.01);
  out.gain.exponentialRampToValueAtTime(vel * 0.4, when + 0.5);
  out.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1700;
  lp.connect(out);
  out.connect(g.music);
  for (const [type, mult, level] of [["sine", 1, 1], ["triangle", 2, 0.22], ["sine", 3, 0.06]] as [OscillatorType, number, number][]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = mtof(note) * mult;
    g.wobble.connect(o.detune);
    const pg = ctx.createGain();
    pg.gain.value = level;
    o.connect(pg);
    pg.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
}

// ------------------------------------------------------------- ambience

/** Gentle rain: a soft wash, lower body, and tiny drops. Fades in/out with setLevel(). */
export function startRain(g: Graph, when: number): { setLevel: (v: number) => void; stop: () => void } {
  const { ctx } = g;
  const sr = ctx.sampleRate;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(g.amb);

  const wash = ctx.createBufferSource();
  wash.buffer = g.noise;
  wash.loop = true;
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 1100;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 6500;
  const wg = ctx.createGain();
  wg.gain.value = 0.2;
  wash.connect(hp);
  hp.connect(lp);
  lp.connect(wg);
  wg.connect(out);
  wash.start(when, 0.3);

  const body = ctx.createBufferSource();
  body.buffer = g.noise;
  body.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 420;
  bp.Q.value = 0.5;
  const bg = ctx.createGain();
  bg.gain.value = 0.16;
  body.connect(bp);
  bp.connect(bg);
  bg.connect(out);
  body.start(when, 1.1);

  const drops = ctx.createBuffer(1, sr * 4, sr);
  const dd = drops.getChannelData(0);
  for (let i = 0; i < dd.length; i++) dd[i] = Math.random() < 0.0009 ? (Math.random() - 0.3) * 1.6 : 0;
  const ds = ctx.createBufferSource();
  ds.buffer = drops;
  ds.loop = true;
  const dbp = ctx.createBiquadFilter();
  dbp.type = "bandpass";
  dbp.frequency.value = 3200;
  dbp.Q.value = 1.4;
  const dg = ctx.createGain();
  dg.gain.value = 0.35;
  ds.connect(dbp);
  dbp.connect(dg);
  dg.connect(out);
  ds.start(when);

  return {
    setLevel: (v: number) => out.gain.setTargetAtTime(v, ctx.currentTime, 0.6),
    stop: () => {
      try { wash.stop(); body.stop(); ds.stop(); } catch { /* already stopped */ }
    },
  };
}

/** Continuous vinyl crackle + low cafe murmur. Returns a function that stops them. */
export function startAmbience(g: Graph, when: number): () => void {
  const { ctx } = g;
  const sr = ctx.sampleRate;

  const crackle = ctx.createBuffer(1, sr * 3, sr);
  const cd = crackle.getChannelData(0);
  for (let i = 0; i < cd.length; i++) {
    cd[i] = Math.random() < 0.0005 ? (Math.random() - 0.5) * 1.4 : (Math.random() - 0.5) * 0.012;
  }
  const cs = ctx.createBufferSource();
  cs.buffer = crackle;
  cs.loop = true;
  const chp = ctx.createBiquadFilter();
  chp.type = "highpass";
  chp.frequency.value = 900;
  const cg = ctx.createGain();
  cg.gain.value = 0.22;
  cs.connect(chp);
  chp.connect(cg);
  cg.connect(g.amb);
  cs.start(when);

  const murmur = ctx.createBuffer(1, sr * 8, sr);
  const md = murmur.getChannelData(0);
  let last = 0;
  for (let i = 0; i < md.length; i++) {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    md[i] = last * 3.5;
  }
  const ms = ctx.createBufferSource();
  ms.buffer = murmur;
  ms.loop = true;
  const mbp = ctx.createBiquadFilter();
  mbp.type = "bandpass";
  mbp.frequency.value = 520;
  mbp.Q.value = 0.6;
  const mg = ctx.createGain();
  mg.gain.value = 0.5;
  const mlfo = ctx.createOscillator();
  mlfo.frequency.value = 0.13;
  const mlg = ctx.createGain();
  mlg.gain.value = 0.25;
  mlfo.connect(mlg);
  mlg.connect(mg.gain);
  mlfo.start(when);
  ms.connect(mbp);
  mbp.connect(mg);
  mg.connect(g.amb);
  ms.start(when);

  return () => {
    try { cs.stop(); ms.stop(); mlfo.stop(); } catch { /* already stopped */ }
  };
}

// ------------------------------------------------------------ sequencer

/** Schedule everything that happens on one 16th-note step. */
export function scheduleStep(g: Graph, stepIdx: number, t: number, rng: () => number, mood: Mood = "dusk") {
  if (mood === "rain") return rainStep(g, stepIdx, t, rng);
  if (mood === "bossa") return bossaStep(g, stepIdx, t, rng);
  return duskStep(g, stepIdx, t, rng);
}

function duskStep(g: Graph, stepIdx: number, t: number, rng: () => number) {
  const { bpm, swing } = TEMPO.dusk;
  const BEAT = 60 / bpm;
  const STEP = BEAT / 4;
  const bar = Math.floor(stepIdx / STEPS_PER_BAR) % DUSK_PROGRESSION.length;
  const s = stepIdx % STEPS_PER_BAR;
  const chord = DUSK_PROGRESSION[bar];
  const next = DUSK_PROGRESSION[(bar + 1) % DUSK_PROGRESSION.length];
  const when = t + (s % 2 === 1 ? swing * STEP : 0);
  const human = (amt: number) => (rng() - 0.5) * amt;

  // drums
  if (s === 0 || s === 10 || (s === 7 && rng() < 0.35) || (s === 15 && rng() < 0.12)) {
    kick(g, when + human(0.008), s === 0 ? 1 : 0.7);
  }
  if (s === 4 || s === 12) snare(g, when + 0.012 + human(0.008), 0.75 + rng() * 0.25);
  if (s % 2 === 0) hat(g, when + human(0.006), s % 4 === 0 ? 0.55 : 0.3 + rng() * 0.2, s === 14 && rng() < 0.3);

  // bass
  if (s === 0) bass(g, when, chord.bass, BEAT * 1.6, 0.8);
  if (s === 10 && rng() < 0.7) bass(g, when, chord.bass + (rng() < 0.5 ? 7 : 12), BEAT * 0.9, 0.6);
  if (s === 14 && rng() < 0.3) bass(g, when, next.bass + (rng() < 0.5 ? 1 : -1), BEAT * 0.4, 0.5);

  // chords (lightly strummed)
  const comp = (dur: number, vel: number) =>
    chord.notes.forEach((n, i) => tine(g, when + i * 0.012 + human(0.01), n, dur, vel * (0.85 + rng() * 0.3)));
  if (s === 0) comp(BEAT * 3, 0.1);
  else if (s === 6 && rng() < 0.6) comp(BEAT * 0.9, 0.075);
  else if (s === 10 && rng() < 0.45) comp(BEAT * 0.9, 0.07);

  // sparse melody
  if ([2, 5, 8, 11, 13].includes(s) && rng() < (bar === 7 ? 0.1 : 0.26)) {
    pluck(g, when + human(0.01), DUSK_SCALE[Math.floor(rng() * DUSK_SCALE.length)], 0.06 + rng() * 0.04);
  }

  // the odd cup clink
  if (s === 0 && rng() < 0.12) clink(g, when + rng() * BEAT * 12);
}

/** Rainy Midnight Keys: no drums. A slow arpeggio, a low root, and the odd high note. */
function rainStep(g: Graph, stepIdx: number, t: number, rng: () => number) {
  const BEAT = 60 / TEMPO.rain.bpm;
  const bar = Math.floor(stepIdx / STEPS_PER_BAR) % RAIN_PROGRESSION.length;
  const s = stepIdx % STEPS_PER_BAR;
  const chord = RAIN_PROGRESSION[bar];
  const human = (amt: number) => (rng() - 0.5) * amt;

  if (s === 0) {
    bass(g, t, chord.bass, BEAT * 3.6, 0.7);
    key(g, t + human(0.01), chord.notes[0] - 12, BEAT * 3.5, 0.07); // a warm low note under the chord
  }
  // slow rolling arpeggio, one chord tone every 3rd step, a little softer at the end of the bar
  const arp: Record<number, number> = { 0: 0, 3: 1, 6: 2, 9: 3, 12: 2 };
  if (s in arp) {
    const n = chord.notes[arp[s]] + (s === 9 ? 12 : 0);
    key(g, t + human(0.015), n, BEAT * 2.6, (s === 0 ? 0.1 : 0.07) * (0.85 + rng() * 0.3));
  }
  if ([2, 7, 10, 14].includes(s) && rng() < 0.2) {
    key(g, t + human(0.02), RAIN_SCALE[Math.floor(rng() * RAIN_SCALE.length)], BEAT * 2.2, 0.05 + rng() * 0.03);
  }
}

/** Morning Bossa: bossa clave, soft shaker, nylon-ish plucks and a rolling bass. */
function bossaStep(g: Graph, stepIdx: number, t: number, rng: () => number) {
  const BEAT = 60 / TEMPO.bossa.bpm;
  const bar = Math.floor(stepIdx / STEPS_PER_BAR) % BOSSA_PROGRESSION.length;
  const s = stepIdx % STEPS_PER_BAR;
  const chord = BOSSA_PROGRESSION[bar];
  const human = (amt: number) => (rng() - 0.5) * amt;
  const when = t;

  // percussion: even shaker, clave on the rim, soft kick on 1 and 3
  shaker(g, when + human(0.004), s % 4 === 0 ? 0.9 : s % 2 === 0 ? 0.6 : 0.4);
  if (BOSSA_CLAVE.includes(s)) rim(g, when + human(0.004), 0.8);
  if (s === 0 || s === 8) kick(g, when, s === 0 ? 0.55 : 0.4);

  // bossa bass: root, then fifth, repeating
  if (s === 0 || s === 8) bass(g, when, chord.bass, BEAT * 1.4, 0.7);
  if (s === 6 || s === 14) bass(g, when, chord.bass + 7, BEAT * 1, 0.55);

  // nylon guitar comping on the syncopated steps
  if ([0, 6, 10, 12].includes(s) && (s === 0 || rng() < 0.85)) {
    chord.notes.forEach((n, i) => pluck(g, when + i * 0.014 + human(0.008), n, (s === 0 ? 0.07 : 0.055) * (0.85 + rng() * 0.3)));
  }

  // bright little melody
  if ([2, 4, 8, 11, 14].includes(s) && rng() < (bar % 4 === 3 ? 0.12 : 0.3)) {
    pluck(g, when + human(0.01), BOSSA_SCALE[Math.floor(rng() * BOSSA_SCALE.length)], 0.07 + rng() * 0.04);
  }
}

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Render N seconds offline (used for testing and for exporting a sample). */
export async function renderLofi(
  seconds: number,
  sampleRate = 22050,
  mood: Mood = "dusk",
  rain = false,
): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate);
  const g = buildGraph(ctx);
  applyMoodToGraph(g, mood, 0);
  startAmbience(g, 0);
  if (rain) {
    const r = startRain(g, 0);
    r.setLevel(RAIN_LEVEL);
  }
  const rng = mulberry32(7);
  const STEP = stepSeconds(mood);
  const steps = Math.ceil(seconds / STEP);
  for (let i = 0; i < steps; i++) scheduleStep(g, i, 0.1 + i * STEP, rng, mood);
  return ctx.startRendering();
}

export const RAIN_LEVEL = 0.55;

// --------------------------------------------------------------- player

/** Live player. start() must be called from a user gesture (browser autoplay rules). */
export class LofiPlayer {
  /** Current mood (read-only, handy for tests). */
  get currentMood() { return this.mood; }
  get rainPlaying() { return this.rainOn; }

  private ctx: AudioContext | null = null;
  private graph: Graph | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private volume = 0.5;
  private muted = false;
  private mood: Mood = "dusk";
  private rainOn = false;
  private rain: { setLevel: (v: number) => void; stop: () => void } | null = null;

  private onVisibility = () => {
    if (!this.ctx) return;
    // Browsers can reject these (e.g. context already closed); music is optional, so ignore.
    const done = document.hidden ? this.ctx.suspend() : this.ctx.resume();
    done.catch(() => {});
  };

  start() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.graph = buildGraph(ctx);
    applyMoodToGraph(this.graph, this.mood, ctx.currentTime);
    this.applyVolume();
    startAmbience(this.graph, ctx.currentTime);
    this.applyRain();
    this.nextTime = ctx.currentTime + 0.15;
    this.step = 0;
    this.timer = window.setInterval(() => this.tick(), 25);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  private tick() {
    const { ctx, graph } = this;
    if (!ctx || !graph) return;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05; // recover after a stall
    while (this.nextTime < ctx.currentTime + 0.2) {
      scheduleStep(graph, this.step, this.nextTime, Math.random, this.mood);
      this.nextTime += stepSeconds(this.mood);
      this.step++;
    }
  }

  private applyVolume() {
    if (!this.ctx || !this.graph) return;
    const level = this.muted ? 0 : this.volume * this.volume * 0.9;
    this.graph.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.05);
  }

  /** Switch the jukebox mood. Safe to call before start(). */
  setMood(mood: Mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    const { ctx, graph } = this;
    if (!ctx || !graph) return;
    // quick dip so the old mood's last notes don't clash with the new one, then start it fresh
    const now = ctx.currentTime;
    const dips: [GainNode, number][] = [[graph.music, 0.9], [graph.low, 0.9], [graph.drums, 0.8]];
    for (const [node, level] of dips) {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(0.0001, now + 0.15);
      node.gain.setValueAtTime(0.0001, now + 0.4);
      node.gain.linearRampToValueAtTime(level, now + 0.6);
    }
    applyMoodToGraph(graph, mood, now + 0.15);
    this.step = 0;
    this.nextTime = now + 0.4;
  }

  /** Rain ambience on/off (the "Rainy Night" window weather). Safe to call before start(). */
  setRain(on: boolean) {
    this.rainOn = on;
    this.applyRain();
  }

  private applyRain() {
    const { ctx, graph } = this;
    if (!ctx || !graph) return;
    if (this.rainOn && !this.rain) this.rain = startRain(graph, ctx.currentTime);
    this.rain?.setLevel(this.rainOn ? RAIN_LEVEL : 0);
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
  }

  stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onVisibility);
    this.rain?.stop();
    this.rain = null;
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.graph = null;
  }
}
