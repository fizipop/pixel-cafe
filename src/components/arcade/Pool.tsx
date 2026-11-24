"use client";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { HEAD_SPOT, POCKETS, POOL, PoolSim, aimPreview, groupOf, placeProblem, type PoolBall, type PoolGame } from "@/shared/pool";
import type { PoolBallView } from "@/shared/protocol";
import { PAD, PH, PSCALE, PW, ballColor, drawPool, type SceneBall } from "@/game/poolArt";
import { ArcadeFrame, useBeans, useCountdown, type ArcadeProps } from "./ui";

const STAKES = [0, 10, 25, 50, 100];
const toBalls = (v: PoolBallView[]): PoolBall[] => v.map((b) => ({ ...b, vx: 0, vy: 0 }));
const MAX_PULL = 150; // how far (table px) you pull the cue back for full power

/** A little ball for the group trays. */
function BallIcon({ id, out }: { id: number; out: boolean }) {
  const col = ballColor(id);
  const stripe = groupOf(id) === "stripe";
  return (
    <span aria-label={`ball ${id}${out ? " (pocketed)" : ""}`} className="inline-grid h-6 w-6 place-items-center rounded-full border border-espresso text-[10px] font-bold text-black"
      style={{ background: stripe ? `linear-gradient(#fbf6ea 0 26%, ${col} 26% 74%, #fbf6ea 74%)` : col, opacity: out ? 0.28 : 1, color: id === 8 || id === 2 || id === 4 || id === 7 ? "#fff" : "#111" }}>
      <span className="grid h-3.5 w-3.5 place-items-center rounded-full bg-[#fbf6ea] text-[9px] leading-none text-black">{id}</span>
    </span>
  );
}

