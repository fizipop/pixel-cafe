"use client";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { NetClient } from "@/net/client";
import type { SfxName } from "@/lib/sfx";
import type { PolaroidView } from "@/shared/protocol";
import { POLAROID_H, POLAROID_W, drawPolaroid } from "@/lib/polaroidRender";

export type RooftopProps = {
  net: NetClient;
  onClose: () => void;
  sfx: (n: SfxName) => void;
  /** Switch to another rooftop window (e.g. from the photo booth to the Polaroid Wall). */
  onOpen?: (game: "roast" | "stars" | "photo" | "wall") => void;
};

/** Modal frame shared by the Floor 3 windows: title, live bean balance, Esc to close, an optional footer note. */
export function RoofFrame({
  title, net, onClose, children, width = "max-w-3xl", accent = "text-amber", footer, onEsc,
}: {
  title: string;
  net: NetClient;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  accent?: string;
  footer?: ReactNode;
  onEsc?: () => void;
}) {
  const beans = useSyncExternalStore(net.subscribe, () => net.shownBeans, () => 0);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") (onEsc ?? onClose)(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onEsc]);
  return (
    <div className="fixed inset-0 z-30 grid place-items-center bg-black/65 p-3" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`px-panel flex max-h-[94vh] w-full ${width} flex-col p-4`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className={`font-pixel text-xs sm:text-sm ${accent}`}>{title}</h2>
          <div className="flex items-center gap-3">
            <span className="bg-espresso px-3 py-1 text-xl text-cream" aria-label="Cafe Beans balance">🫘 <b data-testid="beans">{beans}</b></span>
            <button className="px-btn secondary" onClick={onClose}>Close (Esc)</button>
          </div>
        </div>
        <div className="overflow-y-auto pr-1">{children}</div>
        {footer && <p className="mt-3 text-sm text-latte">{footer}</p>}
      </div>
    </div>
  );
}

/** One Rooftop Polaroid. `developing` fades the picture in over ~2.5 s, like a print coming out of the camera. */
export function PolaroidCard({ photo, width = POLAROID_W, developing = false, className = "" }: { photo: PolaroidView; width?: number; developing?: boolean; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    if (!developing) { drawPolaroid(canvas, photo, 1); return; }
    let raf = 0;
    const t0 = performance.now();
    const frame = (now: number) => {
      const k = Math.min(1, (now - t0) / 2500);
      drawPolaroid(canvas, photo, 0.1 + 0.9 * k * k);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [photo, developing]);
  return (
    <canvas
      ref={ref}
      width={POLAROID_W}
      height={POLAROID_H}
      className={`block bg-foam ${className}`}
      style={{ width, height: (width * POLAROID_H) / POLAROID_W, imageRendering: "pixelated" }}
      role="img"
      aria-label={`Polaroid taken on the rooftop with ${photo.people.length} ${photo.people.length === 1 ? "person" : "people"}`}
    />
  );
}
