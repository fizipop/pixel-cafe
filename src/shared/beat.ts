// Beat Battle: a four-lane arrow rhythm game against a rival DJ. The chart is generated from a fixed seed,
// so the browser, the server and the tests all see the same notes. The final score is always recomputed
// from the list of judgements (one letter per note), which is what the server checks before paying out.

export const BEAT = {
  BPM: 128, BARS: 28, FIRST_BAR: 2, // two bars of intro before the first arrow
  SICK_MS: 45, GOOD_MS: 110, LOOKAHEAD_MS: 1700, // how long an arrow takes to fall to the line
  SICK: 350, GOOD: 200, HYPE_SICK: 4, HYPE_GOOD: 2, HYPE_MISS: -9, RIVAL_DRAIN: 1.1, // hype per second the rival takes back
} as const;

export const beatMs = () => 60000 / BEAT.BPM;
export const SONG_MS = Math.round(BEAT.BARS * 4 * beatMs());
export const LANES = ["←", "↓", "↑", "→"] as const;
export const LANE_KEYS = [["ArrowLeft", "KeyD"], ["ArrowDown", "KeyF"], ["ArrowUp", "KeyJ"], ["ArrowRight", "KeyK"]];

export type Note = { t: number; lane: 0 | 1 | 2 | 3 };

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The song's arrows: denser as it goes, a rest on the last bar. Same notes every time. */
export function buildChart(seed = 7): Note[] {
  const rng = mulberry(seed);
  const notes: Note[] = [];
  let lane = 1;
  for (let bar = BEAT.FIRST_BAR; bar < BEAT.BARS - 1; bar++) {
    const heat = (bar - BEAT.FIRST_BAR) / (BEAT.BARS - BEAT.FIRST_BAR);
    for (let step = 0; step < 8; step++) { // eighth notes
      const onBeat = step % 2 === 0;
      const p = onBeat ? 0.8 + heat * 0.2 : 0.4 + heat * 0.5;
      if (rng() > p) continue;
      let next = Math.floor(rng() * 4);
      if (next === lane && rng() < 0.55) next = (next + 1 + Math.floor(rng() * 3)) % 4; // mostly move around
      lane = next;
      notes.push({ t: Math.round((bar * 4 + step / 2) * beatMs()), lane: lane as 0 | 1 | 2 | 3 });
    }
  }
  return notes;
}
export const CHART: Note[] = buildChart();

// ------------------------------------------------------------------ difficulty levels

export type Difficulty = "easy" | "normal" | "hard" | "insane";
export const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "insane"];
export const isDifficulty = (d: unknown): d is Difficulty => typeof d === "string" && (DIFFICULTIES as string[]).includes(d);

/** What a level changes: tempo, song length, how long an arrow takes to fall (scroll speed), the bean multiplier, and how busy the chart is. */
export type Level = {
  id: Difficulty; label: string; blurb: string; bpm: number; bars: number; lookahead: number; beanMult: number;
  seed: number;
  on: [number, number]; off: [number, number]; dbl: [number, number]; stream: [number, number]; // [start, extra by the last bar] chance per slot
};
export const LEVELS: Record<Difficulty, Level> = {
  easy: { id: "easy", label: "Easy", blurb: "Slow 96 BPM, one arrow at a time, lots of time to read.", bpm: 96, bars: 24, lookahead: 2100, beanMult: 0.5, seed: 3, on: [0.78, 0.22], off: [0.04, 0.2], dbl: [0, 0], stream: [0, 0] },
  normal: { id: "normal", label: "Normal", blurb: "128 BPM eighth-note runs that build as the song heats up.", bpm: BEAT.BPM, bars: BEAT.BARS, lookahead: BEAT.LOOKAHEAD_MS, beanMult: 1, seed: 7, on: [0.8, 0.2], off: [0.4, 0.5], dbl: [0, 0], stream: [0, 0] },
  hard: { id: "hard", label: "Hard", blurb: "144 BPM, faster scroll, double arrows and short 16th-note streams.", bpm: 144, bars: 32, lookahead: 1400, beanMult: 1.5, seed: 11, on: [0.92, 0.08], off: [0.55, 0.4], dbl: [0.06, 0.14], stream: [0.08, 0.16] },
  insane: { id: "insane", label: "Insane", blurb: "168 BPM, lightning scroll, constant doubles and long streams.", bpm: 168, bars: 36, lookahead: 1100, beanMult: 2, seed: 19, on: [0.97, 0.03], off: [0.72, 0.25], dbl: [0.15, 0.22], stream: [0.18, 0.25] },
};
export const levelOf = (d: Difficulty) => LEVELS[d];
export const beatMsAt = (bpm: number) => 60000 / bpm;
export const songMsFor = (d: Difficulty) => Math.round(LEVELS[d].bars * 4 * beatMsAt(LEVELS[d].bpm));

