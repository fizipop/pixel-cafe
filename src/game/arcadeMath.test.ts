import test from "node:test";
import assert from "node:assert/strict";
import {
  CRASH_CAP, MIN_BET, MAX_BET, MINES_TILES, SLOT_PAYS, SLOT_SYMBOLS, WHEEL_ORDER, crashMultAt, crashPoint, crashTimeAt,
  handValue, minesMultiplier, newShoe, placeMines, rouletteColor, rouletteReturn, slotMultiplier, slotRtp, spinReel, validBet,
  validMineCount, validRouletteBet, blackjackReturn,
} from "../shared/arcade.ts";
import { mulberry32 } from "./iceJump.ts";
import { arcadeStep, arcadeStepSeconds, ARCADE_BPM } from "../lib/arcadeMusic.ts";
import { FLOOR2_X, FLOOR_NAMES, STAIRS, clampToFloor, floorOfSeat, floorOfX } from "../shared/floors.ts";
import { MACHINES, arcadeSeatInfo, arcadeSeats, BLACKJACK, ROULETTE } from "./arcadeLayout.ts";
import { WALL_H, WORLD_H, WORLD_W, TILE } from "./constants.ts";

test("bets: whole beans between the table limits only", () => {
  assert.ok(validBet(MIN_BET) && validBet(MAX_BET) && validBet(50));
  for (const bad of [0, 4, 501, 7.5, -10, NaN, Infinity, "10", null, undefined]) assert.equal(validBet(bad), false, String(bad));
});

test("slots: pay table, pairs, and the house keeps an edge (return ~93%)", () => {
  assert.equal(slotMultiplier(["seven", "seven", "seven"]), SLOT_PAYS.seven);
  assert.equal(slotMultiplier(["cup", "cup", "cup"]), SLOT_PAYS.cup);
  assert.equal(slotMultiplier(["cat", "cat", "bean"]), 0.5);
  assert.equal(slotMultiplier(["cat", "bean", "cat"]), 0);
  assert.equal(slotMultiplier(["bean", "cat", "cat"]), 0);
  const rtp = slotRtp();
  assert.ok(rtp > 0.85 && rtp < 0.99, `rtp ${rtp}`);
  // five distinct symbols, rarer = better
  assert.equal(SLOT_SYMBOLS.length, 5);
  const sorted = [...SLOT_SYMBOLS].sort((a, b) => SLOT_PAYS[a] - SLOT_PAYS[b]);
  assert.deepEqual(sorted, ["cup", "croissant", "bean", "cat", "seven"]);
  // simulated rtp is close to the exact one
  const rng = mulberry32(42);
  let paid = 0;
  const N = 200_000;
  for (let i = 0; i < N; i++) paid += slotMultiplier([spinReel(rng), spinReel(rng), spinReel(rng)]);
  assert.ok(Math.abs(paid / N - rtp) < 0.03, `simulated ${paid / N} vs ${rtp}`);
});

test("mines: multiplier rises with every safe tile and with more hazards; fair edge", () => {
  assert.equal(minesMultiplier(3, 0), 1);
  assert.equal(minesMultiplier(1, 1), 1.01);
  assert.equal(minesMultiplier(3, 1), 1.1);
  assert.equal(minesMultiplier(24, 1), 24.25);
  for (let m = 1; m <= 24; m++) {
    let prev = 1;
    for (let k = 1; k <= MINES_TILES - m; k++) {
      const cur = minesMultiplier(m, k);
      assert.ok(cur >= prev, `m=${m} k=${k}`);
      prev = cur;
    }
    assert.ok(minesMultiplier(m, 1) <= minesMultiplier(Math.min(24, m + 1), 1));
  }
  // exact expected value of "reveal k tiles then cash out" is 97% for every k
  for (const [m, k] of [[3, 2], [5, 4], [10, 3]]) {
    let p = 1;
    for (let i = 0; i < k; i++) p *= (MINES_TILES - m - i) / (MINES_TILES - i);
    assert.ok(Math.abs(p * (minesMultiplier(m, k) + 0.005) - 0.97) < 0.02);
  }
  assert.ok(validMineCount(1) && validMineCount(24) && !validMineCount(0) && !validMineCount(25) && !validMineCount(2.5));
});

