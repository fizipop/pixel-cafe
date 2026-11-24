"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { NOTE_MAX, PAGE_SIZE, entryDate, pageCount, pageOf } from "@/lib/guestbook";
import type { SfxName } from "@/lib/sfx";
import type { GuestbookSource } from "@/net/stores";

export default function Guestbook({
  username, source, onClose, sfx,
}: {
  username: string;
  source: GuestbookSource;
  onClose: () => void;
  sfx: (n: SfxName) => void;
}) {
  const { entries: list, signedToday: signed } = useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot);
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<{ text: string; good: boolean } | null>(null);

  const pages = pageCount(list.length);
  const entries = pageOf(list, page);

  const go = (p: number) => {
    const next = Math.min(Math.max(0, p), pages - 1);
    if (next !== page) { setPage(next); sfx("page"); }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      if ((e.target as HTMLElement | null)?.tagName === "TEXTAREA" || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
      if (e.key === "ArrowLeft") go(page - 1);
      if (e.key === "ArrowRight") go(page + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, page, pages]);

  const sign = async () => {
    const res = await source.sign(draft);
    if (res.ok) {
      setDraft("");
      setPage(0);
      setMessage({ text: "Signed! Thanks for stopping by.", good: true });
      sfx("beans");
    } else {
      setMessage({ text: res.reason, good: false });
    }
  };

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Lounge guestbook">
      <div className="px-panel flex max-h-[92vh] w-full max-w-xl flex-col p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber sm:text-sm">Lounge Guestbook</h2>
          <button className="px-btn secondary" onClick={onClose}>Close (Esc)</button>
        </div>

        <ul className="mb-2 grid gap-3 sm:grid-cols-2" aria-label="Guestbook entries">
          {entries.map((e, i) => (
            <li key={e.id} className="flex min-h-28 flex-col justify-between border-4 border-[#8a6446] p-3 text-espresso" style={{ background: i % 2 ? "#f7e6a0" : "#f4e4c1" }}>
              <p className="break-words">{e.text}</p>
              <p className="mt-2 text-base opacity-75">{e.mine ? `${e.name} (you)` : e.name} · {entryDate(e)}</p>
            </li>
          ))}
        </ul>

        <div className="mb-4 flex items-center justify-between">
          <button className="px-btn secondary" onClick={() => go(page - 1)} disabled={page === 0} aria-label="Previous page">◀ Prev</button>
          <span className="text-latte">Page {Math.min(page, pages - 1) + 1} of {pages}</span>
          <button className="px-btn secondary" onClick={() => go(page + 1)} disabled={page >= pages - 1} aria-label="Next page">Next ▶</button>
        </div>

        <div>
          <label className="mb-1 block text-latte" htmlFor="guestbook-note">
            {signed ? "You signed today's page. Come back tomorrow!" : `Sign today's page as ${username} (one note a day)`}
          </label>
          <input
            id="guestbook-note"
            className="px-input"
            value={draft}
            maxLength={NOTE_MAX}
            disabled={signed}
            placeholder="A short, kind note..."
            onChange={(e) => { setDraft(e.target.value); setMessage(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") sign(); }}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <span className={draft.length >= NOTE_MAX ? "text-ember" : "text-latte"}>{draft.length}/{NOTE_MAX}</span>
            <span role="status" className={message?.good ? "text-mint" : "text-ember"}>{message?.text}</span>
            <button className="px-btn" onClick={sign} disabled={signed || draft.trim().length === 0}>Sign</button>
          </div>
          <p className="mt-2 text-sm text-latte">{PAGE_SIZE} notes per page. {source.networked ? "Shared with everyone in the cafe." : "Saved on this device only (the server is offline)."}</p>
        </div>
      </div>
    </div>
  );
}
