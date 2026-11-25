import type { SfxName } from "./sfx";
// The arcade announcer: a game-show host voice for the whole arcade, made from free browser APIs only.
//   * the most natural English voice the browser has is picked (neural / natural / online / enhanced voices first,
//     robotic and novelty voices last), and re-picked when the voice list loads
//   * every line is delivered as short, punchy phrases with their own pitch and rate ("ROUND ONE..." then a big "FIGHT!",
//     a rising "JACKPOT!", a sympathetic "Ooh, so close!") instead of one flat read
//   * the voice is backed by synchronised Web Audio show effects from the shared Sfx engine: a riser or drumroll before a
//     big reveal, a brass fanfare and a crowd cheer when it lands, a gasp or an "aww" for a near miss, and a PA chime
//     with slapback echo, so it sounds like an arena or a live game show rather than bare text-to-speech
// It is one connected voice for the whole arcade:
//   * lines are only ever triggered by real game events (the games call `say` when something happens)
//   * one line at a time, by priority: a jackpot or a K.O. cuts off a minor "WINNER!", a minor line never interrupts
//     a major one, and the same line can't repeat within its cooldown
//   * it follows the global volume and mute (mute silences speech too) plus its own voice on/off switch
//   * no SpeechSynthesis (or no voices)? The show effects still play and the voice is simply skipped: games never depend on it
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

/** Rough speaking time for some text at a rate. */
export const speechMs = (line: string, rate = 1.05) => (450 + line.length * 62) / rate;

// ------------------------------------------------------------------ voice choice

export type VoiceInfo = { name: string; lang: string; localService?: boolean };
const NOVELTY = /espeak|robot|compact|novelty|whisper|bad news|bells|boing|bubbles|cellos|zarvox|trinoids|albert|jester|organ|superstar|wobble|fred|ralph|junior|deranged|hysterical|pipe organ/i;

/** How good a voice is for an energetic announcer (higher is better; negative = avoid). Pure, so it is tested. */
export function voiceScore(v: VoiceInfo): number {
  const lang = v.lang.toLowerCase().replace("_", "-");
  if (!lang.startsWith("en")) return -100;
  let s = 0;
  if (/natural|neural/i.test(v.name)) s += 50; // e.g. Microsoft "... Online (Natural)" voices
  if (/online/i.test(v.name)) s += 25;
  if (/enhanced|premium/i.test(v.name)) s += 30; // macOS / iOS high-quality downloads
  if (/google/i.test(v.name)) s += 22; // Chrome's network voices sound far less robotic than the system defaults
  if (lang === "en-us" || lang === "en-gb") s += 10; else s += 4;
  if (/guy|ryan|davis|christopher|eric|aaron|andrew|brian|daniel|alex|tom|oliver|arthur/i.test(v.name)) s += 8; // announcer-ish
  if (v.localService === false) s += 4; // network voices are usually the expressive ones
  if (NOVELTY.test(v.name)) s -= 80;
  return s;
}

/** The best announcer voice in a list (null when there is no English voice at all). */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[]): V | null {
  let best: V | null = null, bs = -Infinity;
  for (const v of voices) { const sc = voiceScore(v); if (sc > bs) { bs = sc; best = v; } }
  return best && bs > -50 ? best : null;
}

// ------------------------------------------------------------------ delivery: phrases and show cues

/** One phrase of a line: what to say and how (pitch 0..2, rate 0.1..10, volume 0..1 relative to the master). */
export type Phrase = { text: string; pitch: number; rate: number; volume?: number };
const P = (text: string, pitch: number, rate: number, volume = 1): Phrase => ({ text, pitch, rate, volume });

