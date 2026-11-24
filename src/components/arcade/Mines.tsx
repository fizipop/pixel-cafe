"use client";
import { useEffect, useState } from "react";
import { MINES_MAX, MINES_MIN, MINES_TILES, minesMultiplier } from "@/shared/arcade";
import type { MinesView } from "@/shared/protocol";
import { ArcadeFrame, BetPicker, useBeans, type ArcadeProps } from "./ui";

/** Cafe Mines: 5x5 tiles, some hide a spilled coffee / burnt bean. Open safe tiles to grow the multiplier, cash out any time. */
export default function Mines({ net, onClose, sfx }: ArcadeProps) {
  const beans = useBeans(net);
  const [bet, setBet] = useState(10);
  const [mines, setMines] = useState(3);
  const [view, setView] = useState<MinesView | null>(null);
  const [lastHit, setLastHit] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);

  // pick up a round that was left running when the window was closed
  useEffect(() => {
    let live = true;
    void net.call<{ view: MinesView }>("mines:state").then((r) => { if (live && r.ok) { setView(r.view); setBet(r.view.bet); setMines(r.view.mines); } });
    return () => { live = false; };
  }, [net]);

  const run = async (event: "mines:start" | "mines:reveal" | "mines:cashout", payload?: unknown, tile?: number) => {
    if (busy) return;
    setBusy(true);
    const r = await net.call<{ view: MinesView }>(event, payload);
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.reason, good: false }); return; }
    const v = r.view;
    setView(v);
    if (event === "mines:start") { setMsg(null); setLastHit(null); sfx("chip"); return; }
    if (v.over === "hit") { setLastHit(tile ?? null); sfx("boom"); setMsg({ text: "Spilled coffee! You lost the bet.", good: false }); }
    else if (v.over === "cashed") { sfx("cashout"); setMsg({ text: `Cashed out ×${v.mult.toFixed(2)}: +${v.payout} beans`, good: true }); }
    else if (v.over === "cleared") { sfx("jackpot"); setMsg({ text: `Board cleared! ×${v.mult.toFixed(2)}: +${v.payout} beans`, good: true }); }
    else sfx("place");
  };

  const active = !!view?.active;
  const finished = !!view && !view.active;
  const hazards = new Set(view?.hazards ?? []);
  const opened = new Set(view?.revealed ?? []);
  const cashNow = view ? Math.floor(view.bet * view.mult) : 0;
  const previewNext = minesMultiplier(mines, 1);

  return (
    <ArcadeFrame title="Cafe Mines" net={net} onClose={onClose} width="max-w-2xl" accent="text-mint">
      <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="mx-auto grid w-fit grid-cols-5 gap-2 bg-espresso/70 p-3" role="grid" aria-label="Mines board">
          {Array.from({ length: MINES_TILES }, (_, i) => {
            const isOpen = opened.has(i);
            const isHazard = finished && hazards.has(i);
            return (
              <button
                key={i}
                className={`grid h-14 w-14 place-items-center border-4 text-2xl transition-transform ${
                  isHazard ? (i === lastHit ? "border-ember bg-ember/70" : "border-ember/60 bg-espresso")
                    : isOpen ? "border-mint bg-mint/30"
                    : "border-bark bg-roast hover:-translate-y-0.5"
                }`}
                disabled={!active || isOpen || busy}
                onClick={() => void run("mines:reveal", { tile: i }, i)}
                aria-label={isHazard ? "Spilled coffee" : isOpen ? "Safe tile" : `Tile ${i + 1}`}
              >
                {isHazard ? "☕" : isOpen ? "🫘" : ""}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          {active && view ? (
            <>
              <p className="text-xl text-latte">Bet <b className="text-cream">{view.bet}</b> · {view.mines} hazard{view.mines === 1 ? "" : "s"}</p>
              <p className="text-3xl text-mint" aria-live="polite">×{view.mult.toFixed(2)}</p>
              <p className="text-latte">Next safe tile: ×{view.next.toFixed(2)}</p>
              <button className="px-btn !py-3" disabled={busy} onClick={() => void run("mines:cashout")}>
                Cash out {cashNow} beans
              </button>
            </>
          ) : (
            <>
              <BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy} />
              <label className="block">
                <span className="text-latte">Hazards on the board: <b className="text-cream">{mines}</b></span>
                <input
                  type="range" min={MINES_MIN} max={MINES_MAX} value={mines}
                  onChange={(e) => { setMines(Number(e.target.value)); e.currentTarget.blur(); }}
                  className="mt-1 w-full accent-amber" aria-label="Number of hazards"
                />
                <span className="text-sm text-latte">More hazards = bigger multipliers, bigger risk. First tile pays ×{previewNext.toFixed(2)}.</span>
              </label>
              <button className="px-btn !py-3" disabled={busy || beans < bet} onClick={() => void run("mines:start", { bet, mines })}>
                {finished ? "Play again" : "Start round"} ({bet})
              </button>
            </>
          )}
          <p className="min-h-7 text-xl" role="status">{msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}</p>
        </div>
      </div>
    </ArcadeFrame>
  );
}
