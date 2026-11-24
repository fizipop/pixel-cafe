// Floor 3 rules shared by the browser (animations, rendering) and the server (the real referee):
// marshmallow roasting, star wishes and the compact sprite format used by Polaroids.
import { GRID } from "../lib/editor.ts";

// ------------------------------------------------------------------ marshmallow roasting
// The marshmallow heats up while it is over the fire. `heat` = seconds held over the fire x this
// roast's `rate` (the server picks a random rate, so you cannot just count to a fixed number).
export type RoastGrade = "raw" | "toasty" | "golden" | "brown" | "burnt";

export const ROAST_THRESHOLDS = { toasty: 2.0, golden: 3.2, brown: 4.4, burnt: 5.6 } as const;
export const ROAST_RATE_MIN = 0.85;
export const ROAST_RATE_MAX = 1.3;
export const ROAST_PERFECT_BEANS = 5; // the small bonus for a golden-brown roast
export const ROAST_REWARD_GAP_MS = 12_000; // at most one bonus per device per 12 s
export const ROAST_MAX_MS = 20_000; // a roast nobody pulled out is thrown away after this

export const roastHeat = (elapsedMs: number, rate: number) => Math.max(0, (elapsedMs / 1000) * rate);

export function roastGrade(heat: number): RoastGrade {
  if (heat < ROAST_THRESHOLDS.toasty) return "raw";
  if (heat < ROAST_THRESHOLDS.golden) return "toasty";
  if (heat < ROAST_THRESHOLDS.brown) return "golden";
  if (heat < ROAST_THRESHOLDS.burnt) return "brown";
  return "burnt";
}

export const ROAST_LINES: Record<RoastGrade, string> = {
  raw: "Still cold and squishy. Give it longer over the fire!",
  toasty: "A light toast. Almost there, a little longer next time.",
  golden: "Perfect! Golden-brown all the way round.",
  brown: "A bit dark. Crunchy, but still tasty.",
  burnt: "Charcoal! It caught fire. Better luck next time.",
};

// ------------------------------------------------------------------ star wishes
export const WISH_MAX = 80;
export const WISH_COOLDOWN_MS = 20_000;
export const WISH_TTL_MS = 48 * 3600_000; // wishes drift away after two days
export const WISH_CAP = 60; // most wishes kept
export const WISH_SHOWN = 24; // most wishes shown

// ------------------------------------------------------------------ Polaroids
export const POLAROID_WALL_CAP = 24; // the wall holds the newest 24 photos
export const POLAROID_COOLDOWN_MS = 15_000;

/** A 32x32 sprite as a palette plus run-lengths: [paletteIndex + 1 (0 = empty), runLength, ...]. About 1 KB instead of ~8 KB. */
export type PackedSprite = { pal: string[]; runs: number[] };

export function packPixels(pixels: string[]): PackedSprite {
  const pal: string[] = [];
  const index = new Map<string, number>();
  const runs: number[] = [];
  let prev = -1;
  let count = 0;
  for (let i = 0; i < GRID * GRID; i++) {
    const c = (pixels[i] ?? "").toLowerCase();
    let v = 0;
    if (c) {
      let k = index.get(c);
      if (k === undefined) { k = pal.length; pal.push(c); index.set(c, k); }
      v = k + 1;
    }
    if (v === prev) count++;
    else {
      if (count) runs.push(prev, count);
      prev = v;
      count = 1;
    }
  }
  if (count) runs.push(prev, count);
  return { pal, runs };
}

export function unpackPixels(p: PackedSprite): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < p.runs.length; i += 2) {
    const color = p.runs[i] === 0 ? "" : (p.pal[p.runs[i] - 1] ?? "");
    for (let n = 0; n < p.runs[i + 1] && out.length < GRID * GRID; n++) out.push(color);
  }
  while (out.length < GRID * GRID) out.push("");
  return out;
}

const HEX = /^#[0-9a-f]{3,8}$/;
/** Validates data read from disk or the network: right shape, hex colours, runs that add up to 1024 pixels. */
export function isPackedSprite(v: unknown): v is PackedSprite {
  if (typeof v !== "object" || v === null) return false;
  const { pal, runs } = v as { pal?: unknown; runs?: unknown };
  if (!Array.isArray(pal) || pal.length > 256 || !pal.every((c) => typeof c === "string" && HEX.test(c))) return false;
  if (!Array.isArray(runs) || runs.length % 2 !== 0 || runs.length > 2048) return false;
  let total = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const k = runs[i];
    const n = runs[i + 1];
    if (!Number.isInteger(k) || k < 0 || k > pal.length || !Number.isInteger(n) || n < 1) return false;
    total += n;
  }
  return total === GRID * GRID;
}

/** Where each person stands on the photo, in a 216x168 picture. Back row is drawn first. Pure so it can be tested. */
export function polaroidSlots(n: number): { x: number; y: number; scale: number }[] {
  const count = Math.max(0, Math.min(6, n));
  if (count === 0) return [];
  const w = 216;
  if (count <= 3) {
    const step = 64;
    const start = (w - (count - 1) * step) / 2;
    return Array.from({ length: count }, (_, i) => ({ x: Math.round(start + i * step), y: 140, scale: 3 }));
  }
  // two rows of 2x-scaled people: back row (up to 3), front row (the rest), staggered
  const back = Math.ceil(count / 2);
  const front = count - back;
  const row = (k: number, y: number, step: number) => {
    const start = (w - (k - 1) * step) / 2;
    return Array.from({ length: k }, (_, i) => ({ x: Math.round(start + i * step), y, scale: 2 }));
  };
  return [...row(back, 116, 56), ...row(front, 148, 56)];
}

/** "Nov 24 · 9:41 PM" (24-hour clocks are fine too, this is just the little caption). */
export function polaroidStamp(ts: number): string {
  const d = new Date(ts);
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()];
  const h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${mon} ${d.getDate()} · ${((h + 11) % 12) + 1}:${m} ${h >= 12 ? "PM" : "AM"}`;
}
