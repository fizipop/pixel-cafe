// Floor 3's own music: a procedural, cozy night-time loop (Web Audio only, no audio files). A soft
// electric piano plays slow jazz chords (Cmaj7 - Am7 - Fmaj7 - G6), a nylon-string "acoustic" pluck
// walks through them, a sparse music-box melody floats on top, and under it all there is a breeze
// and a very light rain. It has its own AudioContext and only runs while you are on the rooftop;
// the volume slider and the music toggle drive it exactly like the cafe's lofi player.

export const ROOFTOP_BPM = 68;
export const rooftopStepSeconds = () => 60 / ROOFTOP_BPM / 4; // one 16th note

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// One bar per chord: bass root, and the piano voicing (MIDI notes).
const CHORDS: { bass: number; keys: number[] }[] = [
  { bass: 36, keys: [55, 59, 64, 67] }, // Cmaj7
  { bass: 33, keys: [57, 60, 64, 67] }, // Am7
  { bass: 41, keys: [57, 60, 64, 65] }, // Fmaj7
  { bass: 43, keys: [59, 62, 64, 67] }, // G6
];
const PIANO_STEPS = new Set([0, 10]); // the chord is struck on the one and the "and of three"
const PLUCK_STEPS = [2, 4, 6, 8, 12, 14]; // nylon-string plucks, as indexes into the chord (+ an octave)
const PLUCK_TONES = [1, 2, 3, 2, 3, 1];
const BASS_STEPS = new Set([0, 8]);
// C-major pentatonic music-box melody, one bar per chord (0 = rest)
const BELL: number[][] = [
  [0, 0, 0, 0, 79, 0, 0, 0, 0, 0, 76, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 72, 0, 0, 0, 0, 0, 76, 0, 0, 0],
  [0, 0, 81, 0, 0, 0, 0, 0, 79, 0, 0, 0, 0, 0, 76, 0],
  [0, 0, 0, 0, 74, 0, 0, 0, 0, 0, 0, 0, 72, 0, 0, 0],
];

export type RooftopStep = { bass: number | null; keys: number[] | null; pluck: number | null; bell: number | null };

/** What plays on a given 16th-note step (pure, so it can be tested). 64 steps = 4 bars, then it loops. */
export function rooftopStep(step: number): RooftopStep {
  const s = ((step % 64) + 64) % 64;
  const bar = Math.floor(s / 16);
  const i = s % 16;
  const { bass, keys } = CHORDS[bar];
  const p = PLUCK_STEPS.indexOf(i);
  const bell = BELL[bar][i];
  return {
    bass: BASS_STEPS.has(i) ? midi(bass) : null,
    keys: PIANO_STEPS.has(i) ? keys.map(midi) : null,
    pluck: p >= 0 ? midi(keys[PLUCK_TONES[p]] + 12) : null,
    bell: bell ? midi(bell) : null,
  };
}

type Graph = { ctx: AudioContext; master: GainNode; bus: GainNode; noise: AudioBuffer };

