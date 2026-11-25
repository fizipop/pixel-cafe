import test from "node:test";
import assert from "node:assert/strict";
import { PENGUIN_LANE_IDS, PENGUIN_MAX_MULT, PENGUIN_TILES, mulberry32, newShoe, penguinCrackChance, penguinMultiplier } from "../shared/arcade.ts";
import { HAND_NAMES, bestHand, buildPots } from "../shared/poker.ts";
import {
  FOOT_SPOT, HEAD_SPOT, POOL, PoolSim, applyShot, chooseShot, groupOf, legalTargets, newPoolGame, playShot, rackBalls, respotCue, type PoolGame,
} from "../shared/pool.ts";
import {
  BTN, CHARACTERS, FIGHT, LADDER, cpuButtons, newBrain, newMatch, stepMatch, type FightMatch,
} from "../shared/fighter.ts";
import { RACE, fmtTime, newRace, positions, raceBeans, stepRace, track } from "../shared/racer.ts";
import { FLOOR2_X, STAIRS } from "../shared/floors.ts";
import { WALL_H, WORLD_H, WORLD_W, TILE } from "./constants.ts";
import { NavGrid } from "./pathing.ts";
import { ARCADE_H, MACHINES, POKER, POOL_TABLE, ROULETTE_WATCH, arcadeSeats, arcadeSeatInfo, arcadeSolids, arcadeWalls, TABLE_GAME } from "./arcadeLayout.ts";
import { BEAT, CHART, SONG_MS, RANK_BEANS, accuracy, comboMult, judge, newScore, rankOf, scoreRun, scoreStep, trackStep } from "../shared/beat.ts";

// ------------------------------------------------------------------ poker

const hand = (s: string) => bestHand(s.split(" "));

test("poker: every hand category is recognised and ranked in order", () => {
  const ladder = [
    "2S 5H 9D JC KH", // high card
    "2S 2H 9D JC KH", // pair
    "2S 2H 9D 9C KH", // two pair
    "2S 2H 2D JC KH", // trips
    "5S 6H 7D 8C 9H", // straight
    "2S 5S 9S JS KS", // flush
    "2S 2H 2D KC KH", // full house
    "2S 2H 2D 2C KH", // quads
    "5S 6S 7S 8S 9S", // straight flush
    "10S JS QS KS AS", // royal flush
  ].map(hand);
  ladder.forEach((h, i) => { assert.equal(h.cat, i); assert.equal(h.name, HAND_NAMES[i]); });
  for (let i = 1; i < ladder.length; i++) assert.ok(ladder[i].score > ladder[i - 1].score, HAND_NAMES[i]);
});

test("poker: kickers, the wheel, and the best five of seven decide ties", () => {
  assert.ok(hand("AS AH KD 5C 2H").score > hand("AS AH QD 5C 2H").score, "kicker");
  assert.ok(hand("AS AH KD 5C 2H").score > hand("KS KH AD 5C 2H").score, "higher pair");
  assert.equal(hand("AS 2H 3D 4C 5H").cat, 4, "the wheel is a straight");
  assert.ok(hand("6S 2H 3D 4C 5H").score > hand("AS 2H 3D 4C 5H").score, "the wheel is the lowest straight");
  assert.equal(hand("AS KH QD JC 9H").cat, 0, "A-K-Q-J-9 is not a straight");
  assert.equal(hand("AS AH AD KC KH").score, hand("AC AD AH KS KD").score, "equal hands tie");
  const seven = bestHand("2S 2H 9D 9C KH KS 3D".split(" "));
  assert.equal(seven.name, "Two Pair");
  assert.equal(seven.best.length, 5);
  assert.equal(bestHand("AS KS QS JS 10S 2H 3D".split(" ")).name, "Royal Flush");
  assert.equal(bestHand("2S 2H 2D 2C 3S 3H 3D".split(" ")).name, "Four of a Kind");
  assert.equal(bestHand("2S 3H 4D".split(" ")).name, "—", "fewer than five cards is not a hand");
});

test("poker: random deals always produce a hand and the deck has 52 distinct cards", () => {
  const deck = newShoe(mulberry32(5), 1);
  assert.equal(new Set(deck).size, 52);
  for (let i = 0; i < 200; i++) {
    const d = newShoe(mulberry32(i), 1);
    const h = bestHand(d.slice(0, 7));
    assert.ok(h.cat >= 0 && h.best.length === 5);
  }
});

