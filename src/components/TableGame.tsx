"use client";
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { WorldStore } from "@/game/worldState";
import type { Side } from "@/game/tictactoe";
import type { SfxName } from "@/lib/sfx";

const defaultName = (id: string | null) =>
  !id ? "nobody yet" : id.startsWith("npc:") ? id.slice(4).replace(/^./, (c) => c.toUpperCase()) : "another player";

/** Tic-Tac-Toe board. It only reads the shared table state and dispatches moves, so two real players could use it as is. */
export default function TableGame({
  world, me, onClose, sfx, nameOf = defaultName,
}: {
  world: WorldStore;
  me: string;
  /** Shows real player names when online. */
  nameOf?: (occupant: string | null) => string;
  onClose: () => void;
  sfx: (n: SfxName) => void;
}) {
  const { table } = useSyncExternalStore(world.subscribe, world.getState, world.getState);
  const mySide: Side | null = table.players.X === me ? "X" : table.players.O === me ? "O" : null;
  const oppSide: Side | null = mySide ? (mySide === "X" ? "O" : "X") : null;
  const opp = nameOf(oppSide ? table.players[oppSide] : null);

  const move = (idx: number) => world.dispatch({ type: "ttt", action: { type: "move", idx, by: me } });
  const again = () => { world.dispatch({ type: "ttt", action: { type: "reset", by: me } }); };

  // sounds for moves and results
  const prevCount = useRef(table.board.filter(Boolean).length);
  const prevWinner = useRef(table.winner);
  useEffect(() => {
    const count = table.board.filter(Boolean).length;
    if (count > prevCount.current) sfx("place");
    prevCount.current = count;
    if (table.winner && table.winner !== prevWinner.current) {
      sfx(table.winner === "draw" ? "ding" : table.winner === mySide ? "win" : "lose");
    }
    prevWinner.current = table.winner;
  }, [table.board, table.winner, mySide, sfx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const n = Number(e.key);
      if (n >= 1 && n <= 9) move(n - 1);
      else if (e.key.toLowerCase() === "r") again();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  const myTurn = !!mySide && !table.winner && table.turn === mySide;
  let status = "";
  if (!mySide) status = "Take a seat at the table to play.";
  else if (!table.players[oppSide!]) status = "Waiting for an opponent...";
  else if (table.winner === "draw") status = "A draw! Nicely played.";
  else if (table.winner) status = table.winner === mySide ? "You win! 🎉" : `${opp} wins this one.`;
  else status = myTurn ? "Your move" : `${opp} is thinking...`;

  const wins = mySide ? table.scores[mySide] : 0;
  const losses = oppSide ? table.scores[oppSide] : 0;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Tic-Tac-Toe">
      <div className="px-panel w-full max-w-sm p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber sm:text-sm">Tic-Tac-Toe</h2>
          <button className="px-btn secondary" onClick={onClose}>Close (Esc)</button>
        </div>
        <p className="mb-3 text-latte">You are <b className="text-ember">{mySide ?? "-"}</b> · playing {opp}</p>

        <div className="mx-auto mb-3 grid w-fit grid-cols-3 gap-2" role="grid" aria-label="Board">
          {table.board.map((cell, i) => {
            const win = table.line?.includes(i);
            return (
              <button
                key={i}
                role="gridcell"
                data-nosfx
                aria-label={`Cell ${i + 1}${cell ? `: ${cell}` : ""}`}
                disabled={!!cell || !myTurn}
                onClick={() => move(i)}
                className={`grid h-20 w-20 place-items-center border-4 font-pixel text-2xl ${win ? "border-amber bg-bark" : "border-bark bg-espresso"} ${!cell && myTurn ? "hover:border-latte" : ""}`}
                style={{ color: cell === "X" ? "#d9622b" : "#6fa0e0" }}
              >
                {cell ?? <span className="text-[0.6rem] text-bark">{i + 1}</span>}
              </button>
            );
          })}
        </div>

        <p className="mb-2 text-center text-xl" role="status">{status}</p>
        <p className="mb-2 text-center text-latte">
          You {wins} · Draws {table.scores.draw} · {nameOf(oppSide ? table.players[oppSide] : null)} {losses}
        </p>
        <button className="px-btn w-full whitespace-nowrap" onClick={again} disabled={!table.board.some(Boolean)}>New round (R)</button>
        <p className="mt-2 text-sm text-latte">Keys 1-9 pick a square. Walk away from the table to stand up.</p>
      </div>
    </div>
  );
}
