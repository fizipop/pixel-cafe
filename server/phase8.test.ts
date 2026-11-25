/* eslint-disable @typescript-eslint/no-explicit-any */
import test from "node:test";
import assert from "node:assert/strict";
import { Room, type Conn } from "./room.ts";
import { MemoryRepository } from "./repository.ts";
import { buildSeats } from "../src/game/layout.ts";
import { STAIRS } from "../src/shared/floors.ts";
import { FREE_REWARD_CAP, FREE_REWARD_WINDOW_MS, PENGUIN_TILES, penguinCrackChance, penguinMultiplier, mulberry32 } from "../src/shared/arcade.ts";
import { BTN, CHARACTERS, FIGHT, LADDER, ladderBeans } from "../src/shared/fighter.ts";
import { CHART, RANK_BEANS, SONG_MS } from "../src/shared/beat.ts";
import { RACE, raceBeans, track } from "../src/shared/racer.ts";
import { newPoolGame, playShot } from "../src/shared/pool.ts";
import { PK } from "./poker.ts";
import { POOL_BOT_MS, POOL_OFFER_MS, POOL_TURN_MS } from "./pool.ts";
import { PVP_BEANS } from "./fighter.ts";

type Msg = { event: string; payload: any };
function fake(id: string): Conn & { log: Msg[] } {
  const log: Msg[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixels = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? "#ff0000" : ""));
const got = (c: { log: Msg[] }, ev: string) => c.log.filter((m) => m.event === ev);
const last = (c: { log: Msg[] }, ev: string) => got(c, ev).at(-1)?.payload;

function setup(rngValues: number[] = [], repo = new MemoryRepository(), seed = 0) {
  const now = { t: Date.UTC(2026, 10, 24, 15, 0, 0) };
  const queue = [...rngValues];
  const fallback = seed ? mulberry32(seed) : () => 0.5;
  const room = new Room({ now: () => now.t, schedule: () => {}, repo, rng: () => (queue.length ? (queue.shift() as number) : fallback()) });
  const add = (id: string, name = id, clientId = id, beans = 500) => {
    const c = fake(id);
    assert.equal(room.join(c, { clientId, name, pixels, beans }).ok, true);
    return c;
  };
  /** Advance the clock, ticking the slow (15 Hz) and fast (30 Hz) timers like the server does. */
  const advance = (ms: number, step = 33) => {
    for (let t = 0; t < ms; t += step) { now.t += Math.min(step, ms - t); room.fastTick(); if (Math.floor(now.t / 33) % 2 === 0) room.tick(); }
  };
  const up = (id: string) => {
    const p = room.players.get(id)!;
    p.state.x = STAIRS[1].spot.x; p.state.y = STAIRS[1].spot.y;
    assert.equal(room.goFloor(id, { floor: 2 }).ok, true);
  };
  const sit = (id: string, seatId: string) => {
    const s = buildSeats().find((x) => x.id === seatId)!;
    const p = room.players.get(id)!;
    p.state.x = s.exit.x; p.state.y = s.exit.y;
    return room.sit(id, { seatId });
  };
  const call = (id: string, ev: any, d?: any) => room.arcadeEvent(id, ev, d) as any;
  const beans = (clientId: string) => room.arcade.wallets.balance(clientId);
  return { room, add, advance, up, sit, call, beans, repo, now };
}

// ------------------------------------------------------------------ Penguin Cross

test("penguin cross: step, cash out at a higher multiplier, and the wallet matches", () => {
  const { add, up, call, beans } = setup([0.99, 0.99, 0.99]);
  add("a", "Ann", "dev-a", 100); up("a");
  assert.equal(call("a", "penguin:state").ok, false);
  assert.equal(call("a", "penguin:step").ok, false, "no crossing yet");
  const start = call("a", "penguin:start", { bet: 20, lane: "thin" });
  assert.equal(start.ok, true);
  assert.equal(beans("dev-a"), 80);
  assert.equal(start.view.steps, 0);
  assert.equal(start.view.tiles, PENGUIN_TILES);
  assert.equal(call("a", "penguin:start", { bet: 20, lane: "thin" }).ok, false, "one crossing at a time");
  assert.equal(call("a", "penguin:cashout").ok, false, "take a step first");
  const s1 = call("a", "penguin:step");
  assert.equal(s1.view.steps, 1);
  assert.equal(s1.view.mult, penguinMultiplier("thin", 1));
  const s2 = call("a", "penguin:step"); call("a", "penguin:step");
  assert.ok(s2.view.mult > s1.view.mult, "bigger with every step");
  assert.equal(call("a", "penguin:state").view.steps, 3, "a left-open window picks the crossing back up");
  const cash = call("a", "penguin:cashout");
  assert.equal(cash.view.over, "cashed");
  assert.equal(cash.view.payout, Math.floor(20 * penguinMultiplier("thin", 3)));
  assert.equal(beans("dev-a"), 80 + cash.view.payout);
  assert.equal(call("a", "penguin:cashout").ok, false, "already paid");
  assert.equal(call("a", "penguin:step").ok, false);
});

