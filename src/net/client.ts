// Browser side of the Socket.IO connection. One NetClient per visit to /play.
//
//   const net = await NetClient.connect({ name, pixels });   // null if the server isn't running
//   net.on("chat", (m) => ...)                                // typed server events
//   net.sendMove(...) / net.chat("hi") / net.sit("t2-left")   // typed client events
import { io, type Socket } from "socket.io-client";
import type { DrinkKind } from "@/lib/drinks";
import { unescapeHtml } from "@/shared/text";
import type { WorldAction, WorldState } from "@/game/worldState";
import {
  playerOccupant,
  type GuestbookView, type InitPayload, type Result, type RumourView, type ServerToClient,
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
  closed = false;
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
    for (const p of init.players) this.names.set(p.id, unescapeHtml(p.name));

    socket.on("player:joined", (p: { id: string; name: string }) => this.names.set(p.id, unescapeHtml(p.name)));
    socket.on("online", (p: { count: number }) => { this.online = p.count; this.emit(); });
    socket.on("rumours", (p: RumourView[]) => { this.rumours = p; this.emit(); });
    socket.on("guestbook", (p: GuestbookView) => { this.guestbook = p; this.emit(); });
    socket.on("disconnect", () => {
      this.closed = true;
      this.emit();
      this.closeSubs.forEach((f) => f());
    });
  }

  /** Connect and join. Resolves null (never throws) if the server can't be reached in time. */
  static connect(opts: { name: string; pixels: string[]; timeoutMs?: number; url?: string }): Promise<NetClient | null> {
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
          { clientId: clientId(), name: opts.name, pixels: opts.pixels },
          (err: Error | null, res?: { ok: true; init: InitPayload } | { ok: false; reason: string }) => {
            if (err || !res || !res.ok) return finish(null);
            finish(new NetClient(socket, res.init));
          },
        );
      });
    });
  }

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
  chat(text: string) { return this.ask("chat", { text }); }
  rumourPost(text: string) { return this.ask("rumour:post", { text }); }
  guestbookSign(text: string) { return this.ask("guestbook:sign", { text }); }

  close() {
    this.closed = true;
    this.subs.clear();
    this.closeSubs.clear();
    this.socket.close();
  }
}

export type { WorldState };