/** How each line is performed: build-up phrases low and quick, the payoff high, loud and stretched. */
export const PHRASING: Record<AnnounceLine, Phrase[]> = {
  "WINNER!": [P("We have a...", 1.05, 1.15, 0.85), P("WINNER!", 1.45, 0.9)],
  "BIG WIN!": [P("Oh, look at that!", 1.15, 1.2, 0.9), P("BIG... WIN!", 1.5, 0.85)],
  "JACKPOT!": [P("Ladies and gentlemen...", 0.95, 1.1, 0.85), P("it's a...", 1.15, 1.05, 0.9), P("JACKPOT!", 1.75, 0.78)],
  "BETTER LUCK NEXT TIME!": [P("Ooh, so close!", 1.2, 1.0, 0.8), P("Better luck next time!", 0.95, 0.95, 0.8)],
  "SO CLOSE!": [P("Ooooh...", 1.3, 0.8, 0.85), P("so close!", 1.0, 0.95, 0.85)],
  "TRY AGAIN!": [P("Don't give up!", 1.15, 1.1, 0.85), P("Try again!", 1.3, 0.95, 0.85)],
  "ROUND ONE! FIGHT!": [P("Round one...", 0.85, 0.85), P("FIGHT!", 1.6, 0.9)],
  "ROUND TWO! FIGHT!": [P("Round two...", 0.85, 0.85), P("FIGHT!", 1.6, 0.9)],
  "FINAL ROUND! FIGHT!": [P("Final round...", 0.8, 0.8), P("FIGHT!", 1.7, 0.88)],
  "K.O.!": [P("K... O!", 0.7, 0.75)],
  "PERFECT!": [P("PER-FECT!", 1.55, 0.8)],
  "YOU WIN!": [P("YOU...", 1.2, 0.9), P("WIN!", 1.65, 0.85)],
  "YOU LOSE!": [P("You lose...", 0.8, 0.85, 0.85)],
  "THREE, TWO, ONE! GO!": [P("Three!", 1.0, 0.9), P("Two!", 1.15, 0.9), P("One!", 1.3, 0.9), P("GO GO GO!", 1.7, 1.2)],
  "FINAL LAP!": [P("This is it...", 1.0, 1.1, 0.9), P("FINAL LAP!", 1.5, 0.9)],
  "NEW RECORD!": [P("Unbelievable!", 1.3, 1.1), P("A NEW... RECORD!", 1.6, 0.85)],
  "FIRST PLACE!": [P("Taking the checkered flag...", 1.05, 1.15, 0.9), P("FIRST PLACE!", 1.6, 0.85)],
  "GET READY!": [P("Get ready...", 1.1, 0.95), P("to DANCE!", 1.5, 1.0)],
  "FULL COMBO!": [P("FULL...", 1.3, 0.9), P("COMBO!", 1.75, 0.85)],
  "INCREDIBLE!": [P("IN-CRED-IBLE!", 1.6, 0.85)],
  "HUFF AND PUFF BONUS!": [P("Here comes the...", 1.0, 1.15, 0.9), P("HUFF...", 1.3, 0.85), P("and PUFF...", 1.45, 0.85), P("BONUS!", 1.8, 0.8)],
  "BONUS!": [P("BONUS... ROUND!", 1.6, 0.85)],
  "LOTTERY WINNER!": [P("The numbers match!", 1.2, 1.1), P("We have a LOTTERY... WINNER!", 1.65, 0.85)],
  "PLACE YOUR BETS!": [P("Place your bets!", 1.2, 1.05, 0.85)],
};

/** The show effects around a line: `pre` plays first (the voice waits `leadMs` for it), `hit` lands with the payoff. */
export type ShowCue = { pre: SfxName[]; leadMs: number; hit: SfxName[] };
const hype = (pre: SfxName): ShowCue => ({ pre: [pre], leadMs: pre === "drumroll" ? 1450 : 700, hit: ["fanfareBig", "crowdCheer"] });
export const SHOW_CUES: Record<AnnounceLine, ShowCue> = {
  "WINNER!": { pre: ["stinger"], leadMs: 220, hit: ["fanfare", "crowdCheer"] },
  "BIG WIN!": hype("riser"),
  "JACKPOT!": hype("drumroll"),
  "LOTTERY WINNER!": hype("drumroll"),
  "HUFF AND PUFF BONUS!": hype("riser"),
  "BONUS!": hype("riser"),
  "NEW RECORD!": hype("riser"),
  "FIRST PLACE!": { pre: ["paEcho"], leadMs: 350, hit: ["fanfareBig", "crowdCheer"] },
  "FULL COMBO!": hype("riser"),
  "INCREDIBLE!": { pre: ["stingerBig"], leadMs: 380, hit: ["crowdCheer"] },
  "PERFECT!": { pre: ["paEcho"], leadMs: 320, hit: ["fanfareBig", "crowdCheer"] },
  "YOU WIN!": { pre: ["stingerBig"], leadMs: 380, hit: ["fanfare", "crowdCheer"] },
  "K.O.!": { pre: ["paEcho"], leadMs: 260, hit: ["crowdGasp", "crowdCheer"] },
  "ROUND ONE! FIGHT!": { pre: ["paEcho"], leadMs: 320, hit: ["fanfare"] },
  "ROUND TWO! FIGHT!": { pre: ["paEcho"], leadMs: 320, hit: ["fanfare"] },
  "FINAL ROUND! FIGHT!": { pre: ["drumroll"], leadMs: 1450, hit: ["fanfareBig"] },
  "THREE, TWO, ONE! GO!": { pre: ["paEcho"], leadMs: 300, hit: ["crowdCheer"] },
  "FINAL LAP!": { pre: ["paEcho"], leadMs: 300, hit: ["fanfare"] },
  "GET READY!": { pre: ["paEcho"], leadMs: 300, hit: [] },
  "YOU LOSE!": { pre: ["stinger"], leadMs: 200, hit: ["crowdAww"] },
  "BETTER LUCK NEXT TIME!": { pre: [], leadMs: 0, hit: ["crowdAww"] },
  "SO CLOSE!": { pre: [], leadMs: 0, hit: ["crowdGasp"] },
  "TRY AGAIN!": { pre: ["stinger"], leadMs: 200, hit: [] },
  "PLACE YOUR BETS!": { pre: ["paEcho"], leadMs: 300, hit: [] },
};