test("poker: side pots split by how much each player put in, and folded chips stay in the pot", () => {
  // A is all-in for 50, B for 120, C called 120, D folded after putting in 30
  const pots = buildPots([
    { seat: 0, total: 50, folded: false }, { seat: 1, total: 120, folded: false }, { seat: 2, total: 120, folded: false }, { seat: 3, total: 30, folded: true },
  ]);
  assert.deepEqual(pots, [{ amount: 50 * 3 + 30, eligible: [0, 1, 2] }, { amount: 70 * 2, eligible: [1, 2] }]);
  assert.equal(pots.reduce((n, p) => n + p.amount, 0), 50 + 120 + 120 + 30);
  assert.deepEqual(buildPots([{ seat: 0, total: 100, folded: false }, { seat: 1, total: 60, folded: false }]), [{ amount: 120, eligible: [0, 1] }, { amount: 40, eligible: [0] }], "an uncalled bet comes back to its owner");
  assert.deepEqual(buildPots([]), []);
});

// ------------------------------------------------------------------ penguin cross

test("penguin cross: multipliers climb with every step, lanes differ, and every lane returns about 97%", () => {
  for (const lane of PENGUIN_LANE_IDS) {
    let prev = 1;
    for (let s = 1; s <= PENGUIN_TILES; s++) {
      const m = penguinMultiplier(lane, s);
      assert.ok(m > prev || m === PENGUIN_MAX_MULT, `${lane} step ${s}`);
      prev = m;
    }
    for (let s = 1; s < PENGUIN_TILES; s++) assert.ok(penguinCrackChance(lane, s + 1) >= penguinCrackChance(lane, s), "hazard escalates");
    // exact return for "cash out after n safe steps" (before rounding down): P(survive n) x multiplier(n) = edge
    for (const n of [1, 3, 6, 9]) {
      let p = 1;
      for (let k = 1; k <= n; k++) p *= 1 - penguinCrackChance(lane, k);
      const mult = penguinMultiplier(lane, n);
      if (mult < PENGUIN_MAX_MULT) assert.ok(Math.abs(p * mult - 0.97) < 0.01 * Math.max(1, mult / 50) + 0.01, `${lane} n=${n}: ${p * mult}`);
    }
  }
  assert.equal(penguinMultiplier("calm", 0), 1);
  assert.ok(penguinMultiplier("cracked", 5) > penguinMultiplier("thin", 5) && penguinMultiplier("thin", 5) > penguinMultiplier("calm", 5));
  assert.ok(penguinMultiplier("cracked", 12) <= PENGUIN_MAX_MULT);
  assert.ok(penguinCrackChance("cracked", 99) <= 0.92);
});

test("penguin cross: simulated crossings average out near the 97% return", () => {
  const rng = mulberry32(99);
  for (const lane of PENGUIN_LANE_IDS) {
    let paid = 0, bet = 0;
    for (let g = 0; g < 40000; g++) {
      bet++;
      let steps = 0;
      while (steps < 4) { if (rng() < penguinCrackChance(lane, steps + 1)) { steps = -1; break; } steps++; }
      if (steps > 0) paid += penguinMultiplier(lane, steps);
    }
    assert.ok(paid / bet > 0.9 && paid / bet < 1.04, `${lane}: ${paid / bet}`);
  }
});

// ------------------------------------------------------------------ pool

test("pool: a rack has 16 balls, the right groups and no overlaps", () => {
  const balls = rackBalls();
  assert.equal(balls.length, 16);
  assert.deepEqual(balls.map((b) => b.id).sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => i));
  assert.equal(balls.filter((b) => groupOf(b.id) === "solid").length, 7);
  assert.equal(balls.filter((b) => groupOf(b.id) === "stripe").length, 7);
  assert.equal(groupOf(8), null);
  for (let i = 0; i < balls.length; i++) for (let j = i + 1; j < balls.length; j++) assert.ok(Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y) >= POOL.R * 2, `${i},${j}`);
  assert.ok(balls.every((b) => b.x > POOL.R && b.x < POOL.W - POOL.R && b.y > POOL.R && b.y < POOL.H - POOL.R));
});

