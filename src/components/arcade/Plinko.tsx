"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PLINKO_GATES, PLINKO_ROWS, PLINKO_SLOTS, PLINKO_TABLES, plinkoOdds, type PlinkoGate } from "@/shared/casino";
import type { PlinkoResult } from "@/shared/protocol";
import { ArcadeFrame, BetPicker, useBeans, type ArcadeProps } from "./ui";

// Board geometry (canvas pixels). Positions are counted in half-peg steps from the centre, like the shared rules.
const W = 380, H = 470, DX = 13, DY = 28, TOP = 58, CX = W / 2;
const px = (x: number) => CX + x * DX;
const rowY = (r: number) => TOP + r * DY;
const SLOT_Y = rowY(PLINKO_ROWS) + 6;
const ROW_MS = 165;

type Ball = { path: (-1 | 1)[]; gate: PlinkoGate; t0: number; slot: number; done: boolean };

function multColour(m: number) {
  return m >= 6 ? "#ff3b6b" : m >= 2 ? "#ff8a3a" : m >= 1 ? "#f2c36b" : m >= 0.5 ? "#7fc8a9" : "#58a6e0";
}

/** Where the ball is `ms` into its fall: a hop off each peg, then a drop into the slot. Replays the server's path exactly. */
function ballAt(b: Ball, ms: number) {
  let x = PLINKO_GATES[b.gate] * 2;
  const row = Math.floor(ms / ROW_MS);
  if (row < 0) return { x: px(x), y: TOP - 34 + Math.min(1, (ms + 300) / 300) * 20, row: -1 };
  if (row >= PLINKO_ROWS) {
    for (const d of b.path) x += d;
    const t = Math.min(1, (ms - PLINKO_ROWS * ROW_MS) / 220);
    return { x: px(x), y: rowY(PLINKO_ROWS) - 6 + t * 18, row: PLINKO_ROWS };
  }
  for (let r = 0; r < row; r++) x += b.path[r];
  const t = (ms - row * ROW_MS) / ROW_MS;
  const x1 = x + b.path[row];
  // off the peg: a little hop up, then gravity brings it down onto the next row's peg
  const y = rowY(row) - 7 - 9 * t + (DY + 9) * t * t;
  return { x: px(x) + (px(x1) - px(x)) * t, y, row };
}

