// Where everything is on Floor 2 (the Arcade & Casino). All positions are WORLD pixels (Floor 2 is shifted right by
// FLOOR2_X, see src/shared/floors.ts). Shared by the server (seats) and the Phaser scene.
//
// Floor 2 is taller than the other floors (ARCADE_H) and laid out in zones, with walkways between the bands:
//
//   back wall:  CLASSIC ARCADE cabinets + leaderboard kiosk | SPORTS LOUNGE (big screen, couches) | BEAT BATTLE x2
//   walkway
//   middle:     elevator | NEON DRIFT GP racing rigs | BLACKJACK | ROULETTE (+ watch spot)
//   walkway
//   casino row: Pixel Slots x2 | Huff & Xtra Puff | Huff & Xtra Puff BONUS | Plinko | Lottery booth
//   walkway
//   bottom:     TEXAS HOLD'EM | 8-BALL POOL
import { FLOOR2_H, FLOOR2_X } from "../shared/floors.ts";
import { WORLD_W } from "./constants.ts";
import type { Seat } from "./layout.ts";

const X0 = FLOOR2_X;
/** Floor 2's height in world pixels (the other floors are WORLD_H). */
export const ARCADE_H = FLOOR2_H;

export type ArcadeGame =
  | "slots" | "mines" | "moon" | "penguin" | "board" | "fighter" | "racer" | "beat" // cabinets and the kiosk
  | "plinko" | "huff" | "huffBonus" | "lottery" // the casino wing: Plinko table, the two Huff & Xtra Puff slots, the lottery booth
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
  sign?: string; // short marquee label shown above it
};

/** A machine standing with its back to the north: the bottom 28px is solid, you stand 24px below its front. */
const machine = (id: string, game: ArcadeGame | null, art: string, lx: number, top: number, w: number, h: number, label: string, glow: number, sign?: string): Machine => ({
  id, game, art, x: X0 + lx, y: top, w, h,
  solid: { x: X0 + lx + 2, y: top + h - 28, w: w - 4, h: 28 },
  spot: { x: X0 + lx + Math.round(w / 2), y: top + h + 24 },
  label, glow, sign,
});
const CAB_W = 44, CAB_H = 60, WALL_ROW = 100;
const cabinet = (id: string, game: ArcadeGame | null, art: string, lx: number, label: string, glow: number, sign?: string) => machine(id, game, art, lx, WALL_ROW, CAB_W, CAB_H, label, glow, sign);

/** The casino row: the slot machines, Plinko and the lottery booth, all standing on the casino carpet. */
export const CASINO_ROW = 600;

export const MACHINES: Machine[] = [
  // CLASSIC ARCADE (back wall, left)
  cabinet("mines", "mines", "cab_mines", 140, "play Cafe Mines", 0x7fc8a9, "MINES"),
  cabinet("moon", "moon", "cab_moon", 204, "fly To the Moon", 0x9fb8d8, "TO THE MOON"),
  cabinet("penguin", "penguin", "cab_penguin", 268, "play Penguin Cross", 0x7fd8f0, "PENGUIN"),
  cabinet("fighter", "fighter", "cab_fighter", 332, "play Pixel Fighter II", 0xd9304a, "FIGHTER II"),
  cabinet("deco-d", null, "cab_deco0", 396, "", 0x9b5de5),
  machine("kiosk", "board", "kiosk", 462, 96, 56, 68, "view the Leaderboards", 0xf28fad, "TOP SCORES"),
  // BEAT BATTLE (back wall, right): two stations, each with a dance pad on the floor in front (the pad is the Press E spot)
  { ...cabinet("beat-a", "beat", "cab_beat", 858, "play Beat Battle (station 1)", 0xff5fa8, "P1"), spot: { x: X0 + 880, y: 196 } },
  { ...cabinet("beat-b", "beat", "cab_beat", 926, "play Beat Battle (station 2)", 0xff5fa8, "P2"), spot: { x: X0 + 948, y: 196 } },
  // CASINO row
  machine("slots-a", "slots", "cab_slots", 80, CASINO_ROW, CAB_W, CAB_H, "play Pixel Slots", 0xf2c36b, "PIXEL SLOTS"),
  machine("slots-b", "slots", "cab_slots", 144, CASINO_ROW, CAB_W, CAB_H, "play Pixel Slots", 0xf2c36b, "PIXEL SLOTS"),
  machine("huff", "huff", "cab_huff", 222, CASINO_ROW - 6, 54, 66, "play Huff & Xtra Puff", 0xf2d27a, "HUFF & XTRA PUFF"),
  machine("huff-bonus", "huffBonus", "cab_huff_bonus", 300, CASINO_ROW - 8, 66, 68, "play Huff & Xtra Puff BONUS", 0xff8fb0, "HUFF BONUS"),
  machine("plinko", "plinko", "cab_plinko", 394, CASINO_ROW - 26, 60, 86, "play Pixel Plinko", 0xff5fa8, "PLINKO"),
  machine("lottery", "lottery", "lottery_booth", 486, CASINO_ROW - 16, 84, 76, "buy a Lucky Bean Lottery ticket", 0x7fe0a9, "LOTTERY"),
];