test("mines: hazards are distinct, in range, and the right count", () => {
  const rng = mulberry32(5);
  for (let m = 1; m <= 24; m++) {
    const h = placeMines(m, rng);
    assert.equal(h.length, m);
    assert.equal(new Set(h).size, m);
    assert.ok(h.every((t) => t >= 0 && t < MINES_TILES));
  }
});

test("crash: curve is increasing, point distribution has a ~4% edge, capped", () => {
  assert.equal(crashMultAt(0), 1);
  assert.ok(crashMultAt(6400) >= 2 && crashMultAt(6400) < 2.1);
  assert.ok(crashMultAt(1000) < crashMultAt(2000));
  assert.ok(crashTimeAt(2) > 6000 && crashTimeAt(2) < 6500);
  assert.equal(crashPoint(0), 1);
  assert.equal(crashPoint(0.03), 1);
  assert.equal(crashPoint(0.5), 1.92);
  assert.equal(crashPoint(0.999999), CRASH_CAP);
  // P(point >= x) = 0.96 / x: bet-and-auto-cash at x returns 96% on average
  const rng = mulberry32(9);
  const N = 100_000;
  let ge2 = 0;
  for (let i = 0; i < N; i++) if (crashPoint(rng()) >= 2) ge2++;
  assert.ok(Math.abs(ge2 / N - 0.48) < 0.01, `${ge2 / N}`);
});

test("roulette: 37 pockets, colours, payouts", () => {
  assert.equal(WHEEL_ORDER.length, 37);
  assert.deepEqual([...WHEEL_ORDER].sort((a, b) => a - b), Array.from({ length: 37 }, (_, i) => i));
  assert.equal(rouletteColor(0), "green");
  assert.equal(rouletteColor(1), "red");
  assert.equal(rouletteColor(2), "black");
  assert.equal(rouletteColor(36), "red");
  const reds = Array.from({ length: 36 }, (_, i) => i + 1).filter((n) => rouletteColor(n) === "red").length;
  assert.equal(reds, 18);
  const bet = (kind: string, amount = 10, n?: number) => ({ kind, amount, n }) as never;
  assert.equal(rouletteReturn(bet("red"), 1), 20);
  assert.equal(rouletteReturn(bet("red"), 2), 0);
  assert.equal(rouletteReturn(bet("black"), 2), 20);
  assert.equal(rouletteReturn(bet("odd"), 7), 20);
  assert.equal(rouletteReturn(bet("even"), 8), 20);
  assert.equal(rouletteReturn(bet("low"), 18), 20);
  assert.equal(rouletteReturn(bet("high"), 19), 20);
  assert.equal(rouletteReturn(bet("num", 10, 17), 17), 360);
  assert.equal(rouletteReturn(bet("num", 10, 17), 18), 0);
  for (const k of ["red", "black", "odd", "even", "low", "high"]) assert.equal(rouletteReturn(bet(k), 0), 0, `zero loses ${k}`);
  assert.equal(rouletteReturn(bet("num", 10, 0), 0), 360);
  // expected return of every bet type is 36/37
  for (const [b, name] of [[bet("red"), "red"], [bet("odd"), "odd"], [bet("low"), "low"], [bet("num", 10, 5), "num"]] as const) {
    let total = 0;
    for (let n = 0; n <= 36; n++) total += rouletteReturn(b, n);
    assert.ok(Math.abs(total / 37 / 10 - 36 / 37) < 1e-9, name);
  }
  assert.ok(validRouletteBet({ kind: "num", n: 36, amount: 5 }));
  for (const bad of [{ kind: "num", n: 37, amount: 5 }, { kind: "num", amount: 5 }, { kind: "red", amount: 1 }, { kind: "x", amount: 5 }, null, 4]) assert.equal(validRouletteBet(bad), false);
});

test("blackjack: shoe, totals and payouts", () => {
  const shoe = newShoe(mulberry32(1));
  assert.equal(shoe.length, 208);
  assert.equal(new Set(shoe).size, 52);
  assert.equal(handValue(["KS", "QD", "2C"]).total, 22);
  assert.equal(handValue(["AS", "AD"]).total, 12);
  assert.equal(blackjackReturn("blackjack", 5), 5 + 7); // 3:2 rounds the winnings down
  assert.equal(blackjackReturn("win", 5), 10);
});

