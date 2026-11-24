"use client";
import { useEffect, useState } from "react";
import CharacterPreview from "../CharacterPreview";
import { PENGUIN_LANES, PENGUIN_LANE_IDS, PENGUIN_TILES, penguinCrackChance, penguinMultiplier, type PenguinLane } from "@/shared/arcade";
import type { PenguinView } from "@/shared/protocol";
import { ArcadeFrame, BetPicker, sprite, useBeans, type ArcadeProps } from "./ui";

const PENGUIN = sprite([
  "....kkkk....",
  "...kkkkkk...",
  "...kwkkwk...",
  "...kkoookk..",
  "..kkwwwwkk..",
  ".kkwwwwwwkk.",
  ".kkwwwwwwkk.",
  ".kkwwwwwwkk.",
  "..kkwwwwkk..",
  "...kkkkkk...",
  "...oo..oo...",
  "..ooo..ooo..",
], { k: "#1f2a44", w: "#fff6e0", o: "#f2a93b" });
const SPLASH = sprite([
  "..w....w..",
  ".w..ww..w.",
  "w.wwwwww.w",
  "..wbbbbw..",
  "wbbbbbbbbw",
  ".bbbbbbbb.",
], { w: "#e8f8ff", b: "#2a6a9a" });

/** Penguin Cross: hop across 12 cracking ice tiles. Each safe tile raises the multiplier; cash out any time before the next one gives way. */
export default function Penguin({ net, onClose, sfx }: ArcadeProps) {
  const beans = useBeans(net);
  const [bet, setBet] = useState(10);
  const [lane, setLane] = useState<PenguinLane>("thin");
  const [view, setView] = useState<PenguinView | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    let live = true;
    void net.call<{ view: PenguinView }>("penguin:state").then((r) => { if (live && r.ok) { setView(r.view); setBet(r.view.bet); setLane(r.view.lane); } });
    return () => { live = false; };
  }, [net]);

  const run = async (event: "penguin:start" | "penguin:step" | "penguin:cashout", payload?: unknown) => {
    if (busy) return;
    setBusy(true);
    const r = await net.call<{ view: PenguinView }>(event, payload);
    setBusy(false);
    if (!r.ok) { setMsg({ text: r.reason, good: false }); return; }
    const v = r.view;
    setView(v);
    if (event === "penguin:start") { setMsg(null); sfx("chip"); return; }
    if (v.over === "cracked") { sfx("splash"); setMsg({ text: "CRACK! The ice gave way and the penguin took a swim. Bet lost.", good: false }); }
    else if (v.over === "cashed") { sfx("cashout"); setMsg({ text: `Cashed out ×${v.mult.toFixed(2)}: +${v.payout} beans`, good: true }); }
    else if (v.over === "shore") { sfx("jackpot"); setMsg({ text: `Made it across! ×${v.mult.toFixed(2)}: +${v.payout} beans`, good: true }); }
    else sfx("jump");
  };

  const active = !!view?.active;
  const finished = !!view && !view.active;
  const steps = view?.steps ?? 0;
  const cracked = view?.over === "cracked";
  const cashNow = view ? Math.floor(view.bet * view.mult) : 0;
  const shownLane = view?.lane ?? lane;

  return (
    <ArcadeFrame title="Penguin Cross" net={net} onClose={onClose} width="max-w-4xl" accent="text-[#7fd8f0]">
      <div className="mb-3 overflow-x-auto bg-[#173a5a] p-3" role="group" aria-label="The ice crossing">
        <div className="flex min-w-[44rem] items-end gap-1">
          <div className="grid h-24 w-16 place-items-center bg-[#d8f4ff]/70 text-center text-sm text-espresso">START{steps === 0 && !cracked && <CharacterPreview pixels={PENGUIN.pixels} cols={PENGUIN.cols} scale={4} />}</div>
          {Array.from({ length: PENGUIN_TILES }, (_, i) => {
            const n = i + 1;
            const crossed = n <= steps;
            const here = n === steps && !cracked && steps > 0;
            const broke = cracked && n === steps + 1;
            const next = active && n === steps + 1;
            return (
              <div
                key={n}
                className={`relative grid h-24 flex-1 place-items-center border-b-8 text-center ${
                  broke ? "border-[#0b2a44] bg-[#2a6a9a]" : crossed ? "border-[#9fd0e8] bg-[#d8f4ff]" : next ? "border-[#9fd0e8] bg-[#b8e4f8] animate-pulse" : "border-[#4a7a9a] bg-[#8ac0e0]/60"
                }`}
                aria-label={broke ? `Tile ${n}: cracked` : crossed ? `Tile ${n}: safe` : `Tile ${n}`}
              >
                {here && <CharacterPreview pixels={PENGUIN.pixels} cols={PENGUIN.cols} scale={4} />}
                {broke && <CharacterPreview pixels={SPLASH.pixels} cols={SPLASH.cols} scale={4} />}
                {!here && !broke && <span className="text-xs text-espresso/70">×{penguinMultiplier(shownLane, n).toFixed(2)}</span>}
              </div>
            );
          })}
          <div className="grid h-24 w-16 place-items-center bg-[#7fe0a9]/80 text-center text-sm text-espresso">SHORE 🐟</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {active && view ? (
          <div className="flex flex-col gap-2">
            <p className="text-xl text-latte">Bet <b className="text-cream">{view.bet}</b> · {PENGUIN_LANES[view.lane].name} · tile {view.steps}/{view.tiles}</p>
            <p className="text-3xl text-mint" aria-live="polite">×{view.mult.toFixed(2)}</p>
            <p className="text-latte">Next tile pays ×{view.next.toFixed(2)} but cracks {Math.round(view.chance * 100)}% of the time.</p>
            <div className="flex flex-wrap gap-3">
              <button className="px-btn !py-3" disabled={busy} onClick={() => void run("penguin:step")}>Step forward</button>
              <button className="px-btn secondary !py-3" disabled={busy || view.steps < 1} onClick={() => void run("penguin:cashout")}>Cash out {cashNow}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy} />
            <div role="radiogroup" aria-label="Ice lane" className="flex flex-col gap-1">
              {PENGUIN_LANE_IDS.map((id) => (
                <button key={id} role="radio" aria-checked={lane === id} className={`px-btn !text-left ${lane === id ? "active" : "secondary"}`} onClick={() => setLane(id)}>
                  <b>{PENGUIN_LANES[id].name}</b> <span className="opacity-80">· first tile cracks {Math.round(penguinCrackChance(id, 1) * 100)}%, then climbs</span>
                  <span className="block text-sm opacity-80">{PENGUIN_LANES[id].blurb} Tile 5 pays ×{penguinMultiplier(id, 5).toFixed(2)}.</span>
                </button>
              ))}
            </div>
            <button className="px-btn !py-3" disabled={busy || beans < bet} onClick={() => void run("penguin:start", { bet, lane })}>
              {finished ? "Cross again" : "Start crossing"} ({bet})
            </button>
          </div>
        )}
        <div>
          <p className="min-h-14 text-xl" role="status">{msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}</p>
          <p className="text-sm text-latte">Every tile you cross can crack, and the chance grows with each step. Cash out after any safe step to lock in your Cafe Beans; reach the shore and you are paid automatically.</p>
        </div>
      </div>
    </ArcadeFrame>
  );
}
