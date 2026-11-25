"use client";
import { useEffect, useRef, useState } from "react";
import { RACE, fmtTime, newRace, positions, raceBeans, stepRace, type Race, type RaceInput } from "@/shared/racer";
import { RacerView, VH, VW } from "@/game/racerArt";
import { mulberry32 } from "@/shared/arcade";
import type { RunFinish, RunStart } from "@/shared/protocol";
import { ArcadeFrame, type ArcadeProps } from "./ui";

const KEYS: Record<string, keyof RaceInput> = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", Space: "drift", ShiftLeft: "drift", ShiftRight: "drift",
};
const ORDINAL = ["1st", "2nd", "3rd"];
const ord = (n: number) => ORDINAL[n - 1] ?? `${n}th`;

/** Neon Drift GP: a behind-the-car 3D race against an 8-car field. Arrow keys / WASD steer, Space or Shift drifts. Your result is checked by the server. */
export default function Racer({ net, onClose, sfx, announce }: ArcadeProps) {
  const annRef = useRef(announce);
  useEffect(() => { annRef.current = announce; }, [announce]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const race = useRef<Race | null>(null);
  const input = useRef<RaceInput>({ left: false, right: false, up: false, down: false, drift: false });
  const token = useRef(0);
  const view = useRef(new RacerView());
  const [phase, setPhase] = useState<"menu" | "race" | "done">("menu");
  const [result, setResult] = useState<{ pos: number; total: number; best: number; fin?: RunFinish; err?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const sfxRef = useRef(sfx);
  useEffect(() => { sfxRef.current = sfx; }, [sfx]);

  const start = async () => {
    if (busy) return;
    setBusy(true);
    const r = await net.call<RunStart>("racer:start");
    setBusy(false);
    if (!r.ok) { setResult({ pos: 0, total: 0, best: 0, err: r.reason }); return; }
    token.current = r.token;
    race.current = newRace(r.token);
    view.current = new RacerView();
    input.current = { left: false, right: false, up: false, down: false, drift: false };
    setResult(null);
    setPhase("race");
  };

  useEffect(() => {
    if (phase !== "race") return;
    const set = (e: KeyboardEvent, down: boolean) => { const k = KEYS[e.code]; if (k) { e.preventDefault(); input.current[k] = down; } };
    const kd = (e: KeyboardEvent) => set(e, true);
    const ku = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const rng = mulberry32(token.current);
    let raf = 0, last = performance.now(), acc = 0, tick = 0, finished = false, wasUp = false, wasDrift = false;
    // the countdown lights: the announcer counts the grid down so "GO!" lands with the green light
    const countdown = window.setTimeout(() => annRef.current("THREE, TWO, ONE! GO!"), Math.max(0, RACE.COUNTDOWN_MS - 2700));
    const STEP = 1000 / 60;
    const loop = (now: number) => {
      const r = race.current;
      const c = canvas.current?.getContext("2d");
      if (r) {
        acc = Math.min(acc + (now - last), 250);
        last = now;
        while (acc >= STEP && !r.done) {
          stepRace(r, input.current, STEP, rng);
          acc -= STEP;
          for (const ev of r.events.splice(0)) {
            sfxRef.current(ev === "boost" ? "whoosh" : ev === "oil" ? "splash" : ev === "lap" ? "ding" : ev === "go" ? "engine" : ev === "scrape" ? "screech" : "clack");
            if (ev === "lap" && r.cars[0].lap === RACE.LAPS - 1) annRef.current("FINAL LAP!");
          }
          // engine rev when you floor it, tyre squeal when a drift starts
          const inp = input.current, me0 = r.cars[0];
          if (inp.up && !wasUp && r.t > RACE.COUNTDOWN_MS) sfxRef.current("engine");
          if (me0.drifting && !wasDrift) sfxRef.current("screech");
          wasUp = inp.up; wasDrift = me0.drifting;
        }
        tick++;
        if (c) view.current.render(c, r, tick);
        if (r.done && !finished) {
          finished = true;
          const me = r.cars[0];
          const pos = positions(r)[0];
          const total = Math.round(me.finishedAt ?? 0), bestLap = Math.round(me.best);
          void net.call<RunFinish>("racer:finish", { token: token.current, totalMs: total, bestLapMs: bestLap, position: pos }).then((f) => {
            setResult(f.ok ? { pos, total, best: bestLap, fin: f } : { pos, total, best: bestLap, err: f.reason });
            if (f.ok && f.beans > 0) sfxRef.current("cashout");
            // the finish: a record beats everything, then first place, a podium, or commiseration
            if (f.ok && f.best) annRef.current("NEW RECORD!");
            else if (pos === 1) annRef.current("FIRST PLACE!");
            else if (pos <= 3) annRef.current("WINNER!");
            else annRef.current("BETTER LUCK NEXT TIME!");
            if (f.ok && f.best && pos === 1) window.setTimeout(() => annRef.current("FIRST PLACE!"), 2200);
            setPhase("done");
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(countdown); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [phase, net]);

  return (
    <ArcadeFrame title="Neon Drift GP" net={net} onClose={onClose} width="max-w-4xl" accent="text-[#f2a93b]">
      {phase === "menu" ? null : (
        <canvas ref={canvas} width={VW} height={VH} className="mx-auto block w-full max-w-3xl border-4 border-bark bg-espresso" style={{ aspectRatio: `${VW}/${VH}` }} aria-label="Race track" />
      )}
      {phase === "race" && <p className="mt-2 text-center text-latte">W/↑ throttle · S/↓ brake · A/D or ←/→ steer · Space/Shift drift (hold through a corner, release the turbo bar for a boost) · cyan pads boost · avoid oil</p>}
      {phase !== "race" && (
        <div className="mt-3 text-center">
          {phase === "done" && result && (
            <div role="status" className="mb-3">
              <p className="text-2xl text-amber">{result.pos ? `You finished ${ord(result.pos)}` : "Race not recorded"}</p>
              {result.pos > 0 && <p className="text-xl text-cream">Time {fmtTime(result.total)} · best lap {fmtTime(result.best)}</p>}
              {result.fin && <p className="text-mint">{result.fin.beans > 0 ? `+${result.fin.beans} Cafe Beans` : "No podium, no beans"}{result.fin.best ? " · NEW personal best lap!" : ""}{result.fin.rank ? ` · lap rank #${result.fin.rank}` : ""}</p>}
              {result.err && <p className="text-ember">{result.err}</p>}
            </div>
          )}
          {phase === "menu" && result?.err && <p className="mb-2 text-ember" role="alert">{result.err}</p>}
          {phase === "menu" && <p className="mb-3 text-xl text-cream">Four laps from 6th on an 8-car grid, with oil slicks, turbo pads and hills. Podium finishes pay Cafe Beans (1st {raceBeans(1)}, 2nd {raceBeans(2)}, 3rd {raceBeans(3)}) and your best lap goes on the leaderboard.</p>}
          <button className="px-btn !px-6 !py-3" disabled={busy} onClick={() => void start()}>{phase === "done" ? "Race again" : "Start the race"}</button>
          <p className="mt-3 text-sm text-latte">Free to play. Controls: W/↑ throttle, S/↓ brake, A/D or ←/→ steer, Space or Shift to drift.</p>
        </div>
      )}
    </ArcadeFrame>
  );
}
