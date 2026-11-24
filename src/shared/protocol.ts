// The Socket.IO contract between the browser and the server. Types only (plus a few limits),
// so both sides import the same file and can't drift apart.
import type { DrinkKind } from "../lib/drinks.ts";
import type { SeatSnapshot } from "../game/seats.ts";
import type { WorldAction, WorldState } from "../game/worldState.ts";
import type { Entry } from "../lib/guestbook.ts";

// ------------------------------------------------------------------ limits
export const CHAT_MAX = 150; // characters
export const CHAT_COOLDOWN_MS = 1000; // max 1 message per second per player
export const CHAT_RADIUS = 280; // world pixels: roughly one screen
export const NAME_MAX = 24;
export const MOVE_HZ = 15; // position updates per second (client send rate and server broadcast rate)
export const SIT_REACH = 130; // how close (px) you must be to a seat to claim it

/** How a socket id appears in seat and table-game state ("npc:<name>" is used for NPCs). */
export const playerOccupant = (socketId: string) => `player:${socketId}`;

// ------------------------------------------------------------------ data
export type PlayerState = {
  id: string; // socket id
  name: string; // anonymous username (already escaped)
  pixels: string[]; // 32x32 sprite, "" = transparent
  x: number;
  y: number;
  flip: boolean; // facing left
  moving: boolean;
  drink: DrinkKind | null; // held drink badge
};

export type MoveUpdate = { id: string; x: number; y: number; flip: boolean; moving: boolean };

export type RumourView = {
  id: string;
  text: string;
  createdAt: number;
  likes: number; // total, includes your own like
  likedByMe: boolean;
  mine: boolean;
  sample?: boolean;
};

export type GuestbookView = { entries: (Entry & { mine?: boolean })[]; signedToday: boolean };

export type JoinPayload = { clientId: string; name: string; pixels: string[] };

export type InitPayload = {
  selfId: string;
  players: PlayerState[]; // everyone else already in the cafe
  seats: SeatSnapshot;
  world: WorldState;
  rumours: RumourView[];
  guestbook: GuestbookView;
  online: number;
};

export type ChatMessage = { id: string; from: string; name: string; text: string; ts: number };
export type Result = { ok: true } | { ok: false; reason: string };

// ------------------------------------------------------------------ events
/** Browser -> server. A trailing callback is the acknowledgement. */
export interface ClientToServer {
  join: (p: JoinPayload, ack: (r: { ok: true; init: InitPayload } | { ok: false; reason: string }) => void) => void;
  move: (p: { x: number; y: number; flip: boolean; moving: boolean }) => void;
  profile: (p: { pixels: string[] }) => void; // you switched characters
  drink: (p: { kind: DrinkKind | null }) => void; // you picked up / put down a drink
  emote: (p: { n: number }) => void; // 0..3 for keys 1-4
  sit: (p: { seatId: string }, ack: (r: Result) => void) => void;
  stand: () => void;
  chat: (p: { text: string }, ack: (r: Result) => void) => void;
  "world:action": (p: { action: WorldAction }, ack?: (r: Result) => void) => void;
  "rumour:post": (p: { text: string }, ack: (r: Result) => void) => void;
  "rumour:like": (p: { id: string }) => void;
  "guestbook:sign": (p: { text: string }, ack: (r: Result) => void) => void;
}

/** Server -> browser. */
export interface ServerToClient {
  "player:joined": (p: PlayerState) => void;
  "player:left": (p: { id: string }) => void;
  "player:profile": (p: { id: string; pixels: string[] }) => void;
  "player:drink": (p: { id: string; kind: DrinkKind | null }) => void;
  moves: (p: MoveUpdate[]) => void; // batched, volatile (may be dropped; the next one fixes it)
  emote: (p: { id: string; n: number }) => void;
  seats: (p: SeatSnapshot) => void; // full seat snapshot after any change
  chat: (p: ChatMessage) => void; // only sent to players near the sender (and the sender)
  system: (p: { text: string }) => void; // "X switched the jukebox to ..."
  world: (p: WorldState) => void; // full shared state after any change
  rumours: (p: RumourView[]) => void; // personalised per player
  guestbook: (p: GuestbookView) => void; // personalised per player
  online: (p: { count: number }) => void;
}
