"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CharacterPreview from "./CharacterPreview";
import {
  DRINKS, MAKE_MS, RATING_TEXT, beansFor, drinkInfo, newZone, rate, sliderPos,
  type DrinkKind, type Rating, type Zone,
} from "@/lib/drinks";
import type { SfxName } from "@/lib/sfx";

// 10x8 pixel cup tinted by the drink (steam, foam, liquid)
function cupPixels(liquid: string, top: string): string[] {
  const rows = [
    "..s..s....",
    "...s..s...",
    ".tttttt...",
    ".wllllwww.",
    ".wllllw.w.",
    ".wwwwwwww.",
    "..wwwwww..",
    "..dddddd..",
  ];
  const pal: Record<string, string> = { s: "#8a6446", w: "#fff6e0", l: liquid, t: top, d: "#d8c8a0" };
  return rows.join("").split("").map((ch) => pal[ch] ?? "");
}

type Stage = "pick" | "make" | "done";

export default function DrinkMaker({
  onClose, onServe, onChat, sfx,
}: {
  onClose: () => void;
  onServe: (drink: DrinkKind, rating: Rating) => void;
  onChat: () => void;
  sfx: (n: SfxName) => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [kind, setKind] = useState<DrinkKind>("espresso");
  const [zone, setZone] = useState<Zone>({ center: 0.5, half: 0.1 });
  const [pos, setPos] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [rating, setRating] = useState<Rating | null>(null);
  const startRef = useRef(0);
  const readyAt = useRef(0);
  const locked = useRef(false);
  const timer = useRef<number | null>(null);

  const info = drinkInfo(kind);

  const begin = useCallback((k: DrinkKind) => {
    const now = performance.now();
    startRef.current = now;
    readyAt.current = now + 250; // ignore stray key repeats right after picking
    locked.current = false;
    setKind(k);
    setZone(newZone(k));
    setPos(0);
    setElapsed(0);
    setRating(null);
    setStage("make");
  }, []);

  const stop = useCallback(() => {
    if (locked.current || performance.now() < readyAt.current) return;
    locked.current = true;
    const t = Math.min(performance.now() - startRef.current, MAKE_MS);
    const p = sliderPos(t, info.period);
    const r = rate(p, zone);
    setPos(p);
    setElapsed(t);
    setRating(r);
    setStage("done");
    sfx(kind === "matcha" || kind === "cocoa" ? "froth" : "pour");
    if (r !== "meh") window.setTimeout(() => sfx("ding"), 350);
    timer.current = window.setTimeout(() => onServe(kind, r), 1400);
  }, [info.period, zone, kind, sfx, onServe]);

  // run the slider
  useEffect(() => {
    if (stage !== "make") return;
    let raf = 0;
    const tick = () => {
      const t = performance.now() - startRef.current;
      if (t >= MAKE_MS) return stop(); // time is up: it stops where it is
      setElapsed(t);
      setPos(sliderPos(t, info.period));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [stage, info.period, stop]);

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return stage === "done" ? undefined : onClose();
      if (stage === "pick") {
        const d = DRINKS.find((x) => x.key === e.key);
        if (d) begin(d.id);
        else if (e.key.toLowerCase() === "c") onChat();
      } else if (stage === "make" && (e.key === " " || e.key.toLowerCase() === "e" || e.key === "Enter")) {
        e.preventDefault();
        if (!e.repeat) stop();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, begin, stop, onClose, onChat]);

  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/60 p-3" role="dialog" aria-modal="true" aria-label="Make a drink">
      <div className="px-panel w-full max-w-lg p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="font-pixel text-xs text-amber sm:text-sm">{stage === "pick" ? "Behind the counter" : info.name}</h2>
          <button className="px-btn secondary" onClick={onClose} disabled={stage === "done"}>Close (Esc)</button>
        </div>

        {stage === "pick" && (
          <>
            <p className="mb-3 text-latte">Pick a drink, then stop the slider in the sweet spot. You&apos;ll make it yourself.</p>
            <ul className="grid grid-cols-2 gap-3">
              {DRINKS.map((d) => (
                <li key={d.id}>
                  <button
                    className="flex w-full flex-col items-center gap-2 border-4 border-bark bg-espresso p-3 hover:border-amber"
                    onClick={() => begin(d.id)}
                  >
                    <CharacterPreview pixels={cupPixels(d.liquid, d.top)} cols={10} scale={6} />
                    <span className="font-pixel text-[0.55rem] leading-relaxed text-cream">{d.key}. {d.name}</span>
                    <span className="text-center text-latte">{d.blurb}</span>
                  </button>
                </li>
              ))}
            </ul>
            <button className="px-btn secondary mt-4 w-full" onClick={onChat}>C. Chat with Mina</button>
          </>
        )}

        {stage !== "pick" && (
          <div>
            <div className="mb-3 flex items-center gap-4">
              <CharacterPreview pixels={cupPixels(info.liquid, info.top)} cols={10} scale={6} />
              <p className="text-xl">{stage === "make" ? `${info.action}: stop in the green!` : rating && RATING_TEXT[rating]}</p>
            </div>

            <button
              onClick={stop}
              disabled={stage !== "make"}
              aria-label="Stop the slider"
              data-nosfx
              className="relative block h-12 w-full border-4 border-bark bg-espresso"
            >
              <span
                className="absolute inset-y-0 bg-mint/70"
                style={{ left: `${(zone.center - zone.half) * 100}%`, width: `${zone.half * 200}%` }}
              />
              <span
                className="absolute inset-y-0 bg-amber/90"
                style={{ left: `${(zone.center - zone.half * 0.45) * 100}%`, width: `${zone.half * 0.9 * 100}%` }}
              />
              <span className="absolute inset-y-[-4px] w-2 bg-cream" style={{ left: `calc(${pos * 100}% - 4px)` }} data-testid="slider" />
            </button>

            <div className="mt-2 h-2 w-full bg-espresso" aria-hidden>
              <div className="h-full bg-latte" style={{ width: `${(1 - elapsed / MAKE_MS) * 100}%` }} />
            </div>

            <p className="mt-3 text-center text-latte" role="status">
              {stage === "make" && "Press E, Space or click to stop"}
              {stage === "done" && rating && `${rating.toUpperCase()}  +${beansFor(rating)} beans`}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
