"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { POCKETS, POOL, PoolSim, groupOf, type PoolBall } from "@/shared/pool";
import type { PoolBallView } from "@/shared/protocol";
import { ArcadeFrame, useBeans, useCountdown, type ArcadeProps } from "./ui";

const STAKES = [0, 10, 25, 50, 100];
const COLORS = ["#fff6e0", "#f2c36b", "#3a5fd9", "#d9304a", "#7a3ad9", "#f2a93b", "#2a8560", "#8a2a2a", "#111111"];
const colorOf = (id: number) => COLORS[id === 0 ? 0 : id === 8 ? 8 : ((id - 1) % 7) + 1];
const toBalls = (v: PoolBallView[]): PoolBall[] => v.map((b) => ({ ...b, vx: 0, vy: 0 }));
const MAX_PULL = 170;

function drawTable(c: CanvasRenderingContext2D, balls: { id: number; x: number; y: number; out: boolean }[], aim: { angle: number; power: number } | null, cue: { x: number; y: number } | null) {
  const { W, H, R } = POOL;
  c.clearRect(0, 0, W + 60, H + 60);
  c.save();
  c.translate(30, 30);
  c.fillStyle = "#5a3a22"; c.fillRect(-30, -30, W + 60, H + 60); // wooden rail
  c.fillStyle = "#33200f"; c.fillRect(-30, -30, W + 60, 6);
  c.fillStyle = "#1f4a8a"; c.fillRect(0, 0, W, H); // cloth
  c.fillStyle = "#2a62b0"; c.fillRect(0, 0, W, 3);
  c.fillStyle = "#ffffff18"; c.fillRect(W * 0.25, 0, 1, H); // head string
  c.fillStyle = "#ffffff30"; c.fillRect(W * 0.72 - 1, H / 2 - 1, 3, 3);
  for (const p of POCKETS) { c.fillStyle = "#05030c"; c.beginPath(); c.arc(p.x, p.y, p.r * 0.85, 0, Math.PI * 2); c.fill(); }
  for (const b of balls) {
    if (b.out) continue;
    c.fillStyle = "#00000055"; c.beginPath(); c.arc(b.x + 2, b.y + 3, R, 0, Math.PI * 2); c.fill();
    const stripe = groupOf(b.id) === "stripe";
    c.fillStyle = stripe ? "#fff6e0" : colorOf(b.id);
    c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.fill();
    if (stripe) { c.fillStyle = colorOf(b.id); c.fillRect(b.x - R + 1, b.y - 4, R * 2 - 2, 8); c.save(); c.beginPath(); c.arc(b.x, b.y, R, 0, Math.PI * 2); c.clip(); c.fillRect(b.x - R, b.y - 4, R * 2, 8); c.restore(); }
    if (b.id > 0) { c.fillStyle = "#fff6e0"; c.beginPath(); c.arc(b.x, b.y, 4.5, 0, Math.PI * 2); c.fill(); c.fillStyle = "#111"; c.font = "8px monospace"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(String(b.id), b.x, b.y + 0.5); }
    c.fillStyle = "#ffffff88"; c.fillRect(b.x - 5, b.y - 6, 3, 2);
  }
  if (aim && cue) { // the cue and a dotted line where the ball will head
    const dx = Math.cos(aim.angle), dy = Math.sin(aim.angle);
    c.strokeStyle = "#fff6e0aa"; c.setLineDash([4, 6]); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(cue.x + dx * R, cue.y + dy * R); c.lineTo(cue.x + dx * 260, cue.y + dy * 260); c.stroke(); c.setLineDash([]);
    const back = 14 + aim.power * 90;
    c.strokeStyle = "#e8c48a"; c.lineWidth = 4;
    c.beginPath(); c.moveTo(cue.x - dx * (R + back), cue.y - dy * (R + back)); c.lineTo(cue.x - dx * (R + back + 190), cue.y - dy * (R + back + 190)); c.stroke();
    c.strokeStyle = "#3a5fd9"; c.lineWidth = 4;
    c.beginPath(); c.moveTo(cue.x - dx * (R + back), cue.y - dy * (R + back)); c.lineTo(cue.x - dx * (R + back + 6), cue.y - dy * (R + back + 6)); c.stroke();
  }
  c.restore();
}

