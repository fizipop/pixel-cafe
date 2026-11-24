"use client";
import { useEffect } from "react";
import { FLOORS, FLOOR_NAMES, type Floor } from "@/shared/floors";

const BLURB: Record<Floor, string> = {
  1: "Coffee, the jukebox, tic-tac-toe, the cat and the Rumour Board.",
  2: "Neon arcade: poker, pool, fighting, racing, rhythm, slots, mines and more.",
  3: "Fairy lights, a campfire, a telescope and a Polaroid Wall under the stars.",
};
const ICON: Record<Floor, string> = { 1: "☕", 2: "🕹️", 3: "🌙" };

/** The elevator's buttons: pick a floor (or press 1, 2 or 3). Esc closes. */
export default function FloorPicker({ current, onPick, onClose }: { current: Floor; onPick: (f: Floor) => void; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key === "Escape") { onClose(); return; }
      const n = Number(e.key);
      if (n === 1 || n === 2 || n === 3) { if (n !== current) onPick(n); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, onPick, onClose]);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/65 p-3" role="dialog" aria-modal="true" aria-label="Elevator">
      <div className="px-panel w-full max-w-md p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber">Elevator</h2>
          <button className="px-btn secondary" onClick={onClose}>Close (Esc)</button>
        </div>
        <ul className="flex flex-col gap-2">
          {[...FLOORS].reverse().map((f) => (
            <li key={f}>
              <button
                className={`px-btn flex w-full items-center gap-3 !text-left ${f === current ? "secondary" : ""}`}
                disabled={f === current}
                onClick={() => onPick(f)}
                data-testid={`floor-${f}`}
                aria-label={`${FLOOR_NAMES[f]}${f === current ? " (you are here)" : ""}`}
              >
                <span className="font-pixel text-lg" aria-hidden>{f}</span>
                <span className="flex-1">
                  <span className="block text-xl">{ICON[f]} {FLOOR_NAMES[f].replace(/^Floor \d · /, "")}</span>
                  <span className="block text-base opacity-80">{f === current ? "You are here" : BLURB[f]}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-latte">Press 1, 2 or 3 to go straight to a floor.</p>
      </div>
    </div>
  );
}
