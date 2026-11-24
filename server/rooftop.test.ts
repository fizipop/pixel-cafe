/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Room, type Conn } from "./room.ts";
import { JsonFileRepository, MemoryRepository, sanitizeData } from "./repository.ts";
import { buildSeats } from "../src/game/layout.ts";
import { PHOTO_STAND, TELESCOPE } from "../src/game/rooftopLayout.ts";
import { FLOOR3_X, STAIRS } from "../src/shared/floors.ts";
import {
  POLAROID_COOLDOWN_MS, POLAROID_WALL_CAP, ROAST_PERFECT_BEANS, ROAST_RATE_MAX, ROAST_RATE_MIN, ROAST_REWARD_GAP_MS, ROAST_THRESHOLDS,
  WISH_COOLDOWN_MS, WISH_MAX, WISH_TTL_MS, packPixels, unpackPixels,
} from "../src/shared/rooftop.ts";
import { DRINKS } from "../src/lib/drinks.ts";

type Msg = { event: string; payload: any };
function fake(id: string): Conn & { log: Msg[] } {
  const log: Msg[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixelsFor = (color: string) => Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? color : ""));
const got = (c: { log: Msg[] }, ev: string) => c.log.filter((m) => m.event === ev);
const last = (c: { log: Msg[] }, ev: string) => got(c, ev).at(-1)?.payload;

function setup(repo = new MemoryRepository()) {
  const now = { t: Date.UTC(2026, 10, 24, 21, 0, 0) };
  const room = new Room({ now: () => now.t, schedule: () => {}, repo, rng: () => 0.5 }); // rng 0.5 -> roast rate 1.075
  const add = (id: string, name = id, clientId = id, color = "#ff0000") => {
    const c = fake(id);
    assert.equal(room.join(c, { clientId, name, pixels: pixelsFor(color) }).ok, true);
    return c;
  };
  const p = (id: string) => room.players.get(id)!;
  const place = (id: string, at: { x: number; y: number }) => { p(id).state.x = at.x; p(id).state.y = at.y; };
  /** Ride the elevator from wherever you are to `floor`. */
  const goTo = (id: string, floor: 1 | 2 | 3) => {
    place(id, STAIRS[p(id).floor].spot);
    const r = room.goFloor(id, { floor });
    assert.equal(r.ok, true, JSON.stringify(r));
  };
  const sit = (id: string, seatId: string) => {
    const s = buildSeats().find((x) => x.id === seatId)!;
    place(id, s.exit);
    return room.sit(id, { seatId });
  };
  const call = (id: string, ev: any, d?: any) => room.rooftopEvent(id, ev, d) as any;
  const advance = (ms: number) => { now.t += ms; };
  const beans = (clientId: string) => room.arcade.wallets.balance(clientId);
  return { room, add, p, place, goTo, sit, call, advance, beans, repo, now };
}

// ------------------------------------------------------------------ elevator: three floors

test("elevator: any floor to any floor, you land by that floor's elevator", () => {
  const { room, add, goTo, p } = setup();
  add("a");
  goTo("a", 3);
  assert.equal(p("a").floor, 3);
  assert.equal(p("a").state.floor, 3);
  assert.ok(p("a").state.x >= FLOOR3_X && p("a").state.x === STAIRS[3].arrive.x);
  goTo("a", 2);
  assert.equal(p("a").floor, 2);
  goTo("a", 3);
  goTo("a", 1);
  assert.equal(p("a").floor, 1);
  assert.equal(p("a").state.x, STAIRS[1].arrive.x);
  assert.equal(last(room.players.get("a")!.conn as any, "floor:state").floor, 1);
});

