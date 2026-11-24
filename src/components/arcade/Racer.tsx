"use client";
import { useEffect, useRef, useState } from "react";
import { RACE, fmtTime, newRace, positions, raceBeans, stepRace, track, type Car, type Race, type RaceInput } from "@/shared/racer";
import { mulberry32 } from "@/shared/arcade";
import type { RunFinish, RunStart } from "@/shared/protocol";
import { ArcadeFrame, type ArcadeProps } from "./ui";

const VW = 640;
const VH = 400;
const KEYS: Record<string, keyof RaceInput> = {
  KeyW: "up", ArrowUp: "up", KeyS: "down", ArrowDown: "down", KeyA: "left", ArrowLeft: "left", KeyD: "right", ArrowRight: "right", Space: "drift",
};
const ORDINAL = ["1st", "2nd", "3rd", "4th"];

function drawCar(c: CanvasRenderingContext2D, car: Car) {
  c.save();
  c.translate(car.x, car.y);
  c.rotate(car.angle);
  if (car.boost > 0) { c.fillStyle = "#58e1ffaa"; c.fillRect(-26, -4, 14, 8); c.fillStyle = "#fff6e0"; c.fillRect(-20, -2, 8, 4); }
  if (car.drifting) { c.fillStyle = "#ffffff55"; c.fillRect(-14, -9, 6, 4); c.fillRect(-14, 5, 6, 4); }
  c.fillStyle = "#00000055"; c.fillRect(-12, -6, 26, 14);
  c.fillStyle = "#0a0716"; c.fillRect(-13, -7, 26, 14); // body outline
  c.fillStyle = car.color; c.fillRect(-12, -6, 24, 12);
  c.fillStyle = "#0a0716"; c.fillRect(-14, -9, 6, 4); c.fillRect(-14, 5, 6, 4); c.fillRect(7, -9, 6, 4); c.fillRect(7, 5, 6, 4); // wheels
  c.fillStyle = "#1f3a5a"; c.fillRect(0, -4, 6, 8); // windscreen
  c.fillStyle = "#fff6e0"; c.fillRect(-8, -1, 8, 2); // stripe
  c.fillStyle = "#fff3a6"; c.fillRect(11, -5, 2, 3); c.fillRect(11, 2, 2, 3); // headlights
  if (car.oil > 0) { c.strokeStyle = "#fff6e0"; c.lineWidth = 1; c.strokeRect(-16, -12, 32, 24); }
  c.restore();
}