test("penguin cross: a cracked tile drops the penguin and forfeits the bet", () => {
  const { add, up, call, beans } = setup([0.99, penguinCrackChance("cracked", 2) - 0.0001]);
  add("a", "Ann", "dev-a", 100); up("a");
  call("a", "penguin:start", { bet: 50, lane: "cracked" });
  assert.equal(call("a", "penguin:step").view.steps, 1);
  const crack = call("a", "penguin:step");
  assert.equal(crack.view.over, "cracked");
  assert.equal(crack.view.payout, 0);
  assert.equal(beans("dev-a"), 50, "the bet is gone");
  assert.equal(call("a", "penguin:step").ok, false, "round over");
  assert.equal(call("a", "arcade:board").view.penguin.length, 0, "a loss is not a leaderboard entry");
});

test("penguin cross: reaching the shore pays automatically; the biggest cash-out goes on the leaderboard", () => {
  const { add, up, call, beans } = setup(Array(PENGUIN_TILES).fill(0.999));
  add("a", "Ann", "dev-a", 100); up("a");
  call("a", "penguin:start", { bet: 5, lane: "calm" });
  let r: any;
  for (let i = 0; i < PENGUIN_TILES; i++) r = call("a", "penguin:step");
  assert.equal(r.view.over, "shore");
  assert.equal(r.view.steps, PENGUIN_TILES);
  assert.equal(r.view.payout, Math.floor(5 * penguinMultiplier("calm", PENGUIN_TILES)));
  assert.equal(beans("dev-a"), 95 + r.view.payout);
  const board = call("a", "arcade:board").view.penguin;
  assert.deepEqual(board.map((x: any) => [x.name, x.value, x.mine]), [["Ann", penguinMultiplier("calm", PENGUIN_TILES), true]]);
});

test("penguin cross: bad bets, bad lanes and a thin wallet are refused", () => {
  const { add, up, call, beans } = setup();
  add("a", "Ann", "dev-a", 5); up("a");
  for (const bad of [0, 4, 501, 7.5, "10", null]) assert.equal(call("a", "penguin:start", { bet: bad, lane: "calm" }).ok, false, String(bad));
  for (const lane of ["", "easy", null, 3, "__proto__"]) assert.equal(call("a", "penguin:start", { bet: 5, lane }).ok, false, String(lane));
  assert.equal(call("a", "penguin:start", { bet: 100, lane: "calm" }).ok, false, "can't afford it");
  assert.equal(call("a", "penguin:start").ok, false, "missing payload");
  assert.equal(beans("dev-a"), 50, "nothing was taken");
});

// ------------------------------------------------------------------ Texas Hold'em

/** Chips at the table: every stack plus everything in the pot (bets are already counted in the pot). */
const pokerChips = (view: any) => view.seats.reduce((n: number, s: any) => n + (s ? s.stack : 0), 0) + view.pot;

test("poker: sit, buy in (limits, wallet), add a bot, and a hand is dealt", () => {
  const { add, up, sit, call, beans, advance, room } = setup([], new MemoryRepository(), 3);
  const a = add("a", "Ann", "dev-a", 500); up("a");
  assert.equal(call("a", "pk:buyin", { amount: 200 }).ok, false, "not seated");
  assert.equal(sit("a", "f2-pk0-1").ok, true);
  assert.equal(last(a, "pk:state").mySeat, 0);
  assert.equal(call("a", "pk:act", { action: "check" }).ok, false, "no hand yet");
  for (const bad of [0, 50, 99, 1001, 5.5, "200", null]) assert.equal(call("a", "pk:buyin", { amount: bad }).ok, false, String(bad));
  assert.equal(call("a", "pk:buyin", { amount: 200 }).ok, true);
  assert.equal(beans("dev-a"), 300);
  assert.equal(call("a", "pk:buyin", { amount: 900 }).ok, false, "table maximum");
  advance(5000);
  assert.equal(last(a, "pk:state").phase, "wait", "alone: no hand without an opponent");
  assert.equal(call("a", "pk:bot", { add: true }).ok, true);
  advance(PK.START_MS + 200);
  const v = last(a, "pk:state");
  assert.equal(v.phase, "preflop");
  assert.equal(v.seats[0].cards.length, 2);
  assert.ok(v.seats[0].cards.every((c: string) => c !== "??"), "you see your own cards");
  assert.deepEqual(v.seats[1].cards, ["??", "??"], "the bot's cards are hidden");
  assert.equal(v.seats[1].bot, true);
  assert.equal(v.blinds.bb, PK.BB);
  assert.equal(pokerChips(v), 200 + PK.BOT_STACK, "every chip is accounted for");
  assert.equal(room.arcade.poker.humans.length, 1);
  assert.equal(call("a", "pk:buyin", { amount: 100 }).ok, false, "can't buy during a live hand");
});