test("elevator: only real floors, only from the elevator, never to the floor you are on, never seated", () => {
  const { room, add, place, sit, goTo } = setup();
  add("a");
  place("a", STAIRS[1].spot);
  for (const bad of [0, 4, -1, 2.5, "3", null, undefined, NaN, {}]) assert.equal(room.goFloor("a", { floor: bad as any }).ok, false, String(bad));
  assert.equal(room.goFloor("a", { floor: 1 }).ok, false, "already on Floor 1");
  place("a", { x: 400, y: 400 });
  assert.equal(room.goFloor("a", { floor: 3 }).ok, false, "too far from the elevator");
  goTo("a", 3);
  place("a", { x: FLOOR3_X + 500, y: 300 });
  assert.equal(room.goFloor("a", { floor: 1 }).ok, false, "walk to the rooftop elevator first");
  assert.equal(sit("a", "f3-fire-1").ok, true);
  place("a", STAIRS[3].spot);
  assert.equal(room.goFloor("a", { floor: 1 }).ok, false, "seated");
});

test("floor 3 scoping: players, movement, chat and seats stay on their own floor", () => {
  const { room, add, goTo, place, sit } = setup();
  const a = add("a"), b = add("b"), c = add("c"), d = add("d");
  goTo("b", 2);
  goTo("a", 3); goTo("c", 3);
  assert.equal(got(b, "player:joined").filter((m) => m.payload.id === "a").length, 0, "Floor 2 never hears about a joining Floor 3");
  assert.deepEqual(last(c, "floor:state").players.map((q: any) => q.id), ["a"]);
  assert.equal(got(a, "player:joined").at(-1)!.payload.id, "c");

  // movement stays on the floor and is clamped to it
  place("c", { x: FLOOR3_X + 400, y: 400 }); place("a", { x: FLOOR3_X + 410, y: 400 });
  room.move("a", { x: FLOOR3_X + 600, y: 300, flip: false, moving: true });
  room.move("a", { x: 3, y: 300, flip: false, moving: true });
  assert.equal(room.players.get("a")!.state.x, FLOOR3_X, "clamped into Floor 3");
  room.move("a", { x: FLOOR3_X + 600, y: 300, flip: false, moving: true });
  room.tick();
  assert.ok(got(c, "moves").some((m) => m.payload.some((u: any) => u.id === "a")));
  for (const other of [b, d]) assert.equal(got(other, "moves").filter((m) => m.payload.some((u: any) => u.id === "a")).length, 0);

  // chat: even standing at the same x, the other floors hear nothing
  place("a", { x: FLOOR3_X + 400, y: 400 });
  place("b", { x: 400, y: 400 });
  room.players.get("d")!.state.x = FLOOR3_X + 400; room.players.get("d")!.state.y = 400; // Floor 1 player at Floor 3 coordinates
  const beforeB = got(b, "chat").length, beforeD = got(d, "chat").length;
  assert.equal(room.chat("a", { text: "stars tonight" }).ok, true);
  assert.equal(got(c, "chat").at(-1)!.payload.text, "stars tonight");
  assert.equal(got(b, "chat").length, beforeB);
  assert.equal(got(d, "chat").length, beforeD);

  // seats: occupancy is shared on Floor 3 only
  assert.equal(sit("a", "f3-fire-2").ok, true);
  assert.equal(last(c, "seats")["f3-fire-2"], "player:a");
  assert.ok(Object.keys(last(c, "seats")).every((k) => k.startsWith("f3-")), "Floor 3 gets only Floor 3 seats");
  assert.ok(!Object.keys(last(d, "seats") ?? {}).some((k) => k.startsWith("f3-")));
  assert.ok(!Object.keys(last(b, "seats") ?? {}).some((k) => k.startsWith("f3-")));
  assert.equal(sit("c", "f3-fire-2").ok, false, "someone is already there");
  assert.equal(sit("d", "f3-fire-3").ok, false, "Floor 1 player can't take a Floor 3 log");
  void a;
});

test("floor 3: your name, sprite, drink and beans come with you", () => {
  const { room, add, goTo, beans, p } = setup();
  const a = add("a", "Sunny", "dev-a", "#00ff00");
  add("b", "Bea");
  room.drink("a", { kind: DRINKS[1].id });
  const before = beans("dev-a");
  goTo("a", 3);
  assert.equal(p("a").state.name, "Sunny");
  assert.equal(p("a").state.drink, DRINKS[1].id);
  assert.equal(p("a").state.pixels[0], "#00ff00");
  assert.equal(beans("dev-a"), before);
  goTo("b", 3);
  const seen = last(a, "player:joined");
  assert.equal(seen.name, "Bea");
  assert.equal(seen.floor, 3);
  goTo("a", 1);
  assert.equal(p("a").state.drink, DRINKS[1].id, "still holding the drink after coming back down");
});

