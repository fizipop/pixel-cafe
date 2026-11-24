"use client";
import { useEffect, useSyncExternalStore } from "react";
import { MOODS, WEATHERS, type Mood, type Weather } from "@/lib/moods";
import type { WorldStore } from "@/game/worldState";
import type { SfxName } from "@/lib/sfx";

// A little window preview for each weather (CSS only).
const SKY: Record<Weather, string> = {
  dusk: "linear-gradient(#f7d27a, #e0884a)",
  rain: "linear-gradient(#4b5a7a, #25304c)",
  sun: "linear-gradient(#8fd0f0, #f7f2cf)",
};

function WindowPreview({ weather }: { weather: Weather }) {
  return (
    <div className="relative h-14 w-20 border-4 border-[#2a1a11]" style={{ background: SKY[weather] }} aria-hidden>
      <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 bg-[#2a1a11]" />
      <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 bg-[#2a1a11]" />
      {weather === "rain" && [10, 28, 46, 62].map((x, i) => (
        <span key={x} className="absolute w-px bg-[#b8d4f0]" style={{ left: x, top: 4 + (i % 2) * 10, height: 8 }} />
      ))}
      {weather === "sun" && <span className="absolute right-2 top-1 h-3 w-3 bg-[#fff3a6]" />}
    </div>
  );
}

export default function JukeboxMenu({
  world, onClose, sfx,
}: {
  world: WorldStore;
  onClose: () => void;
  sfx: (n: SfxName) => void;
}) {
  const { mood, weather } = useSyncExternalStore(world.subscribe, world.getState, world.getState);

  const pickMood = (m: Mood) => { world.dispatch({ type: "setMood", mood: m }); sfx("jukebox"); };
  const pickWeather = (w: Weather) => { world.dispatch({ type: "setWeather", weather: w }); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return onClose();
      const n = Number(e.key);
      if (n >= 1 && n <= 3) pickMood(MOODS[n - 1].id);
      else if (n >= 4 && n <= 6) pickWeather(WEATHERS[n - 4].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Jukebox">
      <div className="px-panel flex max-h-[92vh] w-full max-w-2xl flex-col overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber sm:text-sm">Jukebox</h2>
          <button className="px-btn secondary" onClick={onClose}>Close (Esc)</button>
        </div>

        <h3 className="mb-1 text-latte">Music mood</h3>
        <ul className="mb-3 grid gap-2">
          {MOODS.map((m, i) => (
            <li key={m.id}>
              <button
                onClick={() => pickMood(m.id)}
                aria-pressed={mood === m.id}
                className={`flex w-full items-center justify-between gap-3 border-4 p-2 text-left ${mood === m.id ? "border-amber bg-bark" : "border-bark bg-espresso hover:border-latte"}`}
              >
                <span>
                  <span className="font-pixel text-[0.6rem] leading-relaxed text-cream">{i + 1}. {m.name}</span>
                  <span className="block text-latte">{m.blurb}</span>
                </span>
                <span className="text-amber">{mood === m.id ? "♪ Playing" : ""}</span>
              </button>
            </li>
          ))}
        </ul>

        <h3 className="mb-2 text-latte">Window weather</h3>
        <ul className="grid gap-2 sm:grid-cols-3">
          {WEATHERS.map((w, i) => (
            <li key={w.id}>
              <button
                onClick={() => pickWeather(w.id)}
                aria-pressed={weather === w.id}
                className={`flex w-full flex-col items-center gap-1 border-4 p-2 ${weather === w.id ? "border-amber bg-bark" : "border-bark bg-espresso hover:border-latte"}`}
              >
                <WindowPreview weather={w.id} />
                <span className="font-pixel text-[0.55rem] leading-relaxed text-cream">{i + 4}. {w.name}</span>
                <span className="text-center text-latte">{w.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-latte">Keys 1-3 change the music, 4-6 change the weather. Saved on this device.</p>
      </div>
    </div>
  );
}
