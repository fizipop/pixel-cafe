/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Room, type Conn } from "./room.ts";
import { JsonFileRepository, MemoryRepository, sanitizeData } from "./repository.ts";
import { buildSeats } from "../src/game/layout.ts";
import { BLACKJACK, ROULETTE } from "../src/game/arcadeLayout.ts";
import { STAIRS, FLOOR2_X } from "../src/shared/floors.ts";
import { blackjackReturn, crashPoint, crashTimeAt, placeMines, slotMultiplier, MIN_BET, START_BEANS, TOPUP_BEANS } from "../src/shared/arcade.ts";
import { DRINKS } from "../src/lib/drinks.ts";
import { BJ_BET_MS } from "./blackjack.ts";
import { CRASH_WAIT_MS } from "./crash.ts";
import { ROULETTE_BET_MS, ROULETTE_SPIN_MS } from "./roulette.ts";

type Msg = { event: string; payload: any };
function fake(id: string): Conn & { log: Msg[] } {
  const log: Msg[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixels = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? "#ff0000" : ""));
const got = (c: { log: Msg[] }, ev: string) => c.log.filter((m) => m.event === ev);
const last = (c: { log: Msg[] }, ev: string) => got(c, ev).at(-1)?.payload;

function setup(rngValues: number[] = [], repo = new MemoryRepository()) {
  const now = { t: Date.UTC(2026, 10, 23, 15, 0, 0) };
  const queue = [...rngValues];
  const room = new Room({ now: () => now.t, schedule: () => {}, repo, rng: () => (queue.length ? (queue.shift() as number) : 0.5) });
  const add = (id: string, name = id, clientId = id, beans?: number) => {
    const c = fake(id);
    const r = room.join(c, { clientId, name, pixels, beans });
    assert.equal(r.ok, true);
    return c;
  };
  const advance = (ms: number, step = 100) => { for (let t = 0; t < ms; t += step) { now.t += Math.min(step, ms - t); room.tick(); } };
  /** Walk to the elevator and ride to Floor 2. */
  const up = (id: string) => {
    const p = room.players.get(id)!;
    p.state.x = STAIRS[1].spot.x; p.state.y = STAIRS[1].spot.y;
    const r = room.goFloor(id, { floor: 2 });
    assert.equal(r.ok, true);
  };
  const sit = (id: string, seatId: string) => {
    const s = buildSeats().find((x) => x.id === seatId)!;
    const p = room.players.get(id)!;
    p.state.x = s.exit.x; p.state.y = s.exit.y;
    return room.sit(id, { seatId });
  };
  const call = (id: string, ev: any, d?: any) => room.arcadeEvent(id, ev, d) as any;
  const beans = (clientId: string) => room.arcade.wallets.balance(clientId);
  return { room, add, now, advance, up, sit, call, beans, repo };
}

// ------------------------------------------------------------------ floors

test("floors: stairs scope players, movement, chat and seats to the current floor", () => {
  const { room, add, up, sit } = setup();
  const a = add("a"), b = add("b"), c = add("c");
  room.players.get("b")!.state.x = room.players.get("a")!.state.x + 20; // b and c stand next to a on Floor 1
  room.players.get("c")!.state.x = room.players.get("a")!.state.x + 30;
  up("a");
  assert.equal(got(b, "player:left").at(-1)!.payload.id, "a");
  const fs = last(a, "floor:state");
  assert.equal(fs.floor, 2);
  assert.deepEqual(fs.players, []);
  assert.ok(fs.x >= FLOOR2_X);
  assert.equal(room.players.get("a")!.floor, 2);

  // chat: a and b are far apart anyway; the real test is the same x on both floors
  room.players.get("b")!.state.x = room.players.get("a")!.state.x; room.players.get("b")!.state.y = room.players.get("a")!.state.y;
  const before = got(b, "chat").length;
  assert.equal(room.chat("a", { text: "hello upstairs" }).ok, true);
  assert.equal(got(b, "chat").length, before, "Floor 1 does not hear Floor 2");
  assert.equal(got(a, "chat").at(-1)!.payload.text, "hello upstairs");

  // movement is not shared across floors, and is clamped to the floor
  room.move("a", { x: FLOOR2_X + 300, y: 400, flip: false, moving: true });
  room.move("b", { x: 300, y: 400, flip: false, moving: true });
  room.tick();
  assert.equal(got(b, "moves").filter((m) => m.payload.some((u: any) => u.id === "a")).length, 0);
  assert.equal(got(c, "moves").filter((m) => m.payload.some((u: any) => u.id === "a")).length, 0);
  room.move("a", { x: 5, y: 400, flip: false, moving: false }); // "Floor 1" coordinates are clamped back into Floor 2
  assert.equal(room.players.get("a")!.state.x, FLOOR2_X);

  // a second player joining Floor 2 sees a, a sees them; seats are per floor
  up("b");
  assert.equal(got(a, "player:joined").at(-1)!.payload.id, "b");
  assert.deepEqual(last(b, "floor:state").players.map((p: any) => p.id), ["a"]);
  assert.equal(sit("a", "f2-bj0-1").ok, true);
  const seatsB = last(b, "seats");
  assert.equal(seatsB["f2-bj0-1"], "player:a");
  assert.ok(!Object.keys(last(c, "seats") ?? {}).some((k) => k.startsWith("f2-")), "Floor 1 never receives Floor 2 seats");
  assert.ok(Object.keys(last(b, "seats")).every((k) => k.startsWith("f2-")), "Floor 2 gets only Floor 2 seats");
});

