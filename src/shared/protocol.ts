// The Socket.IO contract between the browser and the server. Types only (plus a few limits),
// so both sides import the same file and can't drift apart.
import type { DrinkKind } from "../lib/drinks.ts";
import type { SeatSnapshot } from "../game/seats.ts";
import type { WorldAction, WorldState } from "../game/worldState.ts";
import type { Entry } from "../lib/guestbook.ts";
import type { Floor } from "./floors.ts";
import type { BjResult, Card, RouletteBet, SlotSymbol } from "./arcade.ts";
import type { PackedSprite, RoastGrade } from "./rooftop.ts";

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
  floor: Floor;
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

/** Your private table, as the server sees it (null when you are not seated at one). */
export type TableInfo = { id: string; name: string; locked: boolean; seated: number; capacity: number };

/** One outfit on the Fashion Stand. `id` is a public hash, never the device's client id. */
export type OutfitEntry = {
  id: string;
  name: string; // anonymous username (escaped)
  pixels: string[];
  votes: number; // upvotes received today
  inCafe: boolean;
  mine: boolean;
  votedByMe: boolean;
  crowned: boolean; // currently a #1 outfit today
};
export type OutfitView = { day: string; entries: OutfitEntry[]; votedToday: boolean };

export type GuestbookView = { entries: (Entry & { mine?: boolean })[]; signedToday: boolean };

export type JoinPayload = { clientId: string; name: string; pixels: string[]; beans?: number /* drink-making beans on this device, seeds a brand-new wallet */ };

export type InitPayload = {
  selfId: string;
  players: PlayerState[]; // everyone else already in the cafe
  seats: SeatSnapshot;
  world: WorldState;
  rumours: RumourView[];
  guestbook: GuestbookView;
  online: number;
  locks: string[]; // ids of locked private tables
  table: TableInfo | null;
  crowns: string[]; // socket ids of players wearing a #1 outfit today
  floor: Floor;
  beans: number; // your Cafe Beans balance (fictional currency)
  topup?: number; // a daily starter top-up was just added
};

/** Sent to you alone when you take the stairs: your new floor, who is on it, and where you landed. */
export type FloorState = { floor: Floor; x: number; y: number; players: PlayerState[]; seats: SeatSnapshot };

// ------------------------------------------------------------------ Floor 2: arcade views
export type WalletMsg = { beans: number; topup?: number };
export type BoardRow = { name: string; value: number; mine: boolean };
export type BoardView = { ice: BoardRow[]; moon: BoardRow[]; rich: BoardRow[] };

export type SlotsResult = { reels: SlotSymbol[]; mult: number; win: number; beans: number };

export type MinesView = {
  active: boolean;
  bet: number;
  mines: number; // hazards on the board
  revealed: number[]; // safe tiles opened so far (0..24, row-major)
  mult: number; // current multiplier
  next: number; // multiplier if the next tile is safe
  over?: "hit" | "cashed" | "cleared";
  payout?: number;
  hazards?: number[]; // shown once the round is over
  beans: number;
};

export type CrashView = {
  phase: "wait" | "fly" | "crashed";
  deadline: number | null; // server time (ms) the next flight takes off, during "wait"
  now: number; // server time of this message
  mult: number; // current multiplier (final one once crashed)
  history: number[]; // recent crash points, newest last
  players: { name: string; amount: number; cashedAt?: number }[];
  mine: { amount: number; auto?: number; cashedAt?: number; payout?: number } | null;
};

export type RouletteView = {
  phase: "bet" | "spin" | "result";
  deadline: number | null; // server time (ms) betting closes / spin ends / next round
  now: number;
  result: number | null; // known from the moment the wheel starts spinning
  spinMs: number;
  history: number[];
  mine: RouletteBet[];
  watching: number; // how many people are betting this round
  returned: number | null; // result phase: total beans your bets paid out
};

export type BjSeatView = {
  name: string;
  bet: number;
  cards: Card[];
  total: number;
  status: "waiting" | "bet" | "playing" | "stand" | "bust" | "blackjack";
  result?: BjResult;
  payout?: number;
  mine: boolean;
};
export type BlackjackView = {
  phase: "bet" | "play" | "dealer" | "payout";
  deadline: number | null;
  now: number;
  dealer: Card[]; // the hole card is "??" until the dealer's turn
  dealerTotal: number | null;
  seats: (BjSeatView | null)[];
  turn: number | null;
  mySeat: number; // -1 when you are not seated
  canDouble: boolean;
};

// ------------------------------------------------------------------ Floor 3: rooftop views
/** Your marshmallow is on the stick: heat rises at `rate` x real time (see roastHeat in shared/rooftop.ts). */
export type RoastStart = { rate: number };
export type RoastResult = { grade: RoastGrade; heat: number; perfect: boolean; bonus: number; beans: number };

/** An anonymous wish on the star wall. `id` is public; the author's device is never sent. */
export type StarWishView = { id: string; text: string; ts: number; mine: boolean };
export type StarsView = { wishes: StarWishView[] };

export type PolaroidPerson = { name: string; sprite: PackedSprite };
/** One photo on the Rooftop Polaroid Wall. */
export type PolaroidView = { id: string; ts: number; by: string; people: PolaroidPerson[] };

export type IceStart = { token: number };
export type IceFinish = { beans: number; best: boolean; score: number; rank: number | null };

/** Ack for arcade requests: the reply fields on success, a reason on failure. */
export type Ack<T = object> = ({ ok: true } & T) | { ok: false; reason: string };

