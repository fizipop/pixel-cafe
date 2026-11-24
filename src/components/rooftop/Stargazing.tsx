"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RoofFrame, type RooftopProps } from "./ui";
import { CONSTELLATIONS, constellationAt, type Constellation } from "@/lib/constellations";
import { WISH_COOLDOWN_MS, WISH_MAX } from "@/shared/rooftop";
import { unescapeHtml } from "@/shared/text";
import type { StarWishView, StarsView } from "@/shared/protocol";

const W = 480;
const H = 300;

type Shooter = { x: number; y: number; vx: number; vy: number; born: number; gold: boolean };
const hash = (n: number, seed = 0) => {
  let h = (n * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};
const BACKDROP = Array.from({ length: 150 }, (_, i) => ({ x: hash(i, 1) * W, y: hash(i, 2) * H, s: hash(i, 3), ph: hash(i, 4) * 6.28 }));

function drawSky(c: CanvasRenderingContext2D, now: number, hover: Constellation | null, shooters: Shooter[]) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#060822"); g.addColorStop(0.7, "#14194a"); g.addColorStop(1, "#3a3068");
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  // the Milky Way: a faint diagonal band
  c.save(); c.translate(W / 2, H / 2); c.rotate(-0.5);
  c.fillStyle = "#9fb8d814"; c.fillRect(-W, -26, W * 2, 52);
  c.fillStyle = "#c9a0e810"; c.fillRect(-W, -10, W * 2, 20);
  c.restore();
  for (const s of BACKDROP) {
    c.globalAlpha = 0.35 + 0.65 * Math.abs(Math.sin(now / (900 + s.s * 1400) + s.ph));
    c.fillStyle = s.s > 0.8 ? "#ffe9b0" : s.s > 0.4 ? "#fff6e0" : "#9fb8d8";
    c.fillRect(Math.floor(s.x), Math.floor(s.y), s.s > 0.9 ? 2 : 1, s.s > 0.9 ? 2 : 1);
  }
  c.globalAlpha = 1;
  c.font = "18px VT323, monospace";
  c.textAlign = "center";
  for (const k of CONSTELLATIONS) {
    const on = hover?.id === k.id;
    const P = k.points.map(([x, y]) => [Math.round(x * W), Math.round(y * H)] as const);
    c.strokeStyle = on ? "#ffe9b0" : "#9fb8d855";
    c.lineWidth = on ? 2 : 1;
    c.beginPath();
    for (const [a, b] of k.lines) { c.moveTo(P[a][0], P[a][1]); c.lineTo(P[b][0], P[b][1]); }
    c.stroke();
    P.forEach(([x, y], i) => {
      const tw = 0.6 + 0.4 * Math.sin(now / 400 + i * 1.7);
      c.fillStyle = on ? "#fff3a6" : "#fff6e0";
      c.globalAlpha = on ? 1 : tw;
      const r = on ? 3 : 2;
      c.fillRect(x - r + 1, y - r + 1, r * 2 - 1, r * 2 - 1);
      if (on) { c.fillRect(x - 5, y, 11, 1); c.fillRect(x, y - 5, 1, 11); }
      c.globalAlpha = 1;
    });
    if (on) {
      const mx = Math.round((P.reduce((a, p) => a + p[0], 0)) / P.length);
      const top = Math.min(...P.map((p) => p[1]));
      c.fillStyle = "#05030c"; c.fillText(k.name, mx + 1, top - 7);
      c.fillStyle = "#ffe9b0"; c.fillText(k.name, mx, top - 8);
    }
  }
  for (const s of shooters) { // shooting stars: a bright head with a fading tail
    const age = (now - s.born) / 1000;
    for (let i = 0; i < 22; i++) {
      c.globalAlpha = (1 - i / 22) * Math.max(0, 1 - age / 1.4);
      c.fillStyle = s.gold ? "#ffe9b0" : "#ffffff";
      c.fillRect(Math.round(s.x + s.vx * age - s.vx * i * 0.012), Math.round(s.y + s.vy * age - s.vy * i * 0.012), i < 4 ? 3 : 2, i < 4 ? 3 : 2);
    }
  }
  c.globalAlpha = 1;
  // telescope eyepiece vignette
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.45, W / 2, H / 2, H * 0.85);
  v.addColorStop(0, "rgba(0,0,0,0)"); v.addColorStop(1, "rgba(0,0,0,0.55)");
  c.fillStyle = v; c.fillRect(0, 0, W, H);
}