test("floors: identity, drink badge, sprite and beans travel with you", () => {
  const { room, add, up, beans } = setup();
  add("a", "Sunny");
  add("b", "Bob");
  room.drink("a", { kind: DRINKS[0].id });
  const startBeans = beans("a");
  up("a");
  assert.equal(room.players.get("a")!.state.name, "Sunny");
  assert.equal(room.players.get("a")!.state.drink, DRINKS[0].id);
  assert.equal(room.players.get("a")!.state.pixels.length, 1024);
  up("b");
  const joined = last(room.players.get("a")!.conn as any, "player:joined");
  assert.equal(joined.name, "Bob");
  assert.equal(beans("a"), startBeans);
  // going back down
  const p = room.players.get("a")!;
  p.state.x = STAIRS[2].spot.x; p.state.y = STAIRS[2].spot.y;
  assert.equal(room.goFloor("a", { floor: 1 }).ok, true);
  assert.equal(p.floor, 1);
  assert.ok(p.state.x < FLOOR2_X);
});

test("floors: need to be at the elevator, standing, and ask for a real floor", () => {
  const { room, add, sit } = setup();
  add("a");
  assert.equal(room.goFloor("a", { floor: 2 }).ok, false, "too far from the elevator");
  room.players.get("a")!.state.x = STAIRS[1].spot.x; room.players.get("a")!.state.y = STAIRS[1].spot.y;
  assert.equal(room.goFloor("a", { floor: 1 }).ok, false, "already there");
  assert.equal(room.goFloor("a", { floor: 4 as any }).ok, false);
  assert.equal(room.goFloor("a", { floor: "3" as any }).ok, false);
  assert.equal(room.goFloor("nobody", { floor: 2 }).ok, false);
  assert.equal(sit("a", "t0-top").ok, true);
  assert.equal(room.goFloor("a", { floor: 2 }).ok, false, "seated");
});

test("floors: Floor 2 seats can't be taken from Floor 1; arcade requests need Floor 2", () => {
  const { add, sit, call } = setup();
  add("a");
  assert.equal(sit("a", "f2-bj0-1").ok, false);
  assert.equal(call("a", "slots:spin", { bet: 10 }).ok, false);
  assert.equal(call("a", "arcade:board").ok, false);
});

test("floors: leaving the cafe from Floor 2 frees the table seat and the other floor's view", () => {
  const { room, add, up, sit } = setup();
  add("a"); const b = add("b");
  up("a"); up("b");
  sit("a", "f2-bj0-2");
  room.leave("a");
  assert.equal(last(b, "seats")["f2-bj0-2"], undefined);
  assert.equal(room.arcade.blackjack.sitters[1], null);
});

// ------------------------------------------------------------------ wallet

test("wallet: new devices start with beans, drink beans seed it (capped), balance persists", () => {
  const repo = new MemoryRepository();
  const s1 = setup([], repo);
  s1.add("a", "A", "dev-a");
  s1.add("b", "B", "dev-b", 300);
  s1.add("c", "C", "dev-c", 99999);
  assert.equal(s1.beans("dev-a"), START_BEANS);
  assert.equal(s1.beans("dev-b"), 300);
  assert.equal(s1.beans("dev-c"), 500);
  assert.equal(last(s1.room.players.get("b")!.conn as any, "wallet"), undefined); // balance arrives in the join ack
  s1.room.arcade.wallets.debit("dev-a", 20);
  const s2 = setup([], repo); // a "restart" with the same data
  const c = s2.add("a2", "A", "dev-a", 400);
  assert.equal(s2.beans("dev-a"), START_BEANS - 20, "the seed only applies to a brand-new wallet");
  void c;
});