for (const seed of [8, 9, 10, 11]) test(`poker: hands against a bot never create or lose a chip, and standing up returns your chips (session ${seed})`, () => {
  const { add, up, sit, call, beans, advance, room } = setup([], new MemoryRepository(), seed);
  const a = add("a", "Ann", "dev-a", 500); up("a"); sit("a", "f2-pk0-3");
  call("a", "pk:buyin", { amount: 300 });
  call("a", "pk:bot", { add: true });
  const rng = mulberry32(17 + seed);
  let hands = 0, baseline = -1, prevPhase = "";
  for (let i = 0; i < 6000 && hands < 40; i++) {
    advance(100);
    const v = last(a, "pk:state");
    if (!v) continue;
    if (v.phase === "preflop" && prevPhase !== "preflop" && !["flop", "turn", "river"].includes(prevPhase)) { baseline = pokerChips(v); hands++; }
    prevPhase = v.phase;
    if (baseline >= 0 && v.phase !== "showdown" && v.phase !== "wait") assert.equal(pokerChips(v), baseline, `chips conserved (phase ${v.phase})`);
    for (const s of v.seats) if (s) assert.ok(s.stack >= 0 && s.bet >= 0);
    if (v.turn === v.mySeat && v.mySeat >= 0) { // play randomly but legally (tight, so a session lasts a while)
      const r = rng();
      if (r < 0.06) call("a", "pk:act", { action: "fold" });
      else if (r < 0.2 && v.maxRaise > v.toCall) call("a", "pk:act", { action: "raise", amount: Math.min(v.maxRaise, v.minRaise + Math.floor(rng() * 40)) });
      else call("a", "pk:act", { action: v.canCheck ? "check" : "call" });
    }
    if (v.phase === "wait" || v.phase === "showdown") {
      const me = v.seats[2];
      if (me && me.stack === 0) call("a", "pk:buyin", { amount: 100 });
    }
  }
  assert.ok(hands >= 6, `played ${hands} hands`);
  advance(PK.SHOWDOWN_MS + 500);
  const mine = last(a, "pk:state").seats[2].stack;
  const walletBefore = beans("dev-a");
  room.stand("a");
  assert.equal(beans("dev-a"), walletBefore + mine, "chips come back to the wallet");
  assert.equal(last(a, "pk:state"), null);
  assert.equal(room.arcade.poker.seats[2], null);
  void walletBefore;
});

test("poker: two players, blinds, folding gives the pot to the other, and the turn timer folds you", () => {
  const { add, up, sit, call, advance } = setup([], new MemoryRepository(), 5);
  const a = add("a", "Ann", "dev-a", 500); add("b", "Bob", "dev-b", 500);
  up("a"); up("b"); sit("a", "f2-pk0-1"); sit("b", "f2-pk0-2");
  call("a", "pk:buyin", { amount: 200 }); call("b", "pk:buyin", { amount: 200 });
  advance(PK.START_MS + 200);
  const v = last(a, "pk:state");
  assert.equal(v.phase, "preflop");
  assert.equal(v.pot, PK.SB + PK.BB);
  const dealer = v.seats.findIndex((s: any) => s?.dealer);
  assert.equal(v.turn, dealer, "heads-up the dealer (small blind) acts first");
  const actor = dealer === 0 ? "a" : "b", other = dealer === 0 ? "b" : "a";
  assert.equal(call(other, "pk:act", { action: "fold" }).ok, false, "not your turn");
  assert.equal(call(actor, "pk:act", { action: "check" }).ok, false, "the small blind owes half a big blind");
  assert.equal(call(actor, "pk:act", { action: "raise", amount: PK.BB }).ok, false, "below the minimum raise");
  assert.equal(call(actor, "pk:act", { action: "dance" }).ok, false);
  assert.equal(call(actor, "pk:act", { action: "fold" }).ok, true);
  const end = last(a, "pk:state");
  assert.equal(end.phase, "showdown");
  assert.match(end.msg, /takes the pot/);
  const winner = end.seats.findIndex((s: any) => s?.won);
  assert.equal(winner, dealer === 0 ? 1 : 0);
  assert.equal(end.seats[winner].stack, 200 + PK.SB);
  assert.equal(end.seats[dealer].stack, 200 - PK.SB);
  // the next hand: nobody acts, the clock folds for them
  advance(PK.SHOWDOWN_MS + PK.START_MS + 300);
  const v2 = last(a, "pk:state");
  assert.equal(v2.phase, "preflop");
  assert.notEqual(v2.turn, null);
  advance(PK.ACT_MS + 300);
  const after = last(a, "pk:state");
  assert.equal(after.phase, "showdown");
  assert.match(after.msg, /takes the pot/);
});

test("poker: all-in showdown with a short stack: every chip is paid out", () => {
  const { add, up, sit, call, advance } = setup([], new MemoryRepository(), 12);
  const names = ["a", "b", "c"];
  const socks = names.map((n) => add(n, n.toUpperCase(), `dev-${n}`, 1000));
  names.forEach((n, i) => { up(n); sit(n, `f2-pk0-${i + 1}`); });
  call("a", "pk:buyin", { amount: 100 }); call("b", "pk:buyin", { amount: 300 }); call("c", "pk:buyin", { amount: 300 });
  advance(PK.START_MS + 200);
  let v = last(socks[0], "pk:state");
  assert.equal(v.phase, "preflop");
  assert.equal(pokerChips(v), 700);
  for (let guard = 0; guard < 12 && v.phase !== "showdown"; guard++) { // everybody shoves
    const who = names[v.turn];
    const view = last(socks[names.indexOf(who)], "pk:state");
    const r = call(who, "pk:act", { action: "raise", amount: view.maxRaise });
    if (!r.ok) call(who, "pk:act", { action: "call" });
    v = last(socks[0], "pk:state");
  }
  assert.equal(v.phase, "showdown");
  assert.equal(v.board.length, 5, "the board ran out");
  const stacks = v.seats.filter(Boolean).map((s: any) => s.stack);
  assert.equal(stacks.reduce((n: number, x: number) => n + x, 0), 700, "chips in = chips out");
  assert.ok(v.seats.filter((s: any) => s?.hand).length >= 2, "hands are shown at a showdown");
  assert.ok(stacks.every((x: number) => x >= 0));
  assert.ok(v.seats.reduce((n: number, s: any) => n + (s?.won || 0), 0) >= 100);
});

