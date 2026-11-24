// Browser side of the Socket.IO connection. One NetClient per visit to /play.
//
//   const net = await NetClient.connect({ name, pixels });   // null if the server isn't running
//   net.on("chat", (m) => ...)                                // typed server events
//   net.sendMove(...) / net.chat("hi") / net.sit("t2-left")   // typed client events
import { io, type Socket } from "socket.io-client";
import type { DrinkKind } from "@/lib/drinks";
import { unescapeHtml } from "@/shared/text";
import type { WorldAction, WorldState } from "@/game/worldState";
import type { Floor } from "@/shared/floors";
import {
  playerOccupant,
  type Ack, type ArcadeEvent, type BlackjackView, type CrashView, type FloorState, type GuestbookView, type InitPayload, type OutfitView,
  type Result, type RouletteView, type RumourView, type ServerToClient, type TableInfo, type WalletMsg,
} from "@/shared/protocol";

const CLIENT_ID_KEY = "pixelcafe.clientId";

/** A random id that stays the same on this device (used for per-person limits like "1 guestbook note a day"). */
export function clientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = `c${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return `c${Math.random().toString(36).slice(2)}`;
  }
}

export function socketUrl(): string {
  return process.env.NEXT_PUBLIC_SOCKET_URL || `http://${typeof location === "undefined" ? "localhost" : location.hostname}:3001`;
}

type Listener = () => void;

export class NetClient {
  readonly socket: Socket;
  readonly selfId: string;
  readonly occupant: string; // how we appear in seat/table state
  readonly init: InitPayload;
  online: number;
  rumours: RumourView[];
  guestbook: GuestbookView;
  /** The private table you are sitting at (null when you are not at one). Replaced, never mutated. */
  table: TableInfo | null;
  /** Ids of locked private tables (for the padlock drawn on the table). */
  locks: string[];
  /** Socket ids wearing today's #1 outfit crown. */
  crowns: string[];
  closed = false;
  /** Which floor you are on (replaced by the server's `floor:state`). */
  floor: Floor;
  /** Your Cafe Beans (fictional currency); the server is the source of truth. */
  beans: number;
  /** Set when a daily starter top-up lands; `id` changes every time so the HUD can show it once. */
  topupNote: { id: number; amount: number } | null = null;
  /** Live views of the shared Floor 2 tables; null when you aren't taking part. Replaced, never mutated. */
  crash: CrashView | null = null;
  roulette: RouletteView | null = null;
  bj: BlackjackView | null = null;
  private topupSeq = 0;
  private held: number | null = null;
  /** socket id -> display name, for everyone we've seen (used by the table game UI). */
  private names = new Map<string, string>();

  private subs = new Set<Listener>();
  private closeSubs = new Set<() => void>();

  private constructor(socket: Socket, init: InitPayload) {
    this.socket = socket;
    this.init = init;
    this.selfId = init.selfId;
    this.occupant = playerOccupant(init.selfId);
    this.online = init.online;
    this.rumours = init.rumours;
    this.guestbook = init.guestbook;
    this.table = init.table;
    this.locks = init.locks;
    this.crowns = init.crowns;
    this.floor = init.floor;
    this.beans = init.beans;
    if (init.topup) this.topupNote = { id: ++this.topupSeq, amount: init.topup };
    for (const p of init.players) this.names.set(p.id, unescapeHtml(p.name));

    socket.on("player:joined", (p: { id: string; name: string }) => this.names.set(p.id, unescapeHtml(p.name)));
    socket.on("online", (p: { count: number }) => { this.online = p.count; this.emit(); });
    socket.on("rumours", (p: RumourView[]) => { this.rumours = p; this.emit(); });
    socket.on("guestbook", (p: GuestbookView) => { this.guestbook = p; this.emit(); });
    socket.on("table:info", (p: TableInfo | null) => { this.table = p; this.emit(); });
    socket.on("locks", (p: string[]) => { this.locks = p; this.emit(); });
    socket.on("crowns", (p: string[]) => { this.crowns = p; this.emit(); });
    socket.on("floor:state", (p: FloorState) => {
      this.floor = p.floor;
      for (const q of p.players) this.names.set(q.id, unescapeHtml(q.name));
      if (p.floor !== 2) { this.crash = null; this.roulette = null; this.bj = null; }
      this.emit();
    });
    socket.on("wallet", (p: WalletMsg) => {
      this.beans = p.beans;
      if (p.topup) this.topupNote = { id: ++this.topupSeq, amount: p.topup };
      this.emit();
    });
    socket.on("crash:state", (p: CrashView | null) => { this.crash = p; this.emit(); });
    socket.on("roulette:state", (p: RouletteView | null) => { this.roulette = p; this.emit(); });
    socket.on("bj:state", (p: BlackjackView | null) => { this.bj = p; this.emit(); });
    socket.on("disconnect", () => {
      this.closed = true;
      this.emit();
      this.closeSubs.forEach((f) => f());
    });
  }

