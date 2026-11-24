// Floor 2's own music: a procedural chiptune / lofi synth loop (Web Audio only, no audio files).
// Square-wave arpeggios and a pentatonic lead over Am - F - C - G, a triangle bass and a soft
// kick / snare / hat. It has its own AudioContext and only runs while you are in the Arcade; the
// volume slider and the music toggle drive it exactly like the cafe's lofi player.

export const ARCADE_BPM = 108;
export const arcadeStepSeconds = () => 60 / ARCADE_BPM / 4; // one 16th note

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

// root (MIDI), third interval: Am, F, C, G
const CHORDS: { root: number; third: number }[] = [
  { root: 45, third: 3 }, { root: 41, third: 4 }, { root: 48, third: 4 }, { root: 43, third: 4 },
];
const ARP_PATTERN = [0, 1, 2, 1, 2, 1, 0, 1, 2, 1, 2, 3, 2, 1, 0, 1]; // chord tone per 16th (3 = octave)
const BASS_STEPS = new Set([0, 3, 6, 8, 11, 14]);
// A-minor pentatonic lead, one bar per chord (0 = rest). A5=81 C6=84 D6=86 E6=88 G5=79 E5=76
const LEAD: number[][] = [
  [81, 0, 0, 76, 0, 0, 79, 0, 81, 0, 0, 0, 84, 0, 81, 0],
  [84, 0, 0, 81, 0, 0, 79, 0, 0, 0, 81, 0, 0, 0, 0, 0],
  [79, 0, 0, 84, 0, 0, 81, 0, 79, 0, 0, 0, 76, 0, 79, 0],
  [74, 0, 0, 79, 0, 0, 83, 0, 0, 0, 79, 0, 74, 0, 0, 0],
];

export type ArcadeStep = { arp: number; bass: number | null; lead: number | null; kick: boolean; snare: boolean; hat: boolean };

/** What plays on a given 16th-note step (pure, so it can be tested). */
export function arcadeStep(step: number): ArcadeStep {
  const s = ((step % 64) + 64) % 64;
  const bar = Math.floor(s / 16);
  const i = s % 16;
  const { root, third } = CHORDS[bar];
  const tones = [0, third, 7, 12];
  const lead = LEAD[bar][i];
  return {
    arp: midi(root + 24 + tones[ARP_PATTERN[i]]),
    bass: BASS_STEPS.has(i) ? midi(root + (i === 14 ? 12 : 0)) : null,
    lead: lead ? midi(lead) : null,
    kick: i === 0 || i === 6 || i === 8 || (i === 11 && bar % 2 === 1),
    snare: i === 4 || i === 12,
    hat: i % 2 === 0,
  };
}

type Graph = { ctx: AudioContext; master: GainNode; bus: GainNode; noise: AudioBuffer };

function note(g: Graph, type: OscillatorType, f: number, t: number, dur: number, vel: number, out: AudioNode = g.bus) {
  const o = g.ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  const e = g.ctx.createGain();
  e.gain.setValueAtTime(0.0001, t);
  e.gain.exponentialRampToValueAtTime(vel, t + 0.006);
  e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(e);
  e.connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noiseHit(g: Graph, t: number, dur: number, vel: number, filter: BiquadFilterType, f: number) {
  const src = g.ctx.createBufferSource();
  src.buffer = g.noise;
  const fl = g.ctx.createBiquadFilter();
  fl.type = filter;
  fl.frequency.value = f;
  const e = g.ctx.createGain();
  e.gain.setValueAtTime(vel, t);
  e.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(fl);
  fl.connect(e);
  e.connect(g.bus);
  src.start(t, Math.random());
  src.stop(t + dur + 0.02);
}

function scheduleStep(g: Graph, step: number, t: number) {
  const s = arcadeStep(step);
  const len = arcadeStepSeconds();
  note(g, "square", s.arp, t, len * 0.8, 0.045);
  if (s.lead) note(g, "square", s.lead, t, len * 3, 0.06);
  if (s.bass) note(g, "triangle", s.bass, t, len * 1.8, 0.3);
  if (s.kick) {
    const o = g.ctx.createOscillator();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    const e = g.ctx.createGain();
    e.gain.setValueAtTime(0.5, t);
    e.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(e);
    e.connect(g.bus);
    o.start(t);
    o.stop(t + 0.2);
  }
  if (s.snare) noiseHit(g, t, 0.13, 0.22, "bandpass", 1900);
  if (s.hat) noiseHit(g, t, 0.035, step % 4 === 0 ? 0.1 : 0.06, "highpass", 7000);
}

export class ArcadeMusic {
  private g: Graph | null = null;
  private timer: number | null = null;
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
    const lp = ctx.createBiquadFilter(); // lofi: roll off the harsh top end
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const comp = ctx.createDynamicsCompressor();
    bus.connect(lp);
    lp.connect(master);
    master.connect(comp);
    comp.connect(ctx.destination);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.g = { ctx, master, bus, noise: buf };
    this.apply();
    if (this.active) this.run();
  }

  private level() {
    return this.muted || !this.active ? 0 : this.volume * this.volume * 0.8;
  }

  private apply() {
    if (this.g) this.g.master.gain.setTargetAtTime(this.level(), this.g.ctx.currentTime, 0.08);
  }

  private run() {
    const g = this.g;
    if (!g || this.timer !== null) return;
    this.step = 0;
    this.nextTime = g.ctx.currentTime + 0.1;
    this.timer = window.setInterval(() => {
      if (g.ctx.state === "closed") return;
      if (this.nextTime < g.ctx.currentTime) this.nextTime = g.ctx.currentTime + 0.05; // recover after a stall
      while (this.nextTime < g.ctx.currentTime + 0.2) {
        scheduleStep(g, this.step++, this.nextTime);
        this.nextTime += arcadeStepSeconds();
      }
    }, 25);
  }

  private halt() {
    if (this.timer !== null) { window.clearInterval(this.timer); this.timer = null; }
  }

  /** True while you are on Floor 2: the loop plays; otherwise it is silent and the scheduler is off. */
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
