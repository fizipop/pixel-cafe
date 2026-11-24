"use client";
import { useEffect, useRef, useState } from "react";
import {
  BEAT, CHART, LANES, LANE_KEYS, LANE_NOTES, RANK_BEANS, SONG_MS, beatMs, judge, newScore, rankOf, scoreRun, scoreStep, trackStep, comboMult,
  type Judge, type Rank, type Score,
} from "@/shared/beat";
import type { RunFinish, RunStart } from "@/shared/protocol";
import { ArcadeFrame, type ArcadeProps } from "./ui";

const W = 480;
const H = 360;
const LANE_X = [120, 180, 240, 300];
const HIT_Y = 300;
const COLORS = ["#ff5fa8", "#58e1ff", "#7fe0a9", "#f2c36b"];
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
  private stepS = beatMs() / 4000;

  constructor() {
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
      while (this.startAt + this.step * this.stepS < this.ctx.currentTime + 0.25 && this.step < BEAT.BARS * 16) this.schedule(this.step++);
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

function arrow(c: CanvasRenderingContext2D, x: number, y: number, lane: number, fill: string, size = 22) {
  // the shape points right by default; rotate so lane 0 faces left, 1 down, 2 up, 3 right
  c.save(); c.translate(x, y); c.rotate([Math.PI, Math.PI / 2, -Math.PI / 2, 0][lane]);
  c.fillStyle = "#05030c"; c.beginPath(); c.moveTo(size, 0); c.lineTo(-size * 0.2, -size); c.lineTo(-size * 0.2, -size * 0.45); c.lineTo(-size, -size * 0.45); c.lineTo(-size, size * 0.45); c.lineTo(-size * 0.2, size * 0.45); c.lineTo(-size * 0.2, size); c.closePath(); c.fill();
  c.fillStyle = fill; const s = size - 4; c.beginPath(); c.moveTo(s, 0); c.lineTo(-s * 0.2, -s); c.lineTo(-s * 0.2, -s * 0.45); c.lineTo(-s, -s * 0.45); c.lineTo(-s, s * 0.45); c.lineTo(-s * 0.2, s * 0.45); c.lineTo(-s * 0.2, s); c.closePath(); c.fill();
  c.restore();
}

type Pop = { text: string; col: string; t: number };

/** Beat Battle: four falling arrows, D F J K (or the arrow keys) to hit them on the line, and a tug-of-war with a rival DJ. */
export default function Beat({ net, onClose, sfx }: ArcadeProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const song = useRef<Song | null>(null);
  const token = useRef(0);
  const [phase, setPhase] = useState<"menu" | "play" | "done">("menu");
  const [final, setFinal] = useState<{ score: Score; rank: Rank; fin?: RunFinish & { rankLetter: string }; err?: string; failed?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const press = useRef<(lane: number) => void>(() => {});
  const sfxRef = useRef(sfx);
  useEffect(() => { sfxRef.current = sfx; }, [sfx]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const r = await net.call<RunStart>("beat:start");
    setBusy(false);
    if (!r.ok) { setFinal({ score: newScore(), rank: "D", err: r.reason }); return; }
    token.current = r.token;
    song.current?.stop();
    song.current = new Song(); // created in the click, so the browser lets it play
    setFinal(null);
    setPhase("play");
  };

  useEffect(() => () => { song.current?.stop(); song.current = null; }, []);

  useEffect(() => {
    if (phase !== "play" || !song.current) return;
    const sg = song.current;
    const letters: (Judge | null)[] = CHART.map(() => null);
    let live = newScore();
    let lastResolved = -1;
    let combo = 0;
    const pops: Pop[] = [];
    const flash = [0, 0, 0, 0];
    let finished = false;

    const resolve = (i: number, j: Judge) => {
      letters[i] = j;
      const gap = i === 0 ? CHART[0].t : CHART[i].t - CHART[i - 1].t;
      live = scoreStep(live, j, gap);
      lastResolved = Math.max(lastResolved, i);
      combo = live.combo;
      pops.push({ text: j === "S" ? "SICK!" : j === "G" ? "GOOD" : "MISS", col: j === "S" ? "#58e1ff" : j === "G" ? "#7fe0a9" : "#d9304a", t: 0 });
      if (pops.length > 3) pops.shift();
    };

    press.current = (lane) => {
      if (finished) return;
      flash[lane] = 1;
      const t = sg.now();
      let best = -1, bd = Infinity;
      for (let i = 0; i < CHART.length; i++) {
        if (letters[i] !== null || CHART[i].lane !== lane) continue;
        const d = Math.abs(CHART[i].t - t);
        if (CHART[i].t - t > PRESS_WINDOW_MS) break; // later notes are even further away
        if (d < bd) { bd = d; best = i; }
      }
      if (best < 0 || bd > PRESS_WINDOW_MS) return; // a tap with nothing near it does nothing
      const j = judge(t - CHART[best].t);
      resolve(best, j);
      if (j === "M") sg.miss(); else sg.blip(lane, j);
    };

    const keyLane = (code: string) => LANE_KEYS.findIndex((k) => k.includes(code));
    const kd = (e: KeyboardEvent) => { const l = keyLane(e.code); if (l >= 0) { e.preventDefault(); if (!e.repeat) press.current(l); } };
    window.addEventListener("keydown", kd);

    const finish = async () => {
      finished = true;
      const seq = letters.map((l) => l ?? "M").join("");
      const score = scoreRun(seq) ?? live;
      const rank = rankOf(score);
      if (score.failed) { setFinal({ score, rank, failed: true }); setPhase("done"); sfxRef.current("lose"); return; }
      const r = await net.call<RunFinish & { rankLetter: string }>("beat:finish", { token: token.current, seq });
      setFinal(r.ok ? { score, rank, fin: r } : { score, rank, err: r.reason });
      if (r.ok && r.beans > 0) sfxRef.current("cashout");
      setPhase("done");
    };

    let raf = 0;
    const loop = () => {
      const t = sg.now();
      const c = canvas.current?.getContext("2d");
      for (let i = Math.max(0, lastResolved - 4); i < CHART.length; i++) {
        if (letters[i] === null && CHART[i].t + BEAT.GOOD_MS < t) resolve(i, "M");
        if (CHART[i].t > t) break;
      }
      if (c) {
        c.clearRect(0, 0, W, H);
        const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#14082a"); g.addColorStop(1, "#2a1050"); c.fillStyle = g; c.fillRect(0, 0, W, H);
        const beatPhase = ((t / beatMs()) % 1 + 1) % 1;
        for (let i = 0; i < 4; i++) { c.fillStyle = `${COLORS[i]}${beatPhase < 0.2 ? "22" : "10"}`; c.fillRect(LANE_X[i] - 28, 0, 56, H); }
        c.fillStyle = "#fff6e044"; c.fillRect(LANE_X[0] - 30, HIT_Y + 2, LANE_X[3] - LANE_X[0] + 60, 2);
        for (let i = 0; i < 4; i++) { flash[i] = Math.max(0, flash[i] - 0.08); arrow(c, LANE_X[i], HIT_Y, i, flash[i] > 0 ? "#fff6e0" : "#3a2a5a"); }
        const speed = (HIT_Y + 30) / BEAT.LOOKAHEAD_MS;
        for (let i = 0; i < CHART.length; i++) {
          const n = CHART[i];
          const y = HIT_Y - (n.t - t) * speed;
          if (y < -40) break;
          if (letters[i] !== null || y > H + 30) continue;
          arrow(c, LANE_X[n.lane], y, n.lane, COLORS[n.lane]);
        }
        // the rival DJ bobs to the beat; he grows bolder as he wins the tug-of-war
        const bob = Math.round(Math.sin(t / beatMs() * Math.PI * 2) * 3);
        const winning = live.hype < 35;
        c.fillStyle = "#05030c"; c.fillRect(372, 70 + bob, 60, 70);
        c.fillStyle = "#ff5fa8"; c.fillRect(376, 100 + bob, 52, 40); // body
        c.fillStyle = "#f1c27d"; c.fillRect(386, 76 + bob, 32, 26); // head
        c.fillStyle = "#05030c"; c.fillRect(384, 84 + bob, 36, 7); c.fillStyle = winning ? "#ff303a" : "#58e1ff"; c.fillRect(388, 86 + bob, 10, 3); c.fillRect(406, 86 + bob, 10, 3); // shades
        c.fillStyle = "#7fe0a9"; c.fillRect(382, 68 + bob, 40, 6); c.fillRect(380, 74 + bob, 6, 18); c.fillRect(418, 74 + bob, 6, 18); // headphones
        c.fillStyle = "#05030c"; c.fillRect(366, 140, 72, 10); c.fillStyle = "#58e1ff"; c.fillRect(372, 143, 24, 4); c.fillStyle = "#f2c36b"; c.fillRect(408, 143, 24, 4);
        // hype bar: you pull it right, the rival pulls it left
        c.fillStyle = "#05030c"; c.fillRect(18, 28, 14, 240);
        c.fillStyle = "#ff5fa8"; c.fillRect(20, 30, 10, 236);
        const h = Math.round((236 * live.hype) / 100);
        c.fillStyle = "#58e1ff"; c.fillRect(20, 30 + 236 - h, 10, h);
        c.font = "16px VT323, monospace"; c.textAlign = "left"; c.fillStyle = "#58e1ff"; c.fillText("YOU", 14, 288); c.fillStyle = "#ff5fa8"; c.fillText("DJ", 16, 22);
        c.textAlign = "center"; c.font = "22px VT323, monospace"; c.fillStyle = "#fff6e0";
        c.fillText(live.score.toLocaleString(), W / 2, 24);
        c.font = "16px VT323, monospace"; c.fillStyle = "#f2c36b"; c.fillText(combo > 1 ? `${combo} COMBO ×${comboMult(combo)}` : "", W / 2, 44);
        for (const p of pops) { p.t++; c.globalAlpha = Math.max(0, 1 - p.t / 40); c.font = "28px VT323, monospace"; c.fillStyle = p.col; c.fillText(p.text, W / 2, HIT_Y - 50 - p.t / 3); c.globalAlpha = 1; }
        if (t < 0) { c.font = "30px VT323, monospace"; c.fillStyle = "#fff6e0"; c.fillText("GET READY", W / 2, 160); }
        if (t > 0 && t < 1500) { c.font = "20px VT323, monospace"; c.fillStyle = "#fff6e0aa"; c.fillText(CHART.length + " arrows · D F J K or ← ↓ ↑ →", W / 2, 340); }
      }
      if (!finished && (live.failed || t > CHART[CHART.length - 1].t + 800 || t > SONG_MS + 2000)) void finish();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); };
  }, [phase, net]);

  useEffect(() => {
    if (phase === "done") { song.current?.stop(); song.current = null; }
  }, [phase]);

  return (
    <ArcadeFrame title="Beat Battle" net={net} onClose={onClose} width="max-w-3xl" accent="text-[#ff5fa8]">
      {phase !== "menu" && (
        <>
          <canvas ref={canvas} width={W} height={H} className="mx-auto block w-full max-w-xl border-4 border-bark bg-espresso" style={{ aspectRatio: `${W}/${H}`, touchAction: "none" }} aria-label="Falling arrows" />
          {phase === "play" && (
            <div className="mx-auto mt-2 grid max-w-xl grid-cols-4 gap-2" role="group" aria-label="Arrow buttons">
              {LANES.map((a, i) => (
                <button key={i} className="px-btn !py-3 !text-2xl" style={{ background: COLORS[i] }} onPointerDown={(e) => { e.preventDefault(); press.current(i); }} aria-label={`Lane ${i + 1}`}>{a}</button>
              ))}
            </div>
          )}
        </>
      )}
      {phase === "done" && final && (
        <div className="mt-3 text-center" role="status">
          <p className="font-pixel text-5xl text-amber">{final.rank}</p>
          <p className="text-xl text-cream">{final.score.score.toLocaleString()} points · max combo {final.score.maxCombo} · Sick {final.score.sick} · Good {final.score.good} · Miss {final.score.miss}</p>
          {final.failed && <p className="text-ember">The rival DJ drowned you out. Hit more arrows to keep the hype bar on your side!</p>}
          {final.fin && <p className="text-mint">{final.fin.beans > 0 ? `+${final.fin.beans} Cafe Beans` : "No beans this time"}{final.fin.best ? " · NEW high score!" : ""}{final.fin.rank ? ` · board rank #${final.fin.rank}` : ""}</p>}
          {final.err && <p className="text-ember">{final.err}</p>}
        </div>
      )}
      {phase !== "play" && (
        <div className="mt-3 text-center">
          {phase === "menu" && <p className="mb-3 text-xl text-cream">Hit the falling arrows in time with the track and out-hype the rival DJ. Rank S pays {RANK_BEANS.S} beans, A {RANK_BEANS.A}, B {RANK_BEANS.B}, C {RANK_BEANS.C}. High scores go on the leaderboard.</p>}
          {phase === "menu" && final?.err && <p className="mb-2 text-ember" role="alert">{final.err}</p>}
          <button className="px-btn !px-6 !py-3" disabled={busy} onClick={() => void start()}>{phase === "done" ? "Play again" : "Start the song"}</button>
          <p className="mt-3 text-sm text-latte">Free to play. Keys: D F J K or the arrow keys (or tap the buttons). Sick! is within 45 ms, Good within 110 ms. Combos raise your multiplier up to ×4.</p>
        </div>
      )}
    </ArcadeFrame>
  );
}
