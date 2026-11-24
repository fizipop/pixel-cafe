// Builds the HTTP + Socket.IO server around a Room. index.ts starts it; tests start it on port 0.
import { createServer, type Server as HttpServer } from "node:http";
import { Server, type Socket } from "socket.io";
import type { ClientToServer, ServerToClient } from "../src/shared/protocol.ts";
import { ARCADE_EVENTS, MOVE_HZ } from "../src/shared/protocol.ts";
import { Room, type Conn, type RoomOptions } from "./room.ts";

export type CafeServer = { room: Room; http: HttpServer; io: Server<ClientToServer, ServerToClient>; close: () => Promise<void> };

export function createCafeServer(opts: { origins?: string[]; room?: RoomOptions } = {}): CafeServer {
  const room = new Room(opts.room);

  const http = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" });
      res.end(JSON.stringify({ ok: true, online: room.online }));
      return;
    }
    res.writeHead(404).end("Pixel Cafe socket server. Open the game at http://localhost:3000/play");
  });

  const io = new Server<ClientToServer, ServerToClient>(http, {
    cors: { origin: opts.origins && opts.origins.length ? opts.origins : true },
    maxHttpBufferSize: 64 * 1024, // a full 32x32 sprite is ~10 KB
  });

  const asConn = (socket: Socket<ClientToServer, ServerToClient>): Conn => ({
    id: socket.id,
    emit: (event, payload) => (socket as Socket).emit(event, payload),
    emitVolatile: (event, payload) => (socket as Socket).volatile.emit(event, payload),
  });

  io.on("connection", (socket) => {
    const conn = asConn(socket);
    const id = socket.id;

    // Every handler is wrapped: a bad packet from one client must never crash the server.
    const safe = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
      try { fn(...a); } catch (err) { console.error(`[${id}]`, err); }
    };
    const reply = (ack: unknown, value: unknown) => { if (typeof ack === "function") (ack as (v: unknown) => void)(value); };

    socket.on("join", safe((p, ack) => reply(ack, room.join(conn, p))));
    socket.on("move", safe((d) => room.move(id, d)));
    socket.on("profile", safe((d) => room.profile(id, d)));
    socket.on("drink", safe((d) => room.drink(id, d)));
    socket.on("emote", safe((d) => room.emote(id, d)));
    socket.on("sit", safe((d, ack) => reply(ack, room.sit(id, d))));
    socket.on("stand", safe(() => room.stand(id)));
    socket.on("chat", safe((d, ack) => reply(ack, room.chat(id, d))));
    socket.on("world:action", safe((d, ack) => reply(ack, room.worldAction(id, d))));
    socket.on("rumour:post", safe((d, ack) => reply(ack, room.rumourPost(id, d))));
    socket.on("rumour:like", safe((d) => room.rumourLike(id, d)));
    socket.on("guestbook:sign", safe((d, ack) => reply(ack, room.guestbookSign(id, d))));
    socket.on("table:lock", safe((d, ack) => reply(ack, room.tableLock(id, d))));
    socket.on("outfit:list", safe((ack) => reply(ack, room.outfitList(id))));
    socket.on("outfit:vote", safe((d, ack) => reply(ack, room.outfitVote(id, d))));
    socket.on("floor:go", safe((d, ack) => reply(ack, room.goFloor(id, d))));
    socket.on("beans:earn", safe((d) => room.earn(id, d)));
    // every Floor 2 mini-game request goes to the arcade, which answers through the ack
    for (const ev of ARCADE_EVENTS) {
      (socket as Socket).on(ev, safe((...args: unknown[]) => {
        const ack = args.at(-1);
        const payload = typeof args[0] === "function" ? undefined : args[0];
        reply(ack, room.arcadeEvent(id, ev, payload));
      }));
    }
    socket.on("disconnect", safe(() => room.leave(id)));
  });

  const timers = [
    setInterval(() => room.tick(), Math.round(1000 / MOVE_HZ)),
    setInterval(() => room.sweep(), 60_000),
  ];

  return {
    room, http, io,
    close: () => new Promise<void>((resolve) => {
      timers.forEach(clearInterval);
      room.repo.flush(); // make sure the last votes/posts reach disk
      void io.close(() => resolve());
    }),
  };
}
