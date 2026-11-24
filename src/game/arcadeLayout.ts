// Where everything is on Floor 2 (the Arcade). All positions are WORLD pixels (Floor 2 is shifted
// right by FLOOR2_X, see src/shared/floors.ts). Shared by the server (seats) and the Phaser scene.
import { FLOOR2_X } from "../shared/floors.ts";
import type { Seat } from "./layout.ts";

const X0 = FLOOR2_X;

export type ArcadeGame =
  | "slots" | "mines" | "moon" | "penguin" | "board" | "fighter" | "racer" | "beat" // cabinets and the kiosk
  | "blackjack" | "roulette" | "poker" | "pool"; // tables (you sit down to play)

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
  cabinet("penguin", "penguin", "cab_penguin", 336, "play Penguin Cross", 0x7fd8f0),
  {
    id: "kiosk", game: "board", art: "kiosk", x: X0 + 520, y: 96, w: 56, h: 68,
    solid: { x: X0 + 522, y: 134, w: 52, h: 28 }, spot: { x: X0 + 548, y: 186 },
    label: "view the Leaderboards", glow: 0xf28fad,
  },
  cabinet("fighter", "fighter", "cab_fighter", 660, "play Pixel Fighter II", 0xd9304a),
  cabinet("racer", "racer", "cab_racer", 716, "race Neon Drift GP", 0xf2a93b),
  cabinet("beat", "beat", "cab_beat", 772, "play Beat Battle", 0xff5fa8),
  cabinet("deco-d", null, "cab_deco0", 828, "", 0x9b5de5),
];

// ---- the card, wheel and pool tables ------------------------------------------------------------

export const BLACKJACK = { id: "bj0", x: X0 + 168, y: 330, w: 160, h: 88, seats: 4 };
export const ROULETTE = { id: "rt0", x: X0 + 560, y: 320, w: 192, h: 96, seats: 4 };
/** Stand here (right of the roulette table) to watch and bet without a seat. */
export const ROULETTE_WATCH = { x: ROULETTE.x + ROULETTE.w + 30, y: ROULETTE.y + 66 };

/** Texas Hold'em: six seats along the front of a long green-felt table. */
export const POKER = { id: "pk0", x: X0 + 80, y: 520, w: 240, h: 100, seats: 6 };
/** 8-Ball Pool: two stools, one each side of the table's foot. Players sit down to start or join a match. */
export const POOL_TABLE = { id: "pl0", x: X0 + 560, y: 520, w: 240, h: 128, seats: 2 };

export const ARCADE_PLANTS: [number, number][] = [[X0 + 62, 740], [X0 + 962, 740], [X0 + 962, 220], [X0 + 470, 150]];

type Table = { id: string; x: number; y: number; w: number; seats: number };
const tableSeats = (t: Table, step: number, first: number, below = 72): Seat[] =>
  Array.from({ length: t.seats }, (_, i) => {
    const x = t.x + first + i * step;
    const y = t.y + below; // just below the table's solid base
    return { id: `f2-${t.id}-${i + 1}`, kind: "chair" as const, x, y, depth: y + 21, flipX: false, exit: { x, y: y + 24 } };
  });

export function arcadeSeats(): Seat[] {
  return [...tableSeats(BLACKJACK, 40, 20), ...tableSeats(ROULETTE, 48, 24), ...tableSeats(POKER, 40, 20, 90), ...tableSeats(POOL_TABLE, 80, 80, 126)];
}

/** "f2-bj0-3" -> { table: "bj0", index: 2 }, or null for any other seat id. */
export type ArcadeTable = "bj0" | "rt0" | "pk0" | "pl0";
export function arcadeSeatInfo(seatId: string | null | undefined): { table: ArcadeTable; index: number } | null {
  if (!seatId) return null;
  const m = /^f2-(bj0|rt0|pk0|pl0)-(\d+)$/.exec(seatId);
  return m ? { table: m[1] as ArcadeTable, index: Number(m[2]) - 1 } : null;
}

/** The game window a table seat opens. */
export const TABLE_GAME: Record<ArcadeTable, ArcadeGame> = { bj0: "blackjack", rt0: "roulette", pk0: "poker", pl0: "pool" };
export const TABLE_NAME: Record<ArcadeTable, string> = { bj0: "Blackjack", rt0: "Roulette", pk0: "Poker", pl0: "8-Ball Pool" };

// ---- collision ----------------------------------------------------------------------------

export type Box = { x: number; y: number; w: number; h: number };
/** The solid base of each table (what you bump into; the felt above it is just art). */
export const TABLE_SOLIDS: Record<ArcadeTable, Box> = {
  bj0: { x: BLACKJACK.x + 4, y: BLACKJACK.y + 22, w: BLACKJACK.w - 8, h: 44 },
  rt0: { x: ROULETTE.x + 4, y: ROULETTE.y + 22, w: ROULETTE.w - 8, h: 46 },
  pk0: { x: POKER.x + 4, y: POKER.y + 22, w: POKER.w - 8, h: 58 },
  pl0: { x: POOL_TABLE.x + 4, y: POOL_TABLE.y + 22, w: POOL_TABLE.w - 8, h: 90 },
};
export const plantBox = ([x, y]: [number, number]): Box => ({ x: x - 8, y: y - 12, w: 16, h: 12 });

/** Every piece of Floor 2 furniture you cannot walk through (walls are separate). The scene and the layout test share this. */
export function arcadeSolids(elevator: Box): Box[] {
  return [elevator, ...MACHINES.map((m) => m.solid), ...Object.values(TABLE_SOLIDS), ...ARCADE_PLANTS.map(plantBox)];
}
