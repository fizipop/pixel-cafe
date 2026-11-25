// The arcade announcer: short, energetic voice lines spoken with the browser's SpeechSynthesis API, each led in by a
// retro synth stinger from the shared Sfx engine. It is one connected voice for the whole arcade:
//   * lines are only ever triggered by real game events (the games call `say` when something happens)
//   * one line at a time, by priority: a jackpot or a K.O. cuts off a minor "WINNER!", a minor line never interrupts
//     a major one, and the same line can't repeat within its cooldown
//   * it follows the global volume and mute (mute silences speech too) plus its own voice on/off switch
//   * no SpeechSynthesis (or no voices)? It quietly does nothing and the stinger still plays: games never depend on it
//   * stop() cancels anything queued or speaking (a game window closing, the page leaving)

export type AnnounceLine =
  | "WINNER!" | "BIG WIN!" | "JACKPOT!" | "BETTER LUCK NEXT TIME!" | "SO CLOSE!" | "TRY AGAIN!"
  | "ROUND ONE! FIGHT!" | "ROUND TWO! FIGHT!" | "FINAL ROUND! FIGHT!" | "K.O.!" | "PERFECT!" | "YOU WIN!" | "YOU LOSE!"
  | "THREE, TWO, ONE! GO!" | "FINAL LAP!" | "NEW RECORD!" | "FIRST PLACE!"
  | "GET READY!" | "FULL COMBO!" | "INCREDIBLE!"
  | "HUFF AND PUFF BONUS!" | "BONUS!" | "LOTTERY WINNER!" | "PLACE YOUR BETS!";

/** 1 = minor (small wins, gentle commiseration), 2 = notable, 3 = major (jackpots, K.O.s, records, first place). */
export const LINE_PRIORITY: Record<AnnounceLine, 1 | 2 | 3> = {
  "WINNER!": 1, "BETTER LUCK NEXT TIME!": 1, "TRY AGAIN!": 1, "SO CLOSE!": 2, "PLACE YOUR BETS!": 1,
  "BIG WIN!": 2, "JACKPOT!": 3, "LOTTERY WINNER!": 3,
  "ROUND ONE! FIGHT!": 2, "ROUND TWO! FIGHT!": 2, "FINAL ROUND! FIGHT!": 2, "K.O.!": 3, "PERFECT!": 3, "YOU WIN!": 3, "YOU LOSE!": 2,
  "THREE, TWO, ONE! GO!": 2, "FINAL LAP!": 2, "NEW RECORD!": 3, "FIRST PLACE!": 3,
  "GET READY!": 2, "FULL COMBO!": 3, "INCREDIBLE!": 3,
  "HUFF AND PUFF BONUS!": 3, "BONUS!": 3,
};

/** What the rest of the cafe can hear about a line (the arcade crowd reacts to wins and losses). */
export type LineMood = "jackpot" | "big" | "win" | "lose" | "neutral";
export function moodOf(line: AnnounceLine): LineMood {
  switch (line) {
    case "JACKPOT!": case "LOTTERY WINNER!": case "HUFF AND PUFF BONUS!": case "BONUS!": case "NEW RECORD!": case "PERFECT!": return "jackpot";
    case "BIG WIN!": case "FIRST PLACE!": case "FULL COMBO!": case "INCREDIBLE!": return "big";
    case "WINNER!": case "YOU WIN!": return "win";
    case "BETTER LUCK NEXT TIME!": case "SO CLOSE!": case "TRY AGAIN!": case "YOU LOSE!": return "lose";
    default: return "neutral";
  }
}

const COOLDOWN_MS: Partial<Record<AnnounceLine, number>> = { "WINNER!": 5000, "BETTER LUCK NEXT TIME!": 9000, "TRY AGAIN!": 9000, "SO CLOSE!": 6000, "PLACE YOUR BETS!": 20000 };
const DEFAULT_COOLDOWN = 1500;

/** Pure gatekeeping (no browser APIs), so it is unit-tested: may this line start now, given what is playing? */
export class AnnounceQueue {
  private speaking: { line: AnnounceLine; until: number } | null = null;
  private last = new Map<AnnounceLine, number>();

