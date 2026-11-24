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