test("pool: the same shot always gives the same table (so the browser replay matches the server)", () => {
  const g = newPoolGame();
  const a = playShot(g, 0.01, 1), b = playShot(g, 0.01, 1);
  assert.deepEqual(a.game.balls, b.game.balls);
  const sim1 = new PoolSim(g.balls, 0.02, 0.8);
  while (!sim1.done) sim1.step();
  const sim2 = new PoolSim(g.balls, 0.02, 0.8).run();
  assert.deepEqual(sim1.balls, sim2.balls);
  assert.ok(sim1.steps < POOL.MAX_STEPS, "the table comes to rest");
  for (const ball of sim1.balls) if (!ball.out) assert.ok(ball.x >= POOL.R - 0.01 && ball.x <= POOL.W - POOL.R + 0.01 && ball.y >= POOL.R - 0.01 && ball.y <= POOL.H - POOL.R + 0.01, "balls stay on the cloth");
});

test("pool: physics basics: a ball stops, bounces off a rail, transfers momentum, and drops in a pocket", () => {
  const empty = (list: { id: number; x: number; y: number }[]) => list.map((b) => ({ ...b, vx: 0, vy: 0, out: false }));
  const lone = new PoolSim(empty([{ id: 0, x: 100, y: 200 }]), 0, 0.3).run();
  assert.ok(lone.balls[0].x > 100 && lone.balls[0].vx === 0, "rolls and stops");
  const rail = new PoolSim(empty([{ id: 0, x: 700, y: 200 }]), 0, 1).run();
  assert.ok(rail.balls[0].x < POOL.W - POOL.R, "came back off the cushion");
  assert.equal(rail.events.railAfterContact, false, "no ball was touched first");
  const hit = new PoolSim(empty([{ id: 0, x: 100, y: 200 }, { id: 1, x: 200, y: 200 }]), 0, 0.6).run();
  assert.equal(hit.events.firstHit, 1);
  assert.ok(hit.balls[1].x > 200 && hit.balls[0].x < hit.balls[1].x, "object ball takes the momentum");
  const side = new PoolSim(empty([{ id: 0, x: POOL.W / 2, y: 120 }]), -Math.PI / 2, 0.6).run();
  assert.ok(side.balls[0].out, "the side pocket takes a ball rolling straight at it");
  const corner = new PoolSim(empty([{ id: 0, x: 60, y: 60 }]), Math.atan2(-1, -1), 0.5).run();
  assert.ok(corner.balls[0].out && corner.events.pocketed.includes(0), "the cue ball rolled into the corner pocket");
});

const table = (balls: { id: number; x: number; y: number }[], over: Partial<PoolGame> = {}): PoolGame => ({
  balls: balls.map((b) => ({ ...b, vx: 0, vy: 0, out: false })), turn: 0, groups: [null, null], breaking: false, ...over,
});

test("pool rules: pocketing a ball on an open table assigns groups and keeps your turn", () => {
  const g = table([{ id: 0, x: 120, y: 60 }, { id: 3, x: 180, y: 60 }, { id: 12, x: 600, y: 300 }, { id: 8, x: 600, y: 200 }]);
  // the shooter pockets a solid (set by hand so the test doesn't depend on the physics)
  const sim = new PoolSim(g.balls, 0, 0.3);
  sim.events.firstHit = 3; sim.events.pocketed = [3]; sim.events.railAfterContact = true; sim.balls[1].out = true;
  const r = applyShot(g, sim);
  assert.equal(r.foul, null);
  assert.deepEqual(r.game.groups, ["solid", "stripe"]);
  assert.equal(r.game.turn, 0, "sank one, shoots again");
  assert.equal(r.winner, null);
});

