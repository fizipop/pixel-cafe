// Shared world constants. No Phaser import here, so pure modules (and tests) can use it.

export const TILE = 32;
export const COLS = 32;
export const ROWS = 24;
export const WORLD_W = COLS * TILE;
export const WORLD_H = ROWS * TILE;
export const WALL_H = 96; // back wall height in px (3 tiles)

/** Occupant id used in solo mode. When online it becomes `player:<socket id>` (see src/net/client.ts). */
export const PLAYER_ID = "player:me";

/** Where everybody enters the cafe (the front door). */
export const SPAWN = { x: 16 * TILE, y: WORLD_H - TILE * 2 - 6 };