test("poker: leaving mid-hand folds for you and refunds your stack; bots can be added and removed", () => {
  const { add, up, sit, call, beans, advance, room } = setup([], new MemoryRepository(), 21);
  const a = add("a", "Ann", "dev-a", 500), b = add("b", "Bob", "dev-b", 500);
  up("a"); up("b"); sit("a", "f2-pk0-1"); sit("b", "f2-pk0-2");
  call("a", "pk:buyin", { amount: 200 }); call("b", "pk:buyin", { amount: 200 });
  advance(PK.START_MS + 200);
  assert.equal(last(a, "pk:state").phase, "preflop");
  const before = beans("dev-a");
  const stackBefore = last(a, "pk:state").seats[0].stack;
  room.stand("a");
  assert.equal(beans("dev-a"), before + stackBefore, "the chips not in the pot come back");
  const v = last(b, "pk:state");
  assert.equal(v.phase, "showdown", "Bob wins the hand");
  assert.equal(v.seats[0], null, "Ann's seat is empty once the hand is over");
  assert.ok(v.seats[1].stack > 200 - PK.BB);
  assert.equal(call("b", "pk:bot", { add: true }).ok, true);
  assert.equal(last(b, "pk:state").bots, 1);
  for (let i = 0; i < 8; i++) call("b", "pk:bot", { add: true });
  assert.equal(last(b, "pk:state").bots, 5, "six seats: you plus five bots");
  advance(PK.SHOWDOWN_MS + PK.START_MS + 500);
  assert.equal(call("a", "pk:bot", { add: true }).ok, false, "Ann is no longer seated");
});

// ------------------------------------------------------------------ 8-Ball Pool

test("pool: play the house bot: the server's shot is the shared physics, the bot answers", () => {
  const { add, up, sit, call, advance } = setup([], new MemoryRepository(), 4);
  const a = add("a", "Ann", "dev-a"); add("b", "Bob", "dev-b");
  up("a"); up("b");
  assert.equal(call("a", "pl:start", { stake: 0, ai: true }).ok, false, "sit first");
  sit("a", "f2-pl0-1");
  assert.equal(last(a, "pl:state").phase, "lobby");
  for (const bad of [5, -1, "10", null]) assert.equal(call("a", "pl:start", { stake: bad, ai: true }).ok, false, String(bad));
  assert.equal(call("a", "pl:start", { stake: 0, ai: true }).ok, true);
  let v = last(a, "pl:state");
  assert.equal(v.phase, "play");
  assert.equal(v.vsBot, true);
  assert.equal(v.me, 0);
  assert.equal(v.players[1].bot, true);
  assert.equal(v.balls.length, 16);
  assert.equal(call("a", "pl:start", { stake: 0, ai: true }).ok, false, "already playing");
  for (const bad of [{ angle: NaN, power: 0.5 }, { angle: 0, power: 0 }, { angle: "x", power: 0.5 }, { angle: 0, power: -2 }]) assert.equal(call("a", "pl:shot", bad).ok, false, JSON.stringify(bad));
  // the break: the server result is exactly what the shared engine (and so the browser replay) computes
  const expect = playShot(newPoolGame(0), 0.03, 1);
  assert.equal(call("a", "pl:shot", { angle: 0.03, power: 1 }).ok, true);
  v = last(a, "pl:state");
  assert.equal(v.shot.seq, 1);
  assert.deepEqual(v.balls.map((x: any) => [x.id, x.x, x.y, x.out]), expect.game.balls.map((x) => [x.id, x.x, x.y, x.out]));
  assert.equal(v.shot.from.length, 16);
  assert.equal(v.turn, expect.game.turn);
  for (let i = 0; i < 12 && last(a, "pl:state").turn === 0 && last(a, "pl:state").phase === "play"; i++) call("a", "pl:shot", { angle: i, power: 0.2 });
  if (last(a, "pl:state").phase === "play") {
    assert.equal(call("a", "pl:shot", { angle: 0, power: 0.2 }).ok, false, "the bot's turn");
    const seq = last(a, "pl:state").shot.seq;
    advance(POOL_BOT_MS + 200);
    assert.ok(last(a, "pl:state").shot.seq > seq, "the bot took its shot");
  }
  assert.equal(call("b", "pl:shot", { angle: 0, power: 0.5 }).ok, false, "Bob isn't at the table");
});