test("floor 3: leaving or disconnecting frees the log and the other floor's view", () => {
  const { room, add, goTo, sit } = setup();
  add("a"); const b = add("b");
  goTo("a", 3); goTo("b", 3);
  sit("a", "f3-fire-4");
  room.leave("a");
  assert.equal(last(b, "seats")["f3-fire-4"], undefined);
  assert.equal(got(b, "player:left").at(-1)!.payload.id, "a");
});

test("rooftop requests are refused anywhere but Floor 3", () => {
  const { add, call, goTo } = setup();
  add("a");
  for (const ev of ["roast:start", "roast:pull", "stars:join", "stars:wish", "polaroid:take", "polaroid:wall"]) assert.equal(call("a", ev, { text: "hi" }).ok, false, ev);
  goTo("a", 2);
  assert.equal(call("a", "polaroid:wall").ok, false);
  assert.equal(call("nobody", "polaroid:wall").ok, false);
  assert.equal(call("a", "bogus:event").ok, false);
});

// ------------------------------------------------------------------ campfire

test("roast: you must be sitting on a campfire log, and the server times the roast", () => {
  const { add, goTo, call, sit, advance, beans, room } = setup();
  const a = add("a", "Alice", "dev-a");
  goTo("a", 3);
  assert.equal(call("a", "roast:start").ok, false, "standing");
  assert.equal(call("a", "roast:pull").ok, false, "nothing on the stick");
  sit("a", "f3-fire-1");
  const start = call("a", "roast:start");
  assert.equal(start.ok, true);
  assert.ok(start.rate >= ROAST_RATE_MIN && start.rate <= ROAST_RATE_MAX);

  const heatAt = (heat: number) => (heat / start.rate) * 1000;
  advance(heatAt(ROAST_THRESHOLDS.golden + 0.5)); // right in the golden window
  const before = beans("dev-a");
  const done = call("a", "roast:pull");
  assert.equal(done.ok, true);
  assert.equal(done.grade, "golden");
  assert.equal(done.perfect, true);
  assert.equal(done.bonus, ROAST_PERFECT_BEANS);
  assert.equal(beans("dev-a"), before + ROAST_PERFECT_BEANS);
  assert.equal(done.beans, before + ROAST_PERFECT_BEANS);
  assert.equal(last(a, "wallet").beans, before + ROAST_PERFECT_BEANS, "the wallet is pushed to the player");
  assert.match(last(a, "system").text, /Alice roasted a perfect golden marshmallow/);
  assert.equal(call("a", "roast:pull").ok, false, "the marshmallow is gone");

  // a second perfect roast inside the reward gap is still perfect, but pays nothing
  assert.equal(call("a", "roast:start").ok, true);
  advance(heatAt(ROAST_THRESHOLDS.golden + 0.5));
  const again = call("a", "roast:pull");
  assert.equal(again.perfect, true);
  assert.equal(again.bonus, 0);
  assert.equal(beans("dev-a"), before + ROAST_PERFECT_BEANS);
  // ...and after the gap it pays again
  advance(ROAST_REWARD_GAP_MS);
  call("a", "roast:start");
  advance(heatAt(ROAST_THRESHOLDS.golden + 0.5));
  assert.equal(call("a", "roast:pull").bonus, ROAST_PERFECT_BEANS);
  void room;
});

test("roast: raw, toasty, brown and burnt marshmallows earn nothing", () => {
  const { add, goTo, call, sit, advance, beans } = setup();
  add("a", "A", "dev-a");
  goTo("a", 3);
  sit("a", "f3-fire-3");
  const cases: [number, string][] = [[0.2, "raw"], [ROAST_THRESHOLDS.toasty + 0.3, "toasty"], [ROAST_THRESHOLDS.brown + 0.3, "brown"], [ROAST_THRESHOLDS.burnt + 0.5, "burnt"], [500, "burnt"]];
  const start = beans("dev-a");
  for (const [heat, grade] of cases) {
    const s = call("a", "roast:start");
    advance(Math.min(60_000, (heat / s.rate) * 1000));
    const r = call("a", "roast:pull");
    assert.equal(r.grade, grade, `heat ${heat}`);
    assert.equal(r.perfect, false);
    assert.equal(r.bonus, 0);
    advance(ROAST_REWARD_GAP_MS);
  }
  assert.equal(beans("dev-a"), start);
});