/** When (ms after the cue starts) the payoff phrase begins: that is when the fanfare / crowd lands. */
export function hitAtMs(line: AnnounceLine): number {
  const ph = PHRASING[line], cue = SHOW_CUES[line];
  return cue.leadMs + ph.slice(0, -1).reduce((n, p) => n + speechMs(p.text, p.rate), 0);
}
/** How long the whole performance takes (used to keep the next line from talking over it). */
export function performanceMs(line: AnnounceLine): number {
  const ph = PHRASING[line];
  return SHOW_CUES[line].leadMs + ph.reduce((n, p) => n + speechMs(p.text, p.rate), 0) + 250;
}

export class Announcer {
  private q = new AnnounceQueue();
  private volume = 0.5;
  private muted = false;
  private enabled = true;
  private ready = false;
  private voice: SpeechSynthesisVoice | null = null;
  private cue: (name: SfxName) => void;
  private listeners = new Set<(line: AnnounceLine) => void>();
  private timers: number[] = [];

  /** `cue` plays a show effect through the shared Sfx engine (so it follows the SFX switch, volume and mute). */
  constructor(cue: (name: SfxName) => void) {
    this.cue = cue;
  }

  private get synth(): SpeechSynthesis | null {
    return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function" ? window.speechSynthesis : null;
  }

  /** Call from a user gesture (browser autoplay rules): picks the best voice, again whenever the voice list changes. */
  start() {
    if (this.ready) return;
    this.ready = true;
    const s = this.synth;
    if (!s) return;
    const pick = () => { try { this.voice = pickVoice(s.getVoices()); } catch { this.voice = null; } };
    pick();
    try { s.addEventListener?.("voiceschanged", pick); } catch { /* old browsers: fine */ }
    try { if (!s.addEventListener) s.onvoiceschanged = pick; } catch { /* ignore */ }
  }

  setVolume(v: number) { this.volume = Math.min(1, Math.max(0, v)); }
  setMuted(m: boolean) { this.muted = m; if (m) this.stop(); }
  setEnabled(on: boolean) { this.enabled = on; if (!on) this.stop(); }
  get isEnabled() { return this.enabled; }
  /** The voice in use (null: none picked yet, or the browser has none). */
  get voiceName() { return this.voice?.name ?? null; }

  /** Hear about every line that gets announced (the scene uses it to make nearby NPCs react). */
  subscribe(fn: (line: AnnounceLine) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  private later(ms: number, fn: () => void) { this.timers.push(window.setTimeout(fn, ms)); }
  private clearTimers() { for (const t of this.timers) window.clearTimeout(t); this.timers = []; }

  say(line: AnnounceLine) {
    const now = performance.now();
    const d = this.q.decide(line, now);
    if (d === "drop") return;
    for (const fn of this.listeners) fn(line);
    if (this.muted || this.volume <= 0) { this.q.started(line, now, performanceMs(line)); return; }
    const s = this.synth;
    if (d === "interrupt") { this.clearTimers(); try { s?.cancel(); } catch { /* ignore */ } }
    const cue = SHOW_CUES[line], phrases = PHRASING[line];
    this.q.started(line, now, performanceMs(line));
    // the show: the lead-in effect now, the payoff effects when the last phrase lands
    for (const c of cue.pre) this.cue(c);
    const hit = hitAtMs(line);
    for (const c of cue.hit) this.later(hit, () => this.cue(c));
    if (!s || !this.enabled) { this.later(performanceMs(line), () => this.q.finished()); return; }
    this.later(cue.leadMs, () => {
      if (this.muted || !this.enabled) return;
      phrases.forEach((p, i) => {
        const u = new SpeechSynthesisUtterance(p.text.replace(/K\.O\./g, "K. O."));
        u.pitch = Math.min(2, Math.max(0, p.pitch));
        u.rate = Math.min(10, Math.max(0.1, p.rate));
        u.volume = Math.min(1, this.volume * 1.6 * (p.volume ?? 1));
        if (this.voice) u.voice = this.voice;
        if (i === phrases.length - 1) { u.onend = () => this.q.finished(); u.onerror = () => this.q.finished(); }
        try { s.speak(u); } catch { /* ignore */ } // utterances queue up, so the phrases play back to back
      });
    });
  }

  /** Silence everything that is speaking or queued, including pending show effects (game closed, muted, page left). */
  stop() {
    this.clearTimers();
    try { this.synth?.cancel(); } catch { /* ignore */ }
    this.q.finished();
  }
}
