// The cafe room: ALL authoritative state and rules, with no sockets in sight.
// `index.ts` plugs Socket.IO into it; tests plug in fake connections.
//
// Players are addressed by socket id. In seat/table state they appear as the occupant id
// "player:<socket id>" (NPCs are "npc:<name>"), the same ids the client uses.
import { SeatState, type SeatSnapshot } from "../src/game/seats.ts";
import { arcadeSeatInfo } from "../src/game/arcadeLayout.ts";
import { isFireSeat } from "../src/game/rooftopLayout.ts";
import { ALL_NPC_SEATS } from "../src/game/crowd.ts";
import { GAME_NPC, GAME_SEAT_PREFIX, NPC_SEATS, PRIVATE_CAPACITY, PRIVATE_TABLES, buildSeats, privateTableOf } from "../src/game/layout.ts";
import { WorldStore, newWorld, type WorldAction } from "../src/game/worldState.ts";
import { chooseMove, type Side } from "../src/game/tictactoe.ts";
import { MOODS, WEATHERS } from "../src/lib/moods.ts";
import { DRINKS, type DrinkKind } from "../src/lib/drinks.ts";
import { SPAWN } from "../src/game/constants.ts";
import { cleanLine, escapeHtml } from "../src/shared/text.ts";
import {
  CHAT_COOLDOWN_MS, CHAT_MAX, CHAT_RADIUS, NAME_MAX, SIT_REACH, playerOccupant,
  type ChatMessage, type InitPayload, type JoinPayload, type MoveUpdate, type OutfitView, type PlayerState, type Result, type TableInfo,
} from "../src/shared/protocol.ts";
import { STAIRS, STAIRS_REACH, clampToFloor, floorOfSeat, isFloor, type Floor } from "../src/shared/floors.ts";
import type { ArcadeEvent, RooftopEvent } from "../src/shared/protocol.ts";
import { Arcade } from "./arcade.ts";
import { Rooftop } from "./rooftop.ts";
import { Guestbook, RumourBoard } from "./boards.ts";
import { OutfitBoard } from "./outfits.ts";
import { MemoryRepository, type Repository } from "./repository.ts";

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
  tableKey: string; // last private-table info sent to this player (to avoid repeats)
  floor: Floor;
};

