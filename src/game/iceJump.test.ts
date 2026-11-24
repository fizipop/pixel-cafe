import test from "node:test";
import assert from "node:assert/strict";
import { ICE, newGame, step, mulberry32, type IceInput } from "./iceJump.ts";
import { iceBeans, ICE_MAX_BEANS } from "../shared/arcade.ts";

const idle = (): IceInput => ({ left: false, right: false, jump: false });
const run = (s: ReturnType<typeof newGame>, secs: number, input: () => IceInput = idle) => {
  for (let t = 0; t < secs; t += 1 / 60) step(s, 1 / 60, input());
};

test("ice jump: same seed, same river", () => {
  const a = newGame(7), b = newGame(7), c = newGame(8);
  assert.deepEqual(a.floes.map((f) => [f.x, f.w, f.cracky]), b.floes.map((f) => [f.x, f.w, f.cracky]));
  assert.notDeepEqual(a.floes.map((f) => f.x), c.floes.map((f) => f.x));
  assert.equal(mulberry32(1)(), mulberry32(1)());
});

test("ice jump: a jump goes up and lands back on the start floe", () => {
  const s = newGame(1);
  s.floes = [s.floes[0]]; // an empty river: nothing above to land on
  step(s, 1 / 60, { left: false, right: false, jump: true });
  assert.ok(s.cat.vy > 0 && s.cat.onFloe === null);
  assert.ok(s.events.includes("jump"));
  let peak = 0;
  for (let i = 0; i < 120 && s.cat.onFloe === null; i++) { step(s, 1 / 60, idle()); peak = Math.max(peak, s.cat.y); }
  assert.ok(peak > ICE.ROW && peak < ICE.ROW * 3, `peak ${peak}`);
  assert.equal(s.cat.onFloe, 1);
  assert.equal(s.cat.y, 0);
  assert.equal(s.score, 0);
});

test("ice jump: landing on the next row scores 10 and the camera follows", () => {
  const s = newGame(2);
  s.floes = s.floes.filter((x) => x.row <= 1); // nothing on row 2 to catch us first
  const f = s.floes.find((x) => x.row === 1)!;
  f.vx = 0;
  f.x = s.cat.x - f.w / 2;
  step(s, 1 / 60, { left: false, right: false, jump: true });
  for (let i = 0; i < 120 && s.cat.onFloe !== f.id; i++) step(s, 1 / 60, idle());
  assert.equal(s.cat.onFloe, f.id);
  assert.equal(s.rows, 1);
  assert.equal(s.score, 10);
  assert.ok(s.events.includes("land"));
  assert.equal(s.over, null);
});

test("ice jump: steering moves the cat in the air and it wraps around the river", () => {
  const s = newGame(3);
  const x0 = s.cat.x;
  step(s, 1 / 60, { left: false, right: true, jump: true });
  run(s, 0.3, () => ({ left: false, right: true, jump: false }));
  assert.ok(s.cat.x > x0 + 20);
  const w = newGame(3);
  w.cat.onFloe = null; w.cat.y = 300; w.cat.vy = 0; w.cat.x = 1; w.camY = 100;
  step(w, 1 / 60, { left: true, right: false, jump: false });
  assert.ok(w.cat.x > ICE.W - 10, "wrapped to the right bank");
});

test("ice jump: a cracking floe crumbles after about a second and drops the cat in the water", () => {
  const s = newGame(4);
  const start = s.floes[0];
  s.floes = [start];
  start.cracky = true;
  step(s, 1 / 60, { left: false, right: false, jump: true });
  run(s, 1.2);
  assert.equal(s.cat.onFloe, 1);
  assert.ok(start.crackedFor > 0, "cracking started on landing");
  assert.ok(s.events.includes("crack"));
  run(s, 1.2);
  assert.equal(start.gone, true);
  assert.equal(s.cat.onFloe, null, "the cat falls");
  run(s, 3);
  assert.equal(s.over, "water");
  assert.ok(s.events.includes("splash"));
});

test("ice jump: standing still loses to the rising water, and a finished game stays finished", () => {
  const s = newGame(5);
  run(s, 30);
  assert.equal(s.over, "water");
  const score = s.score;
  run(s, 1, () => ({ left: false, right: false, jump: true }));
  assert.equal(s.score, score);
});

test("ice jump: walking off the edge drops you; reward is capped", () => {
  const s = newGame(6);
  run(s, 2, () => ({ left: false, right: true, jump: false }));
  assert.equal(s.cat.onFloe === null || s.cat.x < 200, true);
  assert.equal(iceBeans(0), 0);
  assert.equal(iceBeans(249), 9);
  assert.equal(iceBeans(250), 10);
  assert.equal(iceBeans(1e9), ICE_MAX_BEANS);
});

test("ice jump: rows keep appearing above the cat", () => {
  const s = newGame(9);
  const before = s.floes.length;
  s.rows = 30;
  step(s, 1 / 60, idle());
  assert.ok(s.floes.length > before);
  assert.ok(s.rowsMade >= 38);
});
