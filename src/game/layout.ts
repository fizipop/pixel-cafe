// Where everything is in the cafe. One place to change the floor plan.
import { TILE, WALL_H } from "./constants.ts";

// [col, row] of each table's top-left tile (tables are 2 tiles wide)
export const TABLES: [number, number][] = [
  [4, 9], [10, 9], [16, 9],
  [4, 15], [10, 15], [16, 15],
];

export const SOFAS = [
  { id: "sofa-a", x: 700, y: 376, kind: "back" as const }, // backrest against the far side
  { id: "sofa-b", x: 700, y: 560, kind: "front" as const }, // we see its back
];
export const COFFEE_TABLE = { x: 720, y: 468 };

export const COUNTER = { col0: 2, col1: 12, row: 5 };
export const COUNTER_ZONE = {
  x0: COUNTER.col0 * TILE - 8,
  x1: (COUNTER.col1 + 1) * TILE + 8,
  y0: (COUNTER.row + 1) * TILE + 4,
  y1: (COUNTER.row + 1) * TILE + 34,
};

// Cork board on the back wall, between the first two windows.
export const BOARD = { x: 580, y: 12, w: 56, h: 46, spot: { x: 608, y: WALL_H + 8 } };

export type Seat = {
  id: string;
  kind: "chair" | "sofa";
  x: number; // where the sitter's (cropped) feet rest
  y: number;
  depth: number; // draw order relative to the furniture
  flipX: boolean; // which way the sitter faces
  exit: { x: number; y: number }; // where you stand to sit, and where you land when you get up
};

export function buildSeats(): Seat[] {
  const seats: Seat[] = [];
  TABLES.forEach(([col, row], i) => {
    const x = col * TILE;
    const y = row * TILE;
    const id = (side: string) => `t${i}-${side}`;
    seats.push(
      { id: id("top"), kind: "chair", x: x + 32, y: y + 5, depth: y + 11, flipX: false, exit: { x: x + 32, y: y + 8 } },
      { id: id("left"), kind: "chair", x: x - 9, y: y + 37, depth: y + 47, flipX: false, exit: { x: x - 8, y: y + 56 } },
      { id: id("right"), kind: "chair", x: x + 73, y: y + 37, depth: y + 47, flipX: true, exit: { x: x + 72, y: y + 56 } },
      { id: id("bottom"), kind: "chair", x: x + 32, y: y + 58, depth: y + 79, flipX: false, exit: { x: x + 32, y: y + 80 } },
    );
  });
  for (const s of SOFAS) {
    [24, 72].forEach((dx, n) => {
      const front = s.kind === "front";
      seats.push({
        id: `${s.id}-${n + 1}`,
        kind: "sofa",
        x: s.x + dx,
        y: front ? s.y + 12 : s.y + 30,
        depth: front ? s.y + 43 : s.y + 45,
        flipX: false,
        exit: { x: s.x + dx, y: front ? s.y - 12 : s.y + 52 },
      });
    });
  }
  return seats;
}

// ---- Phase 3.5 spots -------------------------------------------------------------

// Jukebox against the back wall, right of the third window.
export const JUKEBOX_SPOT = {
  x: 904, y: 84, // top-left of the sprite
  solid: { x: 904, y: 100, w: 32, h: 28 },
  spot: { x: 920, y: 150 }, // stand here to use it
};

// Guestbook lying on the lounge coffee table.
export const GUESTBOOK_SPOT = { x: COFFEE_TABLE.x + 30, y: COFFEE_TABLE.y + 8, spot: { x: 748, y: 490 } };

// The tic-tac-toe board sits on this table (index into TABLES). Whoever sits at it plays Theo.
export const GAME_TABLE = 1;
export const GAME_SEAT_PREFIX = `t${GAME_TABLE}-`;
export const GAME_NPC = "npc:theo"; // sits at t1-right and plays "O"
export const gameBoardPos = () => {
  const [col, row] = TABLES[GAME_TABLE];
  return { x: col * TILE + 25, y: row * TILE + 21 };
};

// Where the cafe cat wanders (the rug lounge).
export const CAT_AREA = { x0: 660, y0: 400, x1: 940, y1: 620, home: { x: 860, y: 480 } };

/** Seats the NPCs sit in all day. The server marks them taken so real players can't use them. */
export const NPC_SEATS: Record<string, string> = {
  "t1-right": "npc:theo",
  "t3-top": "npc:kai",
  "sofa-a-2": "npc:juno",
};