// ---- the card, wheel and pool tables ------------------------------------------------------------

export const BLACKJACK = { id: "bj0", x: X0 + 420, y: 376, w: 160, h: 88, seats: 4 };
export const ROULETTE = { id: "rt0", x: X0 + 668, y: 368, w: 192, h: 96, seats: 4 };
/** Stand here (right of the roulette table) to watch and bet without a seat. */
export const ROULETTE_WATCH = { x: ROULETTE.x + ROULETTE.w + 30, y: ROULETTE.y + 66 };

/** Texas Hold'em: six seats along the front of a long green-felt table. */
export const POKER = { id: "pk0", x: X0 + 90, y: 820, w: 240, h: 100, seats: 6 };
/** 8-Ball Pool: two stools, one each side of the table's foot. Players sit down to start or join a match. */
export const POOL_TABLE = { id: "pl0", x: X0 + 600, y: 800, w: 240, h: 128, seats: 2 };

// ---- NEON DRIFT GP: two sit-down racing rigs side by side ---------------------------------------

/** Each rig is a cabinet (screen, steering wheel, dash) with a bucket seat in front of it facing the screen. */
export const RIG = { w: 60, cabH: 56, seatH: 30 };
export const RIGS = [{ id: "rig1", x: X0 + 210, y: 340 }, { id: "rig2", x: X0 + 286, y: 340 }];
/** You sit in a rig's seat to race (sitting there opens Neon Drift GP, like a table seat opens its game). */
export function rigSeats(): Seat[] {
  return RIGS.map((r, i) => {
    const x = r.x + RIG.w / 2, y = r.y + RIG.cabH + 14;
    return { id: `f2-rig${i + 1}`, kind: "chair" as const, x, y, depth: r.y + RIG.cabH + RIG.seatH - 1, flipX: false, exit: { x, y: r.y + RIG.cabH + RIG.seatH + 18 } };
  });
}
export const isRigSeat = (id: string | null | undefined) => !!id && /^f2-rig\d$/.test(id);

// ---- SPORTS LOUNGE: a big screen on the back wall, couches facing it -----------------------------

export const BIG_SCREEN = { x: X0 + 580, y: 10, w: 240, h: 78 };
/** Couches face the screen, so we see their backs (and the heads of whoever sits on them). 96px wide each. */
export const LOUNGE_SOFAS = [
  { id: "ls-a", x: X0 + 590, y: 196 }, { id: "ls-b", x: X0 + 712, y: 196 },
  { id: "ls-c", x: X0 + 590, y: 270 }, { id: "ls-d", x: X0 + 712, y: 270 },
];
export const LOUNGE_TABLES = [{ x: X0 + 618, y: 112 }, { x: X0 + 740, y: 112 }];
export const LOUNGE_AREA = { x: X0 + 566, y: 100, w: 270, h: 228 };
export function loungeSeats(): Seat[] {
  return LOUNGE_SOFAS.flatMap((s) => [24, 72].map((dx, n) => ({
    id: `f2-${s.id}-${n + 1}`, kind: "sofa" as const, x: s.x + dx, y: s.y + 4, depth: s.y + 43, flipX: false, exit: { x: s.x + dx, y: s.y - 28 },
  })));
}