test("wallet: drink and gift beans are capped and rate limited", () => {
  const { room, add, beans, now } = setup();
  add("a");
  const start = beans("a");
  room.earn("a", { amount: 5 });
  assert.equal(beans("a"), start + 5);
  room.earn("a", { amount: 9999 });
  assert.equal(beans("a"), start + 5 + 20, "one drink is never worth more than 20");
  room.earn("a", { amount: -5 });
  room.earn("a", { amount: 1.5 });
  assert.equal(beans("a"), start + 25);
  for (let i = 0; i < 10; i++) room.earn("a", { amount: 20 });
  assert.ok(beans("a") <= start + 25 + 60, "no more than ~60 per minute");
  now.t += 60_000;
  const b = beans("a");
  room.earn("a", { amount: 20 });
  assert.equal(beans("a"), b + 20);
});

test("wallet: daily starter top-up when you can't afford the smallest bet, once a day", () => {
  const { room, add, up, call, beans, now } = setup([0.99, 0.99, 0.99]);
  const a = add("a");
  up("a");
  const w = room.arcade.wallets;
  assert.ok(w.debit("a", beans("a") - 3)); // 3 beans left, below the minimum bet
  room.arcade.pushWallet("a");
  assert.equal(beans("a"), 3 + TOPUP_BEANS);
  assert.equal(last(a, "wallet").topup, TOPUP_BEANS);
  assert.ok(w.debit("a", beans("a"))); // broke again the same day
  room.arcade.pushWallet("a");
  assert.equal(beans("a"), 0, "only one top-up a day");
  assert.equal(call("a", "slots:spin", { bet: MIN_BET }).ok, false);
  now.t += 24 * 60 * 60 * 1000;
  room.arcade.pushWallet("a");
  assert.equal(beans("a"), TOPUP_BEANS, "a new day, a new top-up");
});

// ------------------------------------------------------------------ slots

test("slots: pays the table, never lets you bet what you don't have", () => {
  const { add, up, call, beans } = setup([0.99, 0.99, 0.99, 0.0, 0.0, 0.5]);
  add("a", "A", "a", 200);
  up("a");
  assert.equal(beans("a"), 200);
  const r = call("a", "slots:spin", { bet: 10 });
  assert.deepEqual(r.reels, ["seven", "seven", "seven"]);
  assert.equal(r.win, 1200);
  assert.equal(beans("a"), 200 - 10 + 1200);
  const r2 = call("a", "slots:spin", { bet: 10 }); // cup, cup, croissant-ish: a pair pays half
  assert.equal(r2.reels[0], "cup");
  assert.equal(r2.reels[1], "cup");
  assert.equal(slotMultiplier(r2.reels), r2.reels[2] === "cup" ? 7 : 0.5);
  assert.equal(call("a", "slots:spin", { bet: 1 }).ok, false);
  assert.equal(call("a", "slots:spin", { bet: 100000 }).ok, false);
  assert.equal(call("a", "slots:spin", { bet: 7.5 }).ok, false);
  assert.equal(call("a", "slots:spin", { bet: "10" }).ok, false);
  const before = beans("a");
  assert.equal(call("a", "slots:spin", { bet: 500 }).ok, before >= 500);
});

// ------------------------------------------------------------------ mines

test("mines: reveal safe tiles, cash out at the rising multiplier; hazards end the round", () => {
  const rng = () => 0; // deterministic board
  const hazards = placeMines(3, rng);
  const safeTiles = Array.from({ length: 25 }, (_, i) => i).filter((i) => !hazards.includes(i));
  const { room, add, up, call, beans } = setup(Array(200).fill(0));
  void room;
  add("a", "A", "a", 500);
  up("a");
  const start = call("a", "mines:start", { bet: 100, mines: 3 });
  assert.equal(start.ok, true);
  assert.equal(beans("a"), 400);
  assert.equal(call("a", "mines:start", { bet: 10, mines: 3 }).ok, false, "one round at a time");
  const r1 = call("a", "mines:reveal", { tile: safeTiles[0] });
  assert.equal(r1.view.mult, 1.1); // 0.97 * 25/22 = 1.1022
  assert.equal(r1.view.hazards, undefined, "hazards are secret during the round");
  const r2 = call("a", "mines:reveal", { tile: safeTiles[1] });
  assert.ok(r2.view.mult > r1.view.mult);
  assert.equal(call("a", "mines:reveal", { tile: safeTiles[1] }).ok, false, "can't open a tile twice");
  const cash = call("a", "mines:cashout");
  assert.equal(cash.view.over, "cashed");
  assert.equal(cash.view.payout, Math.floor(100 * r2.view.mult));
  assert.equal(beans("a"), 400 + cash.view.payout);
  assert.equal(call("a", "mines:cashout").ok, false, "nothing left to cash out");
  // a hazard: you lose the bet and the board is shown
  call("a", "mines:start", { bet: 50, mines: 3 });
  const boom = call("a", "mines:reveal", { tile: hazards[0] });
  assert.equal(boom.view.over, "hit");
  assert.equal(boom.view.payout, 0);
  assert.deepEqual(boom.view.hazards, hazards);
  assert.equal(beans("a"), 400 + cash.view.payout - 50);
  assert.equal(call("a", "mines:start", { bet: 50, mines: 0 }).ok, false);
  assert.equal(call("a", "mines:start", { bet: 50, mines: 25 }).ok, false);
  assert.equal(call("a", "mines:reveal", { tile: 3 }).ok, false, "no round");
});

