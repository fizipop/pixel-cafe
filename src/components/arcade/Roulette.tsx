"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  BET_PRESETS, WHEEL_ORDER, rouletteColor, type RouletteBet, type RouletteBetKind,
} from "@/shared/arcade";
import { ArcadeFrame, useBeans, useCountdown, type ArcadeProps } from "./ui";

const COLORS = { red: "#d9304a", black: "#1f140d", green: "#1f6b4a" } as const;
const SLICE = 360 / WHEEL_ORDER.length;

/** The wheel, painted once on a canvas and rotated with CSS. Pocket i is centred at i * SLICE degrees from the top. */
function WheelCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    const S = c.width;
    const R = S / 2;
    g.setTransform(1, 0, 0, 1, 0, 0); // effects can run twice (StrictMode): always start from a clean canvas
    g.clearRect(0, 0, S, S);
    g.translate(R, R);
    g.fillStyle = "#5a3a22";
    g.beginPath(); g.arc(0, 0, R - 1, 0, Math.PI * 2); g.fill();
    WHEEL_ORDER.forEach((n, i) => {
      const a0 = ((i - 0.5) * SLICE - 90) * (Math.PI / 180);
      const a1 = ((i + 0.5) * SLICE - 90) * (Math.PI / 180);
      g.fillStyle = COLORS[rouletteColor(n)];
      g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R - 8, a0, a1); g.closePath(); g.fill();
      g.strokeStyle = "#f2c36b"; g.lineWidth = 1; g.stroke();
      g.save();
      g.rotate((i * SLICE) * (Math.PI / 180));
      g.fillStyle = "#fff6e0";
      g.font = `bold ${S * 0.06}px VT323, monospace`;
      g.textAlign = "center";
      g.fillText(String(n), 0, -R * 0.74);
      g.restore();
    });
    g.fillStyle = "#33200f"; g.beginPath(); g.arc(0, 0, R * 0.52, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#8a5a36"; g.beginPath(); g.arc(0, 0, R * 0.42, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#f2c36b"; g.beginPath(); g.arc(0, 0, R * 0.12, 0, Math.PI * 2); g.fill();
  }, []);
  return <canvas ref={ref} width={260} height={260} className="h-full w-full" aria-hidden />;
}

const OUTSIDE: { kind: RouletteBetKind; label: string; cls: string }[] = [
  { kind: "red", label: "Red ×2", cls: "bg-[#d9304a] text-foam" },
  { kind: "black", label: "Black ×2", cls: "bg-[#1f140d] text-foam" },
  { kind: "odd", label: "Odd ×2", cls: "bg-bark text-cream" },
  { kind: "even", label: "Even ×2", cls: "bg-bark text-cream" },
  { kind: "low", label: "1-18 ×2", cls: "bg-bark text-cream" },
  { kind: "high", label: "19-36 ×2", cls: "bg-bark text-cream" },
];
const betLabel = (b: RouletteBet) => (b.kind === "num" ? `#${b.n}` : b.kind === "low" ? "1-18" : b.kind === "high" ? "19-36" : b.kind);