test("pool: challenge another player for a stake: decline and timeout cost nothing, resigning pays the winner", () => {
  const { add, up, sit, call, beans, advance } = setup([], new MemoryRepository(), 6);
  const a = add("a", "Ann", "dev-a", 150), b = add("b", "Bob", "dev-b", 150);
  up("a"); up("b"); sit("a", "f2-pl0-1");
  assert.equal(call("a", "pl:start", { stake: 25, ai: false }).ok, false, "nobody on the other stool");
  sit("b", "f2-pl0-2");
  assert.equal(call("a", "pl:start", { stake: 25, ai: false }).ok, true);
  assert.equal(last(b, "pl:state").phase, "offer");
  assert.equal(call("a", "pl:accept", { accept: true }).ok, false, "can't accept your own challenge");
  assert.equal(call("b", "pl:accept", { accept: false }).ok, true);
  assert.equal(last(a, "pl:state").phase, "lobby");
  assert.equal(beans("dev-a"), 150); assert.equal(beans("dev-b"), 150);
  call("a", "pl:start", { stake: 25, ai: false });
  advance(POOL_OFFER_MS + 500);
  assert.equal(last(a, "pl:state").phase, "lobby", "an unanswered challenge times out");
  call("a", "pl:start", { stake: 100, ai: false });
  assert.equal(call("b", "pl:accept", { accept: true }).ok, true, "Bob can cover it");
  assert.equal(last(a, "pl:state").phase, "play");
  assert.equal(beans("dev-a"), 50); assert.equal(beans("dev-b"), 50);
  assert.equal(call("b", "pl:shot", { angle: 0, power: 1 }).ok, false, "the break belongs to the challenger");
  assert.equal(call("a", "pl:shot", { angle: 0.02, power: 1 }).ok, true);
  assert.equal(call("b", "pl:resign").ok, true);
  const end = last(a, "pl:state");
  assert.equal(end.phase, "over");
  assert.equal(end.winner, 0);
  assert.equal(beans("dev-a"), 250, "the winner takes both stakes");
  assert.equal(beans("dev-b"), 50);
  assert.equal(end.returned, 200);
  assert.equal(end.stake, 100);
});

test("pool: standing up forfeits, resigning against the bot loses the stake, and stalling passes the turn", () => {
  const { room, add, up, sit, call, beans, advance } = setup([], new MemoryRepository(), 9);
  add("a", "Ann", "dev-a", 100); const b = add("b", "Bob", "dev-b", 100);
  up("a"); up("b"); sit("a", "f2-pl0-1"); sit("b", "f2-pl0-2");
  call("a", "pl:start", { stake: 50, ai: false }); call("b", "pl:accept", { accept: true });
  room.stand("a");
  assert.equal(last(b, "pl:state").phase, "over");
  assert.equal(last(b, "pl:state").winner, 1);
  assert.equal(beans("dev-b"), 150);
  assert.equal(beans("dev-a"), 50);
  sit("a", "f2-pl0-1");
  room.stand("b");
  const a = room.players.get("a")!.conn as any;
  call("a", "pl:start", { stake: 25, ai: true });
  assert.equal(beans("dev-a"), 25);
  call("a", "pl:resign");
  assert.equal(beans("dev-a"), 25, "resigning loses the stake");
  call("a", "pl:start", { stake: 0, ai: true });
  advance(POOL_TURN_MS + 200);
  assert.equal(last(a, "pl:state").turn, 1, "the clock passes the turn to the bot");
});

// ------------------------------------------------------------------ Pixel Fighter II

const boutOf = (room: Room, id: string) => (room.arcade.fighter as any).bouts.get(id);

test("fighter: the CPU ladder starts a server-run match that responds to your buttons", () => {
  const { add, up, call, advance, room } = setup([], new MemoryRepository(), 2);
  const a = add("a", "Ann", "dev-a"); up("a");
  assert.equal(call("a", "fg:join", { char: 9, ladder: true }).ok, false, "no such fighter");
  assert.equal(call("a", "fg:join", { char: -1, ladder: true }).ok, false);
  const j = call("a", "fg:join", { char: 0, ladder: true });
  assert.equal(j.ok, true);
  assert.equal(j.view.mode, "fight");
  assert.equal(j.view.ladder, 0);
  assert.deepEqual(j.view.chars, [0, LADDER[0].char]);
  assert.match(j.view.names[1], /^CPU /);
  advance(2200);
  const v = last(a, "fg:state");
  assert.equal(v.match.phase, "fight");
  const x0 = v.match.f[0].x;
  call("a", "fg:input", { bits: BTN.RIGHT });
  advance(500);
  assert.ok(last(a, "fg:state").match.f[0].x > x0, "holding right walks you right");
  call("a", "fg:input", { bits: "junk" });
  call("a", "fg:input", { bits: 1e9 });
  call("a", "fg:input");
  assert.ok(boutOf(room, "a").e[0].bits >= 0 && boutOf(room, "a").e[0].bits < 128, "only real buttons get through");
  assert.ok(got(a, "fg:state").length > 20, "snapshots stream while you fight");
});