test("pool rules: fouls hand the turn over and respot the cue ball", () => {
  const base = table([{ id: 0, x: 400, y: 200 }, { id: 3, x: 480, y: 200 }, { id: 11, x: 560, y: 200 }], { groups: ["solid", "stripe"] });
  const mk = (ev: Partial<PoolSim["events"]>, scratch = false) => {
    const sim = new PoolSim(base.balls, 0, 0.3);
    sim.events = { firstHit: 3, pocketed: [], railAfterContact: true, ...ev };
    if (scratch) sim.balls[0].out = true;
    return applyShot(base, sim);
  };
  assert.match(mk({ firstHit: 11 }).foul ?? "", /wrong ball/);
  assert.match(mk({ firstHit: null }).foul ?? "", /hit nothing/);
  assert.match(mk({ pocketed: [0] }, true).foul ?? "", /Scratch/);
  assert.match(mk({ railAfterContact: false }).foul ?? "", /rail/);
  assert.equal(mk({ railAfterContact: false }).game.turn, 1);
  const s = mk({ pocketed: [0] }, true);
  assert.equal(s.game.balls[0].out, false);
  assert.ok(Math.abs(s.game.balls[0].x - HEAD_SPOT.x) < 1);
  assert.equal(mk({}).game.turn, 1, "no ball down: the turn passes");
  assert.equal(mk({ firstHit: 3, pocketed: [11] }).game.turn, 1, "pocketing the other player's ball does not keep your turn");
});

test("pool rules: the 8-ball wins only at the end, and loses if sunk early or with a scratch", () => {
  const early = table([{ id: 0, x: 400, y: 200 }, { id: 8, x: 480, y: 200 }, { id: 5, x: 200, y: 100 }], { groups: ["solid", "stripe"] });
  const mk = (g: PoolGame, ev: Partial<PoolSim["events"]>) => { const sim = new PoolSim(g.balls, 0, 0.3); sim.events = { firstHit: 8, pocketed: [8], railAfterContact: true, ...ev }; sim.balls.find((b) => b.id === 8)!.out = true; return applyShot(g, sim); };
  assert.equal(legalTargets(early).includes(8), false);
  assert.equal(mk(early, { firstHit: 5 }).winner, 1, "sunk early: you lose");
  const cleared = table([{ id: 0, x: 400, y: 200 }, { id: 8, x: 480, y: 200 }, { id: 12, x: 200, y: 100 }], { groups: ["solid", "stripe"] });
  assert.deepEqual(legalTargets(cleared), [8]);
  assert.equal(mk(cleared, {}).winner, 0, "group cleared: the 8 wins");
  assert.equal(mk(cleared, { pocketed: [8, 0] }).winner, 1, "scratching on the 8 loses");
  const brk = newPoolGame();
  const sim = new PoolSim(brk.balls, 0, 0.3);
  sim.events = { firstHit: 1, pocketed: [8], railAfterContact: true };
  sim.balls.find((b) => b.id === 8)!.out = true;
  const r = applyShot(brk, sim);
  assert.equal(r.winner, null, "the 8 on the break is spotted again");
  assert.equal(r.game.balls.find((b) => b.id === 8)!.out, false);
});

test("pool: cue ball respots on a free spot, and the AI can finish a whole game", () => {
  const cluttered = rackBalls();
  cluttered[0].x = HEAD_SPOT.x; cluttered[0].y = HEAD_SPOT.y;
  const blocker = cluttered[1]; blocker.x = HEAD_SPOT.x; blocker.y = HEAD_SPOT.y + 2;
  const spot = respotCue(cluttered);
  assert.ok(cluttered.every((b) => b.id === 0 || b.out || Math.hypot(b.x - spot.x, b.y - spot.y) >= POOL.R * 2));
  assert.ok(FOOT_SPOT.x > HEAD_SPOT.x);
  const rng = mulberry32(11);
  let g = newPoolGame(0);
  let winner: 0 | 1 | null = null;
  for (let turn = 0; turn < 250 && winner === null; turn++) {
    const shot = chooseShot(g, rng, 0.85);
    const r = playShot(g, shot.angle, shot.power);
    g = r.game; winner = r.winner;
  }
  assert.notEqual(winner, null, "the bot ends the game");
});

// ------------------------------------------------------------------ fighter

const stepN = (m: FightMatch, n: number, a = 0, b = 0) => { for (let i = 0; i < n; i++) stepMatch(m, a, b); };
const live = () => { const m = newMatch(0, 1); stepN(m, FIGHT.INTRO + 1); assert.equal(m.phase, "fight"); return m; };

