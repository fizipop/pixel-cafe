/* eslint-disable @typescript-eslint/no-explicit-any */
// Server side of the arcade polish: Beat Battle remembers the difficulty you started, and the pool table
// enforces ball in hand and the called pocket for the 8-ball.
import test from "node:test";
import assert from "node:assert/strict";
import { Room, type Conn } from "./room.ts";
import { MemoryRepository } from "./repository.ts";
import { buildSeats } from "../src/game/layout.ts";
import { STAIRS } from "../src/shared/floors.ts";
import { mulberry32 } from "../src/shared/arcade.ts";
import { beansFor, chartFor, songMsFor, type Difficulty } from "../src/shared/beat.ts";
import { RACE } from "../src/shared/racer.ts";
import { POOL, type PoolGame } from "../src/shared/pool.ts";

type Msg = { event: string; payload: any };
function fake(id: string): Conn & { log: Msg[] } {
  const log: Msg[] = [];
  return { id, log, emit: (event, payload) => void log.push({ event, payload }), emitVolatile: (event, payload) => void log.push({ event, payload }) };
}
const pixels = Array.from({ length: 1024 }, (_, i) => (i % 7 === 0 ? "#ff0000" : ""));
const last = (c: { log: Msg[] }, ev: string) => c.log.filter((m) => m.event === ev).at(-1)?.payload;