  /** Returns "start" (begin it), "interrupt" (cancel the current line, then begin) or "drop". */
  decide(line: AnnounceLine, now: number): "start" | "interrupt" | "drop" {
    const prio = LINE_PRIORITY[line];
    if (now - (this.last.get(line) ?? -Infinity) < (COOLDOWN_MS[line] ?? DEFAULT_COOLDOWN)) return "drop";
    const cur = this.speaking && this.speaking.until > now ? this.speaking : null;
    if (!cur) return "start";
    return prio > LINE_PRIORITY[cur.line] ? "interrupt" : "drop";
  }

  /** Record that `line` started and roughly how long it will take to say. */
  started(line: AnnounceLine, now: number, ms: number) {
    this.speaking = { line, until: now + ms };
    this.last.set(line, now);
  }

  finished() { this.speaking = null; }
}

/** Rough speaking time: enough to stop the next line from talking over this one. */
export const speechMs = (line: string, rate = 1.05) => (600 + line.length * 62) / rate;

export class Announcer {
  private q = new AnnounceQueue();
  private volume = 0.5;
  private muted = false;
  private enabled = true;
  private ready = false;
  private voice: SpeechSynthesisVoice | null = null;
  private onStinger: (big: boolean) => void;
  private listeners = new Set<(line: AnnounceLine) => void>();

  constructor(onStinger: (big: boolean) => void) {
    this.onStinger = onStinger;
  }

  private get synth(): SpeechSynthesis | null {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function" ? window.speechSynthesis : null;
  }

  /** Call from a user gesture (browser autoplay rules): picks a voice once the list is available. */
  start() {
    if (this.ready) return;
    this.ready = true;
    const s = this.synth;
    if (!s) return;
    const pick = () => {
      try {
        const vs = s.getVoices().filter((v) => v.lang.toLowerCase().startsWith("en"));
        this.voice = vs.find((v) => /male|david|daniel|alex|fred|guy|mark/i.test(v.name)) ?? vs[0] ?? null;
      } catch { this.voice = null; }
    };
    pick();
    try { s.addEventListener?.("voiceschanged", pick); } catch { /* old browsers: fine */ }
  }

  setVolume(v: number) { this.volume = Math.min(1, Math.max(0, v)); }
  setMuted(m: boolean) { this.muted = m; if (m) this.stop(); }
  setEnabled(on: boolean) { this.enabled = on; if (!on) this.stop(); }
  get isEnabled() { return this.enabled; }

  /** Hear about every line that gets announced (the scene uses it to make nearby NPCs react). */
  subscribe(fn: (line: AnnounceLine) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  say(line: AnnounceLine) {
    const now = performance.now();
    const silent = this.muted || this.volume <= 0;
    const d = this.q.decide(line, now);
    if (d === "drop") return;
    for (const fn of this.listeners) fn(line);
    if (silent) { this.q.started(line, now, speechMs(line)); return; }
    const s = this.synth;
    if (d === "interrupt") { try { s?.cancel(); } catch { /* ignore */ } }
    const big = LINE_PRIORITY[line] === 3;
    this.onStinger(big);
    this.q.started(line, now, speechMs(line) + (big ? 420 : 260));
    if (!s || !this.enabled) return;
    const u = new SpeechSynthesisUtterance(line.replace("K.O.", "K. O."));
    u.rate = big ? 1.0 : 1.08;
    u.pitch = big ? 0.75 : 0.9; // a deep, punchy arcade voice
    u.volume = Math.min(1, this.volume * 1.6);
    if (this.voice) u.voice = this.voice;
    u.onend = () => this.q.finished();
    u.onerror = () => this.q.finished();
    // let the stinger land first
    window.setTimeout(() => { if (!this.muted && this.enabled) { try { s.speak(u); } catch { /* ignore */ } } }, big ? 380 : 220);
  }

  /** Silence everything that is speaking or queued (game closed, muted, page leaving). */
  stop() {
    try { this.synth?.cancel(); } catch { /* ignore */ }
    this.q.finished();
  }
}