function envNote(g: Graph, type: OscillatorType, f: number, t: number, dur: number, vel: number, attack: number, out: AudioNode) {
  const o = g.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  const e = g.ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(vel, t + attack);
  e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(e);
  e.connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

/** Rhodes-like electric piano: a warm sine body, a bell-ish overtone that dies fast, and a soft hammer tick. */
function piano(g: Graph, f: number, t: number, vel: number) {
  const len = 2.4;
  envNote(g, "sine", f, t, len, vel, 0.012, g.bus);
  envNote(g, "sine", f * 2, t, len * 0.45, vel * 0.32, 0.006, g.bus);
  envNote(g, "triangle", f * 4.01, t, 0.12, vel * 0.1, 0.003, g.bus);
}

/** Nylon-string pluck: a triangle through a falling low-pass, so it starts bright and mellows out. */
function pluck(g: Graph, f: number, t: number, vel: number) {
  const o = g.ctx.createOscillator();
  o.type = "triangle";
  o.frequency.setValueAtTime(f, t);
  const lp = g.ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.setValueAtTime(3200, t);
  lp.frequency.exponentialRampToValueAtTime(500, t + 0.35);
  const e = g.ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(vel, t + 0.004);
  e.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  o.connect(lp);
  lp.connect(e);
  e.connect(g.bus);
  o.start(t);
  o.stop(t + 0.95);
}

function bell(g: Graph, f: number, t: number, vel: number) {
  envNote(g, "sine", f, t, 2.2, vel, 0.004, g.bus);
  envNote(g, "sine", f * 3.01, t, 0.6, vel * 0.18, 0.003, g.bus);
}

/** A single quiet rain drop. */
function drip(g: Graph, t: number) {
  const f = 1800 + Math.random() * 2400;
  envNote(g, "sine", f, t, 0.07, 0.012 + Math.random() * 0.01, 0.002, g.bus);
}

type Ambience = { stop: () => void };

/** The breeze (slow wind swells) and a light, steady rain, both made from the same looped noise. */
function startAmbience(g: Graph): Ambience {
  const { ctx } = g;
  const nodes: AudioScheduledSourceNode[] = [];
  const loop = () => {
    const src = ctx.createBufferSource();
    src.buffer = g.noise;
    src.loop = true;
    src.start(0, Math.random());
    nodes.push(src);
    return src;
  };
  const lfo = (hz: number, depth: number, target: AudioParam) => {
    const o = ctx.createOscillator();
    o.frequency.value = hz;
    const d = ctx.createGain();
    d.gain.value = depth;
    o.connect(d);
    d.connect(target);
    o.start();
    nodes.push(o);
  };

  // breeze: low band-passed noise whose volume and colour drift slowly, like gusts
  const wind = loop();
  const wf = ctx.createBiquadFilter();
  wf.type = "bandpass";
  wf.frequency.value = 520;
  wf.Q.value = 0.55;
  const wg = ctx.createGain();
  wg.gain.value = 0.035;
  wind.connect(wf);
  wf.connect(wg);
  wg.connect(g.master);
  lfo(0.07, 0.022, wg.gain);
  lfo(0.05, 260, wf.frequency);

  // rain: high, thin and quiet
  const rain = loop();
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 3600;
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 9000;
  const rg = ctx.createGain();
  rg.gain.value = 0.016;
  rain.connect(hp);
  hp.connect(lp);
  lp.connect(rg);
  rg.connect(g.master);
  lfo(0.11, 0.006, rg.gain);

  return {
    stop: () => {
      for (const n of nodes) { try { n.stop(); } catch { /* already stopped */ } }
    },
  };
}

export class RooftopMusic {
  private g: Graph | null = null;
  private timer: number | null = null;
  private ambience: Ambience | null = null;
  private nextTime = 0;
  private step = 0;
  private volume = 0.5;
  private muted = false;
  private active = false;

  /** Call inside a user gesture (browser autoplay rules), like the other audio classes. */
  start() {
    if (this.g) { this.g.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    const master = ctx.createGain();
    const bus = ctx.createGain();
    const lp = ctx.createBiquadFilter(); // soft, warm top end
    lp.type = "lowpass";
    lp.frequency.value = 4200;
    const comp = ctx.createDynamicsCompressor();
    bus.connect(lp);
    lp.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.g = { ctx, master, bus, noise: buf };
    this.apply();
    if (this.active) this.run();
  }

  private level() {
    return this.muted || !this.active ? 0 : this.volume * this.volume * 0.85;
  }

  private apply() {
    if (this.g) this.g.master.gain.setTargetAtTime(this.level(), this.g.ctx.currentTime, 0.08);
  }

  private schedule(g: Graph, step: number, t: number) {
    const s = rooftopStep(step);
    if (s.keys) s.keys.forEach((f, i) => piano(g, f, t + i * 0.018, 0.075)); // a gentle strum, not a block
    if (s.bass) envNote(g, "sine", s.bass, t, 1.6, 0.26, 0.015, g.bus);
    if (s.pluck) pluck(g, s.pluck, t, 0.07);
    if (s.bell) bell(g, s.bell, t, 0.06);
    if (Math.random() < 0.06) drip(g, t + Math.random() * rooftopStepSeconds());
  }

  private run() {
    const g = this.g;
    if (!g || this.timer !== null) return;
    this.step = 0;
    this.nextTime = g.ctx.currentTime + 0.1;
    this.ambience = startAmbience(g);
    this.timer = window.setInterval(() => {
      if (g.ctx.state === "closed") return;
      if (this.nextTime < g.ctx.currentTime) this.nextTime = g.ctx.currentTime + 0.05; // recover after a stall
      while (this.nextTime < g.ctx.currentTime + 0.25) {
        this.schedule(g, this.step++, this.nextTime);
        this.nextTime += rooftopStepSeconds();
      }
    }, 30);
  }

  private halt() {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
    this.ambience?.stop();
    this.ambience = null;
  }

  /** True while you are on Floor 3: the loop plays; otherwise it is silent and the scheduler is off. */
  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    if (!this.g) return;
    if (on) { this.g.ctx.resume().catch(() => {}); this.run(); } else this.halt();
    this.apply();
  }

  setVolume(v: number) { this.volume = Math.min(1, Math.max(0, v)); this.apply(); }
  setMuted(m: boolean) { this.muted = m; this.apply(); }
  get isActive() { return this.active; }

  stop() {
    this.halt();
    this.g?.ctx.close().catch(() => {});
    this.g = null;
  }
}