function render(c: CanvasRenderingContext2D, r: Race, tick: number) {
  const tr = track();
  const me = r.cars[0];
  c.fillStyle = "#16301c"; c.fillRect(0, 0, VW, VH);
  c.save();
  c.translate(VW / 2 - me.x, VH / 2 - me.y);
  // grass speckle
  c.fillStyle = "#1f3f26";
  const gx0 = Math.floor((me.x - VW) / 60) * 60, gy0 = Math.floor((me.y - VH) / 60) * 60;
  for (let gx = gx0; gx < me.x + VW; gx += 60) for (let gy = gy0; gy < me.y + VH; gy += 60) c.fillRect(gx + ((gy * 7) % 40), gy + ((gx * 3) % 40), 5, 3);
  const path = () => { c.beginPath(); tr.pts.forEach((p, i) => (i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y))); c.closePath(); };
  c.lineJoin = "round"; c.lineCap = "round";
  c.strokeStyle = "#d9304a"; c.lineWidth = RACE.ROAD + 16; path(); c.stroke(); // kerb
  c.strokeStyle = "#fff6e0"; c.setLineDash([22, 22]); c.lineWidth = RACE.ROAD + 16; path(); c.stroke(); c.setLineDash([]);
  c.strokeStyle = "#3a3a4a"; c.lineWidth = RACE.ROAD; path(); c.stroke(); // asphalt
  c.strokeStyle = "#5a5a6a"; c.setLineDash([16, 20]); c.lineWidth = 3; path(); c.stroke(); c.setLineDash([]);
  // start / finish line
  const s = tr.pts[0];
  c.save(); c.translate(s.x, s.y); c.rotate(tr.start.angle);
  for (let i = 0; i < 8; i++) for (let k = 0; k < 2; k++) { c.fillStyle = (i + k) % 2 ? "#fff6e0" : "#05030c"; c.fillRect(-6 + k * 6, -RACE.ROAD / 2 + (i * RACE.ROAD) / 8, 6, RACE.ROAD / 8); }
  c.restore();
  for (const p of tr.pads) { // boost pads: glowing chevrons
    c.fillStyle = "#58e1ff"; c.globalAlpha = 0.5 + 0.4 * Math.sin(tick / 6); c.beginPath(); c.arc(p.x, p.y, 20, 0, Math.PI * 2); c.fill(); c.globalAlpha = 1;
    c.fillStyle = "#fff6e0"; c.fillRect(p.x - 8, p.y - 2, 12, 4); c.fillRect(p.x + 2, p.y - 6, 4, 12);
  }
  for (const o of tr.oil) { c.fillStyle = "#05030c"; c.beginPath(); c.ellipse(o.x, o.y, 20, 13, 0.4, 0, Math.PI * 2); c.fill(); c.fillStyle = "#9b5de566"; c.beginPath(); c.ellipse(o.x - 4, o.y - 3, 8, 4, 0.4, 0, Math.PI * 2); c.fill(); }
  for (const car of [...r.cars].reverse()) drawCar(c, car);
  c.restore();

  // HUD
  const pos = positions(r)[0];
  const lapNow = Math.max(0, r.t - RACE.COUNTDOWN_MS - me.lapStart);
  c.font = "22px VT323, monospace"; c.textAlign = "left"; c.textBaseline = "top";
  const text = (t: string, x: number, y: number, col = "#fff6e0") => { c.fillStyle = "#05030c"; c.fillText(t, x + 1, y + 1); c.fillStyle = col; c.fillText(t, x, y); };
  text(`LAP ${Math.min(me.lap + 1, RACE.LAPS)}/${RACE.LAPS}`, 10, 8);
  text(`POS ${ORDINAL[pos - 1]}`, 10, 30, "#f2c36b");
  text(`TIME ${fmtTime(me.finishedAt ?? lapNow)}`, 10, 52);
  text(`BEST ${fmtTime(me.best)}`, 10, 74, "#7fe0a9");
  const sp = Math.round(Math.hypot(me.vx, me.vy) * 0.55);
  c.textAlign = "right";
  text(`${sp} km/h`, VW - 10, 8, me.boost > 0 ? "#58e1ff" : "#fff6e0");
  if (me.charge > 0.9) text("TURBO READY", VW - 10, 30, "#58e1ff");
  // minimap
  const mx = VW - 96, my = VH - 90, k = 80 / 1800;
  c.fillStyle = "#05030c99"; c.fillRect(mx - 6, my - 6, 92, 82);
  c.strokeStyle = "#8a8aa0"; c.lineWidth = 2; c.beginPath(); tr.pts.forEach((p, i) => (i ? c.lineTo(mx + p.x * k, my + p.y * k) : c.moveTo(mx + p.x * k, my + p.y * k))); c.closePath(); c.stroke();
  for (const car of r.cars) { c.fillStyle = car.color; c.fillRect(mx + car.x * k - 2, my + car.y * k - 2, car.human ? 5 : 4, car.human ? 5 : 4); }
  // start lights
  const cd = RACE.COUNTDOWN_MS - r.t;
  if (cd > 0) {
    const lit = 3 - Math.ceil(cd / 1000) + 1;
    for (let i = 0; i < 3; i++) { c.fillStyle = i < lit ? (lit >= 3 ? "#7fe0a9" : "#d9304a") : "#2a2140"; c.beginPath(); c.arc(VW / 2 - 40 + i * 40, 90, 14, 0, Math.PI * 2); c.fill(); }
    c.textAlign = "center"; text("GET READY", VW / 2, 120);
  } else if (r.t < RACE.COUNTDOWN_MS + 900) { c.textAlign = "center"; c.font = "48px VT323, monospace"; text("GO!", VW / 2, 70, "#7fe0a9"); }
}

