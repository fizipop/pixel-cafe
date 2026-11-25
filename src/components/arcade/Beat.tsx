"use client";
import { useEffect, useRef, useState } from "react";
import {
  BEAT, DIFFICULTIES, LANES, LANE_KEYS, LANE_NOTES, LEVELS, beansFor, beatMsAt, chartFor, comboMult, judge, newScore, rankOf, scoreRun, scoreStep, songMsFor, trackStep,
  type Difficulty, type Judge, type Level, type Rank, type Score,
} from "@/shared/beat";
import type { RunFinish, RunStart } from "@/shared/protocol";
import { BH, BW, BeatView, LANE_COLORS } from "@/game/beatArt";
import { ArcadeFrame, type ArcadeProps } from "./ui";

const COLORS = LANE_COLORS;
const LEAD_IN_S = 1.6;
const PRESS_WINDOW_MS = 190;
const AUDIO_KEY = "pixelcafe.audio.v1";

function readAudioPrefs() {
  try { const p = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? "null"); if (p && typeof p.volume === "number") return { volume: p.volume as number, muted: !!p.muted }; } catch { /* default */ }
  return { volume: 0.5, muted: false };
}

/** The backing track: kick, snare, hats, bass, arpeggio and pads, scheduled ahead of time so the arrows line up with it. */
class Song {
  ctx: AudioContext;
  startAt: number; // ctx time of song time 0
  private master: GainNode;
  private noise: AudioBuffer;
  private timer: number;
  private step = 0;
  private stepS: number;
  private steps: number;

  constructor(level: Level) {
    this.stepS = beatMsAt(level.bpm) / 4000;
    this.steps = level.bars * 16;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new AC();
    const { volume, muted } = readAudioPrefs();
    this.master = this.ctx.createGain();
    this.master.gain.value = muted ? 0 : volume * volume * 0.8;
    const comp = this.ctx.createDynamicsCompressor();
    this.master.connect(comp); comp.connect(this.ctx.destination);
    this.noise = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.startAt = this.ctx.currentTime + LEAD_IN_S;
    this.timer = window.setInterval(() => {
      while (this.startAt + this.step * this.stepS < this.ctx.currentTime + 0.25 && this.step < this.steps) this.schedule(this.step++);
    }, 25);
  }

  now() { return (this.ctx.currentTime - this.startAt) * 1000; }

  private tone(type: OscillatorType, f: number, t: number, dur: number, vel: number) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vel, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.03);
  }
  private hit(f: number, filter: BiquadFilterType, t: number, dur: number, vel: number) {
    const s = this.ctx.createBufferSource(); s.buffer = this.noise;
    const bq = this.ctx.createBiquadFilter(); bq.type = filter; bq.frequency.value = f;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vel, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(bq); bq.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.02);
  }

  private schedule(step: number) {
    const t = this.startAt + step * this.stepS;
    const s = trackStep(step);
    if (s.kick) { const o = this.ctx.createOscillator(); o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.12); const g = this.ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18); o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.2); }
    if (s.snare) this.hit(1900, "bandpass", t, 0.13, 0.22);
    if (s.hat) this.hit(7000, "highpass", t, 0.035, step % 4 === 0 ? 0.1 : 0.06);
    if (s.bass) this.tone("triangle", s.bass, t, this.stepS * 3, 0.3);
    this.tone("square", s.arp, t, this.stepS * 0.8, 0.035);
    if (s.pad) s.pad.forEach((f) => this.tone("triangle", f, t, this.stepS * 14, 0.025));
  }

  /** A short tone for the arrow you just hit (lane = pitch), so the player "plays" the melody. */
  blip(lane: number, j: Judge) {
    const t = this.ctx.currentTime;
    this.tone("square", LANE_NOTES[lane], t, 0.16, j === "S" ? 0.12 : 0.07);
  }
  miss() { this.hit(400, "lowpass", this.ctx.currentTime, 0.12, 0.2); }

  stop() { window.clearInterval(this.timer); this.ctx.close().catch(() => {}); }
}

