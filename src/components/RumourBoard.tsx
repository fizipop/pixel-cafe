"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { RUMOUR_MAX, timeAgo, type SortMode } from "@/lib/rumours";
import type { RumourSource } from "@/net/stores";
const PAPER = ["#f4e4c1", "#f7e6a0", "#f6c7d3", "#c9e8d8", "#cfe0f1"];

export default function RumourBoard({ source, onClose }: { source: RumourSource; onClose: () => void }) {
  const items = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [now, setNow] = useState(0);
  const [sort, setSort] = useState<SortMode>("new");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  useEffect(() => {
    queueMicrotask(() => setNow(Date.now()));
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // newest first (the cafe's own pins last), or most liked first
  const list = [...items].sort((a, b) =>
    sort === "popular" ? b.likes - a.likes || b.createdAt - a.createdAt : b.createdAt - a.createdAt || b.likes - a.likes,
  );

  const post = async () => {
    const res = await source.post(draft);
    setNow(Date.now());
    if (res.ok) {
      setDraft("");
      setSort("new");
      setMessage({ text: "Pinned to the board!", good: true });
    } else {
      setMessage({ text: res.reason, good: false });
    }
  };

  const like = (id: string) => source.like(id);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Rumour board">
      <div className="px-panel flex max-h-[90vh] w-full max-w-2xl flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber sm:text-sm">Rumour Board</h2>
          <button className="px-btn secondary" onClick={onClose} aria-label="Close board">Close (Esc)</button>
        </div>

        <div className="mb-3 flex gap-2">
          <button className={`px-btn secondary ${sort === "new" ? "active" : ""}`} onClick={() => setSort("new")} aria-pressed={sort === "new"}>Newest</button>
          <button className={`px-btn secondary ${sort === "popular" ? "active" : ""}`} onClick={() => setSort("popular")} aria-pressed={sort === "popular"}>Popular</button>
        </div>

        <ul className="mb-4 grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto pr-1 sm:grid-cols-2" aria-label="Rumours">
          {list.map((r, i) => {
            return (
              <li key={r.id} className="flex flex-col justify-between border-4 border-espresso p-3 text-espresso" style={{ background: PAPER[i % PAPER.length] }}>
                <p className="mb-2 break-words">{r.text}</p>
                <div className="flex items-center justify-between text-base opacity-80">
                  <span>{r.mine ? `you · ${timeAgo(r, now)}` : timeAgo(r, now)}</span>
                  <button
                    onClick={() => like(r.id)}
                    className={`font-bold ${r.likedByMe ? "text-[#b3203a]" : ""}`}
                    aria-pressed={r.likedByMe}
                    aria-label={`Like (${r.likes})`}
                  >
                    ♥ {r.likes}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>

        <div>
          <label className="mb-1 block text-latte" htmlFor="rumour-draft">Pin an anonymous note (kind and nameless, please)</label>
          <textarea
            id="rumour-draft"
            className="px-input h-24 resize-none"
            value={draft}
            maxLength={RUMOUR_MAX}
            placeholder="A random thought, a funny observation, a nice word..."
            onChange={(e) => { setDraft(e.target.value); setMessage(null); }}
            autoFocus
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className={draft.length >= RUMOUR_MAX ? "text-ember" : "text-latte"}>{draft.length}/{RUMOUR_MAX}</span>
            <span role="status" className={message?.good ? "text-mint" : "text-ember"}>{message?.text}</span>
            <button className="px-btn" onClick={post} disabled={draft.trim().length === 0}>Pin it</button>
          </div>
          <p className="mt-2 text-sm text-latte">{source.networked ? "Shared with everyone in the cafe. Posts disappear after 48 hours." : "Posts disappear after 48 hours. Saved on this device only (the server is offline)."}</p>
        </div>
      </div>
    </div>
  );
}
