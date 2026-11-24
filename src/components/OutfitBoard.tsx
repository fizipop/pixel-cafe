"use client";
import { useCallback, useEffect, useState } from "react";
import CharacterPreview from "./CharacterPreview";
import { GRID } from "@/lib/editor";
import { unescapeHtml } from "@/shared/text";
import type { SfxName } from "@/lib/sfx";
import type { NetClient } from "@/net/client";
import type { OutfitEntry, OutfitView } from "@/shared/protocol";

const REFRESH_MS = 8000;

/** Small gold crown, same art as the one beside the name tag in the cafe. */
function Crown({ className = "" }: { className?: string }) {
  return <span className={className} role="img" aria-label="crown">👑</span>;
}

/**
 * Community Outfit Leaderboard: everyone who visited in the last two days, their pixel
 * character and anonymous name, one upvote per person per day (never your own), and the
 * "Top Outfits Today" ranking. The #1 outfit(s) wear a crown by their name tag in the cafe.
 */
export default function OutfitBoard({
  net, onClose, sfx,
}: {
  net: NetClient | null;
  onClose: () => void;
  sfx: (n: SfxName) => void;
}) {
  const [view, setView] = useState<OutfitView | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState<{ text: string; good: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!net) return;
    const r = await net.outfitList();
    if (r.ok) { setView(r.view); setError(""); } else setError(r.reason);
  }, [net]);

  useEffect(() => {
    queueMicrotask(() => void refresh());
    const t = setInterval(() => void refresh(), REFRESH_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const vote = async (o: OutfitEntry) => {
    if (!net || busy) return;
    setBusy(true);
    const r = await net.outfitVote(o.id);
    setBusy(false);
    if (r.ok) {
      setNote({ text: `You upvoted ${unescapeHtml(o.name)}. Thanks for spreading the love!`, good: true });
      sfx("beans");
      void refresh();
    } else {
      setNote({ text: r.reason, good: false });
    }
  };

  const entries = view?.entries ?? [];
  const ranked = entries.filter((e) => e.votes > 0).slice(0, 3);
  const topVotes = ranked[0]?.votes ?? 0;

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Outfit board">
      <div className="px-panel flex max-h-[92vh] w-full max-w-3xl flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber sm:text-sm">Outfit Board</h2>
          <button className="px-btn secondary" onClick={onClose}>Close (Esc)</button>
        </div>

        {!net ? (
          <p className="py-8 text-center text-latte">The Outfit Board needs the multiplayer server. Run <b>npm run dev:all</b> and come back.</p>
        ) : (
          <div className="overflow-y-auto pr-1">
            <section className="mb-4" aria-label="Top outfits today">
              <h3 className="mb-2 text-xl text-cream">Top Outfits Today</h3>
              {ranked.length === 0 ? (
                <p className="text-latte">No votes yet today. Be the first to upvote an outfit you love!</p>
              ) : (
                <ol className="flex flex-wrap gap-3">
                  {ranked.map((o, i) => (
                    <li key={o.id} className="flex items-center gap-3 bg-espresso/70 p-2">
                      <span className="font-pixel text-xs text-amber">#{o.votes === topVotes ? 1 : i + 1}</span>
                      <CharacterPreview pixels={o.pixels} cols={GRID} scale={2} />
                      <span>
                        <span className="block">{o.votes === topVotes && <Crown className="mr-1" />}{unescapeHtml(o.name)}{o.mine ? " (you)" : ""}</span>
                        <span className="text-latte">{o.votes} upvote{o.votes === 1 ? "" : "s"}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <p className="mb-2 text-latte" role="status">
              {view?.votedToday ? "You've used today's upvote. A new one is waiting tomorrow." : "You have 1 upvote today. Pick your favourite (not yourself)."}
              {note && <span className={`ml-2 ${note.good ? "text-mint" : "text-ember"}`}>{note.text}</span>}
              {error && <span className="ml-2 text-ember">{error}</span>}
            </p>

            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Outfits">
              {!view && !error && <li className="col-span-full text-latte">Loading the stand…</li>}
              {view && entries.length === 0 && <li className="col-span-full text-latte">Nobody has visited yet.</li>}
              {entries.map((o) => (
                <li key={o.id} className="flex flex-col items-center gap-1 bg-espresso/70 p-2 text-center">
                  <CharacterPreview pixels={o.pixels} cols={GRID} scale={3} />
                  <span className="max-w-full break-words">
                    {o.crowned && <Crown className="mr-1" />}{unescapeHtml(o.name)}{o.mine ? " (you)" : ""}
                  </span>
                  <span className="text-base text-latte">{o.inCafe ? <span className="text-mint">● here now</span> : "recent visitor"} · {o.votes} ★</span>
                  {o.mine ? (
                    <span className="text-base text-latte">Can&apos;t vote for yourself</span>
                  ) : (
                    <button
                      className={`px-btn !py-1 ${o.votedByMe ? "active" : ""}`}
                      disabled={busy || view?.votedToday}
                      onClick={() => void vote(o)}
                      aria-label={`Upvote ${unescapeHtml(o.name)}`}
                    >
                      {o.votedByMe ? "Voted ★" : "Upvote ★"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-latte">One upvote per person per day. Votes reset at midnight, and the day&apos;s #1 outfit(s) wear a crown by their name tag.</p>
          </div>
        )}
      </div>
    </div>
  );
}