/** Beat Battle: four falling arrows, D F J K (or the arrow keys) to hit them on the line, and a tug-of-war with a rival DJ. Pick Easy, Normal, Hard or Insane first. */
export default function Beat({ net, onClose, sfx, announce }: ArcadeProps) {
  const annRef = useRef(announce);
  useEffect(() => { annRef.current = announce; }, [announce]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const song = useRef<Song | null>(null);
  const token = useRef(0);
  const [phase, setPhase] = useState<"menu" | "play" | "done">("menu");
  const [diff, setDiff] = useState<Difficulty>("normal");
  const played = useRef<Difficulty>("normal");
  const [final, setFinal] = useState<{ score: Score; rank: Rank; diff: Difficulty; fin?: RunFinish & { rankLetter: string }; err?: string; failed?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const press = useRef<(lane: number) => void>(() => {});
  const sfxRef = useRef(sfx);
  useEffect(() => { sfxRef.current = sfx; }, [sfx]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const r = await net.call<RunStart>("beat:start", { diff });
    setBusy(false);
    if (!r.ok) { setFinal({ score: newScore(), rank: "D", diff, err: r.reason }); return; }
    played.current = diff;
    token.current = r.token;
    song.current?.stop();
    song.current = new Song(LEVELS[diff]); // created in the click, so the browser lets it play
    setFinal(null);
    setPhase("play");
  };

  useEffect(() => () => { song.current?.stop(); song.current = null; }, []);

  useEffect(() => {
    if (phase !== "play" || !song.current) return;
    const sg = song.current;
    const level = LEVELS[played.current];
    const chart = chartFor(played.current);
    const view = new BeatView();
    const letters: (Judge | null)[] = chart.map(() => null);
    let live = newScore();
    let lastResolved = -1;
    let combo = 0;
    const flash = [0, 0, 0, 0];
    let finished = false;
    annRef.current("GET READY!");

    const resolve = (i: number, j: Judge) => {
      letters[i] = j;
      const gap = i === 0 ? chart[0].t : chart[i].t - chart[i - 1].t;
      live = scoreStep(live, j, gap);
      lastResolved = Math.max(lastResolved, i);
      if (live.combo > combo && live.combo % 25 === 0) sfxRef.current("streak"); // combo milestones
      combo = live.combo;
      if (j === "M") view.onMiss();
    };

    press.current = (lane) => {
      if (finished) return;
      flash[lane] = 1;
      const t = sg.now();
      let best = -1, bd = Infinity;
      for (let i = 0; i < chart.length; i++) {
        if (letters[i] !== null || chart[i].lane !== lane) continue;
        const d = Math.abs(chart[i].t - t);
        if (chart[i].t - t > PRESS_WINDOW_MS) break; // later notes are even further away
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0 || bd > PRESS_WINDOW_MS) return; // a tap with nothing near it does nothing
      const j = judge(t - chart[best].t);
      resolve(best, j);
      if (j === "M") sg.miss(); else { sg.blip(lane, j); view.onHit(lane, j); }
    };

    const keyLane = (code: string) => LANE_KEYS.findIndex((k) => k.includes(code));
    const kd = (e: KeyboardEvent) => { const l = keyLane(e.code); if (l >= 0) { e.preventDefault(); if (!e.repeat) press.current(l); } };
    window.addEventListener("keydown", kd);

    const finish = async () => {
      finished = true;
      const seq = letters.map((l) => l ?? "M").join("");
      const score = scoreRun(seq, chart) ?? live;
      const rank = rankOf(score, chart.length);
      const dd = played.current;
      if (score.failed) { setFinal({ score, rank, diff: dd, failed: true }); setPhase("done"); sfxRef.current("lose"); annRef.current("TRY AGAIN!"); return; }
      const r = await net.call<RunFinish & { rankLetter: string }>("beat:finish", { token: token.current, seq });
      setFinal(r.ok ? { score, rank, diff: dd, fin: r } : { score, rank, diff: dd, err: r.reason });
      if (r.ok && r.beans > 0) sfxRef.current("cashout");
      if (score.miss === 0) annRef.current("FULL COMBO!");
      else if (rank === "S") annRef.current("INCREDIBLE!");
      else if (r.ok && r.best) annRef.current("NEW RECORD!");
      else if (rank === "A" || rank === "B") annRef.current("WINNER!");
      else annRef.current("BETTER LUCK NEXT TIME!");
      setPhase("done");
    };

    let raf = 0;
    const loop = () => {
      const t = sg.now();
      const c = canvas.current?.getContext("2d");
      for (let i = Math.max(0, lastResolved - 4); i < chart.length; i++) {
        if (letters[i] === null && chart[i].t + BEAT.GOOD_MS < t) resolve(i, "M");
        if (chart[i].t > t) break;
      }
      if (c) {
        for (let i = 0; i < 4; i++) flash[i] = Math.max(0, flash[i] - 0.08);
        view.draw(c, { t, level, chart, letters, flash, hype: live.hype, score: live.score, combo, comboMult: comboMult(combo), sick: live.sick, good: live.good, miss: live.miss, maxCombo: live.maxCombo, total: chart.length, names: ["You", "Rival DJ"] });
      }
      if (!finished && (live.failed || t > chart[chart.length - 1].t + 800 || t > songMsFor(played.current) + 2000)) void finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); };
  }, [phase, net]);

  useEffect(() => {
    if (phase === "done") { song.current?.stop(); song.current = null; }
  }, [phase]);

  const chipCol: Record<Difficulty, string> = { easy: "#7fe0a9", normal: "#58e1ff", hard: "#f2a93b", insane: "#ff5fa8" };
  return (
    <ArcadeFrame title="Beat Battle" net={net} onClose={onClose} width="max-w-4xl" accent="text-[#ff5fa8]">
      {phase !== "menu" && (
        <>
          <canvas ref={canvas} width={BW} height={BH} className="mx-auto block w-full max-w-2xl border-4 border-bark bg-espresso" style={{ aspectRatio: `${BW}/${BH}`, touchAction: "none", imageRendering: "pixelated" }} aria-label="Falling arrows" />
          {phase === "play" && (
            <div className="mx-auto mt-2 grid max-w-2xl grid-cols-4 gap-2" role="group" aria-label="Arrow buttons">
              {LANES.map((a, i) => (
                <button key={i} className="px-btn !py-3 !text-2xl" style={{ background: COLORS[i] }} onPointerDown={(e) => { e.preventDefault(); press.current(i); }} aria-label={`Lane ${i + 1}`}>
                  {a}<span className="ml-2 text-sm opacity-70">{["D", "F", "J", "K"][i]}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {phase === "done" && final && (
        <div className="mt-3 text-center" role="status">
          <p className="font-pixel text-5xl text-amber">{final.rank}</p>
          <p className="text-lg" style={{ color: chipCol[final.diff] }}>{LEVELS[final.diff].label} · {LEVELS[final.diff].bpm} BPM</p>
          <p className="text-xl text-cream">{final.score.score.toLocaleString()} points · max combo {final.score.maxCombo} · Sick {final.score.sick} · Good {final.score.good} · Miss {final.score.miss}</p>
          {final.failed && <p className="text-ember">The rival DJ drowned you out. Hit more arrows to keep the hype bar on your side!</p>}
          {final.fin && <p className="text-mint">{final.fin.beans > 0 ? `+${final.fin.beans} Cafe Beans` : "No beans this time"}{final.fin.best ? " · NEW high score!" : ""}{final.fin.rank ? ` · board rank #${final.fin.rank}` : ""}</p>}
          {final.err && <p className="text-ember">{final.err}</p>}
        </div>
      )}
      {phase !== "play" && (
        <div className="mt-3 text-center">
          {phase === "menu" && <p className="mb-3 text-xl text-cream">Hit the falling arrows in time with the track and out-hype the rival DJ. Pick a difficulty, then start the song.</p>}
          {phase === "menu" && final?.err && <p className="mb-2 text-ember" role="alert">{final.err}</p>}
          <div className="mx-auto mb-3 grid max-w-3xl gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Difficulty">
            {DIFFICULTIES.map((d) => {
              const L = LEVELS[d];
              return (
                <button key={d} role="radio" aria-checked={diff === d} className={`px-btn !text-left ${diff === d ? "active" : "secondary"}`} onClick={() => setDiff(d)} style={diff === d ? { outline: `3px solid ${chipCol[d]}` } : undefined}>
                  <b style={{ color: chipCol[d] }}>{L.label}</b>
                  <span className="mt-1 block text-sm opacity-90">{L.blurb}</span>
                  <span className="mt-1 block text-xs opacity-80">{L.bpm} BPM · {chartFor(d).length} arrows · beans ×{L.beanMult}</span>
                </button>
              );
            })}
          </div>
          <button className="px-btn !px-6 !py-3" disabled={busy} onClick={() => void start()}>{phase === "done" ? `Play again (${LEVELS[diff].label})` : `Start the song (${LEVELS[diff].label})`}</button>
          <p className="mt-3 text-sm text-latte">Free to play. Keys: D F J K or the arrow keys (or tap the buttons). Sick! is within 45 ms, Good within 110 ms, otherwise it is a Miss. Combos raise your multiplier up to ×4. On {LEVELS[diff].label}, rank S pays {beansFor("S", diff)} beans (A {beansFor("A", diff)}, B {beansFor("B", diff)}, C {beansFor("C", diff)}); harder levels pay more. High scores go on the leaderboard.</p>
        </div>
      )}
    </ArcadeFrame>
  );
}