test("mines: clearing every safe tile cashes out automatically", () => {
  const hazards = placeMines(24, () => 0);
  const safe = Array.from({ length: 25 }, (_, i) => i).find((i) => !hazards.includes(i))!;
  const { add, up, call, beans } = setup(Array(40).fill(0));
  add("a", "A", "a", 100);
  up("a");
  call("a", "mines:start", { bet: 10, mines: 24 });
  const r = call("a", "mines:reveal", { tile: safe });
  assert.equal(r.view.over, "cleared");
  assert.equal(r.view.payout, Math.floor(10 * 24.25)); // 0.97 * 25 = 24.25
  assert.equal(beans("a"), 100 - 10 + r.view.payout);
});

// ------------------------------------------------------------------ crash

test("crash: shared rounds, cash out before it fizzles, bets lost if you don't, auto cash-out, records the best multiplier", () => {
  const { room, add, up, call, beans, advance, now } = setup([0.5, 0.5, 0.5]); // u = 0.5 -> crash at 1.92x
  assert.equal(crashPoint(0.5), 1.92);
  const a = add("a", "Ann", "a", 100), b = add("b", "Ben", "b", 100), c = add("c", "Cy", "c", 100);
  up("a"); up("b"); up("c");
  const ja = call("a", "crash:join");
  assert.equal(ja.view.phase, "wait");
  call("b", "crash:join");
  assert.equal(call("a", "crash:bet", { amount: 10 }).ok, true);
  assert.equal(call("b", "crash:bet", { amount: 20 }).ok, true);
  assert.equal(call("c", "crash:bet", { amount: 20 }).ok, true, "betting doesn't need a subscription... ");
  assert.equal(call("b", "crash:bet", { amount: 20 }).ok, false, "one bet per flight");
  assert.equal(call("a", "crash:cashout").ok, false, "not flying yet");
  assert.equal(beans("a"), 90);
  advance(CRASH_WAIT_MS + 200);
  assert.equal(last(a, "crash:state").phase, "fly");
  // ben sets nothing; ann cashes out around 1.5x
  advance(crashTimeAt(1.5) + 100);
  const out = call("a", "crash:cashout");
  assert.equal(out.ok, true);
  assert.ok(out.mult >= 1.5 && out.mult < 1.92);
  assert.equal(out.payout, Math.floor(10 * out.mult));
  assert.equal(beans("a"), 90 + out.payout);
  advance(crashTimeAt(1.92) - crashTimeAt(1.5) + 400);
  const st = last(a, "crash:state");
  assert.equal(st.phase, "crashed");
  assert.equal(st.mult, 1.92);
  assert.deepEqual(st.history, [1.92]);
  assert.equal(call("b", "crash:cashout").ok, false, "too late");
  assert.equal(beans("b"), 80, "Ben lost his bet");
  assert.equal(last(b, "crash:state").mine.cashedAt, undefined);
  // the best multiplier is on the board
  const board = call("a", "arcade:board").view;
  assert.equal(board.moon[0].name, "Ann");
  assert.equal(board.moon[0].value, out.mult);
  assert.equal(board.moon[0].mine, true);
  // next round auto cash-out
  advance(4000); // rest
  assert.equal(last(a, "crash:state").phase, "wait");
  assert.equal(call("a", "crash:bet", { amount: 10, auto: 1.5 }).ok, true);
  assert.equal(call("a", "crash:bet", { amount: 10, auto: 0.5 }).ok, false, "bet already placed, and 0.5x is invalid anyway");
  advance(CRASH_WAIT_MS + crashTimeAt(1.6) + 300);
  assert.equal(last(a, "crash:state").mine.cashedAt, 1.5, "auto cash-out pays exactly at its target");
  void room; void now; void c;
});