test("floors: names, coordinates and elevators", () => {
  assert.equal(FLOOR_NAMES[1], "Floor 1 · Main Cafe");
  assert.equal(FLOOR_NAMES[2], "Floor 2 · Arcade");
  assert.equal(floorOfX(500), 1);
  assert.equal(floorOfX(FLOOR2_X + 10), 2);
  assert.deepEqual(clampToFloor(2, 0, -10), { x: FLOOR2_X, y: 0 });
  assert.deepEqual(clampToFloor(1, 99999, 99999), { x: WORLD_W, y: WORLD_H });
  assert.equal(floorOfSeat("t1-left"), 1);
  assert.equal(floorOfSeat("f2-bj0-1"), 2);
  assert.ok(STAIRS[2].spot.x - STAIRS[1].spot.x === FLOOR2_X);
});

test("arcade layout: machines, seats and elevators sit inside the room and don't overlap", () => {
  const x0 = FLOOR2_X;
  const inside = (x: number, y: number) => x > x0 + TILE && x < x0 + WORLD_W - TILE && y > WALL_H && y < WORLD_H - TILE;
  const games = MACHINES.filter((m) => m.game).map((m) => m.game);
  for (const g of ["slots", "mines", "moon", "ice", "board"]) assert.ok(games.includes(g as never), g);
  for (const m of MACHINES) {
    assert.ok(inside(m.spot.x, m.spot.y), `${m.id} spot`);
    assert.ok(m.solid.x >= x0 && m.solid.x + m.solid.w <= x0 + WORLD_W, m.id);
  }
  const seats = arcadeSeats();
  assert.equal(seats.length, BLACKJACK.seats + ROULETTE.seats);
  assert.equal(new Set(seats.map((s) => s.id)).size, seats.length);
  for (const s of seats) {
    assert.ok(inside(s.exit.x, s.exit.y), `${s.id} exit`);
    assert.ok(arcadeSeatInfo(s.id));
    assert.equal(floorOfSeat(s.id), 2);
  }
  assert.deepEqual(arcadeSeatInfo("f2-bj0-3"), { table: "bj0", index: 2 });
  assert.equal(arcadeSeatInfo("t1-left"), null);
  assert.ok(inside(STAIRS[2].spot.x, STAIRS[2].spot.y) && inside(STAIRS[2].arrive.x, STAIRS[2].arrive.y));
  // nothing is built on top of the elevator or its landing spot
  const s2 = STAIRS[2];
  const blocks = (r: { x: number; y: number; w: number; h: number }, p: { x: number; y: number }) => p.x >= r.x - 8 && p.x <= r.x + r.w + 8 && p.y >= r.y - 8 && p.y <= r.y + r.h + 8;
  for (const m of MACHINES) assert.ok(!blocks(m.solid, s2.arrive), m.id);
  assert.ok(!blocks({ x: BLACKJACK.x + 4, y: BLACKJACK.y + 22, w: BLACKJACK.w - 8, h: 44 }, s2.arrive));
});

test("arcade music: a 64-step chiptune loop in A minor with bass, lead and drums", () => {
  assert.equal(ARCADE_BPM, 108);
  assert.ok(Math.abs(arcadeStepSeconds() - 60 / 108 / 4) < 1e-9);
  const steps = Array.from({ length: 64 }, (_, i) => arcadeStep(i));
  assert.ok(steps.every((s) => s.arp > 100 && s.arp < 2000));
  assert.ok(steps.filter((s) => s.bass).length >= 20);
  assert.ok(steps.filter((s) => s.lead).length >= 12);
  assert.ok(steps.filter((s) => s.kick).length >= 12 && steps.filter((s) => s.snare).length === 8 && steps.filter((s) => s.hat).length === 32);
  assert.deepEqual(arcadeStep(64), arcadeStep(0)); // it loops
  assert.ok(Math.abs(steps[0].bass! - 110) < 0.01); // bar 1 root is A2
});