test("fighter: win a ladder bout for beans and a streak; the next stage is a different fighter", () => {
  const { add, up, call, advance, room, beans } = setup([], new MemoryRepository(), 2);
  const a = add("a", "Ann", "dev-a", 100); up("a");
  call("a", "fg:join", { char: 0, ladder: true });
  advance(2200);
  const win = () => { // set up a knock-out until the bout is over (the CPU is a real opponent, so keep trying)
    for (let i = 0; i < 120 && !boutOf(room, "a").ended; i++) {
      const m = boutOf(room, "a").match;
      if (m.phase === "fight") {
        m.f[0].x = 150; m.f[1].x = 172; m.f[0].face = 1; m.f[1].face = -1; m.f[0].hp = CHARACTERS[m.f[0].c].hp; m.f[1].hp = 1;
        call("a", "fg:input", { bits: BTN.LIGHT });
        advance(100);
        call("a", "fg:input", { bits: 0 });
        advance(150);
      } else advance(200);
    }
  };
  win();
  const v = last(a, "fg:state");
  assert.equal(v.mode, "over");
  assert.equal(v.result.won, true);
  assert.equal(v.result.beans, ladderBeans(0));
  assert.equal(v.streak, 1);
  assert.equal(beans("dev-a"), 100 + ladderBeans(0));
  assert.equal(call("a", "arcade:board").view.fighter[0].value, 1);
  const j = call("a", "fg:join", { char: 0, ladder: true });
  assert.equal(j.view.ladder, 1);
  assert.equal(j.view.chars[1], LADDER[1].char);
  advance(2200);
  win();
  assert.equal(last(a, "fg:state").streak, 2);
  assert.equal(call("a", "arcade:board").view.fighter[0].value, 2, "the board keeps the best streak");
});

test("fighter: losing a bout ends the streak but never lowers your best", () => {
  const { add, up, call, advance, room } = setup([], new MemoryRepository(), 2);
  const a = add("a", "Ann", "dev-a", 100); up("a");
  room.arcade.solo.record("fighter", { sockId: "a", clientId: "dev-a", name: "Ann" }, 3);
  call("a", "fg:join", { char: 0, ladder: true });
  advance(2200);
  for (let i = 0; i < 2; i++) {
    const m = boutOf(room, "a").match;
    m.f[0].hp = 1; m.f[0].x = 150; m.f[1].x = 160; m.f[1].face = -1;
    advance(1500);
    advance(FIGHT.KO_PAUSE * 17 + FIGHT.INTRO * 17 + 200);
  }
  const lost = last(a, "fg:state");
  assert.equal(lost.mode, "over");
  assert.equal(lost.result.won, false);
  assert.equal(lost.result.beans, 0);
  assert.equal(lost.streak, 0);
  assert.equal(call("a", "arcade:board").view.fighter[0].value, 3);
});

test("fighter: live 1v1 pairs two players, both send buttons, walking out forfeits, and the winner is paid", () => {
  const { add, up, call, advance, beans } = setup([], new MemoryRepository(), 2);
  const a = add("a", "Ann", "dev-a", 100), b = add("b", "Bob", "dev-b", 100);
  up("a"); up("b");
  const q = call("a", "fg:join", { char: 0, ladder: false });
  assert.equal(q.view.mode, "queue");
  assert.equal(call("a", "fg:join", { char: 1, ladder: false }).view.mode, "queue", "you can't fight yourself");
  call("a", "fg:cancel");
  call("a", "fg:join", { char: 0, ladder: false });
  const m = call("b", "fg:join", { char: 3, ladder: false });
  assert.equal(m.view.mode, "fight");
  assert.equal(m.view.me, 1);
  assert.equal(last(a, "fg:state").mode, "fight");
  assert.deepEqual(last(a, "fg:state").chars, [0, 3]);
  assert.deepEqual(last(a, "fg:state").names, ["Ann", "Bob"]);
  advance(2200);
  const xa = last(a, "fg:state").match.f[0].x, xb = last(b, "fg:state").match.f[1].x;
  call("a", "fg:input", { bits: BTN.LEFT });
  call("b", "fg:input", { bits: BTN.RIGHT });
  advance(400);
  assert.ok(last(a, "fg:state").match.f[0].x < xa, "Ann's buttons move Ann");
  assert.ok(last(a, "fg:state").match.f[1].x > xb, "Bob's buttons move Bob");
  call("a", "fg:cancel");
  const end = last(b, "fg:state");
  assert.equal(end.mode, "over");
  assert.equal(end.result.won, true);
  assert.equal(end.result.beans, PVP_BEANS);
  assert.equal(beans("dev-b"), 100 + PVP_BEANS);
  assert.equal(beans("dev-a"), 100);
  assert.equal(last(a, "fg:state").mode, "menu");
});

// ------------------------------------------------------------------ free-to-play cabinets

test("beat battle: the server replays your judgements, ranks them, saves high scores, and refuses faked runs", () => {
  const { add, up, call, now, beans } = setup([], new MemoryRepository(), 1);
  add("a", "Ann", "dev-a", 100); up("a");
  const n = CHART.length;
  const start = () => call("a", "beat:start").token;
  const finish = (token: number, seq: unknown, wait = SONG_MS + 200) => { now.t += wait; return call("a", "beat:finish", { token, seq }); };
  assert.equal(finish(start(), "S".repeat(n - 1)).ok, false, "wrong length");
  assert.equal(finish(start(), "Q".repeat(n)).ok, false, "bad letters");
  assert.equal(finish(start(), 42).ok, false);
  assert.equal(finish(start(), "S".repeat(n), 5000).ok, false, "a song can't be played in 5 seconds");
  const good = finish(start(), Array.from({ length: n }, (_, i) => (i % 9 === 0 ? "M" : i % 3 ? "S" : "G")).join(""));
  assert.equal(good.ok, true);
  assert.ok(["A", "B"].includes(good.rankLetter), good.rankLetter);
  assert.equal(good.beans, RANK_BEANS[good.rankLetter as "A" | "B"]);
  assert.equal(good.best, true);
  assert.ok(good.score > 0 && good.maxCombo > 5);
  const t = start();
  const better = finish(t, "S".repeat(n));
  assert.equal(better.rankLetter, "S");
  assert.equal(better.best, true);
  assert.equal(better.rank, 1);
  assert.equal(finish(t, "S".repeat(n)).ok, false, "token already used");
  const worse = finish(start(), "G".repeat(n));
  assert.equal(worse.best, false);
  assert.equal(call("a", "arcade:board").view.beat[0].value, better.score);
  const wipeout = finish(start(), "M".repeat(n));
  assert.equal(wipeout.rankLetter, "D");
  assert.equal(wipeout.beans, 0);
  assert.equal(wipeout.best, false, "a failed song is never a high score");
  assert.equal(beans("dev-a"), 100 + good.beans + better.beans + worse.beans);
});