/** Neon Drift GP: a top-down three-lap race against three CPU cars. Arrow keys / WASD steer, Space drifts. Your result is checked by the server. */
export default function Racer({ net, onClose, sfx }: ArcadeProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const race = useRef<Race | null>(null);
  const input = useRef<RaceInput>({ left: false, right: false, up: false, down: false, drift: false });
  const token = useRef(0);
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
    let raf = 0, last = performance.now(), acc = 0, tick = 0, finished = false;
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
          for (const ev of r.events.splice(0)) sfxRef.current(ev === "boost" ? "jump" : ev === "oil" ? "splash" : ev === "lap" ? "ding" : ev === "go" ? "win" : "clack");
        }
        tick++;
        if (c) render(c, r, tick);
        if (r.done && !finished) {
          finished = true;
          const me = r.cars[0];
          const pos = positions(r)[0];
          const total = Math.round(me.finishedAt ?? 0), bestLap = Math.round(me.best);
          void net.call<RunFinish>("racer:finish", { token: token.current, totalMs: total, bestLapMs: bestLap, position: pos }).then((f) => {
            setResult(f.ok ? { pos, total, best: bestLap, fin: f } : { pos, total, best: bestLap, err: f.reason });
            if (f.ok && f.beans > 0) sfxRef.current("cashout");
            setPhase("done");
          });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); };
  }, [phase, net]);

  return (
    <ArcadeFrame title="Neon Drift GP" net={net} onClose={onClose} width="max-w-4xl" accent="text-[#f2a93b]">
      {phase === "menu" ? null : (
        <canvas ref={canvas} width={VW} height={VH} className="mx-auto block w-full max-w-3xl border-4 border-bark bg-espresso" style={{ imageRendering: "pixelated", aspectRatio: `${VW}/${VH}` }} aria-label="Race track" />
      )}
      {phase === "race" && <p className="mt-2 text-center text-latte">W/↑ accelerate · S/↓ brake · A/D or ←/→ steer · Space drift (hold through a corner, release for a turbo) · cyan pads boost · avoid oil</p>}
      {phase !== "race" && (
        <div className="mt-3 text-center">
          {phase === "done" && result && (
            <div role="status" className="mb-3">
              <p className="text-2xl text-amber">{result.pos ? `You finished ${ORDINAL[result.pos - 1]}` : "Race not recorded"}</p>
              {result.pos > 0 && <p className="text-xl text-cream">Time {fmtTime(result.total)} · best lap {fmtTime(result.best)}</p>}
              {result.fin && <p className="text-mint">{result.fin.beans > 0 ? `+${result.fin.beans} Cafe Beans` : "No podium, no beans"}{result.fin.best ? " · NEW personal best lap!" : ""}{result.fin.rank ? ` · lap rank #${result.fin.rank}` : ""}</p>}
              {result.err && <p className="text-ember">{result.err}</p>}
            </div>
          )}
          {phase === "menu" && result?.err && <p className="mb-2 text-ember" role="alert">{result.err}</p>}
          {phase === "menu" && <p className="mb-3 text-xl text-cream">Three laps, three CPU rivals, oil slicks and turbo pads. Podium finishes pay Cafe Beans (1st {raceBeans(1)}, 2nd {raceBeans(2)}, 3rd {raceBeans(3)}) and your best lap goes on the leaderboard.</p>}
          <button className="px-btn !px-6 !py-3" disabled={busy} onClick={() => void start()}>{phase === "done" ? "Race again" : "Start the race"}</button>
          <p className="mt-3 text-sm text-latte">Free to play. Controls: W/↑ gas, S/↓ brake, A/D or ←/→ steer, Space to drift.</p>
        </div>
      )}
    </ArcadeFrame>
  );
}
