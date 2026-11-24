"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoofFrame, type RooftopProps } from "./ui";
import { ROAST_LINES, ROAST_PERFECT_BEANS, ROAST_THRESHOLDS, roastHeat, type RoastGrade } from "@/shared/rooftop";
import type { RoastResult } from "@/shared/protocol";

const W = 240;
const H = 150;
const AUTO_PULL_HEAT = ROAST_THRESHOLDS.burnt + 1.6; // it slides off the stick into the fire

// marshmallow colour by heat: white -> light toast -> golden-brown -> dark -> charcoal
const STOPS: [number, string][] = [
  [0, "#fff6e0"], [ROAST_THRESHOLDS.toasty, "#f4dcaa"], [ROAST_THRESHOLDS.golden, "#e0a84a"],
  [ROAST_THRESHOLDS.brown, "#a8602a"], [ROAST_THRESHOLDS.burnt, "#2a1a12"],
];
const mix = (a: string, b: string, t: number) => {
  const p = (h: string, i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16);
  const ch = (i: number) => Math.round(p(a, i) + (p(b, i) - p(a, i)) * t).toString(16).padStart(2, "0");
  return `#${ch(0)}${ch(1)}${ch(2)}`;
};
function marshmallowColour(heat: number) {
  for (let i = 1; i < STOPS.length; i++) {
    if (heat <= STOPS[i][0]) return mix(STOPS[i - 1][1], STOPS[i][1], (heat - STOPS[i - 1][0]) / (STOPS[i][0] - STOPS[i - 1][0]));
  }
  return STOPS[STOPS.length - 1][1];
}

function draw(c: CanvasRenderingContext2D, now: number, heat: number | null, grade: RoastGrade | null) {
  c.clearRect(0, 0, W, H);
  c.fillStyle = "#0b1030"; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) { c.fillStyle = i % 2 ? "#fff6e0" : "#9fb8d8"; c.fillRect((i * 83) % W, (i * 37) % 60, 1, 1); }
  c.fillStyle = "#4d3a2d"; c.fillRect(0, 118, W, 32);
  for (let x = 0; x < W; x += 24) { c.fillStyle = "#3b2c21"; c.fillRect(x, 118, 1, 32); }
  // fire
  const fx = 150;
  const flick = Math.sin(now / 90) * 2;
  const roasting = heat !== null && heat > 0;
  c.fillStyle = "#ff8a3a22"; c.beginPath(); c.arc(fx, 112, 70 + flick * 3, 0, Math.PI * 2); c.fill();
  c.fillStyle = "#2a1810"; c.fillRect(fx - 26, 112, 52, 10);
  c.fillStyle = "#4d2e18"; c.fillRect(fx - 26, 110, 52, 4);
  for (const [w0, h0, col] of [[22, 40, "#d9501e"], [15, 30, "#f2872b"], [8, 20, "#ffd36b"]] as const) {
    const h = h0 + flick * (w0 / 8) + (roasting ? 4 : 0);
    c.fillStyle = col;
    for (let y = 0; y < h; y++) {
      const half = Math.max(1, Math.round((w0 / 2) * Math.sin(Math.PI * Math.pow(1 - y / h, 0.7) * 0.5 + 0.35) * (1 - (y / h) * 0.5)));
      c.fillRect(fx - half + Math.round(Math.sin(now / 160 + y / 6) * 1.5), 112 - y, half * 2, 1);
    }
  }
  // the stick comes in from the left and its tip hovers over the flames
  const tipX = fx - 8;
  const tipY = 82 + (roasting ? Math.sin(now / 240) * 1.5 : 0);
  c.strokeStyle = "#6a4326"; c.lineWidth = 3;
  c.beginPath(); c.moveTo(14, 46); c.lineTo(tipX, tipY); c.stroke();
  c.strokeStyle = "#8a5a36"; c.lineWidth = 1;
  c.beginPath(); c.moveTo(14, 45); c.lineTo(tipX, tipY - 1); c.stroke();
  // the marshmallow (two stacked puffs)
  const colour = grade === "burnt" || (heat ?? 0) >= ROAST_THRESHOLDS.burnt ? "#241812" : marshmallowColour(heat ?? 0);
  c.fillStyle = "#1f140d"; c.fillRect(tipX - 10, tipY - 12, 20, 24);
  c.fillStyle = colour; c.fillRect(tipX - 9, tipY - 11, 18, 22);
  c.fillStyle = "#ffffff44"; c.fillRect(tipX - 8, tipY - 10, 4, 18);
  c.fillStyle = "#00000033"; c.fillRect(tipX - 9, tipY - 1, 18, 1);
  if ((heat ?? 0) >= ROAST_THRESHOLDS.burnt) { // it's on fire
    c.fillStyle = "#ff8a3a"; c.fillRect(tipX - 6, tipY - 18 + Math.round(flick), 12, 6);
    c.fillStyle = "#ffd36b"; c.fillRect(tipX - 3, tipY - 16 + Math.round(flick), 6, 4);
  }
  if (roasting && (heat ?? 0) > ROAST_THRESHOLDS.brown) { // smoke
    for (let i = 0; i < 3; i++) { c.fillStyle = "#c4c4d055"; c.fillRect(tipX - 6 + i * 6 + Math.sin(now / 200 + i) * 3, tipY - 28 - ((now / 30 + i * 9) % 22), 4, 4); }
  }
}