/** 8-Ball Pool. Move the mouse to aim (the cue follows and the guide shows the first contact and the first cushion bounce), press and drag back to pull the cue and set the power, release to shoot. After a foul you get the cue ball in hand: drag it anywhere. Call a pocket for the 8-ball. The server runs the shot; we replay it with the same physics. */
export default function Pool({ net, onClose, sfx, onStand }: ArcadeProps) {
  const beans = useBeans(net);
  const view = useSyncExternalStore(net.subscribe, () => net.pool, () => null);
  const left = useCountdown(view?.deadline, view?.now);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [stake, setStake] = useState(0);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [powerUi, setPowerUi] = useState(0);
  const [call, setCall] = useState<number | null>(null);
  const aim = useRef({ angle: 0, power: 0 });
  const placed = useRef<{ x: number; y: number } | null>(null);
  const gesture = useRef<null | { kind: "pull"; sx: number; sy: number; angle: number } | { kind: "cue" }>(null);
  const charging = useRef(false);
  const hoverPocket = useRef<number | null>(null);
  const shown = useRef<PoolBallView[]>([]);
  const lastSeq = useRef(0);
  const sim = useRef<PoolSim | null>(null);
  const queued = useRef<PoolSim[]>([]); // shots that arrived while another was still rolling (e.g. the bot answering quickly)
  const sfxRef = useRef(sfx);
  useEffect(() => { sfxRef.current = sfx; }, [sfx]);

  const myTurn = !!view && view.phase === "play" && view.me >= 0 && view.turn === view.me && !animating;
  const inHand = myTurn && !!view?.inHand;
  const needsCall = myTurn && !!view && view.targets.length === 1 && view.targets[0] === 8;
  const live = useRef({ myTurn, inHand, needsCall, targets: [] as number[], kitchen: false, call: null as number | null });
  useEffect(() => { live.current = { myTurn, inHand, needsCall, targets: view?.targets ?? [], kitchen: !!view?.kitchen, call }; }, [myTurn, inHand, needsCall, view, call]);

  // a new shot arrived: replay it (the same code the server ran), then settle on the server's final positions
  useEffect(() => {
    if (!view) return;
    if (!view.shot || view.shot.seq === lastSeq.current) { if (!sim.current) shown.current = view.balls; return; }
    lastSeq.current = view.shot.seq;
    const next = new PoolSim(toBalls(view.shot.from), view.shot.angle, view.shot.power);
    placed.current = null; aim.current.power = 0;
    queueMicrotask(() => { setAnimating(true); setCall(null); setPowerUi(0); });
    // let the shot on the table finish rolling before replaying the next one, instead of cutting it off
    if (sim.current && !sim.current.done) queued.current.push(next);
    else { sim.current = next; shown.current = view.shot.from; }
  }, [view]);

  const tableBalls = (): SceneBall[] => {
    const base = shown.current.length ? shown.current : net.pool?.balls ?? [];
    const p = placed.current;
    return live.current.inHand && p ? base.map((b) => (b.id === 0 ? { ...b, x: p.x, y: p.y, out: false } : b)) : base;
  };

  const shoot = useCallback(async (power: number) => {
    const L = live.current;
    if (!L.myTurn || power < 0.04) return;
    if (L.needsCall && L.call === null) { setErr("Click a pocket to call it for the 8-ball first."); return; }
    const a = aim.current;
    const r = await net.call("pl:shot", { angle: a.angle, power, ...(L.inHand && placed.current ? { cue: placed.current } : {}), ...(L.needsCall ? { pocket: L.call } : {}) });
    if (!r.ok) setErr(r.reason); else setErr("");
  }, [net]);

  useEffect(() => {
    let raf = 0, last = performance.now(), tick = 0, pocketed = 0, hit = false;
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now; tick++;
      const c = canvas.current?.getContext("2d");
      const s = sim.current;
      if (s) {
        const steps = 4 * (1 + Math.min(3, queued.current.length)); // 4 steps of 1/240 s = real time at 60 fps (faster to catch up a backlog)
        for (let i = 0; i < steps && !s.done; i++) s.step();
        shown.current = s.balls;
        if (!hit && s.events.firstHit !== null) { hit = true; sfxRef.current("clack"); }
        if (s.events.pocketed.length > pocketed) { pocketed = s.events.pocketed.length; sfxRef.current("pocket"); }
        if (s.done && queued.current.length) { sim.current = queued.current.shift()!; pocketed = 0; hit = false; shown.current = sim.current.balls; }
        else if (s.done) { sim.current = null; pocketed = 0; hit = false; setAnimating(false); shown.current = net.pool?.balls ?? s.balls; }
      }
      const L = live.current;
      if (charging.current && L.myTurn) { aim.current.power = Math.min(1, aim.current.power + dt * 0.8); if (tick % 3 === 0) setPowerUi(Math.round(aim.current.power * 100)); }
      if (c) {
        const balls = tableBalls();
        const cue = balls.find((b) => b.id === 0 && !b.out);
        drawPool(c, {
          balls, tick, myTurn: L.myTurn, targets: L.targets, call: L.call, needsCall: L.needsCall, hoverPocket: hoverPocket.current,
          aim: L.myTurn && cue ? { angle: aim.current.angle, power: aim.current.power, preview: aimPreview(balls, aim.current.angle) } : null,
          placing: L.inHand ? { kitchen: L.kitchen } : null,
        });
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [net]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * PW - PAD, y: ((e.clientY - r.top) / r.height) * PH - PAD };
  };
  const cueBall = () => tableBalls().find((b) => b.id === 0 && !b.out);
  const aimAt = (p: { x: number; y: number }) => { const cb = cueBall(); if (cb && Math.hypot(p.x - cb.x, p.y - cb.y) > 6) aim.current.angle = Math.atan2(p.y - cb.y, p.x - cb.x); };
  const pocketAt = (p: { x: number; y: number }) => { const i = POCKETS.findIndex((k) => Math.hypot(p.x - k.x, p.y - k.y) < k.r + 16); return i >= 0 ? i : null; };
  const tryPlace = (p: { x: number; y: number }) => {
    if (!view) return;
    const g = { balls: toBalls(view.balls), turn: view.turn, groups: [null, null], breaking: false, inHand: true, kitchen: view.kitchen } as PoolGame;
    const x = Math.min(POOL.W - POOL.R, Math.max(POOL.R, p.x)), y = Math.min(POOL.H - POOL.R, Math.max(POOL.R, p.y));
    const kx = view.kitchen ? Math.min(x, HEAD_SPOT.x - 0.5) : x; // a scratch on the break: behind the head string
    if (!placeProblem(g, kx, y)) placed.current = { x: kx, y };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!live.current.myTurn) return;
    const p = point(e);
    if (live.current.needsCall) { const k = pocketAt(p); if (k !== null) { setCall(k); setErr(""); return; } }
    const cb = cueBall();
    if (live.current.inHand && cb && Math.hypot(p.x - cb.x, p.y - cb.y) < POOL.R * 2.4) { e.currentTarget.setPointerCapture(e.pointerId); gesture.current = { kind: "cue" }; return; }
    e.currentTarget.setPointerCapture(e.pointerId);
    aimAt(p);
    gesture.current = { kind: "pull", sx: p.x, sy: p.y, angle: aim.current.angle };
  };
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = point(e);
    hoverPocket.current = live.current.needsCall ? pocketAt(p) : null;
    const g = gesture.current;
    if (!live.current.myTurn) return;
    if (!g) { if (e.buttons === 0) aimAt(p); return; }
    if (g.kind === "cue") { tryPlace(p); return; }
    // pull: how far the pointer has moved *behind* the cue, along the line of the shot
    const back = (p.x - g.sx) * -Math.cos(g.angle) + (p.y - g.sy) * -Math.sin(g.angle);
    const power = Math.min(1, Math.max(0, back / MAX_PULL));
    aim.current.angle = g.angle; aim.current.power = power;
    setPowerUi(Math.round(power * 100));
  };
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.kind === "cue") return;
    const power = aim.current.power;
    if (power >= 0.06) void shoot(power);
    else { aimAt(point(e)); aim.current.power = 0; setPowerUi(0); } // a tap just aims
  };

  // keyboard: arrows or A/D nudge the aim (hold Shift for fine steps), hold Space to charge and release to shoot, Enter shoots at the slider power
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (!live.current.myTurn) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA")) return;
      const step = e.shiftKey ? 0.004 : 0.016;
      if (e.code === "ArrowLeft" || e.code === "KeyA") { aim.current.angle -= step; e.preventDefault(); }
      else if (e.code === "ArrowRight" || e.code === "KeyD") { aim.current.angle += step; e.preventDefault(); }
      else if (e.code === "Space") { e.preventDefault(); if (!e.repeat) { charging.current = true; aim.current.power = 0; } }
      else if (e.code === "Enter") { e.preventDefault(); void shoot(aim.current.power || 0.5); }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space" && charging.current) { charging.current = false; const p = aim.current.power; if (p >= 0.06) void shoot(p); else { aim.current.power = 0; setPowerUi(0); } }
    };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); charging.current = false; };
  }, [shoot]);

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
          const active = view.phase === "play" && view.turn === i;
          const ids = p?.group ? (p.group === "solid" ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15]) : [];
          const out = (id: number) => view.balls.find((x) => x.id === id)?.out ?? false;
          const eightReady = !!p?.group && ids.every(out);
          return (
            <span key={i} className={`flex flex-wrap items-center gap-2 bg-espresso/70 px-3 py-1 ${active ? "outline outline-2 outline-amber" : ""} ${p?.mine ? "text-mint" : "text-cream"}`}>
              {p ? <>{p.bot ? "🤖 " : ""}{p.name}{p.mine ? " (you)" : ""}{p.group ? <span className="text-latte">· {p.group}s</span> : view.phase === "play" ? <span className="text-latte">· open table</span> : null}</> : <span className="text-latte">empty stool</span>}
              {p?.group && <span className="flex items-center gap-0.5" aria-label={`${p.group} balls`}>{ids.map((id) => <BallIcon key={id} id={id} out={out(id)} />)}{eightReady && <BallIcon id={8} out={out(8)} />}</span>}
            </span>
          );
        })}
        {view.stake > 0 && <span className="text-amber">Stake {view.stake} each</span>}
      </div>
      <canvas
        ref={canvas} width={PW * PSCALE} height={PH * PSCALE}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => { gesture.current = null; aim.current.power = 0; setPowerUi(0); }}
        onPointerLeave={() => { hoverPocket.current = null; }}
        className={`block w-full border-4 border-bark ${myTurn ? (inHand ? "cursor-grab" : "cursor-crosshair") : ""}`} style={{ aspectRatio: `${PW}/${PH}`, touchAction: "none" }}
        aria-label="Pool table: move to aim, press and drag back to pull the cue, release to shoot"
      />
      {view.phase === "play" && view.me >= 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-3" role="group" aria-label="Shot controls">
          <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-latte">
            Power
            <input type="range" min={0} max={100} value={powerUi} disabled={!myTurn} className="w-full accent-amber" aria-label="Shot power"
              onChange={(e) => { const v = Number(e.target.value); aim.current.power = v / 100; setPowerUi(v); }} />
            <b className="w-10 text-right text-cream">{powerUi}%</b>
          </label>
          <button className="px-btn !py-1" disabled={!myTurn || powerUi < 5} onClick={() => void shoot(aim.current.power)}>Shoot</button>
          <button className="px-btn secondary !px-3 !py-1" disabled={!myTurn} aria-label="Aim left" onClick={() => { aim.current.angle -= 0.01; }}>◀</button>
          <button className="px-btn secondary !px-3 !py-1" disabled={!myTurn} aria-label="Aim right" onClick={() => { aim.current.angle += 0.01; }}>▶</button>
        </div>
      )}
      <p className="mt-2 min-h-7 text-xl text-amber" role="status" aria-live="polite">
        {view.phase === "play" ? (myTurn
          ? `Your shot${left !== null ? ` (${left}s)` : ""}: ${inHand ? `BALL IN HAND, drag the cue ball${view.kitchen ? " behind the head string" : " anywhere"}, then aim. ` : ""}${needsCall ? (call === null ? "Click a pocket to call it for the 8-ball. " : `8-ball called in pocket ${call + 1}. `) : ""}Move to aim, press and drag back to pull the cue, release to shoot.`
          : animating ? "Balls rolling…" : `${turnName}'s turn.`) : ""} {view.msg}
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
      <p className="mt-2 text-sm text-latte">Aim: move the mouse (or A/D and the arrow keys, Shift for fine steps). Power: press and drag back like pulling a cue, or hold Space and let go, or use the slider and Shoot. The guide shows where the cue ball hits first (and the cushion bounce if it misses). Break, sink your group (solids 1-7 or stripes 9-15), then call a pocket and sink the 8-ball in it. Fouls (scratch, wrong ball first, nothing hit, no rail after contact) give your opponent the cue ball in hand. Sinking the 8 early, on a scratch or in the wrong pocket loses. Beat the bot with a stake and you get 1.8x back. Stakes are fictional Cafe Beans.</p>
    </ArcadeFrame>
  );
}
