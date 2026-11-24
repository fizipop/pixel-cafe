"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import CharacterPreview from "../CharacterPreview";
import { CRASH_CAP } from "@/shared/arcade";
import { ArcadeFrame, BetPicker, BOOM, FLAME, ROCKET, useBeans, useCountdown, type ArcadeProps } from "./ui";

const multColor = (m: number) => (m < 1.5 ? "text-ember" : m < 3 ? "text-amber" : "text-mint");

/** To the Moon: one shared rocket for everyone watching. Bet while it's on the pad, cash out before it fizzles. */
export default function Moon({ net, onClose, sfx }: ArcadeProps) {
  const beans = useBeans(net);
  const view = useSyncExternalStore(net.subscribe, () => net.crash, () => null);
  const [bet, setBet] = useState(10);
  const [auto, setAuto] = useState("");
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(view?.deadline, view?.now);
  const prev = useRef<{ phase?: string; cashed?: number }>({});

  useEffect(() => {
    void net.call("crash:join");
    return () => { net.socket.emit("crash:leave"); };
  }, [net]);

  // sound + messages on phase changes and when our own bet pays out
  useEffect(() => {
    if (!view) return;
    const p = prev.current;
    if (p.phase !== view.phase) {
      if (view.phase === "fly") sfx("jump");
      if (view.phase === "crashed") {
        sfx("boom");
        if (view.mine && !view.mine.cashedAt) queueMicrotask(() => setMsg({ text: `Crashed at ×${view.mult.toFixed(2)}. You lost ${view.mine?.amount} beans.`, good: false }));
      }
      if (view.phase === "wait") queueMicrotask(() => setMsg(null));
    }
    if (view.mine?.cashedAt && p.cashed !== view.mine.cashedAt) {
      sfx("cashout");
      queueMicrotask(() => setMsg({ text: `Cashed out at ×${view.mine?.cashedAt?.toFixed(2)}: +${view.mine?.payout} beans`, good: true }));
    }
    prev.current = { phase: view.phase, cashed: view.mine?.cashedAt };
  }, [view, sfx]);

  const place = async () => {
    if (busy) return;
    const target = auto.trim() === "" ? undefined : Number(auto);
    setBusy(true);
    setMsg(null);
    const r = await net.call("crash:bet", { amount: bet, auto: target });
    setBusy(false);
    if (!r.ok) setMsg({ text: r.reason, good: false });
    else sfx("chip");
  };
  const cash = async () => {
    if (busy) return;
    setBusy(true);
    const r = await net.call("crash:cashout");
    setBusy(false);
    if (!r.ok) setMsg({ text: r.reason, good: false });
  };

  const phase = view?.phase ?? "wait";
  const mult = view?.mult ?? 1;
  const flying = phase === "fly";
  const crashed = phase === "crashed";
  const mine = view?.mine ?? null;
  const live = flying && mine && !mine.cashedAt;
  // the rocket climbs on a log scale so 1x..20x all fit on screen
  const climb = Math.min(1, Math.log(Math.max(1, mult)) / Math.log(20));
  const bottom = flying || crashed ? 8 + climb * 62 : 6;

  return (
    <ArcadeFrame title="To the Moon" net={net} onClose={onClose} width="max-w-3xl" accent="text-mint">
      <div className="grid gap-3 md:grid-cols-[1fr_14rem]">
        <div>
          <div className="relative h-72 overflow-hidden border-4 border-bark bg-[#0c1030]" aria-label="Rocket flight">
            <div className="absolute inset-0 opacity-70" style={{ backgroundImage: "radial-gradient(#fff6e0 1px, transparent 1.5px), radial-gradient(#9fb8d8 1px, transparent 1.5px)", backgroundSize: "46px 46px, 71px 71px", backgroundPosition: `0 ${flying ? (climb * 400) % 46 : 0}px, 13px ${flying ? (climb * 700) % 71 : 0}px` }} />
            <div className="absolute right-6 top-4 h-12 w-12 rounded-full bg-[#e8e0c0] shadow-[0_0_24px_#e8e0c088]" aria-hidden />
            <div className="absolute inset-x-0 bottom-0 h-8 bg-[#1f3a2a]" aria-hidden />
            <div className="absolute left-1/2 -translate-x-1/2 transition-[bottom] duration-100 ease-linear" style={{ bottom: `${bottom}%` }}>
              {crashed ? <CharacterPreview pixels={BOOM.pixels} cols={BOOM.cols} scale={6} /> : (
                <div className={`flex flex-col items-center ${flying ? "animate-pulse" : ""}`}>
                  <CharacterPreview pixels={ROCKET.pixels} cols={ROCKET.cols} scale={5} />
                  {flying && <CharacterPreview pixels={FLAME.pixels} cols={FLAME.cols} scale={5} />}
                </div>
              )}
            </div>
            <div className="absolute inset-x-0 top-3 text-center" aria-live="polite">
              {phase === "wait" && <p className="font-pixel text-xs text-cream">{left === null ? "Place a bet to start the countdown" : `Launch in ${left}s`}</p>}
              {flying && <p className={`font-pixel text-3xl ${multColor(mult)}`}>×{mult.toFixed(2)}</p>}
              {crashed && <p className="font-pixel text-2xl text-ember">Crashed ×{mult.toFixed(2)}</p>}
            </div>
          </div>
          {!!view?.history.length && (
            <ul className="mt-2 flex flex-wrap items-center gap-1.5" aria-label="Recent crashes">
              <li className="text-latte">Recent:</li>
              {[...view.history].reverse().map((h, i) => <li key={i} className={`bg-espresso px-1.5 ${multColor(h)}`}>×{h.toFixed(2)}</li>)}
            </ul>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {mine ? (
            <div className="bg-espresso/70 p-3">
              <p className="text-latte">Your bet: <b className="text-cream">{mine.amount}</b>{mine.auto ? ` · auto ×${mine.auto.toFixed(2)}` : ""}</p>
              {mine.cashedAt && <p className="text-mint">Cashed out ×{mine.cashedAt.toFixed(2)} (+{mine.payout})</p>}
              {live && <button className="px-btn mt-2 w-full !py-4 !text-sm" disabled={busy} onClick={() => void cash()}>Cash out {Math.floor(mine.amount * mult)}</button>}
              {flying && !live && !mine.cashedAt && <p className="text-latte">…</p>}
            </div>
          ) : (
            <div className="bg-espresso/70 p-3">
              <BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy || phase !== "wait"} />
              <label className="mt-2 flex items-center gap-2 text-latte">
                Auto cash-out ×
                <input className="px-input !w-24 !py-1 !text-lg" inputMode="decimal" placeholder="off" value={auto} disabled={phase !== "wait"}
                  onChange={(e) => setAuto(e.target.value.replace(/[^0-9.]/g, "").slice(0, 6))} aria-label="Auto cash-out multiplier" />
              </label>
              <p className="text-sm text-latte">1.01 to {CRASH_CAP}. Leave empty to cash out by hand.</p>
              <button className="px-btn mt-2 w-full !py-3" disabled={busy || phase !== "wait" || beans < bet} onClick={() => void place()}>
                {phase === "wait" ? `Bet ${bet}` : "Wait for the next flight"}
              </button>
            </div>
          )}
          <p className="min-h-7 text-lg" role="status">{msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}</p>
          <div className="bg-espresso/70 p-2">
            <h3 className="mb-1 font-pixel text-[0.6rem] text-amber">This flight ({view?.players.length ?? 0})</h3>
            <ul className="max-h-28 overflow-y-auto text-lg">
              {(view?.players ?? []).map((p, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{p.name}</span>
                  <span className={p.cashedAt ? "text-mint" : crashed ? "text-ember" : "text-latte"}>{p.cashedAt ? `×${p.cashedAt.toFixed(2)}` : p.amount}</span>
                </li>
              ))}
              {!view?.players.length && <li className="text-latte">No bets yet</li>}
            </ul>
          </div>
        </div>
      </div>
      <p className="mt-2 text-sm text-latte">Everyone watching sees the same rocket. Closing this window doesn&apos;t cash you out.</p>
    </ArcadeFrame>
  );
}