test("crash: validates bets and leaving the floor unsubscribes", () => {
  const { room, add, up, call, advance } = setup();
  add("a", "A", "a", 100);
  up("a");
  call("a", "crash:join");
  assert.equal(room.arcade.crash.subs.size, 1);
  assert.equal(call("a", "crash:bet", { amount: 3 }).ok, false);
  assert.equal(call("a", "crash:bet", { amount: 20, auto: 1.0 }).ok, false);
  assert.equal(call("a", "crash:bet", { amount: 20, auto: "5" }).ok, false);
  assert.equal(call("a", "crash:bet", { amount: 5000 }).ok, false);
  advance(500);
  const p = room.players.get("a")!;
  p.state.x = STAIRS[2].spot.x; p.state.y = STAIRS[2].spot.y;
  room.goFloor("a", { floor: 1 });
  assert.equal(room.arcade.crash.subs.size, 0);
});

// ------------------------------------------------------------------ roulette

test("roulette: shared spin, bets close, payouts for colour / parity / straight up", () => {
  const { room, add, up, sit, call, beans, advance } = setup([0.5]); // 0.5 * 37 -> 18 (red, even, low)
  const a = add("a", "Ann", "a", 200), b = add("b", "Ben", "b", 200);
  up("a"); up("b");
  assert.equal(sit("a", `f2-${ROULETTE.id}-1`).ok, true); // seated players are in automatically
  call("b", "roulette:join"); // watching from beside the table
  assert.equal(last(a, "roulette:state").phase, "bet");
  assert.equal(call("a", "roulette:bet", { kind: "red", amount: 10 }).ok, true);
  assert.equal(call("a", "roulette:bet", { kind: "num", n: 18, amount: 5 }).ok, true);
  assert.equal(call("a", "roulette:bet", { kind: "black", amount: 10 }).ok, true);
  assert.equal(call("b", "roulette:bet", { kind: "odd", amount: 25 }).ok, true);
  assert.equal(call("b", "roulette:bet", { kind: "num", n: 40, amount: 5 }).ok, false);
  assert.equal(call("b", "roulette:bet", { kind: "weird", amount: 5 }).ok, false);
  assert.equal(beans("a"), 175);
  advance(ROULETTE_BET_MS + 200);
  // betting is closed and both clients see the same result
  assert.equal(last(a, "roulette:state").phase, "spin");
  assert.equal(last(a, "roulette:state").result, 18);
  assert.equal(last(b, "roulette:state").result, 18);
  assert.equal(call("a", "roulette:bet", { kind: "red", amount: 10 }).ok, false);
  advance(ROULETTE_SPIN_MS + 200);
  assert.equal(last(a, "roulette:state").phase, "result");
  assert.equal(last(a, "roulette:state").returned, 20 + 180);
  assert.equal(last(b, "roulette:state").returned, 0);
  assert.equal(beans("a"), 175 + 200);
  assert.equal(beans("b"), 175);
  assert.deepEqual(last(a, "roulette:state").history, [18]);
  void room;
});

test("roulette: you can take your chips back while betting is open; standing leaves the table", () => {
  const { add, up, sit, call, beans, room } = setup();
  add("a", "A", "a", 100);
  up("a");
  sit("a", `f2-${ROULETTE.id}-2`);
  call("a", "roulette:bet", { kind: "high", amount: 30 });
  assert.equal(beans("a"), 70);
  assert.equal(call("a", "roulette:clear").ok, true);
  assert.equal(beans("a"), 100);
  room.stand("a");
  assert.equal(room.arcade.roulette.subs.size, 0);
  assert.equal(last(room.players.get("a")!.conn as any, "roulette:state"), null);
});

// ------------------------------------------------------------------ blackjack

const bjStart = (s: ReturnType<typeof setup>, ids: string[], rig: string[], bets: number[]) => {
  ids.forEach((id, i) => { assert.equal(s.sit(id, `f2-${BLACKJACK.id}-${i + 1}`).ok, true); });
  s.room.arcade.blackjack.rig(rig);
  ids.forEach((id, i) => assert.equal(s.call(id, "bj:bet", { amount: bets[i] }).ok, true));
  s.advance(BJ_BET_MS + 200, 200);
};