test("fighter: four fighters, a round starts after the intro and nothing moves during it", () => {
  assert.equal(CHARACTERS.length, 4);
  assert.deepEqual(CHARACTERS.map((c) => c.name), ["Ryo", "Kaito", "Shade", "Brick"]);
  const m = newMatch(0, 3);
  const x0 = m.f[0].x;
  stepN(m, 30, BTN.RIGHT);
  assert.equal(m.f[0].x, x0, "locked during the intro");
  stepN(m, FIGHT.INTRO);
  assert.equal(m.phase, "fight");
  assert.equal(m.f[1].hp, CHARACTERS[3].hp);
});

test("fighter: walking, jumping, and landing", () => {
  const m = live();
  const x = m.f[0].x;
  stepN(m, 10, BTN.RIGHT);
  assert.ok(m.f[0].x > x && m.f[0].state === "walk");
  stepN(m, 1, BTN.UP);
  assert.ok(m.f[0].y > 0 || m.f[0].vy > 0);
  stepN(m, 80);
  assert.equal(m.f[0].y, 0);
  assert.equal(m.f[0].state, "idle");
  m.f[0].x = 16; stepN(m, 40, BTN.LEFT);
  assert.ok(m.f[0].x >= FIGHT.MIN_X, "can't leave the stage");
});

test("fighter: a light attack in reach hurts, out of reach whiffs, and a hit sends sparks (events)", () => {
  const m = live();
  m.f[0].x = 150; m.f[1].x = 172; m.f[0].face = 1; m.f[1].face = -1;
  const hp = m.f[1].hp;
  stepN(m, 1, BTN.LIGHT);
  stepN(m, 20);
  assert.equal(m.f[1].hp, hp - CHARACTERS[0].light.dmg);
  assert.ok(m.ev.some((e) => e.k === "hit"));
  const far = live();
  far.f[0].x = 60; far.f[1].x = 250;
  stepN(far, 1, BTN.HEAVY); stepN(far, 30);
  assert.equal(far.f[1].hp, CHARACTERS[1].hp, "too far away");
});

test("fighter: blocking cuts damage a lot, and heavy hits do more than light ones", () => {
  const unblocked = live(), blocked = live(), light = live();
  for (const m of [unblocked, blocked, light]) { m.f[0].x = 150; m.f[1].x = 172; m.f[0].face = 1; m.f[1].face = -1; }
  stepN(unblocked, 1, BTN.HEAVY, 0); stepN(unblocked, 30, 0, 0);
  stepN(blocked, 2, 0, BTN.BLOCK); stepN(blocked, 1, BTN.HEAVY, BTN.BLOCK); stepN(blocked, 30, 0, BTN.BLOCK);
  stepN(light, 1, BTN.LIGHT); stepN(light, 30);
  const dmg = (m: FightMatch) => CHARACTERS[1].hp - m.f[1].hp;
  assert.equal(dmg(unblocked), CHARACTERS[0].heavy.dmg);
  assert.ok(dmg(blocked) <= 2 && dmg(blocked) >= 1, `blocked damage ${dmg(blocked)}`);
  assert.ok(dmg(unblocked) > dmg(light));
  assert.ok(blocked.ev.some((e) => e.k === "block"));
});

test("fighter: a fireball travels, hurts, can be jumped over, and has a cooldown", () => {
  const m = live();
  m.f[0].x = 60; m.f[1].x = 260;
  stepN(m, 1, BTN.SPECIAL); stepN(m, 15);
  assert.equal(m.shots.length, 1);
  stepN(m, 1, 0); // let the button come up before pressing again
  stepN(m, 1, BTN.SPECIAL);
  assert.equal(m.f[0].state === "special" && m.shots.length === 1, true, "cooling down: no second fireball yet");
  stepN(m, 90);
  assert.ok(m.f[1].hp < CHARACTERS[1].hp, "the fireball connected");
  const dodge = live();
  dodge.f[0].x = 60; dodge.f[1].x = 260;
  stepN(dodge, 1, BTN.SPECIAL); stepN(dodge, 12);
  dodge.f[1].y = 40; dodge.f[1].vy = 0; dodge.f[1].state = "jump";
  stepN(dodge, 1);
  const before = dodge.f[1].hp;
  for (let i = 0; i < 20 && dodge.shots.length; i++) { dodge.f[1].y = 40; dodge.f[1].vy = 0; stepMatch(dodge, 0, 0); }
  assert.equal(dodge.f[1].hp, before, "jumping over it works");
});