export type ChatMessage = { id: string; from: string; name: string; text: string; ts: number; scope?: "table" };
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
  "table:lock": (p: { locked: boolean }, ack: (r: Result) => void) => void;
  "outfit:list": (ack: (r: { ok: true; view: OutfitView } | { ok: false; reason: string }) => void) => void;
  "outfit:vote": (p: { id: string }, ack: (r: Result) => void) => void;
  // ---- floors + Cafe Beans
  "floor:go": (p: { floor: Floor }, ack: (r: Result) => void) => void;
  "beans:earn": (p: { amount: number }) => void; // from a drink you made or a gift you gave
  // ---- Floor 2 mini-games (every one answers with an Ack)
  "slots:spin": (p: { bet: number }, ack: (r: Ack<SlotsResult>) => void) => void;
  "mines:state": (ack: (r: Ack<{ view: MinesView }>) => void) => void; // pick up a round you left running
  "mines:start": (p: { bet: number; mines: number }, ack: (r: Ack<{ view: MinesView }>) => void) => void;
  "mines:reveal": (p: { tile: number }, ack: (r: Ack<{ view: MinesView }>) => void) => void;
  "mines:cashout": (ack: (r: Ack<{ view: MinesView }>) => void) => void;
  "crash:join": (ack: (r: Ack<{ view: CrashView }>) => void) => void;
  "crash:leave": () => void;
  "crash:bet": (p: { amount: number; auto?: number }, ack: (r: Ack) => void) => void;
  "crash:cashout": (ack: (r: Ack<{ mult: number; payout: number }>) => void) => void;
  "roulette:join": (ack: (r: Ack<{ view: RouletteView }>) => void) => void;
  "roulette:leave": () => void;
  "roulette:bet": (p: RouletteBet, ack: (r: Ack) => void) => void;
  "roulette:clear": (ack: (r: Ack) => void) => void;
  "bj:bet": (p: { amount: number }, ack: (r: Ack) => void) => void;
  "bj:hit": (ack: (r: Ack) => void) => void;
  "bj:stand": (ack: (r: Ack) => void) => void;
  "bj:double": (ack: (r: Ack) => void) => void;
  "ice:start": (ack: (r: Ack<IceStart>) => void) => void;
  "ice:finish": (p: { token: number; score: number }, ack: (r: Ack<IceFinish>) => void) => void;
  "arcade:board": (ack: (r: Ack<{ view: BoardView }>) => void) => void;
  // ---- Floor 3 rooftop (every one answers with an Ack)
  "roast:start": (ack: (r: Ack<RoastStart>) => void) => void;
  "roast:pull": (ack: (r: Ack<RoastResult>) => void) => void;
  "stars:join": (ack: (r: Ack<StarsView>) => void) => void;
  "stars:leave": () => void;
  "stars:wish": (p: { text: string }, ack: (r: Ack<StarsView>) => void) => void;
  "polaroid:take": (ack: (r: Ack<{ photo: PolaroidView }>) => void) => void;
  "polaroid:wall": (ack: (r: Ack<{ photos: PolaroidView[] }>) => void) => void;
}

/** The rooftop requests the server routes to the Rooftop class (see server/rooftop.ts). */
export const ROOFTOP_EVENTS = ["roast:start", "roast:pull", "stars:join", "stars:leave", "stars:wish", "polaroid:take", "polaroid:wall"] as const;
export type RooftopEvent = (typeof ROOFTOP_EVENTS)[number];

/** The arcade requests the server routes to the Arcade class (see server/arcade.ts). */
export const ARCADE_EVENTS = [
  "slots:spin", "mines:state", "mines:start", "mines:reveal", "mines:cashout", "crash:join", "crash:leave", "crash:bet", "crash:cashout",
  "roulette:join", "roulette:leave", "roulette:bet", "roulette:clear", "bj:bet", "bj:hit", "bj:stand", "bj:double",
  "ice:start", "ice:finish", "arcade:board",
] as const;
export type ArcadeEvent = (typeof ARCADE_EVENTS)[number];

/** Server -> browser. */
export interface ServerToClient {
  "player:joined": (p: PlayerState) => void;
  "player:left": (p: { id: string }) => void;
  "player:profile": (p: { id: string; pixels: string[] }) => void;
  "player:drink": (p: { id: string; kind: DrinkKind | null }) => void;
  moves: (p: MoveUpdate[]) => void; // batched, volatile (may be dropped; the next one fixes it)
  emote: (p: { id: string; n: number }) => void;
  seats: (p: SeatSnapshot) => void; // full seat snapshot after any change
  chat: (p: ChatMessage) => void; // only sent to players near the sender, or (scope "table") to the sender's private table
  system: (p: { text: string }) => void; // "X switched the jukebox to ..."
  world: (p: WorldState) => void; // full shared state after any change
  rumours: (p: RumourView[]) => void; // personalised per player
  guestbook: (p: GuestbookView) => void; // personalised per player
  online: (p: { count: number }) => void;
  "table:info": (p: TableInfo | null) => void; // your own private table, sent when it changes
  locks: (p: string[]) => void; // which private tables are locked (for the padlock on the table)
  crowns: (p: string[]) => void; // who wears the #1 outfit crown right now (socket ids)
  "floor:state": (p: FloorState) => void; // you changed floor
  wallet: (p: WalletMsg) => void; // your Cafe Beans balance changed
  "crash:state": (p: CrashView | null) => void; // only while you watch the To the Moon terminal
  "roulette:state": (p: RouletteView | null) => void; // only while you sit or watch at the roulette table
  "bj:state": (p: BlackjackView | null) => void; // only while you sit at the blackjack table
  "stars:wishes": (p: { wishes: StarWishView[]; fresh: string | null }) => void; // only while you are at the telescope; `fresh` = id of a wish that just arrived
  "polaroid:new": (p: PolaroidView) => void; // a photo was just pinned (sent to everyone on Floor 3)
}
