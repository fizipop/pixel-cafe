"use client";
import { useState, useSyncExternalStore } from "react";
import type { NetClient } from "@/net/client";

const noopSubscribe = () => () => {};

/**
 * HUD block shown only while you are seated at a Private Table: who is there, that chat is
 * private to the table, and the Open / Lock toggle (locked = nobody new can sit down).
 */
export default function TableStatus({ net }: { net: NetClient | null }) {
  const table = useSyncExternalStore(net ? net.subscribe : noopSubscribe, () => (net && !net.closed ? net.table : null), () => null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!net || !table) return null;

  const toggle = async (btn: HTMLButtonElement) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const res = await net.tableLock(!table.locked);
    setBusy(false);
    if (!res.ok) setError(res.reason);
    btn.blur(); // keep WASD/E for the game
  };

  return (
    <div className="border-t-4 border-bark pt-2" role="status" aria-label="Private table">
      <p className="text-amber">🔒 {table.name}</p>
      <p className="text-latte">{table.seated}/{table.capacity} seated · chat is private</p>
      <button
        className={`px-btn mt-1 w-full !py-1 ${table.locked ? "danger" : "secondary"}`}
        onClick={(e) => void toggle(e.currentTarget)}
        disabled={busy}
        aria-pressed={table.locked}
        title={table.locked ? "Let other people sit at your table" : "Stop new people from sitting at your table"}
      >
        {table.locked ? "Table locked · Open it" : "Table open · Lock it"}
      </button>
      {error && <p className="mt-1 text-ember">{error}</p>}
    </div>
  );
}
