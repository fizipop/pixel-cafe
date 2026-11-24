// Floors of the cafe. All floors live in ONE coordinate space: each floor is the same 1024x768 room,
// shifted right by its own offset (Floor 2 by FLOOR2_X, Floor 3 by FLOOR3_X). So a position alone says
// which floor you are on, the Phaser scene needs only one world, and the server can clamp/validate
// positions per floor.
import { WORLD_H, WORLD_W } from "../game/constants.ts";

export type Floor = 1 | 2 | 3;
export const FLOORS: Floor[] = [1, 2, 3];
export const FLOOR2_X = 1280;
export const FLOOR3_X = 2560;

export const FLOOR_NAMES: Record<Floor, string> = {
  1: "Floor 1 · Main Cafe",
  2: "Floor 2 · Arcade",
  3: "Floor 3 · Rooftop Lounge",
};

export const isFloor = (v: unknown): v is Floor => v === 1 || v === 2 || v === 3;

/** Left edge of a floor in world pixels. */
export const floorX0 = (f: Floor) => (f === 3 ? FLOOR3_X : f === 2 ? FLOOR2_X : 0);
export const floorBounds = (f: Floor) => ({ x: floorX0(f), y: 0, w: WORLD_W, h: WORLD_H });
/** Total width of the shared world (all floors side by side). */
export const WORLD_TOTAL_W = FLOOR3_X + WORLD_W;

/** The elevator: stand on `spot` and press E. `arrive` is where you land on that floor. */
export const STAIRS_REACH = 80; // the server accepts you this close (the client prompt is tighter)
export type StairsDef = { x: number; y: number; w: number; h: number; solid: { x: number; y: number; w: number; h: number }; spot: { x: number; y: number }; arrive: { x: number; y: number } };
export const STAIRS: Record<Floor, StairsDef> = {
  1: stairsAt(0),
  2: stairsAt(FLOOR2_X),
  3: stairsAt(FLOOR3_X),
};

function stairsAt(x0: number): StairsDef {
  return {
    x: x0 + 44, y: 340, w: 56, h: 72,
    solid: { x: x0 + 46, y: 390, w: 52, h: 22 },
    spot: { x: x0 + 72, y: 436 },
    arrive: { x: x0 + 140, y: 440 },
  };
}

/** Which floor a world x belongs to. */
export const floorOfX = (x: number): Floor => (x >= FLOOR3_X - 128 ? 3 : x >= FLOOR2_X - 128 ? 2 : 1);

/** Seat ids on Floor 2 start with "f2-" (e.g. "f2-bj0-3"), on Floor 3 with "f3-". Everything else is Floor 1. */
export const ARCADE_SEAT_PREFIX = "f2-";
export const ROOFTOP_SEAT_PREFIX = "f3-";
export const floorOfSeat = (seatId: string): Floor =>
  seatId.startsWith(ROOFTOP_SEAT_PREFIX) ? 3 : seatId.startsWith(ARCADE_SEAT_PREFIX) ? 2 : 1;

/** Keep a position inside its floor's walls-to-walls rectangle. */
export function clampToFloor(floor: Floor, x: number, y: number) {
  const x0 = floorX0(floor);
  return { x: Math.min(x0 + WORLD_W, Math.max(x0, x)), y: Math.min(WORLD_H, Math.max(0, y)) };
}
