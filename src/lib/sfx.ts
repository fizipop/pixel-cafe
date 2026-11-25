// Tiny procedural sound effects (Web Audio only, no audio files).
// Every effect is a small recipe: oscillators and filtered noise with a quick envelope.
// `Sfx` follows the same volume/mute as the music, and has its own on/off switch.

export type SfxName =
  | "click" | "interact" | "sit" | "stand" | "pour" | "froth" | "ding" | "beans"
  | "purr" | "meow" | "place" | "win" | "lose" | "page" | "gift" | "emote" | "jukebox"
  // Floor 2: arcade
  | "elevator" | "spin" | "reelStop" | "cardFlip" | "chip" | "cashout" | "jump" | "splash" | "boom" | "jackpot"
  // Floor 3: rooftop
  | "twinkle" | "shutter" | "sizzle"
  // Floor 2: fighting, pool, rhythm
  | "punch" | "block" | "ko" | "clack" | "pocket"
  // the shared arcade layer: coins, Plinko, racing, combat, rhythm, draws, bonuses and announcer stingers
  | "coin" | "select" | "peg" | "land" | "engine" | "screech" | "whoosh" | "kick" | "combo" | "beatHit" | "perfect" | "streak"
  | "drawTick" | "drawReveal" | "bonus" | "nearMiss" | "stinger" | "stingerBig"
  // game-show backing for the announcer: brass fanfares, a drumroll, a riser, the crowd, and a PA chime with echo
  | "fanfare" | "fanfareBig" | "drumroll" | "riser" | "crowdCheer" | "crowdGasp" | "crowdAww" | "paEcho";

export const SFX_NAMES: SfxName[] = [
  "click", "interact", "sit", "stand", "pour", "froth", "ding", "beans",
  "purr", "meow", "place", "win", "lose", "page", "gift", "emote", "jukebox",
  "elevator", "spin", "reelStop", "cardFlip", "chip", "cashout", "jump", "splash", "boom", "jackpot",
  "twinkle", "shutter", "sizzle", "punch", "block", "ko", "clack", "pocket",
  "coin", "select", "peg", "land", "engine", "screech", "whoosh", "kick", "combo", "beatHit", "perfect", "streak",
  "drawTick", "drawReveal", "bonus", "nearMiss", "stinger", "stingerBig",
  "fanfare", "fanfareBig", "drumroll", "riser", "crowdCheer", "crowdGasp", "crowdAww", "paEcho",
];

/** Sounds that may legitimately repeat fast (peg bounces, draw ticks) get a shorter repeat guard than the default. */
const MIN_GAP: Partial<Record<SfxName, number>> = { peg: 28, drawTick: 30, beatHit: 30, coin: 35 };
/** At most this many effects may start in any 250 ms window: a burst of events never turns into a wall of noise. */
const BURST_MAX = 6;

type Ctx = BaseAudioContext;
type Recipe = (c: Ctx, out: AudioNode, t: number, noise: AudioBuffer) => void;

type ToneOpts = { type?: OscillatorType; f0: number; f1?: number; dur: number; vel: number; attack?: number };

function tone(c: Ctx, out: AudioNode, t: number, o: ToneOpts) {
  const osc = c.createOscillator();
  osc.type = o.type ?? "sine";
  osc.frequency.setValueAtTime(o.f0, t);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  const g = c.createGain();
  const a = o.attack ?? 0.004;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vel, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  osc.connect(g);
  g.connect(out);
  osc.start(t);
  osc.stop(t + o.dur + 0.03);
}

type NoiseOpts = {
  filter: BiquadFilterType; f0: number; f1?: number; q?: number;
  dur: number; vel: number; attack?: number; offset?: number;
};

function burst(c: Ctx, out: AudioNode, noise: AudioBuffer, t: number, o: NoiseOpts) {
  const src = c.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = o.filter;
  f.frequency.setValueAtTime(o.f0, t);
  if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t + o.dur);
  f.Q.value = o.q ?? 0.8;
  const g = c.createGain();
  const a = o.attack ?? 0.005;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(o.vel, t + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t + o.dur);
  src.connect(f);
  f.connect(g);
  g.connect(out);
  src.start(t, o.offset ?? 0);
  src.stop(t + o.dur + 0.03);
}

