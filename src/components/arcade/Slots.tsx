"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { SLOT_NAMES, SLOT_PAIR, SLOT_PAYS, SLOT_SYMBOLS, type SlotSymbol } from "@/shared/arcade";
import type { SlotsResult } from "@/shared/protocol";
import { ArcadeFrame, BetPicker, SlotSprite, useBeans, type ArcadeProps } from "./ui";

const STOPS = [700, 1100, 1500]; // when each reel stops (ms after the spin starts)
const pick = () => SLOT_SYMBOLS[Math.floor(Math.random() * SLOT_SYMBOLS.length)];

/** Pixel Slots: three reels with cafe symbols. The server rolls the result; this just animates it. */
export default function Slots({ net, onClose, sfx }: ArcadeProps) {
  const beans = useBeans(net);
  const [bet, setBet] = useState(10);
  const [reels, setReels] = useState<SlotSymbol[]>(["cup", "bean", "seven"]);
  const [spinning, setSpinning] = useState([false, false, false]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const spinRef = useRef([false, false, false]);
  const timers = useRef<number[]>([]);

  const clearTimers = useCallback(() => {
    timers.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); });
    timers.current = [];
  }, []);
  useEffect(() => () => { clearTimers(); net.release(); }, [clearTimers, net]);

  const spin = useCallback(async () => {
    if (busy) return;
    const before = net.beans;
    if (before < bet) { setMsg({ text: "Not enough Cafe Beans for that bet.", good: false }); return; }
    setBusy(true);
    setMsg(null);
    const r = await net.call<SlotsResult>("slots:spin", { bet });
    if (!r.ok) { setBusy(false); setMsg({ text: r.reason, good: false }); return; }
    net.hold(before - bet);
    sfx("spin");
    spinRef.current = [true, true, true];
    setSpinning([true, true, true]);
    timers.current.push(window.setInterval(() => setReels((cur) => cur.map((s, i) => (spinRef.current[i] ? pick() : s))), 75));
    STOPS.forEach((ms, i) => {
      timers.current.push(window.setTimeout(() => {
        spinRef.current[i] = false;
        setSpinning([...spinRef.current]);
        setReels((cur) => cur.map((s, k) => (k === i ? r.reels[i] : s)));
        sfx("reelStop");
      }, ms));
    });
    timers.current.push(window.setTimeout(() => {
      clearTimers();
      net.release();
      setBusy(false);
      if (r.win > 0) {
        sfx(r.mult >= 50 ? "jackpot" : "win");
        setMsg({ text: r.mult >= 50 ? `JACKPOT! +${r.win} beans` : `You win +${r.win} beans (×${r.mult})`, good: true });
      } else {
        sfx("lose");
        setMsg({ text: "No luck this time.", good: false });
      }
    }, STOPS[2] + 250));
  }, [bet, busy, clearTimers, net, sfx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); void spin(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spin]);

  return (
    <ArcadeFrame title="Pixel Slots" net={net} onClose={onClose} width="max-w-2xl">
      <div className="grid gap-4 sm:grid-cols-[1fr_14rem]">
        <div>
          <div className="mx-auto mb-4 flex w-fit gap-3 border-4 border-amber bg-bark p-3 shadow-[0_0_24px_#f2c36b55]">
            {reels.map((s, i) => (
              <div key={i} className={`grid h-28 w-24 place-items-center border-4 border-espresso bg-foam ${spinning[i] ? "animate-pulse" : ""}`} aria-label={`Reel ${i + 1}: ${SLOT_NAMES[s]}`}>
                <div className={spinning[i] ? "blur-[1px]" : ""}><SlotSprite symbol={s} scale={6} /></div>
              </div>
            ))}
          </div>
          <div className="mb-3 flex justify-center"><BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy} /></div>
          <div className="flex flex-col items-center gap-2">
            <button className="px-btn !px-8 !py-4 !text-sm" disabled={busy || beans < bet} onClick={() => void spin()}>
              {busy ? "Spinning…" : `Spin (${bet})`}
            </button>
            <p className="min-h-7 text-xl" role="status">
              {msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}
              {!msg && beans < bet && <span className="text-ember">Not enough beans for this bet.</span>}
            </p>
          </div>
        </div>
        <div className="bg-espresso/70 p-3">
          <h3 className="mb-2 font-pixel text-[0.6rem] text-amber">Payouts (× bet)</h3>
          <ul className="space-y-1.5">
            {[...SLOT_SYMBOLS].sort((a, b) => SLOT_PAYS[b] - SLOT_PAYS[a]).map((s) => (
              <li key={s} className="flex items-center justify-between gap-2">
                <span className="flex"><SlotSprite symbol={s} scale={2} /><SlotSprite symbol={s} scale={2} /><SlotSprite symbol={s} scale={2} /></span>
                <b className="text-cream">×{SLOT_PAYS[s]}</b>
              </li>
            ))}
            <li className="flex items-center justify-between border-t-4 border-bark pt-1.5 text-latte">
              <span>Any pair on reels 1 + 2</span><b className="text-cream">×{SLOT_PAIR}</b>
            </li>
          </ul>
        </div>
      </div>
    </ArcadeFrame>
  );
}