/** Roulette: the wheel, the shared countdown and your chips. Everyone at the table (seated or watching) sees the same spin. */
export default function Roulette({ net, onClose, sfx, onStand, announce }: ArcadeProps) {
  const beans = useBeans(net);
  const view = useSyncExternalStore(net.subscribe, () => net.roulette, () => null);
  const [chip, setChip] = useState(10);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const [angle, setAngle] = useState(0);
  const [dur, setDur] = useState(0);
  const lastRound = useRef<{ phase?: string; result?: number | null }>({});
  const angleRef = useRef(0);
  const left = useCountdown(view?.deadline, view?.now);

  useEffect(() => {
    void net.call("roulette:join");
    return () => { net.socket.emit("roulette:leave"); };
  }, [net]);

  // spin the wheel when the server starts a spin (or snap to the result if we arrive late); hold the balance until it lands
  useEffect(() => {
    if (!view) return;
    const last = lastRound.current;
    if (view.phase === "spin" && (last.phase !== "spin" || last.result !== view.result) && view.result !== null) {
      const idx = WHEEL_ORDER.indexOf(view.result);
      const target = -idx * SLICE;
      const remaining = Math.max(600, (view.deadline ?? view.now + view.spinMs) - view.now);
      const cur = angleRef.current;
      const next = cur + 5 * 360 + ((((target - cur) % 360) + 360) % 360);
      angleRef.current = next;
      queueMicrotask(() => { setDur(remaining); setAngle(next); });
      sfx("spin"); // winnings are only paid when the ball settles, so the balance never spoils the spin
    } else if (view.phase === "result" && last.phase !== "result") {
      if (last.phase !== "spin" && view.result !== null) { // arrived during the result screen: no animation
        const target = -WHEEL_ORDER.indexOf(view.result) * SLICE;
        angleRef.current = target;
        queueMicrotask(() => { setDur(0); setAngle(target); });
      }
      const staked = view.mine.reduce((n, b) => n + b.amount, 0);
      if (staked > 0) {
        const back = view.returned ?? 0;
        if (back > 0) { sfx(back >= staked * 5 ? "jackpot" : "cashout"); announce(back >= staked * 30 ? "JACKPOT!" : back >= staked * 5 ? "BIG WIN!" : "WINNER!"); queueMicrotask(() => setMsg({ text: `${view.result} comes up! You won ${back} (net ${back - staked >= 0 ? "+" : ""}${back - staked}).`, good: true })); }
        else { sfx("lose"); if (staked >= 50) announce("BETTER LUCK NEXT TIME!"); queueMicrotask(() => setMsg({ text: `${view.result} comes up. No win this time.`, good: false })); }
      }
    } else if (view.phase === "bet" && last.phase !== "bet") {
      queueMicrotask(() => setMsg(null));
    }
    lastRound.current = { phase: view.phase, result: view.result };
  }, [view, sfx, announce]);

  const place = async (bet: Omit<RouletteBet, "amount">) => {
    const r = await net.call("roulette:bet", { ...bet, amount: chip });
    if (!r.ok) setMsg({ text: r.reason, good: false });
    else { sfx("chip"); setMsg(null); }
  };
  const clear = async () => {
    const r = await net.call("roulette:clear");
    if (!r.ok) setMsg({ text: r.reason, good: false });
    else sfx("place");
  };

  const open = view?.phase === "bet";
  const totalStake = view?.mine.reduce((n, b) => n + b.amount, 0) ?? 0;
  const grid = useMemo(() => [3, 2, 1].map((r) => Array.from({ length: 12 }, (_, c) => c * 3 + r)), []);
  const stakeOn = (kind: RouletteBetKind, n?: number) => view?.mine.filter((b) => b.kind === kind && b.n === n).reduce((s, b) => s + b.amount, 0) ?? 0;

  return (
    <ArcadeFrame title="Roulette" net={net} onClose={onClose} width="max-w-3xl" accent="text-[#ff9bd0]">
      <div className="grid gap-4 md:grid-cols-[17rem_1fr]">
        <div className="flex flex-col items-center gap-2">
          <div className="relative h-64 w-64">
            <div className="h-full w-full rounded-full shadow-[0_0_28px_#ff9bd055]" style={{ transform: `rotate(${angle}deg)`, transition: dur ? `transform ${dur}ms cubic-bezier(0.12, 0.6, 0.12, 1)` : "none" }}>
              <WheelCanvas />
            </div>
            <div className="absolute left-1/2 top-0 h-5 w-3 -translate-x-1/2 bg-foam [clip-path:polygon(0_0,100%_0,50%_100%)]" aria-hidden />
            <div className="pointer-events-none absolute inset-0 grid place-items-center">
              {view?.phase !== "spin" && view?.result !== null && view?.result !== undefined && (
                <span className="grid h-14 w-14 place-items-center rounded-full border-4 border-amber font-pixel text-sm text-foam" style={{ background: COLORS[rouletteColor(view.result)] }} aria-label={`Result ${view.result}`}>{view.result}</span>
              )}
            </div>
          </div>
          <p className="font-pixel text-[0.65rem] text-cream" aria-live="polite">
            {!view ? "Joining the table…" : view.phase === "bet" ? (left === null ? "Place a bet to start" : `Bets close in ${left}s`) : view.phase === "spin" ? "No more bets…" : "Round over"}
          </p>
          {!!view?.history.length && (
            <ul className="flex flex-wrap justify-center gap-1" aria-label="Recent numbers">
              {[...view.history].reverse().map((n, i) => (
                <li key={i} className="grid h-6 w-7 place-items-center text-base text-foam" style={{ background: COLORS[rouletteColor(n)] }}>{n}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-latte">Chip:</span>
            {BET_PRESETS.map((p) => <button key={p} className={`px-btn !px-2 !py-1 ${chip === p ? "active" : "secondary"}`} onClick={() => setChip(p)} aria-pressed={chip === p}>{p}</button>)}
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[26rem]">
              <button className={`mb-1 w-full border-2 border-amber bg-[#1f6b4a] py-1 text-foam ${stakeOn("num", 0) ? "outline outline-2 outline-amber" : ""}`} disabled={!open} onClick={() => void place({ kind: "num", n: 0 })} aria-label="Bet on 0">
                0 {stakeOn("num", 0) > 0 && <b className="text-amber">({stakeOn("num", 0)})</b>}
              </button>
              {grid.map((row, i) => (
                <div key={i} className="mb-1 grid grid-cols-12 gap-1">
                  {row.map((n) => (
                    <button key={n} className={`relative h-9 text-lg text-foam ${stakeOn("num", n) ? "outline outline-2 outline-amber" : ""}`} style={{ background: COLORS[rouletteColor(n)] }} disabled={!open} onClick={() => void place({ kind: "num", n })} aria-label={`Bet on ${n}`}>
                      {n}
                      {stakeOn("num", n) > 0 && <span className="absolute -right-1 -top-1 bg-amber px-1 text-xs text-espresso">{stakeOn("num", n)}</span>}
                    </button>
                  ))}
                </div>
              ))}
              <p className="text-sm text-latte">A single number pays ×36.</p>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {OUTSIDE.map((o) => (
              <button key={o.kind} className={`px-btn !py-2 !text-[0.6rem] ${o.cls}`} disabled={!open} onClick={() => void place({ kind: o.kind })}>
                {o.label}{stakeOn(o.kind) > 0 ? ` · ${stakeOn(o.kind)}` : ""}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 bg-espresso/70 p-2 text-lg">
            <span className="text-latte">
              Your bets: {view?.mine.length ? view.mine.map(betLabel).join(", ") : "none"} · staked <b className="text-cream">{totalStake}</b>
            </span>
            <span className="flex gap-2">
              <button className="px-btn secondary !py-1" disabled={!open || totalStake === 0} onClick={() => void clear()}>Take chips back</button>
              {onStand && <button className="px-btn secondary !py-1" onClick={onStand}>Leave table</button>}
            </span>
          </div>
          <p className="min-h-7 text-xl" role="status">
            {msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}
            {!msg && open && beans < chip && <span className="text-ember">Not enough beans for that chip.</span>}
          </p>
          <p className="text-sm text-latte">{view?.watching ?? 0} betting this round. European wheel (one zero).</p>
        </div>
      </div>
    </ArcadeFrame>
  );
}
