// The cafe room: ALL authoritative state and rules, with no sockets in sight.
// `index.ts` plugs Socket.IO into it; tests plug in fake connections.
//
// Players are addressed by socket id. In seat/table state they appear as the occupant id
// "player:<socket id>" (NPCs are "npc:<name>"), the same ids the client uses.
import { SeatState } from "../src/game/seats.ts";
import { GAME_NPC, GAME_SEAT_PREFIX, NPC_SEATS, buildSeats } from "../src/game/layout.ts";
import { WorldStore, newWorld, type WorldAction } from "../src/game/worldState.ts";
import { chooseMove, type Side } from "../src/game/tictactoe.ts";
import { MOODS, WEATHERS } from "../src/lib/moods.ts";
import { DRINKS, type DrinkKind } from "../src/lib/drinks.ts";
import { SPAWN, WORLD_H, WORLD_W } from "../src/game/constants.ts";
import { cleanLine, escapeHtml } from "../src/shared/text.ts";
import {
  CHAT_COOLDOWN_MS, CHAT_MAX, CHAT_RADIUS, NAME_MAX, SIT_REACH, playerOccupant,
  type ChatMessage, type InitPayload, type JoinPayload, type MoveUpdate, type PlayerState, type Result,
} from "../src/shared/protocol.ts";
import { Guestbook, RumourBoard } from "./boards.ts";

/** What the room needs from a connection. Socket.IO provides it in index.ts. */
export interface Conn {
  id: string;
  emit(event: string, payload?: unknown): void;
  /** Like emit, but fine to drop if the client is busy (used for position updates). */
  emitVolatile(event: string, payload?: unknown): void;
}

type Player = {
  conn: Conn;
  clientId: string;
  state: PlayerState;
  seat: string | null;
  lastChat: number;
  lastEmote: number;
  lastProfile: number;
  dirty: boolean;
};

export type RoomOptions = {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void; // for the NPC's thinking delay
  maxPlayers?: number;
};

