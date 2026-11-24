/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Room, type Conn } from "./room.ts";
import { JsonFileRepository, MemoryRepository, sanitizeData } from "./repository.ts";
import { OutfitBoard, outfitId } from "./outfits.ts";
import { PRIVATE_CAPACITY, PRIVATE_TABLES, buildSeats, privateTableOf } from "../src/game/layout.ts";

type Msg = { event: string; payload: any };
function fake(id: string): Conn & { log: Msg[] } {
  const log: Msg[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixels = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? "#ff0000" : ""));
const got = (c: { log: Msg[] }, ev: string) => c.log.filter((m) => m.event === ev);
const last = (c: { log: Msg[] }, ev: string) => got(c, ev).at(-1)?.payload;

function setup(repo = new MemoryRepository(), now = { t: Date.UTC(2026, 10, 23, 15, 0, 0) }) {
  const room = new Room({ now: () => now.t, schedule: () => {}, repo });
  const add = (id: string, name = id, clientId = id) => {
    const c = fake(id);
    assert.equal(room.join(c, { clientId, name, pixels }).ok, true);
    return c;
  };
  return { room, add, now, repo };
}
const seatsOf = () => buildSeats().filter((s) => privateTableOf(s.id) === "pt0");
const goSit = (room: Room, id: string, seatId: string) => {
  const s = buildSeats().find((x) => x.id === seatId)!;
  const p = room.players.get(id)!;
  p.state.x = s.exit.x; p.state.y = s.exit.y;
  return room.sit(id, { seatId });
};

// ------------------------------------------------------------ private tables

test("private table has 6 seats", () => {
  assert.equal(PRIVATE_TABLES.length, 1);
  assert.equal(seatsOf().length, 6);
  assert.equal(PRIVATE_CAPACITY, 6);
  assert.equal(privateTableOf("t1-left"), null);
});

test("private table chat is isolated to the people seated at it", () => {
  const { room, add, now } = setup();
  const [s1, s2] = seatsOf();
  const a = add("a"), b = add("b"), c = add("c"), d = add("d");
  assert.equal(goSit(room, "a", s1.id).ok, true);
  assert.equal(goSit(room, "b", s2.id).ok, true);
  // c and d stand right next to the table, d is not seated
  for (const id of ["c", "d"]) { room.players.get(id)!.state.x = s1.x; room.players.get(id)!.state.y = s1.y; }
  assert.deepEqual(last(a, "table:info"), { id: "pt0", name: "Private Table", locked: false, seated: 2, capacity: 6 });
  assert.equal(last(c, "table:info"), undefined);

  assert.equal(room.chat("a", { text: "secret plans" }).ok, true);
  assert.equal(got(a, "chat").at(-1)!.payload.scope, "table");
  assert.equal(got(b, "chat").at(-1)!.payload.text, "secret plans");
  assert.equal(got(c, "chat").length, 0);
  assert.equal(got(d, "chat").length, 0);

  // outsiders' nearby chat doesn't reach the table either
  now.t += 1100;
  assert.equal(room.chat("c", { text: "hello out here" }).ok, true);
  assert.equal(got(d, "chat").length, 1);
  assert.equal(got(a, "chat").length, 1);
  assert.equal(got(b, "chat").length, 1);

  // standing up returns you to nearby chat
  room.stand("a");
  assert.equal(last(a, "table:info"), null);
  now.t += 1100;
  assert.equal(room.chat("a", { text: "back in the cafe" }).ok, true);
  assert.equal(got(a, "chat").at(-1)!.payload.scope, undefined);
});

test("locking: new people are kept out, sitters can return, empty tables unlock", () => {
  const { room, add } = setup();
  const seats = seatsOf();
  const a = add("a"), b = add("b"), c = add("c");
  assert.equal(room.tableLock("a", { locked: true }).ok, false); // not seated yet
  goSit(room, "a", seats[0].id);
  goSit(room, "b", seats[1].id);
  assert.equal(room.tableLock("a", { locked: true }).ok, true);
  assert.deepEqual(last(c, "locks"), ["pt0"]);
  assert.equal(last(b, "table:info").locked, true);
  assert.equal(goSit(room, "c", seats[2].id).ok, false); // locked out
  assert.equal(room.seats.occupantOf(seats[2].id), undefined);

  room.stand("b");
  assert.equal(goSit(room, "b", seats[3].id).ok, true); // b was seated when it locked
  room.tableLock("a", { locked: false });
  assert.deepEqual(last(c, "locks"), []);
  assert.equal(goSit(room, "c", seats[2].id).ok, true);
  assert.equal(last(a, "table:info").seated, 3);

  // lock again, everybody leaves: it opens by itself
  room.tableLock("c", { locked: true });
  room.stand("a"); room.stand("b"); room.stand("c");
  assert.equal(room.locked.size, 0);
  const d = add("d");
  assert.equal(goSit(room, "d", seats[0].id).ok, true);
  void d;
});

test("a seventh person can't join and a leaving player frees the table", () => {
  const { room, add } = setup();
  const seats = seatsOf();
  const conns = seats.map((_, i) => add(`p${i}`));
  seats.forEach((s, i) => assert.equal(goSit(room, `p${i}`, s.id).ok, true));
  assert.equal(last(conns[0], "table:info").seated, 6);
  add("late");
  assert.equal(goSit(room, "late", seats[0].id).ok, false);
  room.leave("p5");
  assert.equal(goSit(room, "late", seats[5].id).ok, true);
});

// ------------------------------------------------------------- outfit board