/** One brass note: two detuned saws through a lowpass that opens on the attack, with a gentle vibrato. */
function brass(c: Ctx, out: AudioNode, t: number, f: number, dur: number, vel: number) {
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 2;
  lp.frequency.setValueAtTime(f * 1.2, t); lp.frequency.exponentialRampToValueAtTime(f * 6, t + 0.05); lp.frequency.exponentialRampToValueAtTime(f * 2.5, t + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + 0.03); g.gain.setValueAtTime(vel * 0.8, t + dur * 0.7); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  const vib = c.createOscillator(); vib.frequency.value = 5.5;
  const vg = c.createGain(); vg.gain.value = f * 0.008;
  vib.connect(vg);
  for (const det of [-6, 7]) {
    const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; o.detune.value = det;
    vg.connect(o.frequency);
    o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
  }
  lp.connect(g); g.connect(out);
  vib.start(t); vib.stop(t + dur + 0.05);
}
/** A cymbal-ish swell: bright noise rising and fading. */
function swell(c: Ctx, out: AudioNode, t: number, dur: number) {
  const n = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate);
  const d = n.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  burst(c, out, n, t, { filter: "highpass", f0: 4000, dur, vel: 0.1, attack: dur * 0.35 });
}
/** A crowd layer: band-limited noise with a slow random wobble, like many voices at once. */
function crowd(c: Ctx, out: AudioNode, n: AudioBuffer, t: number, f: number, dur: number, vel: number) {
  const src = c.createBufferSource(); src.buffer = n; src.loop = true;
  const bp = c.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 0.8;
  const am = c.createGain(); am.gain.value = 0.7;
  const lfo = c.createOscillator(); lfo.frequency.value = 3 + Math.random() * 4;
  const lg = c.createGain(); lg.gain.value = 0.3; lfo.connect(lg); lg.connect(am.gain);
  const env = c.createGain();
  env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(vel, t + 0.12); env.gain.setValueAtTime(vel, t + dur * 0.6); env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(am); am.connect(env); env.connect(out);
  src.start(t, Math.random()); lfo.start(t); src.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
}