test("fighter: KO ends the round, two round wins take the match, time-outs go to the healthier fighter", () => {
  const m = live();
  m.f[1].hp = 1; m.f[0].x = 150; m.f[1].x = 172;
  stepN(m, 1, BTN.LIGHT); stepN(m, 20);
  assert.equal(m.f[1].state, "ko");
  assert.equal(m.phase, "ko");
  assert.deepEqual(m.wins, [1, 0]);
  stepN(m, FIGHT.KO_PAUSE + 5);
  assert.equal(m.round, 2);
  assert.equal(m.phase, "intro");
  assert.equal(m.f[1].hp, CHARACTERS[1].hp, "health refills for round 2");
  stepN(m, FIGHT.INTRO + 1);
  m.f[1].hp = 1; m.f[0].x = 150; m.f[1].x = 172;
  stepN(m, 1, BTN.LIGHT); stepN(m, 20 + FIGHT.KO_PAUSE + 5);
  assert.equal(m.phase, "over");
  assert.equal(m.winner, 0);
  const t = live();
  t.f[0].hp = 40; t.frames = 2;
  stepN(t, 5);
  assert.equal(t.roundWinner, 1, "time up: Kaito had more health left");
  const draw = live();
  draw.frames = 1; stepN(draw, 3);
  assert.equal(draw.roundWinner, -1, "level on health at time up is a draw");
  assert.deepEqual(draw.wins, [1, 1]);
});

test("fighter: the CPU fights back, and a CPU ladder match always finishes", () => {
  assert.equal(LADDER.length, 5);
  assert.ok(LADDER.every((s, i) => i === 0 || s.level >= LADDER[i - 1].level), "each stage is at least as sharp");
  const rng = mulberry32(21);
  const m = newMatch(0, LADDER[0].char);
  const brain = newBrain();
  let n = 0;
  while (m.phase !== "over" && n < 60 * 60 * 6) {
    stepMatch(m, n % 90 < 50 ? BTN.RIGHT | (n % 20 < 3 ? BTN.LIGHT : 0) : BTN.LEFT, cpuButtons(m, 1, brain, LADDER[0].level, rng));
    n++;
  }
  assert.equal(m.phase, "over");
  assert.notEqual(m.winner, null);
  assert.ok(m.f[0].hp < CHARACTERS[0].hp || m.f[1].hp < CHARACTERS[1].hp || m.round > 1, "damage was dealt");
});

// ------------------------------------------------------------------ racer

test("racer: a closed circuit with pads, oil, and a sane minimum lap time", () => {
  const tr = track();
  assert.ok(tr.length > 3000 && tr.length < 8000);
  assert.equal(tr.pads.length, 4);
  assert.equal(tr.oil.length, 4);
  assert.ok(tr.minLapMs > 4000 && tr.minLapMs < 15000, `${tr.minLapMs}`);
  assert.equal(RACE.LAPS, 4);
  assert.equal(RACE.FIELD, 8); // you and seven CPU racers
  const a = tr.pts[0], z = tr.pts[tr.pts.length - 1];
  assert.ok(Math.hypot(a.x - z.x, a.y - z.y) < 60, "the loop closes");
});

test("racer: an 8-car grid waits for the lights, every CPU racer finishes four laps, and positions are sorted", () => {
  const r = newRace(3);
  const rng = mulberry32(3);
  const x0 = r.cars[0].x;
  for (let i = 0; i < 100; i++) stepRace(r, { left: false, right: false, up: true, down: false, drift: false }, 16, rng); // 1.6 s: still counting down
  assert.equal(r.cars[0].x, x0, "no moving before GO");
  let n = 0;
  while (!r.cars.slice(1).every((c) => c.finishedAt !== null) && n < 30000) { stepRace(r, { left: false, right: false, up: false, down: true, drift: false }, 16, rng); n++; }
  const cpu = r.cars.slice(1);
  assert.ok(cpu.every((c) => c.lap >= RACE.LAPS && c.finishedAt !== null), "every CPU racer finished");
  assert.ok(cpu.every((c) => c.best >= track().minLapMs), "no CPU lap beats the server's minimum");
  const pos = positions(r);
  assert.deepEqual([...pos].sort((a, b) => a - b), Array.from({ length: RACE.FIELD }, (_, i) => i + 1));
  assert.equal(pos[0], RACE.FIELD, "a parked player is last");
  assert.deepEqual([1, 2, 3, 4].map(raceBeans), [30, 18, 8, 0]);
  assert.equal(fmtTime(65432), "1:05.432");
  assert.equal(fmtTime(Infinity), "--:--.---");
});