test("blackjack: stand, dealer draws, win pays 1:1", () => {
  const s = setup();
  const a = s.add("a", "Ann", "a", 100);
  s.up("a");
  // player 10+K = 20, dealer 9+7 = 16 must hit and busts on a 10
  bjStart(s, ["a"], ["10S", "9H", "KD", "7C", "10D"], [10]);
  const v = last(a, "bj:state");
  assert.equal(v.phase, "play");
  assert.equal(v.mySeat, 0);
  assert.equal(v.dealer[1], "??", "the dealer's hole card is hidden");
  assert.equal(v.dealerTotal, null);
  assert.equal(v.turn, 0);
  assert.equal(v.canDouble, true);
  assert.equal(s.beans("a"), 90);
  assert.equal(s.call("a", "bj:stand").ok, true);
  s.advance(3000, 200);
  const end = last(a, "bj:state");
  assert.equal(end.phase, "payout");
  assert.deepEqual(end.dealer, ["9H", "7C", "10D"]);
  assert.equal(end.seats[0].result, "win");
  assert.equal(end.seats[0].payout, 20);
  assert.equal(s.beans("a"), 110);
});

test("blackjack: natural blackjack pays 3:2 and dealer 21 beats a stand", () => {
  const s = setup();
  const a = s.add("a", "Ann", "a", 100), b = s.add("b", "Ben", "b", 100);
  s.up("a"); s.up("b");
  // deal order: a1, b1, d1, a2, b2, d2 -> Ann A+K (blackjack), Ben 10+8 = 18, dealer 9 + 7 = 16 then 5 = 21
  s.sit("a", "f2-bj0-1"); s.sit("b", "f2-bj0-2");
  s.room.arcade.blackjack.rig(["AS", "10H", "9C", "KD", "8S", "7D", "5C"]);
  s.call("a", "bj:bet", { amount: 20 });
  s.call("b", "bj:bet", { amount: 10 });
  s.advance(1000, 200); // everybody bet: dealt after a moment
  assert.equal(last(a, "bj:state").seats[0].status, "blackjack");
  assert.equal(last(a, "bj:state").turn, 1, "Ann's natural is skipped; Ben acts");
  assert.equal(s.call("a", "bj:hit").ok, false, "not Ann's turn");
  assert.equal(s.call("b", "bj:stand").ok, true);
  s.advance(3000, 200);
  const v = last(b, "bj:state");
  assert.equal(v.seats[0].result, "blackjack");
  assert.equal(v.seats[0].payout, 50); // 20 + 30
  assert.equal(v.seats[1].result, "lose");
  assert.equal(s.beans("a"), 100 - 20 + 50);
  assert.equal(s.beans("b"), 90);
});

test("blackjack: double down takes one card, doubles the bet; bust loses", () => {
  const s = setup();
  const a = s.add("a", "Ann", "a", 100), b = s.add("b", "Ben", "b", 100);
  s.up("a"); s.up("b");
  s.sit("a", "f2-bj0-1"); s.sit("b", "f2-bj0-2");
  // Ann 5+6 = 11, Ben 10+6 = 16; dealer 9+7 = 16. Ann doubles into a 10 -> 21. Ben hits a 9 and busts. Dealer hits a 9 and busts.
  s.room.arcade.blackjack.rig(["5S", "10H", "9C", "6D", "6S", "7D", "10C", "9D", "9H"]);
  s.call("a", "bj:bet", { amount: 20 });
  s.call("b", "bj:bet", { amount: 10 });
  s.advance(1000, 200);
  assert.equal(s.call("a", "bj:double").ok, true);
  assert.equal(s.beans("a"), 60, "the double takes a second 20");
  assert.equal(s.call("b", "bj:double").ok, true); // Ben doubles 16 into a 9 and busts
  s.advance(4000, 200);
  const v = last(a, "bj:state");
  assert.equal(v.seats[0].bet, 40);
  assert.equal(v.seats[0].cards.length, 3);
  assert.equal(v.seats[0].result, "win");
  assert.equal(s.beans("a"), 60 + 80);
  assert.equal(last(b, "bj:state").seats[1].result, "lose");
  assert.equal(s.beans("b"), 80);
});

test("blackjack: hit until bust loses, can't double after hitting, rules enforced", () => {
  const s = setup();
  const a = s.add("a", "Ann", "a", 100);
  s.up("a");
  assert.equal(s.call("a", "bj:bet", { amount: 10 }).ok, false, "sit first");
  bjStart(s, ["a"], ["10S", "9H", "6D", "7C", "9S"], [10]);
  assert.equal(s.call("a", "bj:bet", { amount: 10 }).ok, false, "round already running");
  assert.equal(s.call("a", "bj:hit").ok, true); // 16 + 9 = 25
  assert.equal(last(a, "bj:state").seats[0].status, "bust");
  s.advance(3000, 200);
  assert.equal(last(a, "bj:state").seats[0].result, "lose");
  assert.equal(s.beans("a"), 90);
  assert.equal(last(a, "bj:state").dealer.length, 2, "the dealer doesn't draw when everyone busted");
});