test("roast: standing up, switching seats or leaving the floor drops the marshmallow", () => {
  const { room, add, goTo, call, sit, advance, p, place } = setup();
  add("a");
  goTo("a", 3);
  sit("a", "f3-fire-1");
  call("a", "roast:start");
  room.stand("a");
  advance(4000);
  assert.equal(call("a", "roast:pull").ok, false, "stood up");
  sit("a", "f3-fire-1");
  call("a", "roast:start");
  place("a", buildSeats().find((s) => s.id === "f3-fire-2")!.exit);
  assert.equal(room.sit("a", { seatId: "f3-fire-2" }).ok, true);
  assert.equal(call("a", "roast:pull").ok, false, "switched logs");
  call("a", "roast:start");
  room.stand("a");
  goTo("a", 1);
  goTo("a", 3);
  assert.equal(call("a", "roast:pull").ok, false, "left the floor");
  void p;
});

// ------------------------------------------------------------------ stargazing

test("stars: join at the telescope, wish anonymously, other stargazers see it live", () => {
  const { room, add, goTo, call, place, advance, repo } = setup();
  const a = add("a", "Alice", "dev-a"), b = add("b", "Bob", "dev-b"), c = add("c", "Cleo", "dev-c");
  goTo("a", 3); goTo("b", 3); goTo("c", 3);
  assert.equal(call("a", "stars:join").ok, false, "not at the telescope yet");
  assert.equal(call("a", "stars:wish", { text: "no telescope" }).ok, false);
  place("a", TELESCOPE.spot); place("b", TELESCOPE.spot);
  const ja = call("a", "stars:join");
  assert.equal(ja.ok, true);
  assert.ok(ja.wishes.length >= 3 && ja.wishes.every((w: any) => !w.mine), "a few sample wishes keep a quiet night company");
  assert.equal(call("b", "stars:join").ok, true);
  assert.equal(room.rooftop.stargazers.size, 2);

  const w = call("a", "stars:wish", { text: "I wish for <b>snow</b> & tea" });
  assert.equal(w.ok, true);
  const mine = w.wishes.find((x: any) => x.mine);
  assert.equal(mine.text, "I wish for &lt;b&gt;snow&lt;/b&gt; &amp; tea", "escaped like every other post");
  const seenByB = last(b, "stars:wishes");
  assert.equal(seenByB.fresh, mine.id);
  assert.equal(seenByB.wishes.find((x: any) => x.id === mine.id).mine, false, "Bob sees it as someone else's");
  assert.equal(last(a, "stars:wishes").wishes.find((x: any) => x.id === mine.id).mine, true);
  assert.equal(got(c, "stars:wishes").length, 0, "Cleo isn't at the telescope");
  for (const msg of [...a.log, ...b.log]) assert.ok(!JSON.stringify(msg.payload ?? "").includes("dev-a"), "the wisher's device id is never sent");
  assert.ok(!Object.keys(mine).some((k) => ["author", "clientId", "name"].includes(k)));
  assert.equal(repo.listWishes().length, 1);
  assert.equal(repo.listWishes()[0].author, "dev-a");

  // rate limit, duplicates, validation
  assert.equal(call("a", "stars:wish", { text: "another one" }).ok, false, "cooldown");
  advance(WISH_COOLDOWN_MS + 1);
  assert.equal(call("b", "stars:wish", { text: "I wish for <b>snow</b> & tea" }).ok, false, "someone already wished that");
  for (const bad of ["", "   ", "x".repeat(WISH_MAX + 1), "visit https://evil.example now", "mail me a@b.co", "call 555 123 4567", "hi @someone", 42, null]) {
    assert.equal(call("b", "stars:wish", { text: bad }).ok, false, String(bad));
  }
  assert.equal(call("b", "stars:wish", { text: "x".repeat(WISH_MAX) }).ok, true, "exactly the limit is fine");
  assert.equal(call("b", "stars:wish").ok, false, "missing payload is a refusal, not a crash");
});