function setup(seed = 1) {
  const now = { t: Date.UTC(2026, 10, 24, 15, 0, 0) };
  const rng = mulberry32(seed);
  const room = new Room({ now: () => now.t, schedule: () => {}, repo: new MemoryRepository(), rng });
  const add = (id: string, name = id, clientId = id, beans = 500) => {
    const c = fake(id);
    assert.equal(room.join(c, { clientId, name, pixels, beans }).ok, true);
    return c;
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
  return { room, add, up, sit, call, beans, now };
}

test("beat battle: the server grades a run against the difficulty you started, with its own song length and bean multiplier", () => {
  const { add, up, call, now, beans } = setup();
  add("a", "Ann", "dev-a", 100); up("a");
  const run = (diff: unknown, seqFor: Difficulty, letter: string, wait: number) => {
    const t = call("a", "beat:start", diff === undefined ? undefined : { diff });
    now.t += wait;
    return call("a", "beat:finish", { token: t.token, seq: letter.repeat(chartFor(seqFor).length) });
  };
  assert.equal(run("hard", "normal", "S", songMsFor("hard") + 100).ok, false, "a Normal-length run is refused on Hard");
  assert.equal(run("easy", "easy", "S", 3000).ok, false, "too fast for the Easy song");
  const easy = run("easy", "easy", "S", songMsFor("easy") + 100);
  assert.equal(easy.ok, true);
  assert.equal(easy.rankLetter, "S");
  assert.equal(easy.beans, beansFor("S", "easy"));
  const insane = run("insane", "insane", "S", songMsFor("insane") + 100);
  assert.equal(insane.beans, beansFor("S", "insane"));
  assert.ok(insane.beans > easy.beans, "harder pays more");
  assert.ok(insane.score > easy.score, "and has more arrows to score on");
  const odd = run("nightmare", "normal", "S", songMsFor("normal") + 100);
  assert.equal(odd.ok, true, "an unknown level quietly becomes Normal");
  const plain = run(undefined, "normal", "G", songMsFor("normal") + 100);
  assert.equal(plain.ok, true);
  assert.equal(beans("dev-a"), 100 + easy.beans + insane.beans + odd.beans + plain.beans);
});

test("racer: the server accepts any finishing position in the 20-car field", () => {
  const { add, up, call, now } = setup();
  add("a", "Ann", "dev-a"); up("a");
  const t = call("a", "racer:start");
  const lap = 30000;
  now.t += RACE.COUNTDOWN_MS + lap * RACE.LAPS;
  assert.equal(call("a", "racer:finish", { token: t.token, totalMs: lap * RACE.LAPS, bestLapMs: lap, position: 17 }).ok, true);
});

const poolSetup = () => {
  const s = setup(5);
  const a = s.add("a", "Ann", "dev-a"); s.add("b", "Bob", "dev-b");
  s.up("a"); s.up("b");
  s.sit("a", "f2-pl0-1");
  assert.equal(s.call("a", "pl:start", { stake: 0, ai: true }).ok, true);
  const engine = s.room.arcade.pool as any;
  const put = (over: Partial<Omit<PoolGame, "balls">> & { balls: { id: number; x: number; y: number }[] }) => {
    engine.game = { turn: 0, groups: [null, null], breaking: false, ...over, balls: over.balls.map((b) => ({ ...b, vx: 0, vy: 0, out: false })) };
    engine.timeouts = 0;
  };
  return { ...s, a, put, engine };
};

test("pool server: ball in hand lets you place the cue ball, and refuses illegal spots", () => {
  const { a, call, put } = poolSetup();
  assert.equal(last(a, "pl:state").inHand, false, "the break is not a ball in hand");
  const table = [{ id: 0, x: 400, y: 200 }, { id: 3, x: 520, y: 200 }, { id: 12, x: 600, y: 100 }];
  put({ balls: table, inHand: false, groups: ["solid", "stripe"] });
  assert.equal(call("a", "pl:shot", { angle: 0, power: 0.3, cue: { x: 300, y: 100 } }).ok, false, "no ball in hand yet");
  put({ balls: table, inHand: true, groups: ["solid", "stripe"] });
  assert.equal(call("a", "pl:shot", { angle: 0, power: 0.3, cue: { x: 521, y: 205 } }).ok, false, "touching another ball");
  assert.equal(call("a", "pl:shot", { angle: 0, power: 0.3, cue: { x: -3, y: 100 } }).ok, false, "off the cloth");
  assert.equal(call("a", "pl:shot", { angle: 0, power: 0.3, cue: { x: "x", y: 100 } }).ok, false, "garbage");
  const ok = call("a", "pl:shot", { angle: 0, power: 0.3, cue: { x: 150, y: 300 } });
  assert.equal(ok.ok, true);
  const v = last(a, "pl:state");
  const cueFrom = v.shot.from.find((b: any) => b.id === 0);
  assert.deepEqual([cueFrom.x, cueFrom.y], [150, 300], "the replay starts from the spot you chose");
});

test("pool server: a foul hands the opponent ball in hand, and the bot plays its turn from hand", () => {
  const { a, call, put, engine } = poolSetup();
  put({ balls: [{ id: 0, x: 300, y: 200 }, { id: 3, x: 330, y: 200 }, { id: 12, x: 700, y: 330 }], groups: ["solid", "stripe"] });
  // hit the stripe first with a solid group: a foul
  engine.game.balls[2].x = 330; engine.game.balls[2].y = 200; engine.game.balls[1].x = 700; engine.game.balls[1].y = 330;
  assert.equal(call("a", "pl:shot", { angle: 0, power: 0.2 }).ok, true);
  const v = last(a, "pl:state");
  assert.equal(v.turn, 1);
  assert.equal(v.inHand, true, "the bot has the cue ball in hand");
  assert.match(v.msg, /Foul/);
  // the bot answers on its next tick (placing the cue ball itself)
  engine.botAt = 0;
  engine.tick(engine.ctx.now() + 5000);
  const after = last(a, "pl:state");
  assert.ok(after.shot.seq >= 2, "the bot took its shot from hand");
  assert.equal(after.kitchen, false);
});

test("pool server: with only the 8 left you must call a pocket, and the wrong pocket loses", () => {
  const { a, call, put, engine } = poolSetup();
  const table = [{ id: 0, x: 600, y: 140 }, { id: 8, x: 600, y: POOL.R + 2 }, { id: 12, x: 100, y: 300 }];
  put({ balls: table, groups: ["solid", "stripe"] });
  engine.push();
  assert.deepEqual(last(a, "pl:state").targets, [8], "the view tells the client the 8 is the only legal target");
  assert.equal(call("a", "pl:shot", { angle: -Math.PI / 2, power: 0.5 }).ok, false, "no pocket called");
  assert.equal(call("a", "pl:shot", { angle: -Math.PI / 2, power: 0.5, pocket: 9 }).ok, false, "no such pocket");
  assert.equal(call("a", "pl:shot", { angle: -Math.PI / 2, power: 0.5, pocket: 1.5 }).ok, false);
  // the 8 sits next to the top rail; knocking it along the cushion into the corner pocket (index 2) while calling the side pocket (1) loses
  put({ balls: [{ id: 0, x: 500, y: POOL.R + 2 }, { id: 8, x: 600, y: POOL.R + 2 }, { id: 12, x: 100, y: 300 }], groups: ["solid", "stripe"] });
  const r = call("a", "pl:shot", { angle: 0, power: 0.7, pocket: 1 });
  assert.equal(r.ok, true);
  const v = last(a, "pl:state");
  assert.equal(v.phase, "over");
  assert.equal(v.winner, 1, "the 8 went in a different pocket than the one called");
  assert.match(v.msg, /wrong pocket/);
});