test("blackjack: standing up before the deal returns your bet; a turn timeout stands for you", () => {
  const s = setup();
  s.add("a", "Ann", "a", 100); s.add("b", "Ben", "b", 100);
  s.up("a"); s.up("b");
  s.sit("a", "f2-bj0-1"); s.sit("b", "f2-bj0-2");
  s.call("a", "bj:bet", { amount: 50 });
  assert.equal(s.beans("a"), 50);
  s.room.stand("a");
  assert.equal(s.beans("a"), 100);
  s.room.arcade.blackjack.rig(["10S", "9H", "8D", "7C", "10D"]);
  s.call("b", "bj:bet", { amount: 10 });
  s.advance(1000, 200);
  s.advance(24_000, 500); // Ben never acts
  assert.equal(last(s.room.players.get("b")!.conn as any, "bj:state").phase, "payout");
  assert.equal(last(s.room.players.get("b")!.conn as any, "bj:state").seats[1].status, "stand");
});

test("blackjack: a player who leaves mid-hand still gets the hand settled", () => {
  const s = setup();
  s.add("a", "Ann", "a", 100);
  s.up("a");
  bjStart(s, ["a"], ["10S", "9H", "KD", "7C", "10D"], [10]);
  s.room.leave("a");
  s.advance(5000, 200);
  assert.equal(s.beans("a"), 110, "left on 20, dealer busted: the win is still paid");
});

test("blackjack maths: totals, soft aces, payouts", async () => {
  const { handValue, isBlackjack, settleBlackjack } = await import("../src/shared/arcade.ts");
  assert.deepEqual(handValue(["AS", "6D"]), { total: 17, soft: true });
  assert.deepEqual(handValue(["AS", "6D", "9C"]), { total: 16, soft: false });
  assert.equal(handValue(["AS", "AD", "9C"]).total, 21);
  assert.equal(isBlackjack(["AS", "KD"]), true);
  assert.equal(isBlackjack(["5S", "6D", "KC"]), false);
  assert.equal(settleBlackjack(["10S", "KD"], ["AS", "KD"]), "lose"); // 20 loses to a dealer blackjack
  assert.equal(settleBlackjack(["10S", "KD"], ["10C", "QD"]), "push");
  assert.equal(settleBlackjack(["10S", "5D", "KD"], ["10C", "6D"]), "lose"); // player bust
  assert.equal(settleBlackjack(["10S", "7D"], ["10C", "6D", "KD"]), "win"); // dealer bust
  assert.equal(blackjackReturn("blackjack", 25), 25 + 37);
  assert.equal(blackjackReturn("push", 25), 25);
  assert.equal(blackjackReturn("lose", 25), 0);
});

// ------------------------------------------------------------------ persistence