/** 8-Ball Pool: drag back from the cue ball to aim and set the power, release to shoot. The server runs the shot; we replay it with the same physics. */
export default function Pool({ net, onClose, sfx, onStand }: ArcadeProps) {
  const beans = useBeans(net);
  const view = useSyncExternalStore(net.subscribe, () => net.pool, () => null);
  const left = useCountdown(view?.deadline, view?.now);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stake, setStake] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const drag = useRef<{ angle: number; power: number } | null>(null);
  const shown = useRef<PoolBallView[]>([]);
  const lastSeq = useRef(0);
  const sim = useRef<PoolSim | null>(null);
  const sfxRef = useRef(sfx);
  useEffect(() => { sfxRef.current = sfx; }, [sfx]);

  // a new shot arrived: replay it (the same code the server ran), then settle on the server's final positions
  useEffect(() => {
    if (!view) return;
    if (!view.shot || view.shot.seq === lastSeq.current) { if (!sim.current) shown.current = view.balls; return; }
    lastSeq.current = view.shot.seq;
    sim.current = new PoolSim(toBalls(view.shot.from), view.shot.angle, view.shot.power);
    queueMicrotask(() => setAnimating(true));
    shown.current = view.shot.from;
  }, [view]);

  useEffect(() => {
    let raf = 0;
    let pocketed = 0;
    let hit = false;
    const loop = () => {
      const c = canvas.current?.getContext("2d");
      const s = sim.current;
      if (s) {
        for (let i = 0; i < 4 && !s.done; i++) s.step(); // 4 steps of 1/240 s = real time at 60 fps
        shown.current = s.balls;
        if (!hit && s.events.firstHit !== null) { hit = true; sfxRef.current("clack"); }
        if (s.events.pocketed.length > pocketed) { pocketed = s.events.pocketed.length; sfxRef.current("pocket"); }
        if (s.done) { sim.current = null; pocketed = 0; hit = false; setAnimating(false); shown.current = net.pool?.balls ?? s.balls; }
      }
      const v = net.pool;
      const cue = shown.current.find((b) => b.id === 0 && !b.out) ?? null;
      if (c) drawTable(c, shown.current.length ? shown.current : v?.balls ?? [], drag.current, cue);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [net]);

  const myTurn = !!view && view.phase === "play" && view.me >= 0 && view.turn === view.me && !animating;
  const point = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * (POOL.W + 60) - 30, y: ((e.clientY - r.top) / r.height) * (POOL.H + 60) - 30 };
  };
  const cueBall = () => shown.current.find((b) => b.id === 0 && !b.out);
  const aimFrom = (e: React.PointerEvent) => {
    const cue = cueBall();
    if (!cue) return null;
    const p = point(e);
    const dx = cue.x - p.x, dy = cue.y - p.y; // pulling back from the ball: the shot goes the other way
    const d = Math.hypot(dx, dy);
    return d < 8 ? null : { angle: Math.atan2(dy, dx), power: Math.min(1, d / MAX_PULL) };
  };
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => { if (!myTurn) return; e.currentTarget.setPointerCapture(e.pointerId); drag.current = aimFrom(e); };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => { if (drag.current) drag.current = aimFrom(e) ?? drag.current; };
  const onUp = useCallback(async () => {
    const a = drag.current;
    drag.current = null;
    if (!a || a.power < 0.06 || !myTurn) return;
    const r = await net.call("pl:shot", { angle: a.angle, power: a.power });
    if (!r.ok) setErr(r.reason); else setErr("");
  }, [net, myTurn]);

  const send = async (event: "pl:start" | "pl:accept" | "pl:resign", payload?: unknown) => {
    if (busy) return;
    setBusy(true); setErr("");
    const r = await net.call(event, payload);
    setBusy(false);
    if (!r.ok) setErr(r.reason); else sfx("place");
  };

  if (!view) return <ArcadeFrame title="8-Ball Pool" net={net} onClose={onClose} width="max-w-4xl" accent="text-[#58a6e0]"><p className="text-latte">Chalking the cue…</p></ArcadeFrame>;
  const other = view.players.find((p) => p && !p.mine);
  const iAmOffered = view.phase === "offer" && view.me === 1;
  const turnName = view.players[view.turn]?.name ?? "";

  return (
    <ArcadeFrame title="8-Ball Pool" net={net} onClose={onClose} width="max-w-5xl" accent="text-[#58a6e0]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xl">
        {[0, 1].map((i) => {
          const p = view.players[i];
          const live = view.phase === "play" && view.turn === i;
          return (
            <span key={i} className={`bg-espresso/70 px-3 py-1 ${live ? "outline outline-2 outline-amber" : ""} ${p?.mine ? "text-mint" : "text-cream"}`}>
              {p ? <>{p.bot ? "🤖 " : ""}{p.name}{p.mine ? " (you)" : ""}{p.group ? <span className="text-latte"> · {p.group}s</span> : ""}</> : <span className="text-latte">empty stool</span>}
            </span>
          );
        })}
        {view.stake > 0 && <span className="text-amber">Stake {view.stake} each</span>}
      </div>
      <canvas
        ref={canvas} width={POOL.W + 60} height={POOL.H + 60}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => void onUp()} onPointerCancel={() => { drag.current = null; }}
        className={`block w-full border-4 border-bark ${myTurn ? "cursor-crosshair" : ""}`} style={{ aspectRatio: `${POOL.W + 60}/${POOL.H + 60}`, touchAction: "none" }}
        aria-label="Pool table: drag back from the cue ball to aim, release to shoot"
      />
      <p className="mt-2 min-h-7 text-xl text-amber" role="status" aria-live="polite">
        {view.phase === "play" ? (myTurn ? `Your shot${left !== null ? ` (${left}s)` : ""}: drag back from the cue ball, release to shoot.` : animating ? "Balls rolling…" : `${turnName}'s turn.`) : ""} {view.msg}
        {view.returned ? ` You were paid ${view.returned} beans.` : ""}
      </p>

      {iAmOffered && (
        <div className="flex gap-3">
          <button className="px-btn" disabled={busy || beans < view.stake} onClick={() => void send("pl:accept", { accept: true })}>Accept{view.stake ? ` (${view.stake} beans)` : ""}</button>
          <button className="px-btn secondary" disabled={busy} onClick={() => void send("pl:accept", { accept: false })}>Decline</button>
        </div>
      )}
      {view.host && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Start a match">
          <span className="text-latte">Friendly stake:</span>
          {STAKES.map((s) => <button key={s} className={`px-btn !px-2 !py-1 ${stake === s ? "active" : "secondary"}`} aria-pressed={stake === s} onClick={() => setStake(s)}>{s === 0 ? "None" : s}</button>)}
          <button className="px-btn" disabled={busy || beans < stake} onClick={() => void send("pl:start", { stake, ai: true })}>Play the house bot</button>
          <button className="px-btn secondary" disabled={busy || !other || beans < stake} onClick={() => void send("pl:start", { stake, ai: false })} title={other ? "" : "Wait for someone to take the other stool"}>
            {other ? `Challenge ${other.name}` : "Challenge (no one here yet)"}
          </button>
        </div>
      )}
      {view.phase === "offer" && view.me === 0 && <p className="text-latte">Waiting for {other?.name ?? "the other player"} to accept…</p>}
      <div className="mt-2 flex flex-wrap gap-2">
        {view.phase === "play" && view.me >= 0 && <button className="px-btn danger !py-1" disabled={busy} onClick={() => void send("pl:resign")}>Resign</button>}
        {onStand && <button className="px-btn secondary !py-1" onClick={onStand}>Stand up</button>}
      </div>
      {err && <p className="mt-1 text-ember" role="alert">{err}</p>}
      <p className="mt-2 text-sm text-latte">Break the rack, sink your group (solids 1-7 or stripes 9-15), then the 8-ball. Fouls: scratching, hitting the wrong ball first, or nothing reaching a rail. Beat the bot with a stake and you get 1.8x back. Stakes are fictional Cafe Beans.</p>
    </ArcadeFrame>
  );
}
