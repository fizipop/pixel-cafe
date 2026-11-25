/* eslint-disable @typescript-eslint/no-explicit-any */
// The casino wing's server side: Plinko, the two Huff & Xtra Puff machines and the lottery booth. Every result is
// rolled and paid inside one request, stakes can't exceed the wallet, and the browser can't steer or repeat a payout.
import test from "node:test";
import assert from "node:assert/strict";
import { Room, type Conn } from "./room.ts";
import { MemoryRepository } from "./repository.ts";
import { STAIRS } from "../src/shared/floors.ts";
import { mulberry32 } from "../src/shared/arcade.ts";
import { LOTTERY, PLINKO_ROWS, plinkoMult, plinkoRun, plinkoSlot } from "../src/shared/casino.ts";

function fake(id: string): Conn & { log: { event: string; payload: any }[] } {
  const log: { event: string; payload: any }[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixels = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? "#ff0000" : ""));

function setup(rngValues: number[] = [], seed = 0) {
  const now = { t: Date.UTC(2026, 10, 24, 15, 0, 0) };
  const queue = [...rngValues];
  const fallback = seed ? mulberry32(seed) : () => 0.5;
  const room = new Room({ now: () => now.t, schedule: () => {}, repo: new MemoryRepository(), rng: () => (queue.length ? (queue.shift() as number) : fallback()) });
  const add = (id: string, beans = 500) => { assert.equal(room.join(fake(id), { clientId: id, name: id, pixels, beans }).ok, true); };
  const up = (id: string) => {
    const p = room.players.get(id)!;
    p.state.x = STAIRS[1].spot.x; p.state.y = STAIRS[1].spot.y;
    assert.equal(room.goFloor(id, { floor: 2 }).ok, true);
  };
  const call = (id: string, ev: any, d?: any) => room.arcadeEvent(id, ev, d) as any;
  const beans = (id: string) => room.arcade.wallets.balance(id);
  return { room, add, up, call, beans };
}

test("plinko: the server rolls the seed, the replayed path lands in the paid slot, and the wallet moves by exactly bet and win", () => {
  const { add, up, call, beans } = setup([], 11);
  add("a", 500); up("a");
  for (let k = 0; k < 40; k++) {
    const before = beans("a");
    const gate = (k % 3) as 0 | 1 | 2;
    const r = call("a", "plinko:drop", { bet: 10, gate });
    assert.equal(r.ok, true);
    assert.equal(r.path.length, PLINKO_ROWS);
    const replay = plinkoRun(r.seed, gate);
    assert.deepEqual(replay.path, r.path, "the browser replays exactly the path that was paid");
    assert.equal(replay.slot, r.slot);
    assert.equal(plinkoSlot(gate, r.path), r.slot);
    assert.equal(r.mult, plinkoMult(gate, r.slot));
    assert.equal(r.win, Math.floor(10 * r.mult));
    assert.equal(beans("a"), before - 10 + r.win, "debited once, credited once");
    assert.equal(r.beans, beans("a"));
  }
});

test("plinko: rejects bad bets and gates, and never bets beans you don't have", () => {
  const { add, up, call, beans } = setup();
  add("a", 12); up("a");
  const start = beans("a");
  for (const bad of [{ bet: 3, gate: 1 }, { bet: 10.5, gate: 1 }, { bet: "10", gate: 1 }, { bet: 10, gate: 3 }, { bet: 10, gate: -1 }, { bet: 10 }]) assert.equal(call("a", "plinko:drop", bad).ok, false, JSON.stringify(bad));
  assert.equal(beans("a"), start, "a rejected drop costs nothing");
  assert.equal(call("a", "plinko:drop", { bet: start + 5, gate: 1 }).ok, false, "can't bet more than the wallet");
  assert.equal(beans("a"), start);
});

test("huff & xtra puff: both machines settle a spin (and any bonus) in one request and pay exactly the reported total", () => {
  const { add, up, call, beans } = setup([], 5);
  add("a", 500); up("a");
  let bonuses = 0;
  for (let k = 0; k < 200; k++) {
    if (beans("a") < 50) call("a", "huff:spin", { machine: "huff", bet: 5 }); // keep going
    const machine = k % 2 ? "huff" : "huffBonus";
    const before = beans("a");
    if (before < 10) break;
    const r = call("a", "huff:spin", { machine, bet: 10 });
    assert.equal(r.ok, true);
    assert.equal(r.machine, machine);
    const sum = r.spins.reduce((n: number, s: any) => n + s.win, 0) + (r.bonus?.mansion ? 10 * 50 : 0);
    assert.equal(r.total, sum, "the total is the sum of the spins shown");
    assert.equal(beans("a"), before - 10 + r.total);
    assert.equal(r.spins.filter((s: any) => !s.free).length, 1, "one paid spin per request");
    if (r.bonus) { bonuses++; assert.ok(r.spins.length > 1, "the free spins came back with it"); }
  }
  void bonuses;
  assert.equal(call("a", "huff:spin", { machine: "nope", bet: 10 }).ok, false);
  assert.equal(call("a", "huff:spin", { machine: "huff", bet: 1 }).ok, false);
  assert.equal(call("a", "huff:spin", { machine: "huff", bet: 1e6 }).ok, false);
});

test("lottery: costs exactly 20, draws 1-1000 after the entry is paid, an exact match pays 10,000 once", () => {
  // first rng value is the draw: 0.4995 -> 1 + floor(0.4995 * 1000) = 500
  const { add, up, call, beans } = setup([0.4995, 0.4995]);
  add("a", 100); up("a");
  const r = call("a", "lottery:enter", { pick: 500 });
  assert.equal(r.ok, true);
  assert.equal(r.draw, 500);
  assert.equal(r.won, true);
  assert.equal(r.win, LOTTERY.JACKPOT);
  assert.equal(beans("a"), 100 - LOTTERY.COST + LOTTERY.JACKPOT);
  const r2 = call("a", "lottery:enter", { pick: 7 }); // a new entry is a new, independent ticket
  assert.equal(r2.ok, true);
  assert.equal(r2.won, false);
  assert.ok(r2.ticket > r.ticket);
  assert.equal(beans("a"), 100 - 2 * LOTTERY.COST + LOTTERY.JACKPOT, "the jackpot was paid once, the second ticket only cost 20");
  for (const bad of [0, 1001, 3.5, "5", null, -1]) assert.equal(call("a", "lottery:enter", { pick: bad }).ok, false, String(bad));
});

test("lottery: an entry you can't afford is refused without changing anything", () => {
  const { add, up, call, beans } = setup();
  add("a", 50); up("a");
  // drain to below the entry cost with plinko is random, so set the wallet directly through entries
  while (beans("a") >= LOTTERY.COST) assert.equal(call("a", "lottery:enter", { pick: 1 }).ok, true);
  const left = beans("a");
  assert.equal(call("a", "lottery:enter", { pick: 1 }).ok, false);
  assert.equal(beans("a"), left);
});

test("casino games only work on Floor 2", () => {
  const { add, call } = setup();
  add("a", 500);
  for (const [ev, d] of [["plinko:drop", { bet: 10, gate: 1 }], ["huff:spin", { machine: "huff", bet: 10 }], ["lottery:enter", { pick: 5 }]] as const) assert.equal(call("a", ev, d).ok, false, ev);
});