test("arcade scores and wallets survive a restart (JsonFileRepository) and bad data is dropped", () => {
  const dir = mkdtempSync(join(tmpdir(), "cafe-arcade-"));
  const file = join(dir, "data.json");
  try {
    const repo = new JsonFileRepository(file, 0);
    const s = setup([], repo);
    s.add("a", "Ann", "dev-a", 250);
    s.up("a");
    repo.setBest("penguin", "dev-a", { name: "Ann", value: 420, ts: 1 });
    repo.setBest("drift", "dev-a", { name: "Ann", value: 21500, ts: 1 });
    repo.setBest("moon", "dev-a", { name: "Ann", value: 12.34, ts: 2 });
    repo.flush();
    const again = new JsonFileRepository(file, 0);
    assert.equal(again.getWallet("dev-a")?.beans, 250);
    assert.equal(again.getBest("penguin", "dev-a")?.value, 420);
    assert.equal(again.getBest("drift", "dev-a")?.value, 21500);
    assert.equal(again.getBest("moon", "dev-a")?.value, 12.34);
    const clean = sanitizeData({ wallets: { x: { beans: -5.7, name: "X" }, y: "nope", z: { beans: 10 } }, penguin: { q: { name: "Q", value: -1 }, r: { name: "R", value: 5 } }, ice: { old: { name: "Cat", value: 99 } }, moon: [] });
    assert.equal(clean.wallets.x.beans, 0);
    assert.equal(clean.wallets.y, undefined);
    assert.equal(clean.wallets.z, undefined);
    assert.equal(clean.penguin.q, undefined);
    assert.equal(clean.penguin.r.value, 5);
    assert.equal((clean as Record<string, unknown>).ice, undefined, "the old Cat Ice Jump board is gone");
    assert.deepEqual(clean.moon, {});
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ real sockets

test("real sockets: floors scope broadcasts, arcade acks work (with and without a payload), wallet pushes arrive", async () => {
  const { createCafeServer } = await import("./app.ts");
  const { io: connect } = await import("socket.io-client");
  const srv = createCafeServer();
  await new Promise<void>((r) => srv.http.listen(0, r));
  const url = `http://localhost:${(srv.http.address() as any).port}`;
  const mk = () => connect(url, { transports: ["websocket"], forceNew: true });
  const a = mk(), b = mk();
  const waitFor = <T,>(sock: any, event: string, pred: (p: T) => boolean = () => true, ms = 3000) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => { sock.off(event, h); reject(new Error(`timeout waiting for ${event}`)); }, ms);
      const h = (p: T) => { if (pred(p)) { clearTimeout(t); sock.off(event, h); resolve(p); } };
      sock.on(event, h);
    });
  try {
    const ja = await a.timeout(2000).emitWithAck("join", { clientId: "sa", name: "Alice", pixels, beans: 100 });
    const jb = await b.timeout(2000).emitWithAck("join", { clientId: "sb", name: "Bob", pixels });
    assert.equal(ja.init.floor, 1);
    assert.equal(ja.init.beans, 100);
    assert.equal(jb.init.beans, START_BEANS);
    assert.equal(jb.init.players.length, 1);

    // arcade requests are refused downstairs
    assert.equal((await a.timeout(2000).emitWithAck("slots:spin", { bet: 10 })).ok, false);
    assert.equal((await a.timeout(2000).emitWithAck("floor:go", { floor: 2 })).ok, false, "too far from the elevator");

    // walk to the elevator (the server trusts clamped positions) and ride up
    a.emit("move", { x: STAIRS[1].spot.x, y: STAIRS[1].spot.y, flip: false, moving: false });
    await new Promise((r) => setTimeout(r, 120));
    const left = waitFor<any>(b, "player:left", (p) => p.id === a.id);
    const fs = waitFor<any>(a, "floor:state");
    assert.equal((await a.timeout(2000).emitWithAck("floor:go", { floor: 2 })).ok, true);
    assert.equal((await left).id, a.id);
    const state = await fs;
    assert.equal(state.floor, 2);
    assert.deepEqual(state.players, []);

    // Floor 2 requests: no-payload and payload forms
    const board = await a.timeout(2000).emitWithAck("arcade:board");
    assert.equal(board.ok, true);
    assert.equal(board.view.rich.length, 2);
    // any change from 100 (a pair leaves 95, three of a kind 160+): waiting for "< 100" timed out on the ~7.6% of spins that win big
    const walletMsg = waitFor<any>(a, "wallet", (w) => w.beans !== 100);
    const spin = await a.timeout(2000).emitWithAck("slots:spin", { bet: 10 });
    assert.equal(spin.ok, true);
    assert.equal(spin.reels.length, 3);
    assert.equal((await walletMsg).beans, spin.beans);
    const joined = await a.timeout(2000).emitWithAck("crash:join");
    assert.equal(joined.view.phase, "wait");
    const raceStart = await a.timeout(2000).emitWithAck("racer:start");
    assert.ok(raceStart.token > 0);
    assert.equal((await a.timeout(2000).emitWithAck("mines:state")).ok, false);
    assert.equal((await a.timeout(2000).emitWithAck("slots:spin", { bet: 1e9 })).ok, false);
    assert.equal((await a.timeout(2000).emitWithAck("slots:spin")).ok, false, "missing payload is just a refusal");

    // Floor 1 can't see Floor 2 chat or movement
    let heard = 0;
    b.on("chat", () => heard++);
    b.on("moves", (m: any[]) => { if (m.some((u) => u.id === a.id)) heard++; });
    a.emit("move", { x: FLOOR2_X + 400, y: 400, flip: false, moving: true });
    await a.timeout(2000).emitWithAck("chat", { text: "hello from upstairs" });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(heard, 0);

    // and coming back down
    a.emit("move", { x: STAIRS[2].spot.x, y: STAIRS[2].spot.y, flip: false, moving: false });
    await new Promise((r) => setTimeout(r, 120));
    const back = waitFor<any>(b, "player:joined", (p) => p.id === a.id);
    assert.equal((await a.timeout(2000).emitWithAck("floor:go", { floor: 1 })).ok, true);
    assert.equal((await back).floor, 1);
    assert.equal(srv.room.arcade.crash.subs.size, 0, "left Floor 2: no longer watching the rocket");
  } finally {
    a.close(); b.close();
    await srv.close();
  }
});