  /** Connect and join. Resolves null (never throws) if the server can't be reached in time. */
  static connect(opts: { name: string; pixels: string[]; beans?: number; timeoutMs?: number; url?: string }): Promise<NetClient | null> {
    return new Promise((resolve) => {
      const socket = io(opts.url ?? socketUrl(), {
        transports: ["websocket"],
        reconnection: false,
        timeout: opts.timeoutMs ?? 2500,
      });
      let done = false;
      const finish = (c: NetClient | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (!c) socket.close();
        resolve(c);
      };
      const timer = setTimeout(() => finish(null), (opts.timeoutMs ?? 2500) + 500);
      socket.on("connect_error", () => finish(null));
      socket.on("connect", () => {
        socket.timeout(3000).emit(
          "join",
          { clientId: clientId(), name: opts.name, pixels: opts.pixels, beans: opts.beans },
          (err: Error | null, res?: { ok: true; init: InitPayload } | { ok: false; reason: string }) => {
            if (err || !res || !res.ok) return finish(null);
            finish(new NetClient(socket, res.init));
          },
        );
      });
    });
  }

  /** The balance to SHOW: frozen at a game's pre-result value while a reel/wheel/card animation plays, so the HUD never spoils it. */
  get shownBeans() { return this.held ?? this.beans; }
  hold(value: number) { this.held = value; this.emit(); }
  release() { if (this.held !== null) { this.held = null; this.emit(); } }

  /** Display name for an occupant id ("player:<id>" or "npc:<name>"). */
  nameOf(occupant: string | null): string {
    if (!occupant) return "nobody yet";
    if (occupant === this.occupant) return "you";
    if (occupant.startsWith("npc:")) return occupant.slice(4).replace(/^./, (c) => c.toUpperCase());
    return this.names.get(occupant.slice("player:".length)) ?? "another player";
  }

  // ---- subscriptions (React useSyncExternalStore friendly)
  subscribe = (fn: Listener) => {
    this.subs.add(fn);
    return () => { this.subs.delete(fn); };
  };
  private emit() {
    this.subs.forEach((f) => f());
  }
  onClose(fn: () => void) {
    this.closeSubs.add(fn);
    return () => { this.closeSubs.delete(fn); };
  }

  /** Listen to one typed server event. Returns the unsubscribe function. */
  on<K extends keyof ServerToClient>(event: K, fn: ServerToClient[K]): () => void {
    this.socket.on(event as string, fn as (...a: unknown[]) => void);
    return () => { this.socket.off(event as string, fn as (...a: unknown[]) => void); };
  }

  // ---- fire and forget
  sendMove(x: number, y: number, flip: boolean, moving: boolean) { this.socket.emit("move", { x, y, flip, moving }); }
  sendProfile(pixels: string[]) { this.socket.emit("profile", { pixels }); }
  sendDrink(kind: DrinkKind | null) { this.socket.emit("drink", { kind }); }
  sendEmote(n: number) { this.socket.emit("emote", { n }); }
  stand() { this.socket.emit("stand"); }
  rumourLike(id: string) { this.socket.emit("rumour:like", { id }); }
  /** Returns true when the action was handed to the server; the answer arrives as a `world` event. */
  worldAction(action: WorldAction): boolean {
    if (this.closed) return false;
    this.socket.emit("world:action", { action });
    return true;
  }

  // ---- with an answer
  private ask(event: string, payload: unknown): Promise<Result> {
    return new Promise((resolve) => {
      if (this.closed) return resolve({ ok: false, reason: "Disconnected from the cafe." });
      this.socket.timeout(3000).emit(event, payload, (err: Error | null, res?: Result) => {
        resolve(err || !res ? { ok: false, reason: "The cafe didn't answer. Try again." } : res);
      });
    });
  }
  sit(seatId: string) { return this.ask("sit", { seatId }); }
  goFloor(floor: Floor) { return this.ask("floor:go", { floor }); }
  /** Beans from a drink you made or gave away (the server caps and rate limits these). */
  earn(amount: number) { if (!this.closed) this.socket.emit("beans:earn", { amount }); }
  /** A Floor 2 mini-game request. Resolves with the server's answer (never throws). */
  call<T = object>(event: ArcadeEvent, payload?: unknown): Promise<Ack<T>> {
    return new Promise((resolve) => {
      if (this.closed) return resolve({ ok: false, reason: "Disconnected from the cafe." });
      const done = (err: Error | null, res?: Ack<T>) => resolve(err || !res ? { ok: false, reason: "The arcade didn't answer. Try again." } : res);
      const t = this.socket.timeout(4000);
      if (payload === undefined) t.emit(event, done);
      else t.emit(event, payload, done);
    });
  }
  chat(text: string) { return this.ask("chat", { text }); }
  rumourPost(text: string) { return this.ask("rumour:post", { text }); }
  guestbookSign(text: string) { return this.ask("guestbook:sign", { text }); }
  /** Lock or open the private table you are sitting at. */
  tableLock(locked: boolean) { return this.ask("table:lock", { locked }); }
  outfitVote(id: string) { return this.ask("outfit:vote", { id }); }
  /** Current Fashion Stand: everyone seen in the last 48 hours with today's votes. */
  outfitList(): Promise<{ ok: true; view: OutfitView } | { ok: false; reason: string }> {
    return new Promise((resolve) => {
      if (this.closed) return resolve({ ok: false, reason: "Disconnected from the cafe." });
      this.socket.timeout(3000).emit("outfit:list", (err: Error | null, res?: { ok: true; view: OutfitView } | { ok: false; reason: string }) => {
        resolve(err || !res ? { ok: false, reason: "The cafe didn't answer. Try again." } : res);
      });
    });
  }

  close() {
    this.closed = true;
    this.subs.clear();
    this.closeSubs.clear();
    this.socket.close();
  }
}

export type { WorldState };