const charts = new Map<Difficulty, Note[]>();
/** The chart for a level. Normal is the original chart; the others are generated from their own fixed seeds (doubles share a timestamp). */
export function chartFor(d: Difficulty): Note[] {
  const hit = charts.get(d);
  if (hit) return hit;
  let notes: Note[];
  if (d === "normal") notes = CHART;
  else {
    const L = LEVELS[d], rng = mulberry(L.seed), beat = beatMsAt(L.bpm);
    notes = [];
    let lane = 1, skip = false;
    const pick = (avoid: number[]) => { let n = Math.floor(rng() * 4); if (avoid.includes(n)) n = (n + 1 + Math.floor(rng() * 3)) % 4; if (avoid.includes(n)) n = [0, 1, 2, 3].find((k) => !avoid.includes(k))!; return n; };
    for (let bar = BEAT.FIRST_BAR; bar < L.bars - 1; bar++) {
      const heat = (bar - BEAT.FIRST_BAR) / (L.bars - BEAT.FIRST_BAR);
      for (let step = 0; step < 8; step++) {
        if (skip) { skip = false; continue; } // a stream already used this slot
        const onBeat = step % 2 === 0;
        const [a, b] = onBeat ? L.on : L.off;
        if (rng() > a + heat * b) continue;
        const t0 = (bar * 4 + step / 2) * beat;
        lane = pick(rng() < 0.55 ? [lane] : []);
        notes.push({ t: Math.round(t0), lane: lane as Note["lane"] });
        if (onBeat && rng() < L.dbl[0] + heat * L.dbl[1]) notes.push({ t: Math.round(t0), lane: pick([lane]) as Note["lane"] }); // a double: two arrows together
        else if (onBeat && step < 6 && rng() < L.stream[0] + heat * L.stream[1]) { // a stream: four 16ths walking across the lanes
          const dir = rng() < 0.5 ? 1 : 3;
          for (let k = 1; k <= 3; k++) { lane = (lane + dir) % 4; notes.push({ t: Math.round(t0 + (beat / 4) * k), lane: lane as Note["lane"] }); }
          skip = true;
        }
      }
      skip = false;
    }
  }
  charts.set(d, notes);
  return notes;
}
export const beansFor = (letter: Rank, d: Difficulty) => Math.round(RANK_BEANS[letter] * LEVELS[d].beanMult);

export type Judge = "S" | "G" | "M"; // Sick! / Good / Miss
/** Judge a press `deltaMs` away from the note (negative = early). */
export const judge = (deltaMs: number): Judge => (Math.abs(deltaMs) <= BEAT.SICK_MS ? "S" : Math.abs(deltaMs) <= BEAT.GOOD_MS ? "G" : "M");

export type Score = { score: number; combo: number; maxCombo: number; sick: number; good: number; miss: number; hype: number; failed: boolean };
export const newScore = (): Score => ({ score: 0, combo: 0, maxCombo: 0, sick: 0, good: 0, miss: 0, hype: 50, failed: false });
export const comboMult = (combo: number) => 1 + Math.min(3, Math.floor(combo / 10));

/** Fold one judgement into the score. `gapMs` is the time since the previous note (the rival pushes the hype bar back meanwhile). */
export function scoreStep(s: Score, j: Judge, gapMs: number): Score {
  if (s.failed) return s;
  const n = { ...s };
  n.hype = Math.min(100, n.hype - (BEAT.RIVAL_DRAIN * gapMs) / 1000);
  if (j === "M") { n.miss++; n.combo = 0; n.hype += BEAT.HYPE_MISS; }
  else {
    n.combo++;
    n.maxCombo = Math.max(n.maxCombo, n.combo);
    n.score += (j === "S" ? BEAT.SICK : BEAT.GOOD) * comboMult(n.combo - 1);
    if (j === "S") { n.sick++; n.hype += BEAT.HYPE_SICK; } else { n.good++; n.hype += BEAT.HYPE_GOOD; }
    n.hype = Math.min(100, n.hype);
  }
  if (n.hype <= 0) { n.hype = 0; n.failed = true; }
  return n;
}

/** Replay a full run from its judgement string (one letter per note, in chart order). Null if the string is malformed. */
export function scoreRun(seq: unknown, chart: Note[] = CHART): Score | null {
  if (typeof seq !== "string" || seq.length !== chart.length || !/^[SGM]+$/.test(seq)) return null;
  let s = newScore();
  for (let i = 0; i < seq.length; i++) s = scoreStep(s, seq[i] as Judge, i === 0 ? chart[0].t : chart[i].t - chart[i - 1].t);
  return s;
}

export type Rank = "S" | "A" | "B" | "C" | "D";
export const accuracy = (s: Score, total = CHART.length) => (s.sick + s.good * 0.6) / Math.max(1, total);
export function rankOf(s: Score, total = CHART.length): Rank {
  if (s.failed) return "D";
  const a = accuracy(s, total);
  return a >= 0.93 ? "S" : a >= 0.82 ? "A" : a >= 0.65 ? "B" : a >= 0.4 ? "C" : "D";
}
export const RANK_BEANS: Record<Rank, number> = { S: 25, A: 15, B: 8, C: 3, D: 0 };

// ------------------------------------------------------------------ the backing track (pure, so it can be tested)

const midi = (m: number) => 440 * Math.pow(2, (m - 69) / 12);
const PROG = [{ root: 45, third: 3 }, { root: 41, third: 4 }, { root: 48, third: 4 }, { root: 43, third: 4 }]; // Am F C G
export const LANE_NOTES = [midi(69), midi(72), midi(76), midi(79)]; // A4 C5 E5 G5: the tone each arrow plays when you hit it

export type TrackStep = { kick: boolean; snare: boolean; hat: boolean; bass: number | null; arp: number; pad: number[] | null };
/** What the backing track plays on a 16th-note step (the loop is 4 bars; the song plays it 7 times). */
export function trackStep(step: number): TrackStep {
  const s = ((step % 64) + 64) % 64;
  const bar = Math.floor(s / 16), i = s % 16;
  const { root, third } = PROG[bar];
  const tones = [0, third, 7, 12];
  return {
    kick: i % 4 === 0 || i === 10,
    snare: i === 4 || i === 12,
    hat: i % 2 === 0,
    bass: i % 4 === 0 || i === 10 ? midi(root - 12 + (i === 10 ? 7 : 0)) : null,
    arp: midi(root + 12 + tones[[0, 1, 2, 3, 2, 1, 2, 1][i % 8]]),
    pad: i === 0 ? [root + 12, root + 12 + third, root + 19].map(midi) : null,
  };
}