export const MAX_PLAYERS = 40;
export const occupantOf = playerOccupant;
const isDrink = (k: unknown): k is DrinkKind => DRINKS.some((d) => d.id === k);
const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** A 32x32 sprite: 1024 entries, each "" or a hex colour. Anything else is blanked. */
export function sanitizePixels(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length !== 1024) return null;
  return raw.map((c) => (typeof c === "string" && /^#[0-9a-fA-F]{3,8}$/.test(c) ? c : ""));
}

export class Room {
  readonly players = new Map<string, Player>();
  readonly seats = new SeatState();
  readonly world: WorldStore;
  readonly rumours: RumourBoard;
  readonly guestbook: Guestbook;

  private now: () => number;
  private schedule: (fn: () => void, ms: number) => void;
  private maxPlayers: number;
  private seatMap = new Map(buildSeats().map((s) => [s.id, s]));
  private msgSeq = 0;
  private aiPending = false;

  constructor(opts: RoomOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
    this.rumours = new RumourBoard(this.now);
    this.guestbook = new Guestbook(this.now);
    for (const [seatId, who] of Object.entries(NPC_SEATS)) this.seats.sit(who, seatId); // NPCs' chairs are taken
    this.world = new WorldStore(newWorld());
    this.world.dispatch({ type: "ttt", action: { type: "join", side: "O", by: GAME_NPC } }); // Theo plays "O"
    this.world.subscribe((state) => {
      this.all("world", state);
      this.thinkNpc();
    });
  }

  // ------------------------------------------------------------ helpers

  private all(event: string, payload?: unknown, exceptId?: string) {
    for (const p of this.players.values()) if (p.conn.id !== exceptId) p.conn.emit(event, payload);
  }

  private get(id: string) {
    return this.players.get(id);
  }

  private system(text: string) {
    this.all("system", { text });
  }

  get online() {
    return this.players.size;
  }

  // ---------------------------------------------------------- join/leave

  join(conn: Conn, payload: JoinPayload): { ok: true; init: InitPayload } | { ok: false; reason: string } {
    if (this.players.has(conn.id)) this.leave(conn.id); // re-join on the same socket
    if (this.players.size >= this.maxPlayers) return { ok: false, reason: "The cafe is full right now. Try again soon." };
    const pixels = sanitizePixels(payload?.pixels);
    if (!pixels) return { ok: false, reason: "Bad character data." };
    const clientId = typeof payload.clientId === "string" ? payload.clientId.slice(0, 64) : "";
    if (!clientId) return { ok: false, reason: "Missing client id." };
    const name = escapeHtml(cleanLine(typeof payload.name === "string" ? payload.name : "").slice(0, NAME_MAX)) || "Guest";

    const state: PlayerState = { id: conn.id, name, pixels, x: SPAWN.x, y: SPAWN.y, flip: false, moving: false, drink: null };
    const others = [...this.players.values()].map((p) => p.state);
    this.players.set(conn.id, { conn, clientId, state, seat: null, lastChat: 0, lastEmote: 0, lastProfile: 0, dirty: false });

    this.all("player:joined", state, conn.id);
    this.all("online", { count: this.online });
    this.system(`${name} entered the cafe`);
    return {
      ok: true,
      init: {
        selfId: conn.id,
        players: others,
        seats: this.seats.snapshot(),
        world: this.world.getState(),
        rumours: this.rumours.view(clientId),
        guestbook: this.guestbook.view(clientId),
        online: this.online,
      },
    };
  }

  leave(id: string) {
    const p = this.get(id);
    if (!p) return;
    const hadSeat = this.releaseSeat(id);
    this.players.delete(id);
    this.all("player:left", { id });
    if (hadSeat) this.all("seats", this.seats.snapshot());
    this.all("online", { count: this.online });
    this.system(`${p.state.name} left the cafe`);
  }

  // ------------------------------------------------------------ movement

  move(id: string, d: { x: number; y: number; flip: boolean; moving: boolean }) {
    const p = this.get(id);
    if (!p || p.seat || !finite(d?.x) || !finite(d?.y)) return; // seated players don't walk
    p.state.x = Math.min(WORLD_W, Math.max(0, d.x));
    p.state.y = Math.min(WORLD_H, Math.max(0, d.y));
    p.state.flip = !!d.flip;
    p.state.moving = !!d.moving;
    p.dirty = true;
  }

  /** Called ~15 times a second: one batched, droppable packet with everybody who moved. */
  tick() {
    const moved: MoveUpdate[] = [];
    for (const p of this.players.values()) {
      if (!p.dirty) continue;
      p.dirty = false;
      moved.push({ id: p.state.id, x: p.state.x, y: p.state.y, flip: p.state.flip, moving: p.state.moving });
    }
    if (moved.length === 0) return;
    for (const p of this.players.values()) {
      const others = moved.filter((m) => m.id !== p.state.id);
      if (others.length) p.conn.emitVolatile("moves", others);
    }
  }

  // ---------------------------------------------------- look & feel

  profile(id: string, d: { pixels: unknown }) {
    const p = this.get(id);
    const pixels = sanitizePixels(d?.pixels);
    if (!p || !pixels) return;
    const t = this.now();
    if (t - p.lastProfile < 200) return;
    p.lastProfile = t;
    p.state.pixels = pixels;
    this.all("player:profile", { id, pixels }, id);
  }

  drink(id: string, d: { kind: unknown }) {
    const p = this.get(id);
    if (!p) return;
    const kind = d?.kind === null ? null : isDrink(d?.kind) ? d.kind : undefined;
    if (kind === undefined) return;
    p.state.drink = kind;
    this.all("player:drink", { id, kind }, id);
  }

  emote(id: string, d: { n: unknown }) {
    const p = this.get(id);
    if (!p || !Number.isInteger(d?.n) || (d.n as number) < 0 || (d.n as number) > 3) return;
    const t = this.now();
    if (t - p.lastEmote < 400) return;
    p.lastEmote = t;
    this.all("emote", { id, n: d.n }, id);
  }

  // -------------------------------------------------------------- seats

  private isGameSeat(seatId: string) {
    return seatId.startsWith(GAME_SEAT_PREFIX) && !(seatId in NPC_SEATS);
  }

  sit(id: string, d: { seatId: unknown }): Result {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    const seat = typeof d?.seatId === "string" ? this.seatMap.get(d.seatId) : undefined;
    if (!seat) return { ok: false, reason: "No such seat." };
    if (Math.hypot(p.state.x - seat.exit.x, p.state.y - seat.exit.y) > SIT_REACH && p.seat !== seat.id) {
      return { ok: false, reason: "That seat is too far away." };
    }
    const who = occupantOf(id);
    const before = p.seat;
    if (!this.seats.sit(who, seat.id)) return { ok: false, reason: "Someone just took that seat." };
    if (before && before !== seat.id && this.isGameSeat(before) && !this.isGameSeat(seat.id)) this.leaveTable(who);
    p.seat = seat.id;
    p.state.x = seat.x;
    p.state.y = seat.y;
    p.state.moving = false;
    p.dirty = true;
    this.all("seats", this.seats.snapshot());
    if (this.isGameSeat(seat.id)) this.joinTable(who);
    return { ok: true };
  }

  stand(id: string) {
    const p = this.get(id);
    if (!p) return;
    const seatId = p.seat;
    if (!this.releaseSeat(id)) return;
    const seat = seatId ? this.seatMap.get(seatId) : undefined;
    if (seat) { p.state.x = seat.exit.x; p.state.y = seat.exit.y; p.dirty = true; }
    this.all("seats", this.seats.snapshot());
  }

  /** Frees the player's seat (and their place at the game table). True if they had one. */
  private releaseSeat(id: string): boolean {
    const p = this.get(id);
    const who = occupantOf(id);
    const seatId = this.seats.stand(who);
    if (p) p.seat = null;
    if (seatId === undefined) return false;
    if (this.isGameSeat(seatId)) this.leaveTable(who);
    return true;
  }

  // --------------------------------------------------------- table game

  /** First free side, otherwise take over from the NPC. */
  private joinTable(who: string) {
    const t = this.world.getState().table;
    const sides: Side[] = ["X", "O"];
    const side = sides.find((s) => !t.players[s]) ?? sides.find((s) => t.players[s]?.startsWith("npc:"));
    if (side) this.world.dispatch({ type: "ttt", action: { type: "join", side, by: who } });
  }

  /** Leave the table; if that leaves a seat empty, Theo sits down to keep the game going. */
  private leaveTable(who: string) {
    this.world.dispatch({ type: "ttt", action: { type: "leave", by: who } });
    const t = this.world.getState().table;
    const empty: Side | undefined = !t.players.X && !t.players.O ? "O" : !t.players.X ? "X" : !t.players.O ? "O" : undefined;
    if (empty) this.world.dispatch({ type: "ttt", action: { type: "join", side: empty, by: GAME_NPC } });
  }

  /** Theo thinks for a moment, then plays, whenever it is his turn. */
  private thinkNpc() {
    const t = this.world.getState().table;
    if (t.winner || !t.players.X || !t.players.O || this.aiPending) return;
    const who = t.players[t.turn];
    if (!who || !who.startsWith("npc:")) return;
    this.aiPending = true;
    this.schedule(() => {
      this.aiPending = false;
      const cur = this.world.getState().table;
      if (cur.winner || cur.players[cur.turn] !== who) return;
      const idx = chooseMove(cur.board, cur.turn);
      if (idx >= 0) this.world.dispatch({ type: "ttt", action: { type: "move", idx, by: who } });
    }, 750 + Math.random() * 650);
  }

  /** Shared-state actions from a player: jukebox mood, window weather, table moves. */
  worldAction(id: string, raw: { action: WorldAction }): Result {
    const p = this.get(id);
    const a = raw?.action as WorldAction | undefined;
    if (!p || !a || typeof a !== "object") return { ok: false, reason: "Bad action." };
    const before = this.world.getState();
    let ok = false;
    if (a.type === "setMood") {
      ok = this.world.dispatch({ type: "setMood", mood: a.mood, by: id });
      const now = this.world.getState();
      if (ok && now.mood !== before.mood) {
        this.system(`${p.state.name} switched the jukebox to ${MOODS.find((m) => m.id === now.mood)?.name}`);
      }
    } else if (a.type === "setWeather") {
      ok = this.world.dispatch({ type: "setWeather", weather: a.weather, by: id });
      const now = this.world.getState();
      if (ok && now.weather !== before.weather) {
        this.system(`${p.state.name} changed the window to ${WEATHERS.find((w) => w.id === now.weather)?.name}`);
      }
    } else if (a.type === "ttt" && a.action && (a.action.type === "move" || a.action.type === "reset")) {
      // joining and leaving the table only happens by sitting down / standing up
      ok = this.world.dispatch({ type: "ttt", action: { ...a.action, by: occupantOf(id) } });
    }
    return ok ? { ok: true } : { ok: false, reason: "Not allowed." };
  }

  // --------------------------------------------------------------- chat

  chat(id: string, d: { text: unknown }): Result {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    const t = this.now();
    if (t - p.lastChat < CHAT_COOLDOWN_MS) return { ok: false, reason: "Slow down a little (1 message per second)." };
    const clean = typeof d?.text === "string" ? cleanLine(d.text) : "";
    if (!clean) return { ok: false, reason: "Type something first." };
    if (Array.from(clean).length > CHAT_MAX) return { ok: false, reason: `Keep it under ${CHAT_MAX} characters.` };
    p.lastChat = t;
    const msg: ChatMessage = { id: `m${(this.msgSeq++).toString(36)}`, from: id, name: p.state.name, text: escapeHtml(clean), ts: t };
    for (const q of this.players.values()) {
      if (q === p || Math.hypot(q.state.x - p.state.x, q.state.y - p.state.y) <= CHAT_RADIUS) q.conn.emit("chat", msg);
    }
    return { ok: true };
  }

  // ------------------------------------------------- rumours & guestbook

  private pushRumours() {
    for (const p of this.players.values()) p.conn.emit("rumours", this.rumours.view(p.clientId));
  }

  private pushGuestbook() {
    for (const p of this.players.values()) p.conn.emit("guestbook", this.guestbook.view(p.clientId));
  }

  rumourPost(id: string, d: { text: unknown }): Result {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    const r = this.rumours.post(p.clientId, typeof d?.text === "string" ? d.text : "");
    if (r.ok) this.pushRumours();
    return r;
  }

  rumourLike(id: string, d: { id: unknown }) {
    const p = this.get(id);
    if (p && typeof d?.id === "string" && this.rumours.like(p.clientId, d.id)) this.pushRumours();
  }

  guestbookSign(id: string, d: { text: unknown }): Result {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    const r = this.guestbook.sign(p.clientId, p.state.name, typeof d?.text === "string" ? d.text : "");
    if (r.ok) this.pushGuestbook();
    return r;
  }

  /** Housekeeping, run once a minute: expire old rumours for everyone. */
  sweep() {
    if (this.rumours.prune()) this.pushRumours();
  }
}