test("outfits: one upvote a day, no self-votes, leaderboard and crown", () => {
  const { room, add, now } = setup();
  const a = add("a", "Ann"), b = add("b", "Bob"), c = add("c", "Cat");
  const view = (id: string) => (room.outfitList(id) as any).view;
  assert.equal(view("a").entries.length, 3);
  const bobId = outfitId("b");
  assert.equal(view("a").entries.find((e: any) => e.id === bobId).inCafe, true);

  assert.equal(room.outfitVote("b", { id: bobId }).ok, false); // self
  assert.equal(room.outfitVote("a", { id: "nope" }).ok, false);
  assert.equal(room.outfitVote("a", { id: bobId }).ok, true);
  assert.equal(room.outfitVote("a", { id: outfitId("c") }).ok, false); // already voted today
  assert.equal(view("a").votedToday, true);
  assert.equal(view("a").entries[0].id, bobId);
  assert.equal(view("a").entries[0].votedByMe, true);
  assert.equal(view("c").entries[0].votedByMe, false);
  assert.deepEqual(last(c, "crowns"), ["b"]); // Bob wears the crown
  assert.deepEqual(last(a, "crowns"), ["b"]);

  // a tie shares the crown
  assert.equal(room.outfitVote("c", { id: outfitId("a") }).ok, true);
  assert.deepEqual(last(b, "crowns"), ["a", "b"]);
  assert.equal(view("b").entries.filter((e: any) => e.crowned).length, 2);

  // the next day everyone can vote again and the crown resets
  now.t += 24 * 3600_000;
  room.sweep();
  assert.deepEqual(last(a, "crowns"), []);
  assert.equal(view("a").votedToday, false);
  assert.equal(room.outfitVote("a", { id: outfitId("c") }).ok, true);
  void b;
});

test("outfit view never leaks client ids; profile changes update the stand", () => {
  const { room, add } = setup();
  add("a", "Ann", "secret-client-id");
  const json = JSON.stringify((room.outfitList("a") as any).view);
  assert.ok(!json.includes("secret-client-id"));
  room.profile("a", { pixels: pixels.map(() => "#00ff00") });
  assert.equal((room.outfitList("a") as any).view.entries[0].pixels[0], "#00ff00");
});

test("outfit board: stale visitors drop off after 48h", () => {
  const now = { t: Date.UTC(2026, 10, 23, 12) };
  const repo = new MemoryRepository();
  const board = new OutfitBoard(repo, () => now.t);
  board.seen("x", "Xavier", pixels);
  assert.equal(board.view("y", new Set()).entries.length, 1);
  now.t += 49 * 3600_000;
  assert.equal(board.prune(), true);
  assert.equal(board.view("y", new Set()).entries.length, 0);
});

// -------------------------------------------------------------- persistence

test("rumours, guestbook and votes survive a server restart (JSON file)", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafe-"));
  const file = join(dir, "data.json");
  try {
    const now = { t: Date.UTC(2026, 10, 23, 15) };
    const one = setup(new JsonFileRepository(file), now);
    one.add("a", "Ann"); one.add("b", "Bob");
    assert.equal(one.room.rumourPost("a", { text: "the cat runs the cafe" }).ok, true);
    assert.equal(one.room.guestbookSign("a", { text: "lovely place" }).ok, true);
    assert.equal(one.room.outfitVote("a", { id: outfitId("b") }).ok, true);
    one.room.repo.flush();
    assert.ok(JSON.parse(readFileSync(file, "utf8")).rumours.length === 1);

    const two = setup(new JsonFileRepository(file), now);
    const c = two.add("a", "Ann");
    const init = got(c, "online"); void init;
    const rumours = two.room.rumours.view("a");
    assert.ok(rumours.some((r) => r.text === "the cat runs the cafe" && r.mine));
    const book = two.room.guestbook.view("a");
    assert.equal(book.entries[0].text, "lovely place");
    assert.equal(book.signedToday, true); // the one-note-a-day limit persists too
    assert.equal(two.room.guestbookSign("a", { text: "again" }).ok, false);
    assert.equal(two.room.outfitVote("a", { id: outfitId("b") }).ok, false); // already voted today
    assert.equal((two.room.outfitList("a") as any).view.votedToday, true);

    // 48h expiry still applies to what was loaded from disk
    now.t += 49 * 3600_000;
    const three = setup(new JsonFileRepository(file), now);
    assert.ok(!three.room.rumours.view("a").some((r) => r.text === "the cat runs the cafe"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a corrupt data file is set aside, not crashed on or overwritten", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafe-"));
  const file = join(dir, "data.json");
  try {
    writeFileSync(file, "{ not json");
    const origError = console.error;
    console.error = () => {};
    const repo = new JsonFileRepository(file);
    console.error = origError;
    assert.equal(repo.listRumours().length, 0);
    assert.ok(readdirSync(dir).some((f) => f.startsWith("data.json.corrupt-")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sanitizeData drops malformed records", () => {
  const d = sanitizeData({
    rumours: [{ id: "r1", text: "ok", createdAt: 5, author: "a" }, { id: 1 }, null],
    votes: [{ day: "2026-11-23", voter: "a", target: "b" }, { day: 5 }],
    outfits: { a: { id: "oa", clientId: "a", name: "A", pixels: ["#fff"], lastSeen: 1 } },
    guestbookDays: { a: "2026-11-23", b: 7 },
  });
  assert.equal(d.rumours.length, 1);
  assert.equal(d.votes.length, 1);
  assert.equal(Object.keys(d.outfits).length, 0); // wrong sprite size
  assert.deepEqual(d.guestbookDays, { a: "2026-11-23" });
  assert.equal(sanitizeData("garbage").rumours.length, 0);
});
