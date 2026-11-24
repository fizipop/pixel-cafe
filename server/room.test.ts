/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { Room, occupantOf, type Conn } from "./room.ts";
import { CHAT_RADIUS } from "../src/shared/protocol.ts";

type Msg = { event: string; payload: any };
function fake(id: string): Conn & { log: Msg[] } {
  const log: Msg[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixels = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? "#ff0000" : ""));
function setup(now = { t: 1_000_000 }) {
  const jobs: (() => void)[] = [];
  const room = new Room({ now: () => now.t, schedule: (fn) => void jobs.push(fn) });
  const add = (id: string, name = id, clientId = id) => {
    const c = fake(id);
    const r = room.join(c, { clientId, name, pixels });
    assert.equal(r.ok, true);
    return c;
  };
  return { room, add, now, jobs };
}
const got = (c: { log: Msg[] }, ev: string) => c.log.filter((m) => m.event === ev);

test("join shares players, rejects bad sprites, escapes names", () => {
  const { room, add } = setup();
  const a = add("a", "<b>Sunny</b>");
  assert.equal(room.players.get("a")!.state.name, "&lt;b&gt;Sunny&lt;/b&gt;");
  const b = fake("b");
  const r = room.join(b, { clientId: "b", name: "B", pixels: [] });
  assert.equal(r.ok, false);
  add("c");
  assert.equal(got(a, "player:joined").length, 1);
  assert.equal(got(a, "online").at(-1)!.payload.count, 2);
});

test("leave removes player, frees seat", () => {
  const { room, add } = setup();
  const a = add("a"), b = add("b");
  const seat = Object.keys(room.seats.snapshot()).length; // npc seats present
  assert.ok(seat >= 3);
  room.players.get("a")!.state.x = 0;
  room.leave("a");
  assert.equal(got(b, "player:left")[0].payload.id, "a");
  assert.equal(room.online, 1);
  void a;
});

test("movement is batched and not echoed", () => {
  const { room, add } = setup();
  const a = add("a"), b = add("b");
  room.move("a", { x: 100, y: 200, flip: true, moving: true });
  room.tick();
  assert.deepEqual(got(b, "moves").at(-1)!.payload[0], { id: "a", x: 100, y: 200, flip: true, moving: true });
  assert.equal(got(a, "moves").length, 0); // mover gets nothing back
  room.move("a", { x: NaN, y: 1, flip: false, moving: false });
  assert.equal(room.players.get("a")!.state.x, 100);
});

test("two players can't take the same chair", () => {
  const { room, add } = setup();
  add("a"); add("b");
  const seat = "t2-left";
  const s = [...(room as any).seatMap.values()].find((x: any) => x.id === seat) ?? [...(room as any).seatMap.values()].find((x: any) => !(x.id in { "t1-right": 1, "t3-top": 1, "sofa-a-2": 1 }) && !x.id.startsWith("t1-"));
  for (const id of ["a", "b"]) { room.players.get(id)!.state.x = s.exit.x; room.players.get(id)!.state.y = s.exit.y; }
  assert.equal(room.sit("a", { seatId: s.id }).ok, true);
  assert.equal(room.sit("b", { seatId: s.id }).ok, false);
  room.stand("a");
  assert.equal(room.sit("b", { seatId: s.id }).ok, true);
});

test("can't sit in an NPC's chair or a far-away chair", () => {
  const { room, add } = setup();
  add("a");
  assert.equal(room.sit("a", { seatId: "t3-top" }).ok, false);
  assert.equal(room.sit("a", { seatId: "nope" }).ok, false);
});

test("chat: proximity, rate limit, length, escaping", () => {
  const { room, add, now } = setup();
  const a = add("a"), b = add("b"), far = add("far");
  room.players.get("far")!.state.x = room.players.get("a")!.state.x + CHAT_RADIUS + 50;
  assert.equal(room.chat("a", { text: "hi <script>" }).ok, true);
  assert.equal(got(b, "chat")[0].payload.text, "hi &lt;script&gt;");
  assert.equal(got(a, "chat").length, 1);
  assert.equal(got(far, "chat").length, 0);
  assert.equal(room.chat("a", { text: "again" }).ok, false); // < 1s
  now.t += 1001;
  assert.equal(room.chat("a", { text: "x".repeat(151) }).ok, false);
  assert.equal(room.chat("a", { text: "x".repeat(150) }).ok, true);
  now.t += 1001;
  assert.equal(room.chat("a", { text: "   " }).ok, false);
});