/** Plinko: pick a gate and a bet, drop the ball. The server rolls the path and pays; this window replays it. */
export default function Plinko({ net, onClose, sfx, announce }: ArcadeProps) {
  const beans = useBeans(net);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bet, setBet] = useState(10);
  const [gate, setGate] = useState<PlinkoGate>(1);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const [history, setHistory] = useState<{ mult: number; win: number }[]>([]);
  const ball = useRef<Ball | null>(null);
  const flash = useRef<{ slot: number; until: number } | null>(null);
  const hitPeg = useRef<{ row: number; x: number; until: number } | null>(null);
  const gateRef = useRef(gate);
  useEffect(() => { gateRef.current = gate; }, [gate]);
  const timer = useRef(0);
  useEffect(() => () => { window.clearTimeout(timer.current); net.release(); }, [net]); // closing mid-drop: the payout already happened server-side

  const finish = useCallback((r: PlinkoResult) => {
    net.release();
    setBusy(false);
    setHistory((h) => [{ mult: r.mult, win: r.win }, ...h].slice(0, 8));
    const table = PLINKO_TABLES[r.gate], top = Math.max(...table);
    if (r.mult >= top) { sfx("jackpot"); announce("JACKPOT!"); }
    else if (r.mult >= 3) { sfx("jackpot"); announce("BIG WIN!"); }
    else if (r.win > bet) { sfx("win"); sfx("coin"); announce("WINNER!"); }
    else if (r.win > 0) sfx("coin");
    else sfx("lose");
    if (r.mult < top && (r.slot === 1 || r.slot === PLINKO_SLOTS - 2)) { sfx("nearMiss"); announce("SO CLOSE!"); } // one slot off the top prize
    setMsg(r.win > 0
      ? { text: `×${r.mult} — you get ${r.win} beans${r.win > bet ? ` (+${r.win - bet})` : ""}`, good: r.win >= bet }
      : { text: `×${r.mult} — no beans this time.`, good: false });
  }, [announce, bet, net, sfx]);

  // draw loop
  useEffect(() => {
    let raf = 0;
    const loop = (now: number) => {
      const c = canvas.current?.getContext("2d");
      if (c) {
        const g = ball.current?.gate ?? gateRef.current;
        const table = PLINKO_TABLES[g];
        // cabinet glass
        const bg = c.createLinearGradient(0, 0, 0, H);
        bg.addColorStop(0, "#160c2e"); bg.addColorStop(1, "#0a0618");
        c.fillStyle = bg; c.fillRect(0, 0, W, H);
        c.fillStyle = "rgba(160,200,255,0.05)";
        for (let k = 0; k < 6; k++) { c.beginPath(); c.moveTo(30 + k * 70, 0); c.lineTo(70 + k * 70, 0); c.lineTo(k * 70 - 40, H); c.lineTo(k * 70 - 80, H); c.fill(); } // glass reflections
        // drop chute and gates
        c.fillStyle = "#2a1a4a"; c.fillRect(px(-6) - 10, 8, px(6) - px(-6) + 20, 20);
        PLINKO_GATES.forEach((off, k) => {
          const on = k === g;
          c.fillStyle = on ? "#f2c36b" : "#4a3a6a"; c.fillRect(px(off * 2) - 9, 10, 18, 16);
          c.fillStyle = on ? "#1f140d" : "#9a8ab8"; c.font = "bold 11px monospace"; c.textAlign = "center"; c.fillText(["L", "C", "R"][k], px(off * 2), 22);
        });
        // pegs: a staggered field (every row has the parity the ball will have when it reaches it)
        for (let r = 0; r < PLINKO_ROWS; r++) for (let x = -PLINKO_ROWS; x <= PLINKO_ROWS; x++) {
          if ((x + r) % 2 !== 0) continue;
          const lit = hitPeg.current && hitPeg.current.row === r && hitPeg.current.x === x && now < hitPeg.current.until;
          c.fillStyle = lit ? "#fff6e0" : "#9fb8d8";
          c.beginPath(); c.arc(px(x), rowY(r), lit ? 3.6 : 2.8, 0, Math.PI * 2); c.fill();
          c.fillStyle = "rgba(255,255,255,0.6)"; c.fillRect(px(x) - 1.5, rowY(r) - 1.8, 1.4, 1.4);
        }
        // walls
        c.fillStyle = "#3a2a5a"; c.fillRect(px(-PLINKO_ROWS) - 14, TOP - 10, 6, SLOT_Y - TOP + 40); c.fillRect(px(PLINKO_ROWS) + 8, TOP - 10, 6, SLOT_Y - TOP + 40);
        // multiplier slots
        for (let s = 0; s < PLINKO_SLOTS; s++) {
          const x = px(s * 2 - PLINKO_ROWS), m = table[s];
          const lit = flash.current && flash.current.slot === s && now < flash.current.until && Math.floor(now / 120) % 2 === 0;
          c.fillStyle = lit ? "#fff6e0" : multColour(m);
          c.fillRect(x - 12, SLOT_Y + 6, 24, 34);
          c.fillStyle = "#0a0618"; c.fillRect(x - 12, SLOT_Y + 6, 1, 34);
          c.fillStyle = "#0a0618"; c.font = "bold 10px monospace"; c.textAlign = "center";
          c.fillText(m >= 10 ? String(Math.round(m)) : String(m), x, SLOT_Y + 22);
          c.fillText("×", x, SLOT_Y + 34);
        }
        // the ball
        const b = ball.current;
        if (b) {
          const ms = now - b.t0;
          const p = ballAt(b, ms);
          if (p.row >= 0 && p.row < PLINKO_ROWS) {
            let x = PLINKO_GATES[b.gate] * 2; for (let r = 0; r < p.row; r++) x += b.path[r];
            if (!hitPeg.current || hitPeg.current.row !== p.row) { hitPeg.current = { row: p.row, x, until: now + 120 }; sfx("peg"); }
          }
          c.fillStyle = "rgba(0,0,0,0.35)"; c.beginPath(); c.ellipse(p.x + 2, p.y + 4, 6, 3, 0, 0, Math.PI * 2); c.fill();
          const grd = c.createRadialGradient(p.x - 2, p.y - 2, 1, p.x, p.y, 7);
          grd.addColorStop(0, "#fffbe8"); grd.addColorStop(0.5, "#f2c36b"); grd.addColorStop(1, "#b07a10");
          c.fillStyle = grd; c.beginPath(); c.arc(p.x, p.y, 6.5, 0, Math.PI * 2); c.fill();
          if (!b.done && ms > PLINKO_ROWS * ROW_MS + 220) {
            b.done = true; // finish exactly once, whatever the frame timing
            flash.current = { slot: b.slot, until: now + 1600 };
            sfx("land");
          }
        }
        // marquee
        c.fillStyle = "#ff5fa8"; c.font = "bold 12px monospace"; c.textAlign = "center"; c.fillText("★ PIXEL PLINKO ★", CX, H - 8);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [sfx]);

  const drop = useCallback(async () => {
    if (busy) return;
    const before = net.beans;
    if (before < bet) { setMsg({ text: "Not enough Cafe Beans for that bet.", good: false }); return; }
    setBusy(true);
    setMsg(null);
    const r = await net.call<PlinkoResult>("plinko:drop", { bet, gate });
    if (!r.ok) { setBusy(false); setMsg({ text: r.reason, good: false }); return; }
    net.hold(before - bet); // the balance shows the stake gone until the ball lands
    sfx("coin");
    const now = performance.now();
    ball.current = { path: r.path, gate: r.gate, t0: now + 300, slot: r.slot, done: false };
    hitPeg.current = null;
    timer.current = window.setTimeout(() => finish(r), 300 + PLINKO_ROWS * ROW_MS + 260);
  }, [bet, busy, finish, gate, net, sfx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); void drop(); }
      if (!busy && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { setGate((g) => Math.max(0, Math.min(2, g + (e.key === "ArrowLeft" ? -1 : 1))) as PlinkoGate); sfx("select"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, drop, sfx]);

  const odds = plinkoOdds(gate);
  const best = Math.max(...PLINKO_TABLES[gate]);
  const bestOdds = odds.reduce((s, p, i) => s + (PLINKO_TABLES[gate][i] === best ? p : 0), 0);
  return (
    <ArcadeFrame title="Pixel Plinko" net={net} onClose={onClose} width="max-w-3xl" accent="text-[#ff5fa8]">
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <div className="mx-auto self-start border-4 border-[#ff5fa8] bg-black p-1 shadow-[0_0_28px_#ff5fa866]">
          <canvas ref={canvas} width={W} height={H} className="block max-w-full" aria-label="Plinko board" />
        </div>
        <div className="flex flex-col gap-3">
          <div role="group" aria-label="Drop gate" className="flex items-center gap-2">
            <span className="text-latte">Drop gate:</span>
            {(["Left", "Centre", "Right"] as const).map((name, k) => (
              <button key={name} className={`px-btn !px-3 !py-1 ${gate === k ? "active" : "secondary"}`} disabled={busy} aria-pressed={gate === k} onClick={() => { setGate(k as PlinkoGate); sfx("select"); }}>{name}</button>
            ))}
          </div>
          <BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy} />
          <button className="px-btn !py-4 !text-sm" disabled={busy || beans < bet} onClick={() => void drop()}>{busy ? "Dropping…" : `Drop ball (${bet})`}</button>
          <p className="min-h-7 text-xl" role="status">{msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}</p>
          <div className="bg-espresso/70 p-3 text-latte">
            <p>The ball bounces off 12 rows of pegs and pays the multiplier of the slot it lands in. Each gate has its own multiplier row (the side gates land near the big edge slots more often, so those slots pay less there): every gate returns the same {Math.round(94)}% in the long run.</p>
            <p className="mt-1">Top prize from this gate: <b className="text-cream">×{best}</b> (about 1 in {Math.round(1 / bestOdds).toLocaleString()} drops).</p>
            <p className="mt-1 text-sm">Arrow keys pick a gate · Enter or Space drops.</p>
          </div>
          {history.length > 0 && (
            <div className="flex flex-wrap gap-1" aria-label="Recent drops">
              {history.map((h, i) => <span key={i} className="px-2 py-0.5 text-espresso" style={{ background: multColour(h.mult) }}>×{h.mult}</span>)}
            </div>
          )}
        </div>
      </div>
    </ArcadeFrame>
  );
}
