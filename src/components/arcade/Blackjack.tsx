"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { rankOf, suitOf, type Card } from "@/shared/arcade";
import type { BjSeatView } from "@/shared/protocol";
import { ArcadeFrame, BetPicker, useBeans, useCountdown, type ArcadeProps } from "./ui";

const SUIT: Record<string, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };

export function PlayingCard({ card, fresh }: { card: Card; fresh?: boolean }) {
  const hidden = card === "??";
  const red = suitOf(card) === "H" || suitOf(card) === "D";
  return (
    <span
      className={`inline-grid h-16 w-11 place-items-center border-2 border-espresso text-lg leading-none ${fresh ? "animate-[flip_0.3s_ease-out]" : ""} ${hidden ? "bg-[repeating-linear-gradient(45deg,#3a5fd9_0_4px,#2a47a8_4px_8px)]" : "bg-foam"} ${red ? "text-[#d9304a]" : "text-espresso"}`}
      aria-label={hidden ? "Face-down card" : `${rankOf(card)} of ${suitOf(card)}`}
    >
      {!hidden && <span className="text-center"><b className="block">{rankOf(card)}</b>{SUIT[suitOf(card)]}</span>}
    </span>
  );
}

const STATUS_TEXT: Record<string, string> = { waiting: "Waiting…", bet: "Bet placed", playing: "Playing", stand: "Stands", bust: "Bust!", blackjack: "Blackjack!" };
const RESULT_TEXT: Record<string, string> = { blackjack: "Blackjack! ×2.5", win: "Wins!", push: "Push", lose: "Loses" };

function Seat({ seat, index, turn }: { seat: BjSeatView | null; index: number; turn: boolean }) {
  return (
    <div className={`min-h-36 min-w-0 flex-1 p-2 text-center ${seat ? "bg-espresso/70" : "bg-espresso/30"} ${turn ? "outline outline-4 outline-amber" : ""} ${seat?.mine ? "border-b-4 border-mint" : ""}`} aria-label={`Seat ${index + 1}`}>
      {!seat ? <p className="pt-10 text-latte">Seat {index + 1}<br />empty</p> : (
        <>
          <p className="truncate text-lg text-cream">{seat.name}{seat.mine ? " (you)" : ""}</p>
          <div className="my-1 flex min-h-16 flex-wrap justify-center gap-1">{seat.cards.map((c, i) => <PlayingCard key={i} card={c} fresh={i === seat.cards.length - 1} />)}</div>
          <p className="text-latte">{seat.cards.length ? `Total ${seat.total}` : ""}{seat.bet ? ` · bet ${seat.bet}` : ""}</p>
          <p className={seat.result ? (seat.result === "lose" ? "text-ember" : "text-mint") : seat.status === "bust" ? "text-ember" : "text-amber"}>
            {seat.result ? `${RESULT_TEXT[seat.result]}${seat.payout ? ` (+${seat.payout})` : ""}` : STATUS_TEXT[seat.status]}
          </p>
        </>
      )}
    </div>
  );
}

/** Blackjack against the house: up to four seated players share the same dealer and deal. */
export default function Blackjack({ net, onClose, sfx, onStand }: ArcadeProps) {
  const beans = useBeans(net);
  const view = useSyncExternalStore(net.subscribe, () => net.bj, () => null);
  const [bet, setBet] = useState(10);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = useCountdown(view?.deadline, view?.now);
  const seen = useRef({ cards: 0, phase: "" });

  // card flips, and a sound for the outcome of our own hand
  useEffect(() => {
    if (!view) return;
    const count = view.dealer.length + view.seats.reduce((n, s) => n + (s?.cards.length ?? 0), 0);
    if (count > seen.current.cards) sfx("cardFlip");
    if (view.phase === "payout" && seen.current.phase !== "payout") {
      const mine = view.seats[view.mySeat];
      if (mine?.result) sfx(mine.result === "lose" ? "lose" : mine.result === "blackjack" ? "jackpot" : mine.result === "win" ? "cashout" : "place");
    }
    seen.current = { cards: view.phase === "bet" ? 0 : count, phase: view.phase };
  }, [view, sfx]);

  const act = async (event: "bj:bet" | "bj:hit" | "bj:stand" | "bj:double", payload?: unknown) => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    const r = await net.call(event, payload);
    setBusy(false);
    if (!r.ok) setMsg(r.reason);
    else if (event === "bj:bet") sfx("chip");
  };

  const mine = view && view.mySeat >= 0 ? view.seats[view.mySeat] : null;
  const myTurn = !!view && view.phase === "play" && view.turn === view.mySeat && mine?.status === "playing";
  const canBet = !!view && view.phase === "bet" && !!mine && mine.status === "waiting";

  return (
    <ArcadeFrame title="Blackjack" net={net} onClose={onClose} width="max-w-4xl" accent="text-mint">
      <div className="bg-[#1f6b4a] p-3 shadow-[inset_0_0_30px_#0a3a26]">
        <div className="mb-3 text-center">
          <p className="text-lg text-cream">Dealer{view?.dealerTotal !== null && view?.dealerTotal !== undefined ? ` · ${view.dealerTotal}` : ""}</p>
          <div className="flex min-h-16 justify-center gap-1">{(view?.dealer ?? []).map((c, i) => <PlayingCard key={i} card={c} fresh={i === (view?.dealer.length ?? 0) - 1} />)}</div>
          <p className="text-sm text-[#bfe8d0]">Dealer stands on all 17s · Blackjack pays 3:2</p>
        </div>
        <div className="flex gap-2">
          {(view?.seats ?? [null, null, null, null]).map((s, i) => <Seat key={i} seat={s} index={i} turn={view?.phase === "play" && view.turn === i} />)}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-12">
          {!view && <p className="text-latte">Sit at the table to play.</p>}
          {canBet && (
            <div className="flex flex-wrap items-center gap-3">
              <BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy} />
              <button className="px-btn !py-2" disabled={busy || beans < bet} onClick={() => void act("bj:bet", { amount: bet })}>Deal me in ({bet})</button>
            </div>
          )}
          {view?.phase === "bet" && mine && mine.status === "bet" && <p className="text-xl text-mint">Bet in. {left !== null ? `Dealing in ${left}s…` : "Waiting for the others…"}</p>}
          {view?.phase === "bet" && mine?.status === "waiting" && left !== null && <p className="text-latte">Next deal in {left}s: place your bet!</p>}
          {myTurn && (
            <div className="flex flex-wrap items-center gap-2">
              <button className="px-btn !py-3" disabled={busy} onClick={() => void act("bj:hit")}>Hit</button>
              <button className="px-btn secondary !py-3" disabled={busy} onClick={() => void act("bj:stand")}>Stand</button>
              <button className="px-btn secondary !py-3" disabled={busy || !view?.canDouble || beans < (mine?.bet ?? 0)} onClick={() => void act("bj:double")}>Double down</button>
              {left !== null && <span className="text-latte">{left}s</span>}
            </div>
          )}
          {view && view.phase === "play" && !myTurn && <p className="text-latte">{view.turn !== null && view.turn !== view.mySeat ? `${view.seats[view.turn]?.name ?? "Another player"} is playing…` : "Waiting…"}</p>}
          {view?.phase === "dealer" && <p className="text-latte">Dealer plays…</p>}
          {view?.phase === "payout" && <p className="text-latte">Round over. Next round starting…</p>}
        </div>
        {onStand && <button className="px-btn secondary !py-2" onClick={onStand}>Leave table</button>}
      </div>
      <p className="min-h-7 text-xl text-ember" role="status">{msg}</p>
    </ArcadeFrame>
  );
}