const RECIPES: Record<SfxName, Recipe> = {
  click: (c, out, t) => {
    tone(c, out, t, { f0: 1100, f1: 700, dur: 0.05, vel: 0.22 });
  },
  interact: (c, out, t) => {
    tone(c, out, t, { f0: 520, dur: 0.09, vel: 0.2 });
    tone(c, out, t + 0.07, { f0: 780, dur: 0.12, vel: 0.2 });
  },
  sit: (c, out, t, n) => {
    tone(c, out, t, { f0: 150, f1: 70, dur: 0.16, vel: 0.4 });
    burst(c, out, n, t, { filter: "lowpass", f0: 500, dur: 0.12, vel: 0.2 });
  },
  stand: (c, out, t, n) => {
    tone(c, out, t, { f0: 80, f1: 140, dur: 0.12, vel: 0.3 });
    burst(c, out, n, t, { filter: "lowpass", f0: 600, f1: 300, dur: 0.1, vel: 0.14 });
  },
  pour: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "bandpass", f0: 900, f1: 2300, q: 2, dur: 0.9, vel: 0.35, attack: 0.08 });
    [0.15, 0.4, 0.62, 0.8].forEach((d, i) => tone(c, out, t + d, { f0: 380 + i * 90, f1: 900 + i * 120, dur: 0.09, vel: 0.14 }));
  },
  froth: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "highpass", f0: 3000, f1: 5500, q: 0.7, dur: 0.7, vel: 0.25, attack: 0.25 });
    burst(c, out, n, t + 0.05, { filter: "bandpass", f0: 1500, dur: 0.5, vel: 0.12, attack: 0.2 });
  },
  ding: (c, out, t) => {
    tone(c, out, t, { f0: 1319, dur: 0.7, vel: 0.28, attack: 0.002 });
    tone(c, out, t, { f0: 1976, dur: 0.45, vel: 0.12, attack: 0.002 });
  },
  beans: (c, out, t) => {
    [988, 1319, 1568, 1976].forEach((f, i) => tone(c, out, t + i * 0.06, { f0: f, dur: 0.14, vel: 0.2 }));
  },
  purr: (c, out, t, n) => {
    // low noise, chopped by a ~25 Hz wobble: that rumbly purr
    const src = c.createBufferSource();
    src.buffer = n;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 240;
    const am = c.createGain();
    am.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 24;
    const lfoGain = c.createGain();
    lfoGain.gain.value = 0.5;
    lfo.connect(lfoGain);
    lfoGain.connect(am.gain);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.9, t + 0.25);
    env.gain.setValueAtTime(0.9, t + 1.1);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    src.connect(lp);
    lp.connect(am);
    am.connect(env);
    env.connect(out);
    src.start(t, 0.2);
    lfo.start(t);
    src.stop(t + 1.75);
    lfo.stop(t + 1.75);
  },
  meow: (c, out, t) => {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(520, t);
    o.frequency.linearRampToValueAtTime(900, t + 0.12);
    o.frequency.linearRampToValueAtTime(560, t + 0.4);
    const bp = c.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400;
    bp.Q.value = 1.5;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.3, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(bp);
    bp.connect(g);
    g.connect(out);
    o.start(t);
    o.stop(t + 0.45);
  },
  place: (c, out, t, n) => {
    tone(c, out, t, { f0: 760, f1: 480, dur: 0.07, vel: 0.3 });
    burst(c, out, n, t, { filter: "bandpass", f0: 1300, q: 1.2, dur: 0.05, vel: 0.16 });
  },
  win: (c, out, t) => {
    [523, 659, 784, 1047].forEach((f, i) => {
      tone(c, out, t + i * 0.1, { f0: f, dur: 0.3, vel: 0.2 });
      tone(c, out, t + i * 0.1, { type: "triangle", f0: f * 2, dur: 0.2, vel: 0.06 });
    });
  },
  lose: (c, out, t) => {
    tone(c, out, t, { type: "triangle", f0: 392, dur: 0.28, vel: 0.2 });
    tone(c, out, t + 0.2, { type: "triangle", f0: 294, dur: 0.45, vel: 0.2 });
  },
  page: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "bandpass", f0: 2200, f1: 4200, q: 0.9, dur: 0.16, vel: 0.2, attack: 0.04 });
  },
  gift: (c, out, t) => {
    [659, 880, 1175].forEach((f, i) => tone(c, out, t + i * 0.08, { f0: f, dur: 0.2, vel: 0.2 }));
    tone(c, out, t + 0.3, { f0: 1568, dur: 0.4, vel: 0.14 });
  },
  emote: (c, out, t) => {
    tone(c, out, t, { f0: 600, f1: 1000, dur: 0.07, vel: 0.2 });
  },
  elevator: (c, out, t, n) => {
    tone(c, out, t, { f0: 1175, dur: 0.35, vel: 0.2, attack: 0.002 }); // the "ding"
    tone(c, out, t + 0.3, { f0: 880, dur: 0.4, vel: 0.16, attack: 0.002 });
    tone(c, out, t + 0.7, { type: "triangle", f0: 90, f1: 150, dur: 0.6, vel: 0.2, attack: 0.08 }); // the lift hum
    burst(c, out, n, t + 0.7, { filter: "lowpass", f0: 300, dur: 0.6, vel: 0.06, attack: 0.1 });
  },
  punch: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "lowpass", f0: 1200, f1: 300, dur: 0.12, vel: 0.3, attack: 0.002 });
    tone(c, out, t, { type: "square", f0: 180, f1: 70, dur: 0.1, vel: 0.2 });
  },
  block: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "bandpass", f0: 2400, q: 3, dur: 0.06, vel: 0.2, attack: 0.002 });
    tone(c, out, t, { type: "triangle", f0: 520, f1: 380, dur: 0.07, vel: 0.12 });
  },
  ko: (c, out, t, n) => {
    tone(c, out, t, { type: "sawtooth", f0: 400, f1: 60, dur: 0.6, vel: 0.2 });
    burst(c, out, n, t, { filter: "lowpass", f0: 900, f1: 120, dur: 0.5, vel: 0.25 });
  },
  clack: (c, out, t) => {
    tone(c, out, t, { f0: 1900, f1: 1300, dur: 0.035, vel: 0.22, attack: 0.001 });
    tone(c, out, t + 0.01, { f0: 3100, f1: 2400, dur: 0.025, vel: 0.1, attack: 0.001 });
  },
  pocket: (c, out, t, n) => {
    tone(c, out, t, { type: "triangle", f0: 220, f1: 110, dur: 0.18, vel: 0.2 });
    burst(c, out, n, t + 0.05, { filter: "lowpass", f0: 600, dur: 0.12, vel: 0.12 });
  },
  twinkle: (c, out, t) => {
    // a little rising glissando of star chimes (a wish being made)
    [1568, 1976, 2349, 3136].forEach((f, i) => tone(c, out, t + i * 0.07, { f0: f, dur: 0.5, vel: 0.12, attack: 0.004 }));
    tone(c, out, t + 0.32, { f0: 4186, dur: 0.7, vel: 0.07, attack: 0.004 });
  },
  shutter: (c, out, t, n) => {
    // instant camera: flash whine, mechanical click, then the print whirring out
    tone(c, out, t, { f0: 2400, f1: 5200, dur: 0.12, vel: 0.08, attack: 0.02 });
    burst(c, out, n, t + 0.12, { filter: "bandpass", f0: 3200, q: 1.5, dur: 0.035, vel: 0.3, attack: 0.002 });
    burst(c, out, n, t + 0.17, { filter: "bandpass", f0: 1800, q: 1.5, dur: 0.05, vel: 0.22, attack: 0.002 });
    burst(c, out, n, t + 0.3, { filter: "lowpass", f0: 700, f1: 1400, dur: 0.55, vel: 0.07, attack: 0.08 });
  },
  sizzle: (c, out, t, n) => {
    // a marshmallow over the fire: crackle and fizz
    burst(c, out, n, t, { filter: "highpass", f0: 4500, dur: 0.4, vel: 0.1, attack: 0.02 });
    for (let i = 0; i < 5; i++) burst(c, out, n, t + 0.05 + i * 0.07, { filter: "bandpass", f0: 1500 + i * 400, q: 2, dur: 0.03, vel: 0.2, attack: 0.002 });
  },
  spin: (c, out, t, n) => {
    // a ratchet that slows down: wheel / reel spinning
    for (let i = 0; i < 12; i++) {
      const at = t + i * 0.05 + i * i * 0.0035;
      tone(c, out, at, { type: "square", f0: 900 - i * 25, dur: 0.03, vel: 0.07 });
      if (i % 2 === 0) burst(c, out, n, at, { filter: "bandpass", f0: 2400, q: 2, dur: 0.025, vel: 0.08 });
    }
  },
  reelStop: (c, out, t, n) => {
    tone(c, out, t, { type: "square", f0: 260, f1: 110, dur: 0.1, vel: 0.2 });
    burst(c, out, n, t, { filter: "lowpass", f0: 900, dur: 0.07, vel: 0.14 });
  },
  cardFlip: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "bandpass", f0: 3800, f1: 1800, q: 1.1, dur: 0.1, vel: 0.28, attack: 0.008 });
    burst(c, out, n, t + 0.07, { filter: "highpass", f0: 5000, dur: 0.04, vel: 0.1 });
    tone(c, out, t + 0.085, { f0: 420, f1: 260, dur: 0.04, vel: 0.1 });
  },
  chip: (c, out, t, n) => {
    tone(c, out, t, { f0: 2100, f1: 1500, dur: 0.045, vel: 0.2 });
    tone(c, out, t + 0.045, { f0: 2600, f1: 1900, dur: 0.05, vel: 0.14 });
    burst(c, out, n, t, { filter: "bandpass", f0: 3000, q: 2, dur: 0.03, vel: 0.1 });
  },
  cashout: (c, out, t) => {
    // cash-register "cha-ching": two bell strikes then a coin shower
    tone(c, out, t, { f0: 1568, dur: 0.12, vel: 0.2, attack: 0.002 });
    tone(c, out, t + 0.09, { f0: 2093, dur: 0.5, vel: 0.22, attack: 0.002 });
    tone(c, out, t + 0.09, { f0: 3136, dur: 0.3, vel: 0.08, attack: 0.002 });
    [0.26, 0.31, 0.36, 0.41, 0.45].forEach((d, i) => tone(c, out, t + d, { f0: 1760 + i * 180, f1: 1300 + i * 140, dur: 0.07, vel: 0.1 }));
  },
  jump: (c, out, t) => {
    tone(c, out, t, { f0: 300, f1: 680, dur: 0.13, vel: 0.22 });
    tone(c, out, t + 0.05, { type: "triangle", f0: 700, f1: 1100, dur: 0.08, vel: 0.1 });
  },
  splash: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "lowpass", f0: 2600, f1: 300, q: 0.7, dur: 0.5, vel: 0.35, attack: 0.01 });
    tone(c, out, t, { f0: 200, f1: 70, dur: 0.25, vel: 0.2 });
  },
  boom: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "lowpass", f0: 900, f1: 90, q: 0.8, dur: 0.6, vel: 0.5, attack: 0.005 });
    tone(c, out, t, { type: "triangle", f0: 150, f1: 38, dur: 0.5, vel: 0.4 });
  },
  jackpot: (c, out, t) => {
    [523, 659, 784, 1047, 1319, 1568, 2093].forEach((f, i) => {
      tone(c, out, t + i * 0.07, { f0: f, dur: 0.3, vel: 0.18 });
      tone(c, out, t + i * 0.07, { type: "triangle", f0: f * 2, dur: 0.2, vel: 0.06 });
    });
    tone(c, out, t + 0.55, { f0: 2093, dur: 0.9, vel: 0.2, attack: 0.002 });
  },
  coin: (c, out, t) => {
    // a bean / coin clink: two bright partials and a little ring
    tone(c, out, t, { type: "square", f0: 1976, dur: 0.05, vel: 0.1 });
    tone(c, out, t + 0.045, { f0: 2637, dur: 0.22, vel: 0.14, attack: 0.002 });
    tone(c, out, t + 0.045, { f0: 3951, dur: 0.12, vel: 0.05, attack: 0.002 });
  },
  select: (c, out, t) => {
    tone(c, out, t, { type: "square", f0: 660, dur: 0.05, vel: 0.08 });
    tone(c, out, t + 0.05, { type: "square", f0: 990, dur: 0.07, vel: 0.08 });
  },
  peg: (c, out, t) => {
    // a tiny glassy tick, pitch nudged each time so a cascade of bounces sounds like a ball rattling down
    const f = 1500 + Math.random() * 900;
    tone(c, out, t, { type: "triangle", f0: f, f1: f * 0.8, dur: 0.05, vel: 0.12, attack: 0.001 });
  },
  land: (c, out, t, n) => {
    tone(c, out, t, { type: "triangle", f0: 330, f1: 160, dur: 0.18, vel: 0.22 });
    burst(c, out, n, t, { filter: "bandpass", f0: 1200, q: 1.4, dur: 0.08, vel: 0.12 });
    tone(c, out, t + 0.12, { f0: 1319, dur: 0.25, vel: 0.12 });
  },
  engine: (c, out, t) => {
    // a short rev: a sawtooth growl that climbs and falls back
    const o = c.createOscillator(); o.type = "sawtooth";
    o.frequency.setValueAtTime(70, t); o.frequency.exponentialRampToValueAtTime(190, t + 0.28); o.frequency.exponentialRampToValueAtTime(110, t + 0.55);
    const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 900;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.05); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(lp); lp.connect(g); g.connect(out); o.start(t); o.stop(t + 0.62);
  },
  screech: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "bandpass", f0: 2600, f1: 1900, q: 9, dur: 0.45, vel: 0.16, attack: 0.03 });
    tone(c, out, t, { type: "sawtooth", f0: 1250, f1: 980, dur: 0.4, vel: 0.03, attack: 0.03 });
  },
  whoosh: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "bandpass", f0: 400, f1: 3200, q: 1.2, dur: 0.45, vel: 0.3, attack: 0.12 });
    tone(c, out, t, { type: "triangle", f0: 200, f1: 900, dur: 0.35, vel: 0.08 });
  },
  kick: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "lowpass", f0: 1800, f1: 260, dur: 0.16, vel: 0.32, attack: 0.002 });
    tone(c, out, t, { type: "square", f0: 120, f1: 45, dur: 0.16, vel: 0.24 });
    burst(c, out, n, t, { filter: "highpass", f0: 3000, dur: 0.05, vel: 0.12 });
  },
  combo: (c, out, t) => {
    [784, 988, 1175, 1568].forEach((f, i) => tone(c, out, t + i * 0.04, { type: "square", f0: f, dur: 0.06, vel: 0.07 }));
  },
  beatHit: (c, out, t) => {
    tone(c, out, t, { type: "square", f0: 880, f1: 660, dur: 0.05, vel: 0.08 });
  },
  perfect: (c, out, t) => {
    tone(c, out, t, { type: "square", f0: 1319, dur: 0.06, vel: 0.08 });
    tone(c, out, t + 0.03, { f0: 2637, dur: 0.12, vel: 0.08, attack: 0.002 });
  },
  streak: (c, out, t) => {
    [523, 784, 1047, 1568, 2093].forEach((f, i) => tone(c, out, t + i * 0.05, { type: "square", f0: f, dur: 0.08, vel: 0.07 }));
  },
  drawTick: (c, out, t) => {
    tone(c, out, t, { type: "square", f0: 1200 + Math.random() * 400, dur: 0.025, vel: 0.06, attack: 0.001 });
  },
  drawReveal: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "highpass", f0: 3000, dur: 0.2, vel: 0.12 });
    tone(c, out, t, { type: "square", f0: 392, dur: 0.12, vel: 0.12 });
    tone(c, out, t + 0.12, { type: "square", f0: 784, dur: 0.3, vel: 0.12 });
  },
  bonus: (c, out, t) => {
    // a wind-up ratchet that springs into a fanfare
    for (let i = 0; i < 8; i++) tone(c, out, t + i * 0.045, { type: "square", f0: 300 + i * 70, dur: 0.03, vel: 0.08 });
    [784, 988, 1175, 1568, 1976].forEach((f, i) => tone(c, out, t + 0.4 + i * 0.07, { f0: f, dur: 0.3, vel: 0.15 }));
  },
  nearMiss: (c, out, t) => {
    tone(c, out, t, { type: "square", f0: 784, dur: 0.1, vel: 0.1 });
    tone(c, out, t + 0.1, { type: "square", f0: 740, f1: 520, dur: 0.35, vel: 0.1 });
  },
  stinger: (c, out, t) => {
    // the short synth chime that leads into an announcer line
    tone(c, out, t, { type: "square", f0: 659, dur: 0.08, vel: 0.09 });
    tone(c, out, t + 0.08, { type: "square", f0: 988, dur: 0.16, vel: 0.09 });
  },
  stingerBig: (c, out, t) => {
    [523, 659, 784, 1047].forEach((f, i) => tone(c, out, t + i * 0.06, { type: "square", f0: f, dur: 0.12, vel: 0.1 }));
    tone(c, out, t + 0.26, { type: "sawtooth", f0: 1047, dur: 0.4, vel: 0.06 });
  },
  fanfare: (c, out, t) => {
    // a short brass call: stacked saws through a warm filter, a little vibrato, a rising triad
    [[392, 0], [523, 0.12], [659, 0.24], [784, 0.36]].forEach(([f, d], i) => brass(c, out, t + d, f, i === 3 ? 0.55 : 0.16, 0.13));
  },
  fanfareBig: (c, out, t) => {
    // the full show fanfare: a triplet pickup into a held major chord with a cymbal swell
    [[523, 0], [523, 0.09], [523, 0.18], [659, 0.3]].forEach(([f, d]) => brass(c, out, t + d, f, 0.1, 0.12));
    for (const f of [523, 659, 784, 1047]) brass(c, out, t + 0.44, f, 0.9, 0.09);
    swell(c, out, t + 0.3, 1.1);
  },
  drumroll: (c, out, t, n) => {
    // a snare roll that speeds up and swells, ending on a crash: the "and the winner is..." moment
    let at = t;
    for (let i = 0; i < 26; i++) {
      const gap = 0.055 - i * 0.0012;
      burst(c, out, n, at, { filter: "bandpass", f0: 1800, q: 0.9, dur: 0.05, vel: 0.06 + i * 0.006, attack: 0.002 });
      at += gap;
    }
    burst(c, out, n, at + 0.02, { filter: "highpass", f0: 5000, dur: 0.6, vel: 0.22, attack: 0.003 }); // the crash
    tone(c, out, at + 0.02, { type: "triangle", f0: 110, f1: 55, dur: 0.3, vel: 0.25 }); // and a kick under it
  },
  riser: (c, out, t, n) => {
    // a sweeping noise riser with a climbing tone underneath: tension before a reveal
    burst(c, out, n, t, { filter: "bandpass", f0: 300, f1: 6000, q: 2, dur: 0.75, vel: 0.18, attack: 0.6 });
    tone(c, out, t, { type: "sawtooth", f0: 180, f1: 880, dur: 0.75, vel: 0.05, attack: 0.5 });
  },
  crowdCheer: (c, out, t, n) => {
    // a crowd roar: several overlapping filtered-noise "voices" with a wobbling swell, plus a few whoops
    for (let k = 0; k < 4; k++) crowd(c, out, n, t + k * 0.04, 700 + k * 380, 1.4, 0.07);
    for (let k = 0; k < 3; k++) tone(c, out, t + 0.15 + k * 0.22, { type: "triangle", f0: 600 + k * 90, f1: 1100 + k * 80, dur: 0.18, vel: 0.03 });
  },
  crowdGasp: (c, out, t, n) => {
    // a sharp intake of breath from the crowd: a short noise swell that drops in pitch
    burst(c, out, n, t, { filter: "bandpass", f0: 2400, f1: 900, q: 1.4, dur: 0.45, vel: 0.12, attack: 0.08 });
    burst(c, out, n, t + 0.02, { filter: "bandpass", f0: 1500, f1: 600, q: 1.2, dur: 0.4, vel: 0.08, attack: 0.1 });
  },
  crowdAww: (c, out, t, n) => {
    // a sympathetic "awww": a soft vowel-like hum that sags downward over a murmur
    for (const f of [220, 277, 330]) tone(c, out, t, { type: "sawtooth", f0: f * 1.1, f1: f * 0.8, dur: 0.8, vel: 0.02, attack: 0.15 });
    crowd(c, out, n, t, 600, 0.8, 0.05);
  },
  paEcho: (c, out, t) => {
    // the arena PA chime: two bell tones, fed through a slapback delay so it rings like a big room
    const d = c.createDelay(1);
    d.delayTime.value = 0.13;
    const fb = c.createGain(); fb.gain.value = 0.42;
    const wet = c.createGain(); wet.gain.value = 0.6;
    d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(out);
    const send = c.createGain(); send.gain.value = 1;
    send.connect(out); send.connect(d);
    tone(c, send, t, { f0: 988, dur: 0.35, vel: 0.14, attack: 0.002 });
    tone(c, send, t + 0.16, { f0: 1319, dur: 0.5, vel: 0.12, attack: 0.002 });
    globalThis.setTimeout(() => { try { fb.disconnect(); d.disconnect(); wet.disconnect(); send.disconnect(); } catch { /* already gone */ } }, 2500); // tidy up the feedback loop
  },
  jukebox: (c, out, t, n) => {
    burst(c, out, n, t, { filter: "highpass", f0: 2500, dur: 0.3, vel: 0.12, attack: 0.02 });
    tone(c, out, t + 0.04, { type: "triangle", f0: 180, f1: 420, dur: 0.3, vel: 0.22 });
  },
};

