// Where everything is on Floor 2 (the Arcade). All positions are WORLD pixels (Floor 2 is shifted
// right by FLOOR2_X, see src/shared/floors.ts). Shared by the server (seats) and the Phaser scene.
import { FLOOR2_X } from "../shared/floors.ts";
import type { Seat } from "./layout.ts";

const X0 = FLOOR2_X;

export type ArcadeGame = "slots" | "mines" | "moon" | "ice" | "board" | "blackjack" | "roulette";

export type Machine = {
  id: string;
  game: ArcadeGame | null; // null = decoration only
  art: string; // texture key
  x: number; y: number; w: number; h: number; // top-left of the sprite
  solid: { x: number; y: number; w: number; h: number };
  spot: { x: number; y: number }; // stand here to use it
  label: string; // shown in the prompt
  glow: number; // neon colour
};

const CAB = { w: 44, h: 60 };
const cabinet = (id: string, game: ArcadeGame | null, art: string, lx: number, label: string, glow: number): Machine => ({
  id, game, art, x: X0 + lx, y: 100, w: CAB.w, h: CAB.h,
  solid: { x: X0 + lx + 2, y: 132, w: CAB.w - 4, h: 28 },
  spot: { x: X0 + lx + CAB.w / 2, y: 184 },
  label, glow,
});

export const MACHINES: Machine[] = [
  cabinet("slots-a", "slots", "cab_slots", 80, "play Pixel Slots", 0xf2c36b),
  cabinet("slots-b", "slots", "cab_slots", 136, "play Pixel Slots", 0xf2c36b),
  cabinet("mines", "mines", "cab_mines", 224, "play Cafe Mines", 0x7fc8a9),
  cabinet("moon", "moon", "cab_moon", 280, "fly To the Moon", 0x9fb8d8),
  cabinet("ice", "ice", "cab_ice", 336, "play Cat Ice Jump", 0x7fd8f0),
  {
    id: "kiosk", game: "board", art: "kiosk", x: X0 + 520, y: 96, w: 56, h: 68,
    solid: { x: X0 + 522, y: 134, w: 52, h: 28 }, spot: { x: X0 + 548, y: 186 },
    label: "view the Leaderboards", glow: 0xf28fad,
  },
  cabinet("deco-a", null, "cab_deco0", 660, "", 0xd9304a),
  cabinet("deco-b", null, "cab_deco1", 716, "", 0x9b5de5),
  cabinet("deco-c", null, "cab_deco2", 772, "", 0x7fc8a9),
  cabinet("deco-d", null, "cab_deco0", 828, "", 0xf2a93b),
];

// ---- the two card/wheel tables ------------------------------------------------------------

export const BLACKJACK = { id: "bj0", x: X0 + 168, y: 330, w: 160, h: 88, seats: 4 };
export const ROULETTE = { id: "rt0", x: X0 + 560, y: 320, w: 192, h: 96, seats: 4 };
/** Stand here (right of the roulette table) to watch and bet without a seat. */
export const ROULETTE_WATCH = { x: ROULETTE.x + ROULETTE.w + 30, y: ROULETTE.y + 66 };

/** Decorative card tables (green felt, scattered cards): solid furniture only. */
export const CARD_TABLES = [
  { x: X0 + 120, y: 520, w: 96, h: 64 },
  { x: X0 + 360, y: 560, w: 96, h: 64 },
];

export const ARCADE_PLANTS: [number, number][] = [[X0 + 62, 740], [X0 + 962, 740], [X0 + 962, 220], [X0 + 470, 150]];

type Table = { id: string; x: number; y: number; w: number; seats: number };
const tableSeats = (t: Table, step: number, first: number): Seat[] =>
  Array.from({ length: t.seats }, (_, i) => {
    const x = t.x + first + i * step;
    const y = t.y + 72; // just below the table's solid base
    return { id: `f2-${t.id}-${i + 1}`, kind: "chair" as const, x, y, depth: y + 21, flipX: false, exit: { x, y: y + 24 } };
  });

export function arcadeSeats(): Seat[] {
  return [...tableSeats(BLACKJACK, 40, 20), ...tableSeats(ROULETTE, 48, 24)];
}

/** "f2-bj0-3" -> { table: "bj0", index: 2 }, or null for any other seat id. */
export function arcadeSeatInfo(seatId: string | null | undefined): { table: "bj0" | "rt0"; index: number } | null {
  if (!seatId) return null;
  const m = /^f2-(bj0|rt0)-(\d+)$/.exec(seatId);
  return m ? { table: m[1] as "bj0" | "rt0", index: Number(m[2]) - 1 } : null;
}
