"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PkSeatView } from "@/shared/protocol";
import { ArcadeFrame, useBeans, useCountdown, type ArcadeProps } from "./ui";
import { PlayingCard } from "./Blackjack";

const BUY_PRESETS = [100, 200, 500, 1000];

function SeatBox({ seat, index, turn, dealerSeat }: { seat: PkSeatView | null; index: number; turn: boolean; dealerSeat: boolean }) {
  return (
    <div className={`min-h-36 min-w-0 p-2 text-center ${seat ? "bg-espresso/70" : "bg-espresso/30"} ${turn ? "outline outline-4 outline-amber" : ""} ${seat?.mine ? "border-b-4 border-mint" : ""} ${seat?.folded ? "opacity-50" : ""}`} aria-label={`Seat ${index + 1}`}>
      {!seat ? <p className="pt-10 text-latte">Seat {index + 1}<br />empty</p> : (
        <>
          <p className="truncate text-lg text-cream">{dealerSeat && <span title="Dealer button" className="mr-1 bg-cream px-1 text-espresso">D</span>}{seat.bot ? "🤖 " : ""}{seat.name}{seat.mine ? " (you)" : ""}</p>
          <div className="my-1 flex min-h-16 justify-center gap-1">{seat.cards.map((c, i) => <PlayingCard key={i} card={c} />)}</div>
          <p className="text-latte">🫘 {seat.stack}{seat.bet > 0 ? <span className="text-amber"> · bet {seat.bet}</span> : ""}</p>
          <p className={seat.won ? "text-mint" : seat.folded ? "text-latte" : "text-amber"}>
            {seat.won ? `Wins ${seat.won}${seat.hand ? ` · ${seat.hand}` : ""}` : seat.folded ? "Folded" : seat.allIn ? "All-in" : seat.hand ?? ""}
          </p>
        </>
      )}
    </div>
  );
}