/** Schedule one effect on any audio context (used live and for offline tests). */
export function playRecipe(c: Ctx, out: AudioNode, name: SfxName, t: number, noise: AudioBuffer) {
  RECIPES[name](c, out, t, noise);
}

export function makeNoise(c: Ctx, seconds = 2): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/** Live player. start() must run inside a user gesture (browser autoplay rules). */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  private volume = 0.5;
  private muted = false;
  private enabled = true;

  start() {
    if (this.ctx) {
      this.ctx.resume().catch(() => {});
      return;
    }
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp);
    comp.connect(this.ctx.destination);
    this.noise = makeNoise(this.ctx);
    this.applyVolume();
  }

  private applyVolume() {
    if (!this.ctx || !this.master) return;
    // same curve as the music so the one volume slider feels the same for both
    const level = this.muted || !this.enabled ? 0 : this.volume * this.volume * 1.4;
    this.master.gain.setTargetAtTime(level, this.ctx.currentTime, 0.03);
  }

  setVolume(v: number) {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyVolume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyVolume();
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.applyVolume();
  }

  get isEnabled() {
    return this.enabled;
  }

  play(name: SfxName) {
    const { ctx, master, noise } = this;
    if (!ctx || !master || !noise || !this.enabled || this.muted || this.volume <= 0) return;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const now = performance.now();
    if (now - (this.last.get(name) ?? 0) < (MIN_GAP[name] ?? 45)) return; // never machine-gun the same sound
    this.recent = this.recent.filter((t) => now - t < 250);
    if (this.recent.length >= BURST_MAX) return; // too many different effects at once: drop this one
    this.recent.push(now);
    this.last.set(name, now);
    RECIPES[name](ctx, master, ctx.currentTime + 0.005, noise);
  }
  private recent: number[] = [];

  stop() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }
}