test("free-to-play cabinets can only ever hand out a capped number of beans per window", () => {
  const { add, up, call, now, beans } = setup([], new MemoryRepository(), 1);
  add("a", "Ann", "dev-a", 100); up("a");
  const perfect = "S".repeat(CHART.length);
  const play = () => {
    const t = call("a", "beat:start");
    now.t += SONG_MS + 500;
    return call("a", "beat:finish", { token: t.token, seq: perfect });
  };
  let total = 0;
  for (let i = 0; i < 10; i++) { const r = play(); assert.equal(r.ok, true); total += r.beans; }
  assert.equal(total, FREE_REWARD_CAP);
  assert.equal(beans("dev-a"), 100 + FREE_REWARD_CAP);
  assert.equal(play().beans, 0, "capped for this window");
  now.t += FREE_REWARD_WINDOW_MS;
  assert.equal(play().beans, RANK_BEANS.S, "a new window pays again");
});

test("neon drift: a result is only believed if the lap times are possible and the race took real time", () => {
  const { add, up, call, now, beans } = setup([], new MemoryRepository(), 1);
  add("a", "Ann", "dev-a", 100); add("b", "Ben", "dev-b", 100);
  up("a"); up("b");
  const min = track().minLapMs;
  const lap = min + 4000, total = lap * RACE.LAPS;
  const run = (id: string, over: any, wait = RACE.COUNTDOWN_MS + total) => {
    const t = call(id, "racer:start");
    assert.ok(t.token > 0);
    now.t += wait;
    return { token: t.token, res: call(id, "racer:finish", { token: t.token, totalMs: total, bestLapMs: lap, position: 1, ...over }) };
  };
  assert.equal(run("a", { bestLapMs: min - 1 }).res.ok, false, "faster than the track allows");
  assert.equal(run("a", { totalMs: min * 2 }).res.ok, false, "three laps can't take less than three minimum laps");
  assert.equal(run("a", { bestLapMs: total }).res.ok, false, "best lap can't be longer than the average lap");
  assert.equal(run("a", { position: RACE.FIELD + 1 }).res.ok, false, "only an 8-car field");
  assert.equal(run("a", { position: 0 }).res.ok, false);
  assert.equal(run("a", { totalMs: 1.5 }).res.ok, false);
  assert.equal(run("a", {}, 1000).res.ok, false, "finished faster than real time");
  const ok = run("a", {});
  assert.equal(ok.res.ok, true);
  assert.equal(ok.res.beans, raceBeans(1));
  assert.equal(ok.res.best, true);
  assert.equal(ok.res.rank, 1);
  assert.equal(beans("dev-a"), 100 + raceBeans(1));
  assert.equal(call("a", "racer:finish", { token: ok.token, totalMs: total, bestLapMs: lap, position: 1 }).ok, false, "a run can be submitted once");
  const faster = run("b", { bestLapMs: lap - 1500, totalMs: total - 3000, position: 2 });
  assert.equal(faster.res.beans, raceBeans(2));
  assert.equal(faster.res.rank, 1, "lower is better on this board");
  const board = call("a", "arcade:board").view.drift;
  assert.deepEqual(board.map((r: any) => [r.name, r.value]), [["Ben", lap - 1500], ["Ann", lap]]);
  assert.equal(call("a", "racer:finish", { token: 1, totalMs: total, bestLapMs: lap, position: 1 }).ok, false, "no run in progress");
});

test("leaderboard kiosk: all six boards come back, each sorted the right way and flagged mine", () => {
  const { add, up, call, repo } = setup();
  add("a", "Ann", "dev-a"); add("b", "Bob", "dev-b"); up("a"); up("b");
  repo.setBest("penguin", "dev-a", { name: "Ann", value: 5.5, ts: 1 }); repo.setBest("penguin", "dev-b", { name: "Bob", value: 12.25, ts: 2 });
  repo.setBest("moon", "dev-b", { name: "Bob", value: 3, ts: 1 });
  repo.setBest("drift", "dev-a", { name: "Ann", value: 25000, ts: 1 }); repo.setBest("drift", "dev-b", { name: "Bob", value: 22000, ts: 2 });
  repo.setBest("beat", "dev-a", { name: "Ann", value: 90000, ts: 1 }); repo.setBest("beat", "dev-b", { name: "Bob", value: 50000, ts: 2 });
  repo.setBest("fighter", "dev-a", { name: "Ann", value: 7, ts: 1 });
  const v = call("a", "arcade:board").view;
  assert.deepEqual(Object.keys(v).sort(), ["beat", "drift", "fighter", "moon", "penguin", "rich"]);
  assert.deepEqual(v.penguin.map((r: any) => r.name), ["Bob", "Ann"]);
  assert.deepEqual(v.drift.map((r: any) => r.name), ["Bob", "Ann"], "fastest lap first");
  assert.deepEqual(v.beat.map((r: any) => r.name), ["Ann", "Bob"]);
  assert.deepEqual(v.fighter.map((r: any) => [r.name, r.value, r.mine]), [["Ann", 7, true]]);
  assert.equal(v.penguin.find((r: any) => r.name === "Ann").mine, true);
});