export type RoomOptions = {
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => void; // for the NPC's thinking delay
  maxPlayers?: number;
  repo?: Repository; // where rumours, guestbook, outfit votes, wallets and arcade scores are stored (default: in memory)
  rng?: () => number; // randomness for the arcade games (tests pass a seeded one)
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
  readonly outfits: OutfitBoard;
  readonly repo: Repository;
  readonly arcade: Arcade;
  readonly rooftop: Rooftop;
  /** Locked private tables -> socket ids allowed to (re)take a seat (those seated when it was locked). */
  readonly locked = new Map<string, Set<string>>();

  private now: () => number;
  private schedule: (fn: () => void, ms: number) => void;
  private maxPlayers: number;
  private seatMap = new Map(buildSeats().map((s) => [s.id, s]));
  private msgSeq = 0;
  private aiPending = false;
  private crownKey = "";

  constructor(opts: RoomOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
    this.maxPlayers = opts.maxPlayers ?? MAX_PLAYERS;
    this.repo = opts.repo ?? new MemoryRepository();
    this.rumours = new RumourBoard(this.repo, this.now);
    this.guestbook = new Guestbook(this.repo, this.now);
    this.outfits = new OutfitBoard(this.repo, this.now);
    this.arcade = new Arcade(this.repo, {
      now: () => this.now(),
      rng: opts.rng ?? Math.random,
      emitTo: (id, event, payload) => this.players.get(id)?.conn.emit(event, payload),
      socketsOf: (clientId) => [...this.players.values()].filter((q) => q.clientId === clientId).map((q) => q.conn.id),
      who: (id) => { const q = this.players.get(id); return q ? { sockId: id, clientId: q.clientId, name: q.state.name } : undefined; },
      floorOf: (id) => this.players.get(id)?.floor,
    });
    this.rooftop = new Rooftop(this.repo, {
      now: () => this.now(),
      rng: opts.rng ?? Math.random,
      emitTo: (id, event, payload) => this.players.get(id)?.conn.emit(event, payload),
      who: (id) => this.roofWho(id),
      onRooftop: () => [...this.players.keys()].filter((id) => this.players.get(id)?.floor === 3).map((id) => this.roofWho(id)!),
      announce: (text) => this.floorAll(3, "system", { text }),
      wallets: this.arcade.wallets,
      pushWallet: (clientId) => this.arcade.pushWallet(clientId),
    });
    for (const [seatId, who] of Object.entries(ALL_NPC_SEATS)) this.seats.sit(who, seatId); // NPCs' chairs are taken (cafe, crew, arcade crowd)
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

  /** Send to everyone on one floor (players only see and hear people on their own floor). */
  private floorAll(floor: Floor, event: string, payload?: unknown, exceptId?: string) {
    for (const p of this.players.values()) if (p.floor === floor && p.conn.id !== exceptId) p.conn.emit(event, payload);
  }

  /** Seat occupancy of one floor (seat ids are unique across floors, so we just filter). */
  private seatsFor(floor: Floor): SeatSnapshot {
    return Object.fromEntries(Object.entries(this.seats.snapshot()).filter(([seatId]) => floorOfSeat(seatId) === floor));
  }

  private pushSeats(floor: Floor) {
    this.floorAll(floor, "seats", this.seatsFor(floor));
  }

  private get(id: string) {
    return this.players.get(id);
  }

  private roofWho(id: string) {
    const q = this.players.get(id);
    return q ? { sockId: id, clientId: q.clientId, name: q.state.name, pixels: q.state.pixels, x: q.state.x, y: q.state.y, floor: q.floor, seat: q.seat } : undefined;
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

    const state: PlayerState = { id: conn.id, name, pixels, x: SPAWN.x, y: SPAWN.y, flip: false, moving: false, drink: null, floor: 1 };
    const others = [...this.players.values()].filter((p) => p.floor === 1).map((p) => p.state); // everyone starts on Floor 1
    this.players.set(conn.id, { conn, clientId, state, seat: null, lastChat: 0, lastEmote: 0, lastProfile: 0, dirty: false, tableKey: "", floor: 1 });
    this.arcade.wallets.ensure(clientId, name, typeof payload.beans === "number" ? payload.beans : 0);
    const topup = this.arcade.wallets.topup(clientId);
    this.outfits.seen(clientId, name, pixels);

    this.floorAll(1, "player:joined", state, conn.id);
    this.all("online", { count: this.online });
    this.system(`${name} entered the cafe`);
    this.pushCrowns();
    return {
      ok: true,
      init: {
        selfId: conn.id,
        players: others,
        seats: this.seatsFor(1),
        world: this.world.getState(),
        rumours: this.rumours.view(clientId),
        guestbook: this.guestbook.view(clientId),
        online: this.online,
        locks: [...this.locked.keys()],
        table: null,
        crowns: this.crownedSockets(),
        floor: 1,
        beans: this.arcade.wallets.balance(clientId),
        ...(topup ? { topup } : {}),
      },
    };
  }

  leave(id: string) {
    const p = this.get(id);
    if (!p) return;
    const hadSeat = this.releaseSeat(id);
    this.arcade.leftFloor(id);
    this.rooftop.leftFloor(id);
    this.players.delete(id);
    this.floorAll(p.floor, "player:left", { id });
    if (hadSeat) this.pushSeats(p.floor);
    this.pushTables();
    this.pushCrowns();
    this.all("online", { count: this.online });
    this.system(`${p.state.name} left the cafe`);
  }

  // ------------------------------------------------------------ movement

  move(id: string, d: { x: number; y: number; flip: boolean; moving: boolean }) {
    const p = this.get(id);
    if (!p || p.seat || !finite(d?.x) || !finite(d?.y)) return; // seated players don't walk
    const at = clampToFloor(p.floor, d.x, d.y);
    p.state.x = at.x;
    p.state.y = at.y;
    p.state.flip = !!d.flip;
    p.state.moving = !!d.moving;
    p.dirty = true;
  }

  /** Called ~30 times a second: the real-time fights (Pixel Fighter II). */
  fastTick() {
    this.arcade.tickFast(this.now());
  }

  /** Called ~15 times a second: one batched, droppable packet with everybody who moved. */
  tick() {
    const moved: MoveUpdate[] = [];
    for (const p of this.players.values()) {
      if (!p.dirty) continue;
      p.dirty = false;
      moved.push({ id: p.state.id, x: p.state.x, y: p.state.y, flip: p.state.flip, moving: p.state.moving });
    }
    this.arcade.tick(this.now());
    if (moved.length === 0) return;
    for (const p of this.players.values()) {
      // you only see movement on your own floor
      const others = moved.filter((m) => m.id !== p.state.id && this.players.get(m.id)?.floor === p.floor);
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
    this.outfits.seen(p.clientId, p.state.name, pixels);
    this.floorAll(p.floor, "player:profile", { id, pixels }, id);
  }

  drink(id: string, d: { kind: unknown }) {
    const p = this.get(id);
    if (!p) return;
    const kind = d?.kind === null ? null : isDrink(d?.kind) ? d.kind : undefined;
    if (kind === undefined) return;
    p.state.drink = kind;
    this.floorAll(p.floor, "player:drink", { id, kind }, id);
  }

  emote(id: string, d: { n: unknown }) {
    const p = this.get(id);
    if (!p || !Number.isInteger(d?.n) || (d.n as number) < 0 || (d.n as number) > 3) return;
    const t = this.now();
    if (t - p.lastEmote < 400) return;
    p.lastEmote = t;
    this.floorAll(p.floor, "emote", { id, n: d.n }, id);
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
    if (floorOfSeat(seat.id) !== p.floor) return { ok: false, reason: "That seat is on another floor." };
    if (Math.hypot(p.state.x - seat.exit.x, p.state.y - seat.exit.y) > SIT_REACH && p.seat !== seat.id) {
      return { ok: false, reason: "That seat is too far away." };
    }
    const who = occupantOf(id);
    const before = p.seat;
    const tid = privateTableOf(seat.id);
    if (tid && privateTableOf(before) !== tid) {
      const allowed = this.locked.get(tid);
      if (allowed && !allowed.has(id)) return { ok: false, reason: "That table is locked by the people sitting there." };
    }
    if (!this.seats.sit(who, seat.id)) return { ok: false, reason: "Someone just took that seat." };
    if (before && before !== seat.id && this.isGameSeat(before) && !this.isGameSeat(seat.id)) this.leaveTable(who);
    if (before && before !== seat.id && arcadeSeatInfo(before)) this.arcade.stoodUp(id, before);
    if (before && before !== seat.id && isFireSeat(before)) this.rooftop.stoodUp(id);
    p.seat = seat.id;
    p.state.x = seat.x;
    p.state.y = seat.y;
    p.state.moving = false;
    p.dirty = true;
    this.pushSeats(p.floor);
    if (this.isGameSeat(seat.id)) this.joinTable(who);
    if (arcadeSeatInfo(seat.id)) this.arcade.seated(id, seat.id);
    this.pushTables();
    return { ok: true };
  }

  stand(id: string) {
    const p = this.get(id);
    if (!p) return;
    const seatId = p.seat;
    if (!this.releaseSeat(id)) return;
    const seat = seatId ? this.seatMap.get(seatId) : undefined;
    if (seat) { p.state.x = seat.exit.x; p.state.y = seat.exit.y; p.dirty = true; }
    this.pushSeats(p.floor);
    this.pushTables();
  }

  // ------------------------------------------------------ private tables

  private seatedAt(tableId: string): Player[] {
    return [...this.players.values()].filter((q) => privateTableOf(q.seat) === tableId);
  }

  private tableInfo(tableId: string): TableInfo {
    const def = PRIVATE_TABLES.find((t) => t.id === tableId);
    return { id: tableId, name: def?.name ?? "Private Table", locked: this.locked.has(tableId), seated: this.seatedAt(tableId).length, capacity: PRIVATE_CAPACITY };
  }

  private lastLocks = "";

  /** After any seat change: unlock empty tables, tell everyone which tables are locked, tell each player about their own table. */
  private pushTables() {
    for (const tid of [...this.locked.keys()]) if (this.seatedAt(tid).length === 0) this.locked.delete(tid);
    const locks = [...this.locked.keys()].sort();
    const lk = locks.join(",");
    if (lk !== this.lastLocks) { this.lastLocks = lk; this.all("locks", locks); }
    for (const q of this.players.values()) {
      const tid = privateTableOf(q.seat);
      const info = tid ? this.tableInfo(tid) : null;
      const key = info ? JSON.stringify(info) : "";
      if (key === q.tableKey) continue;
      q.tableKey = key;
      q.conn.emit("table:info", info);
    }
  }

  /** Open or lock the private table you are sitting at. Locking keeps everyone not already seated out. */
  tableLock(id: string, d: { locked: unknown }): Result {
    const p = this.get(id);
    const tid = privateTableOf(p?.seat);
    if (!p || !tid) return { ok: false, reason: "Sit at a private table first." };
    if (typeof d?.locked !== "boolean") return { ok: false, reason: "Bad request." };
    if (d.locked) this.locked.set(tid, new Set(this.seatedAt(tid).map((q) => q.conn.id)));
    else this.locked.delete(tid);
    this.pushTables();
    return { ok: true };
  }

  /** Frees the player's seat (and their place at the game table). True if they had one. */
  private releaseSeat(id: string): boolean {
    const p = this.get(id);
    const who = occupantOf(id);
    const seatId = this.seats.stand(who);
    if (p) p.seat = null;
    if (seatId === undefined) return false;
    if (this.isGameSeat(seatId)) this.leaveTable(who);
    else if (arcadeSeatInfo(seatId)) this.arcade.stoodUp(id, seatId);
    else if (isFireSeat(seatId)) this.rooftop.stoodUp(id);
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
    const tid = privateTableOf(p.seat);
    if (tid) {
      // a private table is its own room: only the people seated there hear it
      msg.scope = "table";
      for (const q of this.seatedAt(tid)) q.conn.emit("chat", msg);
    } else {
      for (const q of this.players.values()) {
        if (q.floor !== p.floor) continue; // floors are separate rooms
        if (privateTableOf(q.seat)) continue; // people at a private table only hear their table
        if (q === p || Math.hypot(q.state.x - p.state.x, q.state.y - p.state.y) <= CHAT_RADIUS) q.conn.emit("chat", msg);
      }
    }
    return { ok: true };
  }

  // ------------------------------------------------------------- floors

  /** Take the elevator to any floor (you must be standing at it, not seated). Everything on the other floors is scoped away. */
  goFloor(id: string, d: { floor: unknown }): Result {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    const to = d?.floor;
    if (!isFloor(to)) return { ok: false, reason: "No such floor." };
    if (to === p.floor) return { ok: false, reason: "You are already on that floor." };
    if (p.seat) return { ok: false, reason: "Stand up first." };
    const from = STAIRS[p.floor];
    if (Math.hypot(p.state.x - from.spot.x, p.state.y - from.spot.y) > STAIRS_REACH) return { ok: false, reason: "Walk up to the elevator first." };

    this.floorAll(p.floor, "player:left", { id }, id);
    this.arcade.leftFloor(id);
    this.rooftop.leftFloor(id);
    p.floor = to;
    p.state.floor = to;
    p.state.x = STAIRS[to].arrive.x;
    p.state.y = STAIRS[to].arrive.y;
    p.state.moving = false;
    p.dirty = false;
    const others = [...this.players.values()].filter((q) => q.floor === to && q.conn.id !== id);
    this.floorAll(to, "player:joined", p.state, id);
    p.conn.emit("floor:state", { floor: to, x: p.state.x, y: p.state.y, players: others.map((q) => q.state), seats: this.seatsFor(to) });
    return { ok: true };
  }

  // ------------------------------------------------------- Cafe Beans & arcade

  /** Beans from a drink you made or a drink you gifted (capped and rate limited, see wallet.ts). */
  earn(id: string, d: { amount: unknown }) {
    const p = this.get(id);
    if (p && this.arcade.wallets.earn(p.clientId, d?.amount) > 0) this.arcade.pushWallet(p.clientId);
  }

  /** Every Floor 2 mini-game request comes through here (see server/arcade.ts). */
  arcadeEvent(id: string, event: ArcadeEvent, d: unknown): unknown {
    return this.arcade.handle(id, event, d, this.get(id)?.seat ?? null);
  }

  /** Every Floor 3 request (roasting, star wishes, Polaroids) comes through here (see server/rooftop.ts). */
  rooftopEvent(id: string, event: RooftopEvent, d: unknown): unknown {
    return this.rooftop.handle(id, event, d);
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

  // ------------------------------------------------------------ outfits

  private crownedSockets(): string[] {
    const crown = this.outfits.crowned();
    return [...this.players.values()].filter((q) => crown.has(q.clientId)).map((q) => q.conn.id).sort();
  }

  /** Tell everyone who wears the crown, if that changed. */
  private pushCrowns() {
    const list = this.crownedSockets();
    const key = list.join(",");
    if (key === this.crownKey) return;
    this.crownKey = key;
    this.all("crowns", list);
  }

  outfitList(id: string): { ok: true; view: OutfitView } | { ok: false; reason: string } {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    const online = new Set([...this.players.values()].map((q) => q.clientId));
    return { ok: true, view: this.outfits.view(p.clientId, online) };
  }

  outfitVote(id: string, d: { id: unknown }): Result {
    const p = this.get(id);
    if (!p) return { ok: false, reason: "Not in the cafe." };
    if (typeof d?.id !== "string") return { ok: false, reason: "Bad request." };
    const r = this.outfits.vote(p.clientId, d.id);
    if (r.ok) this.pushCrowns();
    return r;
  }

  /** Housekeeping, run once a minute: expire old rumours and stale outfits, roll the daily crown over at midnight. */
  sweep() {
    if (this.rumours.prune()) this.pushRumours();
    this.outfits.prune();
    this.pushCrowns();
  }
}