// ---- BEAT BATTLE dance floor (pure floor art: you stand on it to play) --------------------------

export const DANCE_PADS = MACHINES.filter((m) => m.game === "beat").map((m) => ({ x: m.spot.x - 24, y: m.spot.y - 26, w: 48, h: 48 }));

// ---- decoration ----------------------------------------------------------------------------------

export const ARCADE_PLANTS: [number, number][] = [[X0 + 62, ARCADE_H - 40], [X0 + 962, ARCADE_H - 40], [X0 + 962, 360], [X0 + 548, 160], [X0 + 620, 700], [X0 + 962, 700]];

/** Zone signs hung over each area (text, world x of the centre, world y of the baseline, colour). */
export const ZONE_SIGNS: { text: string; x: number; y: number; color: string }[] = [
  { text: "CLASSIC ARCADE", x: X0 + 300, y: 30, color: "#58e1ff" },
  { text: "SPORTS LOUNGE", x: BIG_SCREEN.x + BIG_SCREEN.w / 2, y: BIG_SCREEN.y + BIG_SCREEN.h + 16, color: "#f2c36b" },
  { text: "BEAT BATTLE", x: X0 + 914, y: 30, color: "#ff5fa8" },
  { text: "NEON DRIFT GP", x: X0 + 286, y: 326, color: "#f2a93b" },
  { text: "TABLE GAMES", x: X0 + 640, y: 350, color: "#7fe0a9" },
  { text: "★ CASINO ★", x: X0 + 325, y: CASINO_ROW - 40, color: "#f2c36b" },
];

type Table = { id: string; x: number; y: number; w: number; seats: number };
const tableSeats = (t: Table, step: number, first: number, below = 72): Seat[] =>
  Array.from({ length: t.seats }, (_, i) => {
    const x = t.x + first + i * step;
    const y = t.y + below; // just below the table's solid base
    return { id: `f2-${t.id}-${i + 1}`, kind: "chair" as const, x, y, depth: y + 21, flipX: false, exit: { x, y: y + 24 } };
  });

/** The table stools only (each opens its table's game window). */
export function tableSeatList(): Seat[] {
  return [...tableSeats(BLACKJACK, 40, 20), ...tableSeats(ROULETTE, 48, 24), ...tableSeats(POKER, 40, 20, 90), ...tableSeats(POOL_TABLE, 80, 80, 126)];
}

/** Every seat on Floor 2: table stools, racing rig seats and the lounge couches. */
export function arcadeSeats(): Seat[] {
  return [...tableSeatList(), ...rigSeats(), ...loungeSeats()];
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
/** A rig's cabinet is solid; its seat (in front) is where you sit, and it blocks walking too. */
export const rigSolids = (): Box[] => RIGS.flatMap((r) => [{ x: r.x + 4, y: r.y + 24, w: RIG.w - 8, h: RIG.cabH - 24 }, { x: r.x + 12, y: r.y + RIG.cabH, w: RIG.w - 24, h: RIG.seatH - 6 }]);
export const loungeSolids = (): Box[] => [
  ...LOUNGE_SOFAS.map((s) => ({ x: s.x, y: s.y, w: 96, h: 36 })),
  ...LOUNGE_TABLES.map((t) => ({ x: t.x + 4, y: t.y + 8, w: 48, h: 18 })),
];

/** Every piece of Floor 2 furniture you cannot walk through (walls are separate). The scene and the layout test share this. */
export function arcadeSolids(elevator: Box): Box[] {
  return [elevator, ...MACHINES.map((m) => m.solid), ...Object.values(TABLE_SOLIDS), ...ARCADE_PLANTS.map(plantBox), ...rigSolids(), ...loungeSolids()];
}

/** The four walls of Floor 2. */
export function arcadeWalls(tile = 32, wallH = 96): Box[] {
  return [{ x: X0, y: 0, w: WORLD_W, h: wallH }, { x: X0, y: 0, w: tile, h: ARCADE_H }, { x: X0 + WORLD_W - tile, y: 0, w: tile, h: ARCADE_H }, { x: X0, y: ARCADE_H - tile, w: WORLD_W, h: tile }];
}
