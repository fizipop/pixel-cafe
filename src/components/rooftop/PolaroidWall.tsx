"use client";
import { useEffect, useState } from "react";
import { PolaroidCard, RoofFrame, type RooftopProps } from "./ui";
import { POLAROID_WALL_CAP } from "@/shared/rooftop";
import type { PolaroidView } from "@/shared/protocol";

const tilt = (id: string) => ((Array.from(id).reduce((a, c) => a + c.charCodeAt(0), 0) % 7) - 3) * 0.9;

/** The shared Rooftop Polaroid Wall: every group photo ever pinned (newest first, the wall keeps the last 24). */
export default function PolaroidWall({ net, onClose, onOpen }: RooftopProps) {
  const [photos, setPhotos] = useState<PolaroidView[] | null>(null);
  const [error, setError] = useState("");
  const [big, setBig] = useState<PolaroidView | null>(null);

  useEffect(() => {
    let alive = true;
    void net.roof<{ photos: PolaroidView[] }>("polaroid:wall").then((r) => {
      if (!alive) return;
      if (r.ok) setPhotos(r.photos); else setError(r.reason);
    });
    const off = net.on("polaroid:new", (p) => setPhotos((cur) => [p, ...(cur ?? []).filter((x) => x.id !== p.id)].slice(0, POLAROID_WALL_CAP)));
    return () => { alive = false; off(); };
  }, [net]);

  return (
    <RoofFrame
      title="Rooftop Polaroid Wall"
      net={net}
      onClose={onClose}
      onEsc={() => (big ? setBig(null) : onClose())}
      width="max-w-5xl"
      accent="text-ember"
      footer={`The wall keeps the newest ${POLAROID_WALL_CAP} photos and is saved on the server. Take one at the photo stand!`}
    >
      {big ? (
        <div className="flex flex-col items-center gap-3">
          <PolaroidCard photo={big} width={336} className="shadow-[6px_6px_0_#00000066]" />
          <button className="px-btn secondary" onClick={() => setBig(null)}>Back to the wall</button>
        </div>
      ) : (
        <>
          {error && <p className="text-xl text-ember" role="alert">{error}</p>}
          {photos === null && !error && <p className="text-xl text-latte">Loading the wall…</p>}
          {photos?.length === 0 && (
            <div className="py-10 text-center">
              <p className="mb-4 text-xl text-cream">The wall is empty. Be the first to pin a photo!</p>
              {onOpen && <button className="px-btn" onClick={() => onOpen("photo")}>Take a Polaroid</button>}
            </div>
          )}
          <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-label="Pinned Polaroids">
            {photos?.map((p) => (
              <li key={p.id} className="relative flex justify-center pt-3" style={{ transform: `rotate(${tilt(p.id)}deg)` }}>
                <span className="absolute left-1/2 top-0 z-10 h-5 w-3 -translate-x-1/2 bg-latte" aria-hidden />
                <button className="block" onClick={() => setBig(p)} aria-label={`Open the Polaroid from ${new Date(p.ts).toLocaleString()}`}>
                  <PolaroidCard photo={p} width={216} className="shadow-[4px_4px_0_#00000066]" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </RoofFrame>
  );
}