/** Campfire marshmallow roasting. The server times the roast and decides the result, so the bonus can't be faked. */
export default function Roast({ net, onClose, sfx }: RooftopProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const run = useRef<{ startedAt: number; rate: number } | null>(null);
  const [phase, setPhase] = useState<"idle" | "roasting" | "pulling" | "done">("idle");
  const [result, setResult] = useState<RoastResult | null>(null);
  const [error, setError] = useState("");
  const pulling = useRef(false);

  const start = useCallback(async () => {
    setError("");
    const r = await net.roof<{ rate: number }>("roast:start");
    if (!r.ok) { setError(r.reason); return; }
    run.current = { startedAt: performance.now(), rate: r.rate };
    setResult(null);
    setPhase("roasting");
    sfx("sizzle");
  }, [net, sfx]);

  const pull = useCallback(async () => {
    if (!run.current || pulling.current) return;
    pulling.current = true;
    setPhase("pulling");
    const r = await net.roof<RoastResult>("roast:pull");
    pulling.current = false;
    run.current = null;
    if (!r.ok) { setError(r.reason); setPhase("idle"); return; }
    setResult(r);
    setPhase("done");
    if (r.perfect) sfx(r.bonus > 0 ? "win" : "ding");
    else if (r.grade === "burnt") sfx("lose");
    else sfx("page");
  }, [net, sfx]);

  // animation loop (draws straight to the canvas; React only hears about phase changes)
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const c = canvas.current?.getContext("2d");
      const r = run.current;
      const heat = r ? roastHeat(now - r.startedAt, r.rate) : null;
      if (c) draw(c, now, heat, result?.grade ?? null);
      if (heat !== null && heat >= AUTO_PULL_HEAT && !pulling.current) void pull(); // it slid into the fire
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [pull, result]);

  // the marshmallow is left on the stick if you walk away: nothing to clean up client side
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || !["Space", "Enter", "KeyE"].includes(e.code)) return;
      e.preventDefault();
      if (phase === "roasting") void pull();
      else if (phase === "idle" || phase === "done") void start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, pull, start]);

  return (
    <RoofFrame
      title="Campfire · Marshmallow roasting"
      net={net}
      onClose={onClose}
      width="max-w-xl"
      accent="text-ember"
      footer={`A golden-brown roast earns +${ROAST_PERFECT_BEANS} Cafe Beans (once every few seconds). Cafe Beans are a fictional play currency.`}
    >
      <canvas ref={canvas} width={W} height={H} className="mx-auto block w-full max-w-md bg-espresso" style={{ imageRendering: "pixelated", aspectRatio: `${W}/${H}` }} aria-label="A marshmallow on a stick over the campfire" />
      <div className="mt-3 min-h-16 text-center text-xl" role="status" aria-live="polite">
        {phase === "idle" && !error && <p className="text-cream">Skewer a marshmallow, hold it over the flames and pull it out when it is <b className="text-amber">golden-brown</b>. Too long and it burns!</p>}
        {phase === "roasting" && <p className="text-amber">Roasting… watch the colour, then pull it out! (Space / E)</p>}
        {phase === "pulling" && <p className="text-latte">…</p>}
        {phase === "done" && result && (
          <p className={result.perfect ? "text-mint" : result.grade === "burnt" ? "text-ember" : "text-cream"}>
            {ROAST_LINES[result.grade]}
            {result.bonus > 0 && <b className="text-amber"> +{result.bonus} Cafe Beans!</b>}
            {result.perfect && result.bonus === 0 && <span className="text-latte"> (Bonus beans come once every few seconds.)</span>}
          </p>
        )}
        {error && <p className="text-ember">{error}</p>}
      </div>
      <div className="mt-2 flex justify-center gap-3">
        {phase === "roasting" || phase === "pulling" ? (
          <button className="px-btn !px-6 !py-3" onClick={() => void pull()} disabled={phase === "pulling"}>Pull it out!</button>
        ) : (
          <button className="px-btn !px-6 !py-3" onClick={() => void start()}>{phase === "done" ? "Roast another" : "Skewer a marshmallow"}</button>
        )}
      </div>
    </RoofFrame>
  );
}
