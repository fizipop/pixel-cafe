// Floors of the cafe. Both floors live in ONE coordinate space: Floor 2 is the same 1024x768 room,
// shifted right by FLOOR2_X. So a position alone says which floor you are on, the Phaser scene
// needs only one world, and the server can clamp/validate positions per floor.
import { WORLD_H, WORLD_W } from "../game/constants.ts";

export type Floor = 1 | 2;
export const FLOORS: Floor[] = [1, 2];
export const FLOOR2_X = 1280;

export const FLOOR_NAMES: Record<Floor, string> = {
  1: "Floor 1 · Main Cafe",
  2: "Floor 2 · Arcade",
};

/** Left edge of a floor in world pixels. */
export const floorX0 = (f: Floor) => (f === 2 ? FLOOR2_X : 0);
export const floorBounds = (f: Floor) => ({ x: floorX0(f), y: 0, w: WORLD_W, h: WORLD_H });

/** The stairs/elevator: stand on `spot` and press E. `arrive` is where you land on that floor. */
export const STAIRS_REACH = 80; // the server accepts you this close (the client prompt is tighter)
export const STAIRS: Record<Floor, { x: number; y: number; w: number; h: number; solid: { x: number; y: number; w: number; h: number }; spot: { x: number; y: number }; arrive: { x: number; y: number } }> = {
  1: stairsAt(0),
  2: stairsAt(FLOOR2_X),
};

function stairsAt(x0: number) {
  return {
    x: x0 + 44, y: 340, w: 56, h: 72,
    solid: { x: x0 + 46, y: 390, w: 52, h: 22 },
    spot: { x: x0 + 72, y: 436 },
    arrive: { x: x0 + 140, y: 440 },
  };
}

/** Which floor a world x belongs to. */
export const floorOfX = (x: number): Floor => (x >= FLOOR2_X - 128 ? 2 : 1);

/** Seat ids on Floor 2 all start with "f2-" (e.g. "f2-bj0-3"). Everything else is Floor 1. */
export const ARCADE_SEAT_PREFIX = "f2-";
export const floorOfSeat = (seatId: string): Floor => (seatId.startsWith(ARCADE_SEAT_PREFIX) ? 2 : 1);

/** Keep a position inside its floor's walls-to-walls rectangle. */
export function clampToFloor(floor: Floor, x: number, y: number) {
  const x0 = floorX0(floor);
  return { x: Math.min(x0 + WORLD_W, Math.max(x0, x)), y: Math.min(WORLD_H, Math.max(0, y)) };
}