// ------------------------------------------------------------------ seats, floors, sockets

test("new tables: poker and pool seats exist on Floor 2 only, and the new cabinets need Floor 2", () => {
  const { add, sit, call, up } = setup();
  add("a", "Ann", "dev-a");
  for (const seat of ["f2-pk0-1", "f2-pk0-6", "f2-pl0-1", "f2-pl0-2"]) assert.equal(sit("a", seat).ok, false, `${seat} from Floor 1`);
  for (const ev of ["penguin:start", "pk:buyin", "pl:start", "fg:join", "racer:start", "beat:start"]) assert.equal(call("a", ev, {}).ok, false, ev);
  up("a");
  assert.equal(sit("a", "f2-pk0-6").ok, true);
  assert.equal(call("a", "pl:start", { stake: 0, ai: true }).ok, false, "seated at poker, not pool");
  assert.equal(buildSeats().filter((s) => s.id.startsWith("f2-pk0")).length, 6);
  assert.equal(buildSeats().filter((s) => s.id.startsWith("f2-pl0")).length, 2);
});

test("real sockets: penguin, poker seat state, and a fight stream over Socket.IO", async () => {
  const { createCafeServer } = await import("./app.ts");
  const { io: connect } = await import("socket.io-client");
  const srv = createCafeServer();
  await new Promise<void>((r) => srv.http.listen(0, r));
  const url = `http://localhost:${(srv.http.address() as any).port}`;
  const s = connect(url, { transports: ["websocket"], forceNew: true });
  const waitFor = <T,>(event: string, pred: (p: T) => boolean = () => true, ms = 6000) =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => { s.off(event, h); reject(new Error(`timeout waiting for ${event}`)); }, ms);
      const h = (p: T) => { if (pred(p)) { clearTimeout(t); s.off(event, h); resolve(p); } };
      s.on(event, h);
    });
  const ask = (ev: string, d?: any) => (d === undefined ? s.timeout(2000).emitWithAck(ev) : s.timeout(2000).emitWithAck(ev, d));
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  try {
    const j = await ask("join", { clientId: "k1", name: "Kim", pixels, beans: 300 });
    assert.equal(j.ok, true);
    s.emit("move", { x: STAIRS[1].spot.x, y: STAIRS[1].spot.y, flip: false, moving: false });
    await pause(100);
    assert.equal((await ask("floor:go", { floor: 2 })).ok, true);

    assert.equal((await ask("penguin:start", { bet: 10, lane: "calm" })).ok, true);
    assert.equal((await ask("penguin:step")).ok, true);
    assert.equal((await ask("penguin:state")).view.lane, "calm");
    assert.equal((await ask("penguin:start", { bet: 10, lane: "calm" })).ok, false);

    const seat = buildSeats().find((x) => x.id === "f2-pk0-2")!;
    s.emit("move", { x: seat.exit.x, y: seat.exit.y, flip: false, moving: false });
    await pause(100);
    const seated = waitFor<any>("pk:state", (v) => !!v && v.mySeat === 1);
    assert.equal((await ask("sit", { seatId: "f2-pk0-2" })).ok, true);
    assert.equal((await seated).phase, "wait");
    const upd = waitFor<any>("pk:state", (v) => !!v && v.seats[1]?.stack === 200);
    assert.equal((await ask("pk:buyin", { amount: 200 })).ok, true);
    assert.equal((await upd).seats[1].stack, 200);
    assert.equal((await ask("pk:bot", { add: true })).ok, true);
    const hand = await waitFor<any>("pk:state", (v) => !!v && v.phase === "preflop", 8000);
    assert.equal(hand.seats[1].cards.length, 2);
    assert.deepEqual(hand.seats[hand.seats.findIndex((x: any) => x?.bot)].cards, ["??", "??"]);

    s.emit("stand");
    await pause(100);
    const fighting = waitFor<any>("fg:state", (v) => v?.mode === "fight" && v.match?.phase === "fight", 8000);
    const jf = await ask("fg:join", { char: 2, ladder: true });
    assert.equal(jf.ok, true);
    assert.equal(jf.view.chars[0], 2);
    const state = await fighting;
    assert.equal(state.match.f.length, 2);
    s.emit("fg:input", { bits: BTN.RIGHT }); // no ack expected
    assert.ok(await waitFor<any>("fg:state", (v) => !!v?.match && v.match.f[0].x > state.match.f[0].x + 5));
    assert.equal((await ask("fg:cancel")).ok, true);
    assert.equal(CHARACTERS.length, 4);
  } finally {
    s.close();
    await srv.close();
  }
});
