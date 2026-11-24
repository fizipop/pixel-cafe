"use client";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import CharacterPreview from "../CharacterPreview";
import type { NetClient } from "@/net/client";
import { BET_PRESETS, MAX_BET, MIN_BET, type SlotSymbol } from "@/shared/arcade";
import type { SfxName } from "@/lib/sfx";

export type ArcadeProps = {
  net: NetClient;
  onClose: () => void;
  sfx: (n: SfxName) => void;
  /** Stand up from the table you are sitting at (blackjack / roulette). */
  onStand?: () => void;
};

/** Your Cafe Beans, live (frozen while a game animation plays, see NetClient.hold). */
export function useBeans(net: NetClient) {
  return useSyncExternalStore(net.subscribe, () => net.shownBeans, () => 0);
}

/** Modal frame shared by every Floor 2 game: title, live bean balance, Esc to close, the fictional-currency notice. */
export function ArcadeFrame({
  title, net, onClose, children, width = "max-w-3xl", accent = "text-amber", onEsc,
}: {
  title: string;
  net: NetClient;
  onClose: () => void;
  children: ReactNode;
  width?: string;
  accent?: string;
  onEsc?: () => void;
}) {
  const beans = useBeans(net);
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
        <p className="mt-3 text-sm text-latte">
          Cafe Beans are a fictional play currency: they can&apos;t be bought, cashed out or traded for anything. Just for fun. Min bet {MIN_BET}, max {MAX_BET}.
        </p>
      </div>
    </div>
  );
}

/** Preset chips + a number box. `value` is always kept inside the table limits. */
export function BetPicker({
  value, onChange, balance, disabled, label = "Bet",
}: { value: number; onChange: (n: number) => void; balance: number; disabled?: boolean; label?: string }) {
  const clamp = (n: number) => Math.max(MIN_BET, Math.min(MAX_BET, Math.floor(Number.isFinite(n) ? n : MIN_BET)));
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={label}>
      <span className="text-latte">{label}:</span>
      {BET_PRESETS.map((p) => (
        <button key={p} className={`px-btn !px-2 !py-1 ${value === p ? "active" : "secondary"}`} disabled={disabled} onClick={() => onChange(p)} aria-pressed={value === p}>{p}</button>
      ))}
      <button className="px-btn secondary !px-2 !py-1" disabled={disabled || balance < MIN_BET} onClick={() => onChange(clamp(Math.min(balance, MAX_BET)))}>Max</button>
      <input
        className="px-input !w-24 !py-1 !text-lg"
        type="number" inputMode="numeric" min={MIN_BET} max={MAX_BET}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        aria-label={`${label} amount`}
      />
    </div>
  );
}

/** Seconds left until a server deadline (the server's clock, not yours), refreshed 5 times a second. */
export function useCountdown(deadline: number | null | undefined, serverNow: number | undefined) {
  const [offset, setOffset] = useState(0); // server time minus our time, learnt from each update
  const [now, setNow] = useState(0);
  useEffect(() => {
    queueMicrotask(() => { if (serverNow) setOffset(serverNow - Date.now()); });
  }, [serverNow]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    queueMicrotask(tick);
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, []);
  if (!deadline || !now) return null;
  return Math.max(0, Math.ceil((deadline - (now + offset)) / 1000));
}

// ------------------------------------------------------------------ pixel sprites (ASCII -> pixels)

export function sprite(rows: string[], palette: Record<string, string>): { pixels: string[]; cols: number } {
  const cols = Math.max(...rows.map((r) => r.length));
  const pixels: string[] = [];
  for (const row of rows) for (let x = 0; x < cols; x++) pixels.push(palette[row[x] ?? "."] ?? "");
  return { pixels, cols };
}

const SPRITES: Record<SlotSymbol, ReturnType<typeof sprite>> = {
  cup: sprite([
    "............",
    "...s..s.....",
    "....s..s....",
    "..WWWWWWWW..",
    "..WCCCCCCWWW",
    "..WCCCCCCW.W",
    "..WCCCCCCW.W",
    "..WCCCCCCWWW",
    "...WCCCCWW..",
    "....WWWW....",
    "..WWWWWWWW..",
    "............",
  ], { W: "#f4e4c1", C: "#7a4a26", s: "#c9d6e8" }),
  croissant: sprite([
    "............",
    "............",
    "...oo..oo...",
    "..oOOo.oOOo.",
    ".oOoOOooOOOo",
    ".oOOoOOOoOOo",
    "oOoOOOOOOoOo",
    "oOOoOOOOoOOo",
    ".oOOOooOOOo.",
    "..ooo..ooo..",
    "............",
    "............",
  ], { o: "#8a4a1c", O: "#e0993f" }),
  bean: sprite([
    "............",
    "....gggg....",
    "...gGGGGg...",
    "..gGGGyGGg..",
    "..gGGyGGGg..",
    "..gGGGyGGg..",
    "..gGGyGGGg..",
    "..gGGGyGGg..",
    "...gGGGGg...",
    "....gggg....",
    "............",
    "............",
  ], { g: "#b07a10", G: "#f2c36b", y: "#8a5a10" }),
  cat: sprite([
    "............",
    ".o........o.",
    ".oo......oo.",
    ".oooooooooo.",
    ".oOoooooOoo.",
    ".oKooooKooo.",
    ".ooooPPoooo.",
    ".oooPooPooo.",
    "..oooooooo..",
    "...oooooo...",
    "............",
    "............",
  ], { o: "#e0884a", O: "#b8602a", K: "#1f140d", P: "#f28fad" }),
  seven: sprite([
    "............",
    ".RRRRRRRRRR.",
    ".RrrrrrrrRR.",
    ".RR.....RR..",
    "........RR..",
    ".......RR...",
    "......RR....",
    ".....RR.....",
    ".....RR.....",
    ".....RR.....",
    "............",
    "............",
  ], { R: "#d9304a", r: "#ff7a8a" }),
};

export function SlotSprite({ symbol, scale = 5 }: { symbol: SlotSymbol; scale?: number }) {
  const s = SPRITES[symbol];
  return <CharacterPreview pixels={s.pixels} cols={s.cols} scale={scale} />;
}

export const ROCKET = sprite([
  "....rr....",
  "...rwwr...",
  "..rwwwwr..",
  "..rwbbwr..",
  "..rwbbwr..",
  "..rwwwwr..",
  "..rwwwwr..",
  ".rrwwwwrr.",
  "rr.wwww.rr",
  "r..rrrr..r",
  "...rrrr...",
], { r: "#d9304a", w: "#f4e4c1", b: "#58a6e0" });
export const FLAME = sprite(["..yyyy..", "...yo...", "...oo...", "....o..."], { y: "#fff3a6", o: "#f2a93b" });
export const BOOM = sprite([
  "..y....y..",
  "y..oo.o..y",
  ".ooorrooo.",
  "..orrrro..",
  "yoorrrroo.",
  "..orrrro.y",
  ".ooorrooo.",
  "y..o.oo..y",
  "..y....y..",
], { y: "#fff3a6", o: "#f2a93b", r: "#d9304a" });
