"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PolaroidCard, RoofFrame, type RooftopProps } from "./ui";
import type { PolaroidView } from "@/shared/protocol";

const COUNTDOWN = 3; // seconds, so everyone can squeeze into the picture

/** The photo stand: a 3-2-1 countdown, a flash, then a Polaroid of everyone on the rooftop, pinned to the wall. */
export default function PhotoBooth({ net, onClose, sfx, onOpen }: RooftopProps) {
  const [count, setCount] = useState<number | null>(COUNTDOWN);
  const [flash, setFlash] = useState(false);
  const [photo, setPhoto] = useState<PolaroidView | null>(null);
  const [error, setError] = useState("");
  const timer = useRef<number | null>(null);

  const clear = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };

  const take = useCallback(async () => {
    setCount(null);
    setFlash(true);
    sfx("shutter");
    window.setTimeout(() => setFlash(false), 260);
    const r = await net.roof<{ photo: PolaroidView }>("polaroid:take");
    if (r.ok) setPhoto(r.photo);
    else setError(r.reason);
  }, [net, sfx]);

  const begin = useCallback(() => {
    clear();
    setPhoto(null);
    setError("");
    setCount(COUNTDOWN);
  }, []);

  // 3… 2… 1… click
  useEffect(() => {
    if (count === null) return;
    if (count === 0) { queueMicrotask(() => void take()); return; }
    timer.current = window.setTimeout(() => setCount((n) => (n === null ? null : n - 1)), 1000);
    return clear;
  }, [count, take]);

  const done = photo !== null || error !== "";
  return (
    <RoofFrame
      title="Photo stand · Group Polaroid"
      net={net}
      onClose={() => { clear(); onClose(); }}
      width="max-w-xl"
      accent="text-amber"
      footer="Everyone on the rooftop (up to 6, nearest the stand first) is in the picture, with their own look and name. It is pinned to the shared Polaroid Wall."
    >
      <div className="relative flex min-h-80 flex-col items-center justify-center gap-4 text-center">
        {count !== null && count > 0 && (
          <div role="status" aria-live="assertive">
            <p className="text-xl text-cream">Squeeze in, everyone!</p>
            <p className="font-pixel text-6xl text-amber">{count}</p>
          </div>
        )}
        {count === 0 && <p className="text-xl text-cream">Say cheese!</p>}
        {photo && (
          <>
            <PolaroidCard photo={photo} width={288} developing className="rotate-1 shadow-[6px_6px_0_#00000066]" />
            <p className="text-xl text-mint" role="status">Developing… and pinned to the Rooftop Polaroid Wall!</p>
          </>
        )}
        {error && <p className="text-xl text-ember" role="alert">{error}</p>}
        {done && (
          <div className="flex flex-wrap justify-center gap-3">
            <button className="px-btn" onClick={() => onOpen?.("wall")}>View the Polaroid Wall</button>
            <button className="px-btn secondary" onClick={begin}>Take another</button>
          </div>
        )}
        {count !== null && <button className="px-btn secondary" onClick={() => { clear(); setCount(null); setError("Photo cancelled."); }}>Cancel</button>}
        {flash && <div className="pointer-events-none fixed inset-0 z-40 bg-white/90" aria-hidden />}
      </div>
    </RoofFrame>
  );
}
