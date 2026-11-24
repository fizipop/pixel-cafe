"use client";
import { useCallback, useEffect, useState } from "react";
import type { BoardRow, BoardView } from "@/shared/protocol";
import { unescapeHtml } from "@/shared/text";
import { fmtTime } from "@/shared/racer";
import { ArcadeFrame, type ArcadeProps } from "./ui";

const REFRESH_MS = 6000;

function Column({ title, rows, fmt, emptyText }: { title: string; rows: BoardRow[]; fmt: (n: number) => string; emptyText: string }) {
  return (
    <section className="bg-espresso/70 p-3" aria-label={title}>
      <h3 className="mb-2 font-pixel text-[0.6rem] leading-relaxed text-amber">{title}</h3>
      {rows.length === 0 ? <p className="text-latte">{emptyText}</p> : (
        <ol className="space-y-1 text-lg">
          {rows.map((r, i) => (
            <li key={`${r.name}-${i}`} className={`flex items-center justify-between gap-2 ${r.mine ? "text-mint" : "text-cream"}`}>
              <span className="truncate"><span className="mr-1 text-latte">{i + 1}.</span>{i === 0 ? "👑 " : ""}{unescapeHtml(r.name)}{r.mine ? " (you)" : ""}</span>
              <b>{fmt(r.value)}</b>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** The Leaderboard Kiosk: Penguin Cross and To the Moon multipliers, Neon Drift GP fastest laps, Beat Battle scores, Pixel Fighter II win streaks, richest wallets. */
export default function ArcadeBoard({ net, onClose }: ArcadeProps) {
  const [view, setView] = useState<BoardView | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const r = await net.call<{ view: BoardView }>("arcade:board");
    if (r.ok) { setView(r.view); setError(""); } else setError(r.reason);
  }, [net]);
  useEffect(() => {
    queueMicrotask(() => void refresh());
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  return (
    <ArcadeFrame title="Arcade Leaderboards" net={net} onClose={onClose} width="max-w-5xl" accent="text-[#ff9bd0]">
      {error && <p className="mb-2 text-ember">{error}</p>}
      {!view && !error && <p className="text-latte">Loading the scores…</p>}
      {view && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Column title="Penguin Cross · biggest cash-outs" rows={view.penguin} fmt={(n) => `×${n.toFixed(2)}`} emptyText="Nobody has crossed yet." />
          <Column title="To the Moon · biggest multipliers" rows={view.moon} fmt={(n) => `×${n.toFixed(2)}`} emptyText="Nobody has cashed out yet." />
          <Column title="Neon Drift GP · fastest laps" rows={view.drift} fmt={fmtTime} emptyText="No laps yet. Hit the track!" />
          <Column title="Beat Battle · high scores" rows={view.beat} fmt={(n) => n.toLocaleString()} emptyText="No songs played yet." />
          <Column title="Pixel Fighter II · win streaks" rows={view.fighter} fmt={(n) => `${n} win${n === 1 ? "" : "s"}`} emptyText="No streaks yet. Step up!" />
          <Column title="Richest Cafe Beans" rows={view.rich} fmt={(n) => `🫘 ${n}`} emptyText="Nobody yet." />
        </div>
      )}
      <p className="mt-3 text-sm text-latte">Saved on the server and shared by everyone. Updates every few seconds.</p>
    </ArcadeFrame>
  );
}