test("stars: closing the telescope or leaving the floor stops the live feed; old wishes fade away", () => {
  const { room, add, goTo, call, place, advance, repo } = setup();
  add("a"); const b = add("b");
  goTo("a", 3); goTo("b", 3);
  place("a", TELESCOPE.spot); place("b", TELESCOPE.spot);
  call("a", "stars:join"); call("b", "stars:join");
  call("b", "stars:leave");
  assert.equal(room.rooftop.stargazers.has("b"), false);
  assert.equal(call("b", "stars:wish", { text: "not looking" }).ok, false, "you have to be looking through it");
  const n = got(b, "stars:wishes").length;
  call("a", "stars:wish", { text: "first star" });
  assert.equal(got(b, "stars:wishes").length, n);
  goTo("a", 1);
  assert.equal(room.rooftop.stargazers.has("a"), false);

  advance(WISH_TTL_MS + 1000);
  goTo("a", 3); place("a", TELESCOPE.spot);
  assert.ok(!call("a", "stars:join").wishes.some((w: any) => w.text === "first star"));
  assert.equal(repo.listWishes().length, 0);
});

// ------------------------------------------------------------------ Polaroids

test("polaroid: a group photo of everyone on the rooftop, pinned to the wall and sent to Floor 3 only", () => {
  const { room, add, goTo, call, place, repo, p } = setup();
  const a = add("a", "Alice", "dev-a", "#ff0000"), b = add("b", "Bob <3", "dev-b", "#00ff00"), c = add("c", "Cleo", "dev-c", "#0000ff"), d = add("d", "Downstairs");
  goTo("a", 3); goTo("b", 3); goTo("c", 3);
  assert.equal(call("a", "polaroid:take").ok, false, "walk up to the stand first");
  place("a", PHOTO_STAND.spot); place("b", { x: PHOTO_STAND.spot.x + 80, y: PHOTO_STAND.spot.y }); place("c", { x: PHOTO_STAND.spot.x + 20, y: PHOTO_STAND.spot.y });
  const r = call("a", "polaroid:take");
  assert.equal(r.ok, true);
  assert.deepEqual(r.photo.people.map((q: any) => q.name), ["Alice", "Cleo", "Bob &lt;3"], "photographer first, then nearest to the stand");
  assert.equal(r.photo.by, "Alice");
  assert.equal(r.photo.ts, room["now"]());
  assert.deepEqual(unpackPixels(r.photo.people[0].sprite), pixelsFor("#ff0000"), "their own custom sprite");
  assert.deepEqual(unpackPixels(r.photo.people[2].sprite), pixelsFor("#00ff00"));
  for (const who of [a, b, c]) assert.equal(last(who, "polaroid:new").id, r.photo.id);
  assert.equal(got(d, "polaroid:new").length, 0, "Floor 1 doesn't see the flash");
  assert.equal(repo.listPolaroids().length, 1);
  assert.equal(repo.listPolaroids()[0].id, r.photo.id);
  assert.ok(!JSON.stringify(repo.listPolaroids()).includes("dev-a"), "no device ids in a saved photo");

  // the wall is readable from anywhere on Floor 3
  const wall = call("c", "polaroid:wall");
  assert.equal(wall.ok, true);
  assert.equal(wall.photos[0].id, r.photo.id);
  void p;
});

