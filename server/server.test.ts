/* eslint-disable @typescript-eslint/no-explicit-any */
// End-to-end over real sockets: two clients talking to a real Socket.IO server.
import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { io as connect, type Socket } from "socket.io-client";
import { createCafeServer } from "./app.ts";

const pixels = Array.from({ length: 1024 }, (_, i) => (i % 5 === 0 ? "#336699" : ""));

function waitFor<T>(sock: Socket, event: string, pred: (p: T) => boolean = () => true, ms = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for ${event}`)); }, ms);
    const h = (p: T) => { if (pred(p)) { clearTimeout(t); sock.off(event, h); resolve(p); } };
    sock.on(event, h);
  });
}

test("two real clients: presence, movement, profile, chat, jukebox, disconnect", async () => {
  const srv = createCafeServer();
  await new Promise<void>((r) => srv.http.listen(0, r));
  const url = `http://localhost:${(srv.http.address() as AddressInfo).port}`;
  const mk = () => connect(url, { transports: ["websocket"], forceNew: true });
  const a = mk(), b = mk();
  try {
    const joinA = await a.timeout(2000).emitWithAck("join", { clientId: "ca", name: "Alice", pixels });
    assert.equal(joinA.ok, true);
    const joined = waitFor<any>(a, "player:joined");
    const joinB = await b.timeout(2000).emitWithAck("join", { clientId: "cb", name: "Bob", pixels });
    assert.equal(joinB.ok, true);
    assert.equal(joinB.init.players.length, 1);
    assert.equal((await joined).name, "Bob");

    const moved = waitFor<any[]>(b, "moves", (m) => m.some((u) => u.id === a.id));
    a.emit("move", { x: 300, y: 400, flip: false, moving: true });
    assert.equal((await moved)[0].x, 300);

    const prof = waitFor<any>(b, "player:profile");
    a.emit("profile", { pixels: pixels.map(() => "#ff00ff") });
    assert.equal((await prof).pixels[0], "#ff00ff");

    // far away: Bob must NOT hear Alice
    let heard = false;
    b.once("chat", () => { heard = true; });
    assert.equal((await a.timeout(2000).emitWithAck("chat", { text: "out of range" })).ok, true);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(heard, false);
    await new Promise((r) => setTimeout(r, 900)); // chat cooldown
    a.emit("move", { x: 520, y: 700, flip: false, moving: false });
    await new Promise((r) => setTimeout(r, 100));

    const chat = waitFor<any>(b, "chat");
    assert.equal((await a.timeout(2000).emitWithAck("chat", { text: "<hi>" })).ok, true);
    assert.equal((await chat).text, "&lt;hi&gt;");
    assert.equal((await a.timeout(2000).emitWithAck("chat", { text: "again" })).ok, false);

    const toast = waitFor<any>(b, "system", (s) => /Alice switched the jukebox/.test(s.text));
    const world = waitFor<any>(b, "world", (w) => w.mood === "bossa");
    await a.timeout(2000).emitWithAck("world:action", { action: { type: "setMood", mood: "bossa" } });
    await toast;
    assert.equal((await world).mood, "bossa");

    const aId = a.id;
    const left = waitFor<any>(b, "player:left");
    a.disconnect();
    assert.equal((await left).id, aId);
    assert.equal(srv.room.online, 1);

    // garbage must not crash the server
    (b as Socket).emit("move", "nonsense");
    (b as Socket).emit("sit", null, () => {});
    const ok = await b.timeout(2000).emitWithAck("chat", { text: "still alive" });
    assert.equal(ok.ok, true);
  } finally {
    a.close(); b.close();
    await srv.close();
  }
});