/** The brass telescope: a night sky with named constellations, shooting stars, and a wall of anonymous wishes. */
export default function Stargazing({ net, onClose, sfx }: RooftopProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const hoverRef = useRef<Constellation | null>(null);
  const shooters = useRef<Shooter[]>([]);
  const [picked, setPicked] = useState<Constellation | null>(null);
  const [hover, setHover] = useState<Constellation | null>(null);
  const [wishes, setWishes] = useState<StarWishView[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const shoot = useCallback((gold: boolean) => {
    const now = performance.now();
    const fromLeft = Math.random() < 0.5;
    shooters.current.push({
      x: fromLeft ? -10 + Math.random() * 120 : W + 10 - Math.random() * 120,
      y: 10 + Math.random() * 90,
      vx: (fromLeft ? 1 : -1) * (210 + Math.random() * 120), vy: 80 + Math.random() * 70, born: now, gold,
    });
    shooters.current = shooters.current.filter((s) => now - s.born < 1600);
  }, []);

  // look through the telescope: join the stargazers, get the current wishes, hear new ones live
  useEffect(() => {
    let alive = true;
    void net.roof<StarsView>("stars:join").then((r) => {
      if (!alive) return;
      if (r.ok) { setWishes(r.wishes); setReady(true); } else setMsg({ ok: false, text: r.reason });
    });
    const off = net.on("stars:wishes", ({ wishes: list, fresh: id }) => {
      setWishes(list);
      if (id) { setFresh(id); shoot(true); sfx("twinkle"); }
    });
    return () => { alive = false; off(); net.leaveStars(); };
  }, [net, shoot, sfx]);

  // draw + occasional shooting stars
  useEffect(() => {
    let raf = 0;
    let next = performance.now() + 1500 + Math.random() * 2500;
    const loop = (now: number) => {
      const c = canvas.current?.getContext("2d");
      if (now > next) { shoot(false); next = now + 4000 + Math.random() * 6000; }
      if (c) drawSky(c, now, hoverRef.current ?? picked, shooters.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [shoot, picked]);

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const k = constellationAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
    hoverRef.current = k;
    setHover(k);
  };

  const wish = async () => {
    if (busy || !ready) return;
    setBusy(true);
    setMsg(null);
    const r = await net.roof<StarsView>("stars:wish", { text });
    setBusy(false);
    if (!r.ok) { setMsg({ ok: false, text: r.reason }); return; }
    setWishes(r.wishes);
    setText("");
    setMsg({ ok: true, text: "Your wish is out there. Anyone looking through the telescope can see it, and nobody knows it's yours." });
    shoot(true);
    sfx("twinkle");
  };

  const shown = hover ?? picked;
  return (
    <RoofFrame
      title="Telescope · Stargazing"
      net={net}
      onClose={onClose}
      width="max-w-4xl"
      accent="text-mint"
      footer={`Wishes are anonymous: only the words are shown, never who made them. One wish every ${WISH_COOLDOWN_MS / 1000} seconds, up to ${WISH_MAX} characters, and no links or @names.`}
    >
      <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
        <div>
          <canvas
            ref={canvas} width={W} height={H}
            onPointerMove={onMove} onPointerLeave={() => { hoverRef.current = null; setHover(null); }}
            className="block w-full cursor-crosshair border-4 border-bark bg-espresso"
            style={{ imageRendering: "pixelated", aspectRatio: `${W}/${H}` }}
            aria-label="The night sky through the telescope, with named constellations"
          />
          <p className="mt-2 min-h-12 text-xl text-cream" aria-live="polite">
            {shown ? <><b className="text-amber">{shown.name}</b>: {shown.blurb}</> : "Move over the sky, or pick a constellation below. Watch for shooting stars!"}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Constellations">
            {CONSTELLATIONS.map((k) => (
              <button key={k.id} className={`px-btn !px-2 !py-1 ${picked?.id === k.id ? "active" : "secondary"}`} aria-pressed={picked?.id === k.id} onClick={() => setPicked(picked?.id === k.id ? null : k)}>{k.name}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); void wish(); }}>
            <label className="text-latte" htmlFor="wish-text">Make a wish on a star</label>
            <input
              id="wish-text" className="px-input" value={text} maxLength={WISH_MAX} placeholder="I wish…"
              onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.stopPropagation()} autoComplete="off"
            />
            <button type="submit" className="px-btn !py-3" disabled={busy || !ready || text.trim().length === 0}>✦ Make a Wish</button>
            {msg && <p className={msg.ok ? "text-mint" : "text-ember"} role="status">{msg.text}</p>}
          </form>
          <div>
            <h3 className="mb-1 font-pixel text-[10px] text-amber">Wishes from tonight</h3>
            <ul className="max-h-56 space-y-1 overflow-y-auto bg-espresso p-2" aria-label="Star wishes">
              {wishes.length === 0 && <li className="text-latte">No wishes yet. Be the first!</li>}
              {wishes.map((w) => (
                <li key={w.id} className={`text-lg ${w.id === fresh ? "text-amber" : "text-cream"}`}>
                  <span className="text-amber">✦</span> {unescapeHtml(w.text)}{w.mine && <span className="text-latte"> (yours)</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </RoofFrame>
  );
}