test("polaroid: cooldown, nobody from other floors, at most six people, and the wall keeps the newest 24", () => {
  const { room, add, goTo, call, place, advance, repo } = setup();
  for (let i = 0; i < 8; i++) add(`p${i}`, `P${i}`);
  add("down", "Down");
  for (let i = 0; i < 8; i++) { goTo(`p${i}`, 3); place(`p${i}`, { x: PHOTO_STAND.spot.x + i * 10, y: PHOTO_STAND.spot.y }); }
  place("p0", PHOTO_STAND.spot);
  const first = call("p0", "polaroid:take");
  assert.equal(first.ok, true);
  assert.equal(first.photo.people.length, 6);
  assert.equal(first.photo.people[0].name, "P0");
  assert.ok(!first.photo.people.some((q: any) => q.name === "Down"));
  assert.equal(call("p0", "polaroid:take").ok, false, "film is still developing");
  assert.equal(call("p1", "polaroid:take").ok, true, "someone else can take one");
  advance(POLAROID_COOLDOWN_MS + 1);
  assert.equal(call("p0", "polaroid:take").ok, true);
  for (let i = 0; i < POLAROID_WALL_CAP + 5; i++) { advance(POLAROID_COOLDOWN_MS + 1); assert.equal(call(`p${i % 8}`, "polaroid:take").ok, true); }
  assert.equal(repo.listPolaroids().length, POLAROID_WALL_CAP);
  const wall = call("p0", "polaroid:wall").photos;
  assert.equal(wall.length, POLAROID_WALL_CAP);
  assert.ok(wall[0].ts > wall[1].ts, "newest first");
  void room;
});