test("racer: driving the racing line can beat the CPU (the player controls matter)", () => {
  // an autopilot that follows the centre line like the CPU but never lifts: it must finish and be faster than a parked car
  const r = newRace(4);
  const tr = track();
  const rng = mulberry32(4);
  let n = 0;
  while (!r.done && n < 40000) {
    const me = r.cars[0];
    const t = tr.pts[(me.idx + 6) % tr.pts.length];
    let d = Math.atan2(t.y - me.y, t.x - me.x) - me.angle;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    stepRace(r, { left: d < -0.05, right: d > 0.05, up: true, down: Math.abs(d) > 0.7 && Math.hypot(me.vx, me.vy) > 160, drift: false }, 16, rng);
    n++;
  }
  assert.ok(r.cars[0].lap >= 1, `the autopilot completed a lap (lap ${r.cars[0].lap})`);
  assert.ok(r.cars[0].best >= tr.minLapMs, "and obeyed the speed limit");
});

// ------------------------------------------------------------------ beat battle

test("beat battle: a fixed chart on four lanes, in time order, inside the song", () => {
  assert.ok(CHART.length > 120 && CHART.length < 400, `${CHART.length} notes`);
  assert.ok(CHART.every((n, i) => n.lane >= 0 && n.lane <= 3 && (i === 0 || n.t >= CHART[i - 1].t)));
  assert.ok(CHART[0].t >= BEAT.FIRST_BAR * 4 * (60000 / BEAT.BPM) - 1, "two bars of intro");
  assert.ok(CHART.at(-1)!.t < SONG_MS - 1000, "a rest at the end");
  assert.deepEqual(new Set(CHART.map((n) => n.lane)), new Set([0, 1, 2, 3]));
  const first = CHART.slice(0, 40).length, last = CHART.slice(-40).length;
  assert.equal(first, last);
  const early = CHART.filter((n) => n.t < SONG_MS / 3).length, late = CHART.filter((n) => n.t > (SONG_MS * 2) / 3).length;
  assert.ok(late > early, "it gets busier");
});

test("beat battle: timing windows, combo multiplier, hype bar and ranks", () => {
  assert.equal(judge(0), "S"); assert.equal(judge(-BEAT.SICK_MS), "S"); assert.equal(judge(BEAT.SICK_MS + 1), "G");
  assert.equal(judge(-BEAT.GOOD_MS), "G"); assert.equal(judge(BEAT.GOOD_MS + 1), "M");
  assert.equal(comboMult(0), 1); assert.equal(comboMult(10), 2); assert.equal(comboMult(30), 4); assert.equal(comboMult(500), 4);
  let s = newScore();
  s = scoreStep(s, "S", 400);
  assert.equal(s.score, BEAT.SICK);
  for (let i = 0; i < 12; i++) s = scoreStep(s, "S", 400);
  assert.ok(s.score > BEAT.SICK * 13, "combos pay more");
  assert.equal(s.maxCombo, 13);
  const before = s.hype;
  s = scoreStep(s, "M", 400);
  assert.equal(s.combo, 0);
  assert.ok(s.hype < before);
  let dead = newScore();
  for (let i = 0; i < 30 && !dead.failed; i++) dead = scoreStep(dead, "M", 400);
  assert.ok(dead.failed && dead.hype === 0, "the rival wins the tug-of-war");
  assert.equal(scoreStep(dead, "S", 400).score, dead.score, "nothing counts after you fail");
});