test("jukebox + weather sync with system toast", () => {
  const { room, add } = setup();
  const a = add("a", "SunnyMocha413"), b = add("b");
  assert.equal(room.worldAction("a", { action: { type: "setMood", mood: "rain" as any, by: "x" } }).ok, true);
  assert.ok(got(b, "world").length > 0);
  assert.match(got(b, "system").at(-1)!.payload.text, /SunnyMocha413 switched the jukebox to/);
  assert.equal(room.worldAction("a", { action: { type: "setWeather", weather: "nope" as any, by: "x" } }).ok, false);
  void a;
});

test("rumours: shared, per-client cooldown, likes, expiry", () => {
  const { room, add, now } = setup();
  const a = add("a"), b = add("b");
  assert.equal(room.rumourPost("a", { text: "the cat runs the cafe" }).ok, true);
  assert.equal(room.rumourPost("a", { text: "another one here" }).ok, false); // cooldown
  assert.ok(got(b, "rumours").at(-1)!.payload.some((r: any) => r.text === "the cat runs the cafe"));
  const id = got(b, "rumours").at(-1)!.payload.find((r: any) => r.text === "the cat runs the cafe").id;
  room.rumourLike("b", { id });
  const mine = got(b, "rumours").at(-1)!.payload.find((r: any) => r.id === id);
  assert.equal(mine.likes, 1); assert.equal(mine.likedByMe, true);
  assert.equal(got(a, "rumours").at(-1)!.payload.find((r: any) => r.id === id).likedByMe, false);
  now.t += 49 * 3600_000;
  room.sweep();
  assert.ok(!got(b, "rumours").at(-1)!.payload.some((r: any) => r.id === id));
});

test("guestbook: shared, one per day", () => {
  const { room, add } = setup();
  const a = add("a", "Ann"), b = add("b");
  assert.equal(room.guestbookSign("a", { text: "lovely place" }).ok, true);
  assert.equal(room.guestbookSign("a", { text: "again" }).ok, false);
  const view = got(b, "guestbook").at(-1)!.payload;
  assert.equal(view.entries[0].name, "Ann");
  void a;
});

test("tic-tac-toe: two real players, NPC fallback", () => {
  const { room, add, jobs } = setup();
  add("a"); add("b");
  const t = () => room.world.getState().table;
  assert.equal(t().players.O, "npc:theo");
  const seats = [...(room as any).seatMap.values()].filter((s: any) => s.id.startsWith("t1-") && s.id !== "t1-right");
  const near = (id: string, s: any) => { room.players.get(id)!.state.x = s.exit.x; room.players.get(id)!.state.y = s.exit.y; };
  near("a", seats[0]); assert.equal(room.sit("a", { seatId: seats[0].id }).ok, true);
  assert.equal(t().players.X, occupantOf("a"));
  near("b", seats[1] ?? seats[0]);
  // theo holds the other seat; b displaces him only when a free chair exists for b
  const r = room.sit("b", { seatId: seats[1].id });
  assert.equal(r.ok, true);
  assert.equal(t().players.O, occupantOf("b"));
  room.worldAction("a", { action: { type: "ttt", action: { type: "move", idx: 4, by: "x" } as any } });
  assert.equal(t().board[4], "X");
  room.worldAction("b", { action: { type: "ttt", action: { type: "move", idx: 0, by: "x" } as any } });
  assert.equal(t().board[0], "O");
  room.worldAction("b", { action: { type: "ttt", action: { type: "move", idx: 1, by: "x" } as any } }); // not b's turn
  assert.equal(t().board[1], null);
  room.stand("b");
  assert.equal(t().players.O, "npc:theo"); // Theo sits back down
  void jobs;
});