test("polaroid: the wall survives a server restart (server/data.json) and ignores damaged entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "pixelcafe-roof-"));
  const file = join(dir, "data.json");
  const repos: JsonFileRepository[] = [];
  try {
    const repo1 = new JsonFileRepository(file, 10);
    repos.push(repo1);
    const s1 = setup(repo1);
    s1.add("a", "Alice", "dev-a", "#ff00ff");
    s1.goTo("a", 3);
    s1.place("a", PHOTO_STAND.spot);
    const photo = s1.call("a", "polaroid:take").photo;
    s1.place("a", TELESCOPE.spot);
    s1.call("a", "stars:join");
    s1.call("a", "stars:wish", { text: "keep the wall forever" });
    repo1.flush();

    const repo2 = new JsonFileRepository(file, 10);
    repos.push(repo2);
    const s2 = setup(repo2);
    s2.add("z", "Zed", "dev-z");
    s2.goTo("z", 3);
    const wall = s2.call("z", "polaroid:wall").photos;
    assert.equal(wall.length, 1);
    assert.deepEqual(wall[0], photo);
    assert.deepEqual(unpackPixels(wall[0].people[0].sprite), pixelsFor("#ff00ff"));
    s2.place("z", TELESCOPE.spot);
    assert.ok(s2.call("z", "stars:join").wishes.some((w: any) => w.text === "keep the wall forever"));

    const dirty = sanitizeData({
      polaroids: [
        { id: "ok", ts: 1, by: "A", people: [{ name: "A", sprite: packPixels(pixelsFor("#abc")) }] },
        { id: "no-people", ts: 1, by: "A", people: [] },
        { id: "bad-sprite", ts: 1, by: "A", people: [{ name: "A", sprite: { pal: ["red"], runs: [1, 1024] } }] },
        { id: "seven", ts: 1, by: "A", people: Array.from({ length: 7 }, () => ({ name: "A", sprite: packPixels([]) })) },
        { ts: 1 }, "junk", null,
      ],
      wishes: [{ id: "w", text: "ok", ts: 1, author: "x" }, { id: 1 }, null],
    });
    assert.deepEqual(dirty.polaroids.map((p) => p.id), ["ok"]);
    assert.deepEqual(dirty.wishes.map((w) => w.id), ["w"]);
  } finally {
    for (const r of repos) r.flush(); // nothing may still be waiting to write when the folder goes
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ real sockets

test("real sockets: floor 3 end to end (elevator, scoping, roast, wishes, Polaroid wall)", async () => {
  const { createCafeServer } = await import("./app.ts");
  const { io: connect } = await import("socket.io-client");
  const srv = createCafeServer();
  await new Promise<void>((r) => srv.http.listen(0, r));
  const url = `http://localhost:${(srv.http.address() as any).port}`;
  const mk = () => connect(url, { transports: ["websocket"], forceNew: true });
  const a = mk(), b = mk(), c = mk();
  const waitFor = <T,>(sock: any, event: string, pred: (p: T) => boolean = () => true, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for ${event}`)); }, ms);
      const h = (p: T) => { if (pred(p)) { clearTimeout(t); sock.off(event, h); resolve(p); } };
      sock.on(event, h);
    });
  const ask = (s: any, ev: string, d?: any) => (d === undefined ? s.timeout(2000).emitWithAck(ev) : s.timeout(2000).emitWithAck(ev, d));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const ja = await ask(a, "join", { clientId: "ra", name: "Alice", pixels: pixelsFor("#ff0000") });
    await ask(b, "join", { clientId: "rb", name: "Bob", pixels: pixelsFor("#00ff00") });
    await ask(c, "join", { clientId: "rc", name: "Cleo", pixels: pixelsFor("#0000ff") });
    assert.equal(ja.init.floor, 1);

    // from the Main Cafe straight to the roof
    assert.equal((await ask(a, "floor:go", { floor: 3 })).ok, false, "too far from the elevator");
    for (const s of [a, b]) {
      s.emit("move", { x: STAIRS[1].spot.x, y: STAIRS[1].spot.y, flip: false, moving: false });
      await pause(100);
      const fs = waitFor<any>(s, "floor:state");
      assert.equal((await ask(s, "floor:go", { floor: 3 })).ok, true);
      assert.equal((await fs).floor, 3);
    }
    assert.equal(srv.room.players.get(a.id as string)!.floor, 3);

    // requests: refused downstairs, answered upstairs (with and without payloads)
    assert.equal((await ask(c, "polaroid:wall")).ok, false, "Cleo is still on Floor 1");
    assert.equal((await ask(a, "polaroid:wall")).photos.length, 0);
    assert.equal((await ask(a, "roast:start")).ok, false, "not on a log");
    assert.equal((await ask(a, "stars:wish")).ok, false, "missing payload is just a refusal");

    // a campfire log
    const seat = buildSeats().find((s) => s.id === "f3-fire-1")!;
    a.emit("move", { x: seat.exit.x, y: seat.exit.y, flip: false, moving: false });
    await pause(100);
    assert.equal((await ask(a, "sit", { seatId: "f3-fire-1" })).ok, true);
    const started = await ask(a, "roast:start");
    assert.equal(started.ok, true);
    assert.ok(started.rate >= ROAST_RATE_MIN);
    const pulled = await ask(a, "roast:pull");
    assert.equal(pulled.ok, true);
    assert.equal(pulled.grade, "raw");

    // the stars: Bob listens while Alice wishes
    a.emit("stand");
    await pause(60);
    a.emit("move", { x: TELESCOPE.spot.x, y: TELESCOPE.spot.y, flip: false, moving: false });
    b.emit("move", { x: TELESCOPE.spot.x + 10, y: TELESCOPE.spot.y, flip: false, moving: false });
    await pause(100);
    assert.equal((await ask(b, "stars:join")).ok, true);
    const heard = waitFor<any>(b, "stars:wishes");
    assert.equal((await ask(a, "stars:join")).ok, true);
    assert.equal((await ask(a, "stars:wish", { text: "a quiet year" })).ok, true);
    assert.ok((await heard).wishes.some((w: any) => w.text === "a quiet year" && !w.mine));

    // the photo
    a.emit("move", { x: PHOTO_STAND.spot.x, y: PHOTO_STAND.spot.y, flip: false, moving: false });
    await pause(100);
    const flash = waitFor<any>(b, "polaroid:new");
    const shot = await ask(a, "polaroid:take");
    assert.equal(shot.ok, true);
    assert.deepEqual(shot.photo.people.map((q: any) => q.name).sort(), ["Alice", "Bob"]);
    assert.equal((await flash).id, shot.photo.id);
    assert.equal((await ask(b, "polaroid:wall")).photos[0].id, shot.photo.id);
    let cleoHeard = 0;
    c.on("polaroid:new", () => cleoHeard++);
    c.on("stars:wishes", () => cleoHeard++);
    await pause(150);
    assert.equal(cleoHeard, 0);
  } finally {
    a.close(); b.close(); c.close();
    await srv.close();
  }
});