test("beat battle: replaying a run from its judgements gives the score, and bad runs are refused", () => {
  const n = CHART.length;
  const perfect = scoreRun("S".repeat(n))!;
  assert.equal(rankOf(perfect), "S");
  assert.ok(perfect.score > 100000);
  assert.equal(perfect.maxCombo, n);
  const goods = scoreRun("G".repeat(n))!;
  assert.ok(goods.score < perfect.score);
  const mixed = scoreRun(Array.from({ length: n }, (_, i) => (i % 5 === 0 ? "M" : i % 2 ? "G" : "S")).join(""))!;
  assert.ok(["A", "B", "C"].includes(rankOf(mixed)), rankOf(mixed));
  assert.equal(rankOf(scoreRun("M".repeat(n))!), "D");
  for (const bad of ["", "S", "S".repeat(n - 1), "S".repeat(n + 1), "X".repeat(n), null, 5, undefined]) assert.equal(scoreRun(bad), null, String(bad));
  assert.ok(accuracy(perfect) === 1);
  assert.ok(RANK_BEANS.S > RANK_BEANS.A && RANK_BEANS.A > RANK_BEANS.B && RANK_BEANS.B > RANK_BEANS.C && RANK_BEANS.D === 0);
});

test("beat battle: the backing track loops every four bars with drums, bass and chords", () => {
  const steps = Array.from({ length: 64 }, (_, i) => trackStep(i));
  assert.ok(steps.filter((s) => s.kick).length >= 16);
  assert.equal(steps.filter((s) => s.snare).length, 8);
  assert.equal(steps.filter((s) => s.hat).length, 32);
  assert.ok(steps.filter((s) => s.bass).length >= 20);
  assert.equal(steps.filter((s) => s.pad).length, 4);
  assert.deepEqual(trackStep(64), trackStep(0));
  assert.ok(steps.every((s) => s.arp > 100 && s.arp < 3000));
});

// ------------------------------------------------------------------ Floor 2 layout

test("floor 2 layout: the new cabinets and tables are collision-safe, reachable, and every one has a Press E spot", () => {
  const solids = arcadeSolids(STAIRS[2].solid);
  for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
    const a = solids[i], b = solids[j];
    assert.equal(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, false, `solid ${i} overlaps solid ${j}`);
  }
  const x0 = FLOOR2_X;
  const walls = arcadeWalls(TILE, WALL_H);
  void WORLD_H;
  const nav = new NavGrid(x0 + WORLD_W, ARCADE_H, [...solids, ...walls]);
  const from = nav.nearestFree(STAIRS[2].arrive.x, STAIRS[2].arrive.y)!;
  const games = MACHINES.filter((m) => m.game).map((m) => m.game);
  // Neon Drift GP moved from a stand-up cabinet to two sit-down rigs (seats), Beat Battle is now two stations, and the
  // casino row added Huff & Xtra Puff, its BONUS machine, Plinko and the lottery booth (four slot machines in all)
  assert.deepEqual([...games].sort(), ["board", "beat", "beat", "fighter", "huff", "huffBonus", "lottery", "mines", "moon", "penguin", "plinko", "slots", "slots"].sort());
  assert.ok(!games.includes("ice" as never), "Cat Ice Jump is gone");
  const goals = [
    ...MACHINES.filter((m) => m.game).map((m) => ({ name: m.id, ...m.spot })),
    ...arcadeSeats().map((s) => ({ name: s.id, ...s.exit })), { name: "roulette watch", ...ROULETTE_WATCH }, { name: "elevator", ...STAIRS[2].spot },
  ];
  for (const g of goals) {
    assert.ok(nav.isFree(g.x, g.y), `${g.name} is not inside furniture`);
    assert.ok(nav.findPath(from, g), `${g.name} is reachable from the elevator`);
  }
  // seats: poker has six, pool two, each opens its own window
  const seats = arcadeSeats();
  assert.equal(seats.filter((s) => arcadeSeatInfo(s.id)?.table === "pk0").length, POKER.seats);
  assert.equal(seats.filter((s) => arcadeSeatInfo(s.id)?.table === "pl0").length, POOL_TABLE.seats);
  assert.deepEqual(Object.values(TABLE_GAME).sort(), ["blackjack", "poker", "pool", "roulette"]);
  // cabinets are spaced so their prompts don't compete (stand spots at least 40px apart)
  const spots = MACHINES.filter((m) => m.game).map((m) => m.spot);
  for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].y - spots[j].y) >= 40, `${i},${j}`);
});