/** No-Limit Texas Hold'em: up to six seats, house bots to play against, a 20 second turn clock. */
export default function Poker({ net, onClose, sfx, onStand }: ArcadeProps) {
  const beans = useBeans(net);
  const view = useSyncExternalStore(net.subscribe, () => net.poker, () => null);
  const [raise, setRaise] = useState(0);
  const [buy, setBuy] = useState(200);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const left = useCountdown(view?.deadline, view?.now);
  const seen = useRef({ board: 0, phase: "" });

  useEffect(() => {
    if (!view) return;
    if (view.board.length > seen.current.board) sfx("cardFlip");
    if (view.phase === "showdown" && seen.current.phase !== "showdown") {
      const mine = view.seats[view.mySeat];
      if (mine?.won) sfx("cashout"); else if (mine && !mine.folded) sfx("lose");
    }
    seen.current = { board: view.board.length, phase: view.phase };
  }, [view, sfx]);

  const send = async (event: "pk:buyin" | "pk:act" | "pk:bot", payload: unknown) => {
    if (busy) return;
    setBusy(true); setErr("");
    const r = await net.call(event, payload);
    setBusy(false);
    if (!r.ok) setErr(r.reason); else sfx(event === "pk:act" ? "chip" : "place");
  };

  if (!view) return <ArcadeFrame title="Texas Hold'em" net={net} onClose={onClose} width="max-w-4xl" accent="text-mint"><p className="text-latte">Pulling up a chair…</p></ArcadeFrame>;

  const me = view.mySeat >= 0 ? view.seats[view.mySeat] : null;
  const myTurn = view.turn === view.mySeat && view.mySeat >= 0;
  const handLive = view.phase !== "wait" && view.phase !== "showdown";
  const canBuy = !!me && (!handLive || me.folded || !me.cards.length);
  const raiseTo = Math.min(view.maxRaise, Math.max(view.minRaise, raise || view.minRaise));
  const dealerIdx = view.seats.findIndex((s) => s?.dealer);
  const potNow = view.pot;
  const presets: [string, number][] = [["Min", view.minRaise], ["½ pot", view.toCall + view.minRaise + Math.round(potNow / 2)], ["Pot", view.toCall + view.minRaise + potNow], ["All-in", view.maxRaise]];

  return (
    <ArcadeFrame title="Texas Hold'em" net={net} onClose={onClose} width="max-w-4xl" accent="text-mint" onEsc={onClose}>
      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Seats">
        {view.seats.map((s, i) => <SeatBox key={i} seat={s} index={i} turn={view.turn === i} dealerSeat={dealerIdx === i} />)}
      </div>

      <div className="my-3 bg-[#1f6b4a] p-3 text-center">
        <div className="flex min-h-16 items-center justify-center gap-1" aria-label="Community cards">
          {view.board.length === 0 ? <span className="text-cream/70">{view.phase === "wait" ? "No hand in progress" : "Pre-flop"}</span> : view.board.map((c, i) => <PlayingCard key={i} card={c} />)}
        </div>
        <p className="text-xl text-cream">Pot <b data-testid="pot">{view.pot}</b> · blinds {view.blinds.sb}/{view.blinds.bb}</p>
      </div>
      <p className="min-h-7 text-xl text-amber" role="status" aria-live="polite">{view.msg}{left !== null && view.turn !== null && view.seats[view.turn] && !view.seats[view.turn]!.bot ? ` (${left}s)` : ""}</p>

      {me && me.stack === 0 || canBuy && view.phase === "wait" ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-latte">Buy chips ({view.buyIn.min} to {view.buyIn.max}):</span>
          {BUY_PRESETS.map((p) => <button key={p} className={`px-btn !px-2 !py-1 ${buy === p ? "active" : "secondary"}`} onClick={() => setBuy(p)}>{p}</button>)}
          <button className="px-btn" disabled={busy || beans < buy || !me} onClick={() => void send("pk:buyin", { amount: buy })}>Buy in for {buy}</button>
        </div>
      ) : null}

      {myTurn && me && (
        <div className="mt-3 flex flex-col gap-2 bg-espresso/70 p-3" role="group" aria-label="Your move">
          <div className="flex flex-wrap gap-2">
            <button className="px-btn danger" disabled={busy} onClick={() => void send("pk:act", { action: "fold" })}>Fold</button>
            {view.canCheck
              ? <button className="px-btn secondary" disabled={busy} onClick={() => void send("pk:act", { action: "check" })}>Check</button>
              : <button className="px-btn secondary" disabled={busy} onClick={() => void send("pk:act", { action: "call" })}>Call {view.toCall}{view.toCall >= me.stack ? " (all-in)" : ""}</button>}
            {view.maxRaise > view.minRaise - 1 && me.stack > view.toCall && (
              <button className="px-btn" disabled={busy} onClick={() => void send("pk:act", { action: "raise", amount: raiseTo })}>{view.canCheck && view.toCall === 0 ? "Bet" : "Raise to"} {raiseTo}</button>
            )}
          </div>
          {me.stack > view.toCall && (
            <div className="flex flex-wrap items-center gap-2">
              <input type="range" min={view.minRaise} max={Math.max(view.minRaise, view.maxRaise)} step={view.blinds.sb} value={raiseTo} onChange={(e) => { setRaise(Number(e.target.value)); e.currentTarget.blur(); }} className="w-40 accent-amber" aria-label="Raise amount" />
              {presets.map(([label, v]) => <button key={label} className="px-btn secondary !px-2 !py-1" onClick={() => setRaise(Math.min(view.maxRaise, Math.max(view.minRaise, v)))}>{label}</button>)}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className="px-btn secondary !py-1" disabled={busy || view.bots >= 5} onClick={() => void send("pk:bot", { add: true })}>+ Add bot</button>
        <button className="px-btn secondary !py-1" disabled={busy || view.bots === 0} onClick={() => void send("pk:bot", { add: false })}>− Remove bot</button>
        <span className="text-latte">{view.bots} bot{view.bots === 1 ? "" : "s"} at the table</span>
        {onStand && <button className="px-btn secondary !py-1 ml-auto" onClick={onStand}>Stand up &amp; cash out</button>}
      </div>
      {err && <p className="mt-2 text-ember" role="alert">{err}</p>}
      <p className="mt-2 text-sm text-latte">Chips at the table are Cafe Beans from your wallet; standing up returns them. Bots play house chips. Hands run from High Card up to a Royal Flush.</p>
    </ArcadeFrame>
  );
}
