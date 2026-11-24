// Floor 2 arcade polish: Pixel Fighter II controls, the 20-car Neon Drift field, Beat Battle difficulty levels, and Miniclip-style 8-ball rules.
import test from "node:test";
import assert from "node:assert/strict";
import { BTN, CHARACTERS, FIGHT, METER_MAX, newMatch, stepMatch, type FightMatch } from "../shared/fighter.ts";
import { RACE, elevation, newRace, positions, track } from "../shared/racer.ts";
import { BEAT, CHART, DIFFICULTIES, LEVELS, beansFor, chartFor, isDifficulty, rankOf, scoreRun, songMsFor, RANK_BEANS } from "../shared/beat.ts";
import {
  HEAD_SPOT, POCKETS, POOL, PoolSim, aimPreview, applyShot, chooseShot, needsCall, newPoolGame, placeCue, placeProblem, playShot, rackBalls, type PoolGame,
} from "../shared/pool.ts";

// ------------------------------------------------------------------ Pixel Fighter II controls

const stepN = (m: FightMatch, n: number, a = 0, b = 0) => { for (let i = 0; i < n; i++) stepMatch(m, a, b); };
const live = (c0 = 0, c1 = 1) => { const m = newMatch(c0, c1); stepN(m, FIGHT.INTRO + 1); assert.equal(m.phase, "fight"); return m; };

test("fighter controls: S crouches, a crouching fighter ducks a standing-height shuriken, a standing one does not", () => {
  const duck = live(2, 0);
  duck.f[0].x = 60; duck.f[1].x = 220;
  stepN(duck, 1, BTN.SPECIAL, BTN.DOWN); stepN(duck, 150, 0, BTN.DOWN);
  assert.equal(duck.f[1].state, "crouch");
  assert.equal(duck.f[1].hp, CHARACTERS[0].hp, "the shuriken flew overhead");
  const stand = live(2, 0);
  stand.f[0].x = 60; stand.f[1].x = 220;
  stepN(stand, 1, BTN.SPECIAL, 0); stepN(stand, 150);
  assert.ok(stand.f[1].hp < CHARACTERS[0].hp, "an unprotected fighter is hit");
});

test("fighter controls: holding back from an attack blocks it without pressing the block key", () => {
  const mk = (hold: number) => {
    const m = live(0, 1);
    m.f[0].x = 100; m.f[1].x = 124;
    stepN(m, 1, 0, BTN.HEAVY); // the opponent starts a kick...
    stepN(m, 2, hold, BTN.HEAVY); // ...and we either hold back (LEFT, away from them) or not
    const blockedState = m.f[0].state;
    stepN(m, 40, hold, 0);
    return { loss: CHARACTERS[0].hp - m.f[0].hp, blockedState };
  };
  const held = mk(BTN.LEFT), idle = mk(0);
  assert.equal(held.blockedState, "block");
  assert.ok(held.loss > 0 && held.loss <= 3, `chip damage only (${held.loss})`);
  assert.ok(idle.loss >= 8, `an idle fighter eats the full hit (${idle.loss})`);
  // walking away when nothing is coming does not freeze you in a block
  const calm = live(0, 1);
  calm.f[0].x = 60; calm.f[1].x = 260;
  stepN(calm, 5, BTN.LEFT);
  assert.equal(calm.f[0].state, "walk");
});

test("fighter controls: trading blows fills the super meter, and a full meter powers up the next special", () => {
  const m = live(0, 1);
  m.f[0].x = 100; m.f[1].x = 124;
  stepN(m, 1, BTN.LIGHT); stepN(m, 20);
  assert.ok(m.f[0].meter > 0 && m.f[1].meter > 0, "both fighters gain meter from a hit");
  const plain = live(0, 1), power = live(0, 1);
  for (const x of [plain, power]) { x.f[0].x = 60; x.f[1].x = 250; }
  power.f[0].meter = METER_MAX;
  stepN(plain, 1, BTN.SPECIAL); stepN(plain, 12);
  stepN(power, 1, BTN.SPECIAL); stepN(power, 12);
  assert.equal(plain.shots.length, 1); assert.equal(power.shots.length, 1);
  assert.ok(power.shots[0].dmg > plain.shots[0].dmg * 1.5, "the super fireball hits harder");
  assert.equal(power.shots[0].big, true);
  assert.equal(power.f[0].meter, 0, "and it spends the meter");
});

// ------------------------------------------------------------------ Neon Drift GP

test("racer: a 20-car grid on the road, you start mid-pack, and the hills are scenery only", () => {
  const r = newRace(9), tr = track();
  assert.equal(r.cars.length, RACE.FIELD);
  assert.equal(new Set(r.cars.map((c) => c.id)).size, RACE.FIELD);
  for (const c of r.cars) {
    const d = Math.min(...tr.pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y)));
    assert.ok(d < RACE.ROAD / 2, `${c.name} starts on the tarmac (${d.toFixed(1)})`);
  }
  for (let i = 0; i < r.cars.length; i++) for (let j = i + 1; j < r.cars.length; j++) assert.ok(Math.hypot(r.cars[i].x - r.cars[j].x, r.cars[i].y - r.cars[j].y) >= RACE.CAR_R * 2, "no overlaps on the grid");
  const start = positions(r)[0];
  assert.ok(start >= 10 && start <= 13, `you roll off ${start}th`);
  assert.equal(new Set(r.cars.slice(1).map((c) => c.lane)).size > 4, true, "the CPU cars use different lanes");
  const n = tr.pts.length;
  const zs = Array.from({ length: n }, (_, i) => elevation(i, n));
  assert.ok(Math.max(...zs) - Math.min(...zs) > 40, "real hills");
  assert.ok(Math.abs(elevation(0, n) - elevation(n, n)) < 1e-9, "the hills close up around the lap");
});

// ------------------------------------------------------------------ Beat Battle difficulty

test("beat battle levels: easy to insane get faster, denser and more complex, and every chart replays", () => {
  assert.deepEqual(DIFFICULTIES, ["easy", "normal", "hard", "insane"]);
  assert.equal(chartFor("normal"), CHART, "Normal is the original chart");
  assert.equal(LEVELS.normal.bpm, BEAT.BPM);
  const lv = DIFFICULTIES.map((d) => LEVELS[d]);
  for (let i = 1; i < lv.length; i++) {
    assert.ok(lv[i].bpm > lv[i - 1].bpm, "faster tempo");
    assert.ok(lv[i].lookahead < lv[i - 1].lookahead, "faster scroll speed");
    assert.ok(lv[i].beanMult > lv[i - 1].beanMult, "better rewards");
    assert.ok(chartFor(DIFFICULTIES[i]).length > chartFor(DIFFICULTIES[i - 1]).length, "more notes");
  }
  const doubles = (d: (typeof DIFFICULTIES)[number]) => { const c = chartFor(d); return c.filter((n, i) => i > 0 && n.t === c[i - 1].t).length; };
  assert.equal(doubles("easy"), 0); assert.equal(doubles("normal"), 0);
  assert.ok(doubles("hard") > 5 && doubles("insane") > doubles("hard"), "double arrows");
  const gaps = (d: (typeof DIFFICULTIES)[number]) => { const c = chartFor(d); const ms = 60000 / LEVELS[d].bpm / 4; return c.filter((n, i) => i > 0 && Math.abs(n.t - c[i - 1].t - ms) < 3).length; };
  assert.equal(gaps("easy"), 0); assert.ok(gaps("hard") > 8, "16th-note streams on Hard"); assert.ok(gaps("insane") > gaps("hard"));
  for (const d of DIFFICULTIES) {
    const c = chartFor(d);
    assert.ok(c.every((n, i) => n.lane >= 0 && n.lane <= 3 && (i === 0 || n.t >= c[i - 1].t)), `${d} is in order on four lanes`);
    assert.ok(c[0].t >= BEAT.FIRST_BAR * 4 * (60000 / LEVELS[d].bpm) - 1, `${d}: a bar-in intro`);
    assert.ok(c.at(-1)!.t < songMsFor(d) - 1000, `${d}: a rest at the end`);
    assert.equal(new Set(c.map((n) => n.lane)).size, 4);
    assert.equal(rankOf(scoreRun("S".repeat(c.length), c)!, c.length), "S");
    assert.equal(scoreRun("S".repeat(c.length - 1), c), null, `${d}: wrong length is refused`);
    assert.equal(chartFor(d), c, "charts are cached");
  }
  assert.ok(isDifficulty("insane") && !isDifficulty("nightmare") && !isDifficulty(3));
  assert.equal(beansFor("S", "normal"), RANK_BEANS.S);
  assert.ok(beansFor("S", "easy") < RANK_BEANS.S && beansFor("S", "insane") > RANK_BEANS.S);
  assert.equal(beansFor("D", "insane"), 0);
});

// ------------------------------------------------------------------ 8-Ball Pool rules

const table = (balls: { id: number; x: number; y: number }[], over: Partial<PoolGame> = {}): PoolGame => ({
  balls: balls.map((b) => ({ ...b, vx: 0, vy: 0, out: false })), turn: 0, groups: [null, null], breaking: false, ...over,
});
const shotWith = (g: PoolGame, ev: Partial<PoolSim["events"]>, out: number[] = []) => {
  const sim = new PoolSim(g.balls, 0, 0.3);
  sim.events = { firstHit: 3, pocketed: [], railAfterContact: true, ...ev };
  for (const id of out) sim.balls.find((b) => b.id === id)!.out = true;
  return sim;
};

test("pool rules: any foul gives the other player ball in hand; a plain miss does not", () => {
  const base = table([{ id: 0, x: 400, y: 200 }, { id: 3, x: 480, y: 200 }, { id: 11, x: 560, y: 200 }], { groups: ["solid", "stripe"] });
  const wrong = applyShot(base, shotWith(base, { firstHit: 11 }));
  assert.match(wrong.foul ?? "", /wrong ball/);
  assert.equal(wrong.game.inHand, true);
  assert.equal(wrong.game.turn, 1);
  assert.equal(wrong.game.balls[0].x, 400, "an ordinary foul leaves the cue ball where it lies, ready to be picked up");
  assert.equal(wrong.game.kitchen, false);
  const miss = applyShot(base, shotWith(base, {}));
  assert.equal(miss.foul, null);
  assert.equal(miss.game.inHand, false, "a clean miss just passes the turn");
  const scratch = applyShot(base, shotWith(base, { pocketed: [0] }, [0]));
  assert.equal(scratch.game.inHand, true);
  assert.ok(Math.abs(scratch.game.balls[0].x - HEAD_SPOT.x) < 1, "a dropped cue ball returns to the head spot before being placed");
  assert.equal(scratch.game.kitchen, false);
  const brk = newPoolGame();
  const brkScratch = applyShot(brk, shotWith(brk, { firstHit: 1, pocketed: [0] }, [0]));
  assert.equal(brkScratch.game.inHand, true);
  assert.equal(brkScratch.game.kitchen, true, "a scratch on the break is placed behind the head string");
  const hit = applyShot(base, shotWith(base, { pocketed: [3] }, [3]));
  assert.equal(hit.game.inHand, false);
});

test("pool rules: placing the cue ball in hand: bounds, other balls and the head string", () => {
  const g = table([{ id: 0, x: 400, y: 200 }, { id: 3, x: 480, y: 200 }], { inHand: true });
  assert.equal(placeProblem(g, 300, 100), null);
  assert.match(placeProblem({ ...g, inHand: false }, 300, 100) ?? "", /in hand/);
  assert.match(placeProblem(g, -5, 100) ?? "", /cloth/);
  assert.match(placeProblem(g, POOL.W + 1, 100) ?? "", /cloth/);
  assert.match(placeProblem(g, 485, 205) ?? "", /touching/);
  assert.match(placeProblem(g, NaN, 100) ?? "", /Bad/);
  assert.equal(placeProblem(g, 482 + POOL.R * 2, 200), null, "just clear of the 3");
  const k = { ...g, kitchen: true };
  assert.equal(placeProblem(k, HEAD_SPOT.x - 10, 100), null);
  assert.match(placeProblem(k, HEAD_SPOT.x + 10, 100) ?? "", /head string/);
  const moved = placeCue(g, { x: 300, y: 100 });
  assert.deepEqual([moved.balls[0].x, moved.balls[0].y], [300, 100]);
  assert.equal(g.balls[0].x, 400, "placing never mutates the original");
  assert.equal(placeCue(g, { x: 484, y: 200 }), g, "an illegal spot is ignored");
});

test("pool rules: the 8-ball must go in the pocket you called", () => {
  const cleared = table([{ id: 0, x: 400, y: 200 }, { id: 8, x: 480, y: 200 }, { id: 12, x: 200, y: 100 }], { groups: ["solid", "stripe"] });
  assert.equal(needsCall(cleared), true);
  assert.equal(needsCall(table([{ id: 0, x: 1, y: 1 }, { id: 8, x: 2, y: 2 }, { id: 3, x: 9, y: 9 }], { groups: ["solid", "stripe"] })), false);
  const sank = (pocket: number, call?: number) => applyShot(cleared, shotWith(cleared, { firstHit: 8, pocketed: [8], pocketOf: { 8: pocket } }, [8]), call);
  assert.equal(sank(2, 2).winner, 0, "called and sunk: you win");
  const wrong = sank(4, 2);
  assert.equal(wrong.winner, 1, "wrong pocket loses");
  assert.match(wrong.reason, /wrong pocket/);
  assert.equal(sank(4).winner, 0, "without a call the shared engine stays permissive (the server enforces the call)");
  assert.equal(applyShot(cleared, shotWith(cleared, { firstHit: 8, pocketed: [8, 0], pocketOf: { 8: 2, 0: 3 } }, [8, 0]), 2).winner, 1, "scratching on the 8 still loses");
});

test("pool: the simulation records which pocket each ball dropped in", () => {
  const sim = new PoolSim([{ id: 0, x: 60, y: 60, vx: 0, vy: 0, out: false }], Math.atan2(-1, -1), 0.5).run();
  assert.equal(sim.events.pocketOf?.[0], 0, "the top-left corner is pocket 0");
  assert.equal(POCKETS.length, 6);
});

test("pool aim guide: first contact, the object ball's direction, and the first cushion bounce", () => {
  const balls = [{ id: 0, x: 100, y: 200, out: false }, { id: 5, x: 300, y: 200, out: false }, { id: 6, x: 300, y: 330, out: false }];
  const head = aimPreview(balls, 0);
  assert.ok(head.hit && head.hit.id === 5, "straight at the 5");
  assert.ok(Math.abs(head.hit!.ghost.x - (300 - POOL.R * 2)) < 0.01 && Math.abs(head.hit!.ghost.y - 200) < 0.01, "ghost ball one diameter short");
  assert.ok(Math.abs(head.hit!.objDir.x - 1) < 1e-6 && head.hit!.cueDir === null, "a dead-straight hit sends the 5 on and stops the cue ball");
  assert.equal(head.bounced, false);
  const cut = aimPreview(balls, 0.08); // grazing the lower side of the 5
  assert.equal(cut.hit?.id, 5);
  assert.ok(cut.hit!.objDir.y < 0 && cut.hit!.objDir.x > 0, "a cut sends the object ball up and away");
  assert.ok(cut.hit!.cueDir && cut.hit!.cueDir.y > 0, "and the cue ball glances the other way (a deflection line is shown)");
  // aiming at the top rail: no ball, one bounce, and the path turns
  const rail = aimPreview([balls[0]], -Math.PI / 4);
  assert.equal(rail.hit, null);
  assert.equal(rail.bounced, true);
  assert.ok(rail.path.length >= 3);
  const p = rail.path;
  assert.ok(p[1].y <= POOL.R + 1e-6, "reached the top cushion");
  assert.ok(p[2].y > p[1].y, "and came back down");
  assert.deepEqual(aimPreview([{ id: 0, x: 1, y: 1, out: true }], 0).path, [], "no cue ball, no guide");
  // the preview agrees with the real physics about the first ball struck
  const rack = rackBalls();
  const sim = new PoolSim(rack, 0.01, 0.4).run();
  const pv = aimPreview(rack.map((b) => ({ id: b.id, x: b.x, y: b.y, out: b.out })), 0.01);
  assert.equal(pv.hit?.id, sim.events.firstHit);
});

test("pool bot: with ball in hand it places the cue ball legally and still finishes a game, calling its 8-ball pocket", () => {
  let seed = 7;
  const rng = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  let g = newPoolGame(0);
  let winner: 0 | 1 | null = null, inHandShots = 0, calls = 0;
  for (let turn = 0; turn < 300 && winner === null; turn++) {
    const shot = chooseShot(g, rng, 0.85);
    if (g.inHand) { inHandShots++; if (shot.cue) assert.equal(placeProblem(g, shot.cue.x, shot.cue.y), null, "the bot places the cue on a legal spot"); }
    if (needsCall(g)) { assert.ok(Number.isInteger(shot.pocket), "the bot calls a pocket for the 8"); calls++; }
    const r = playShot(placeCue(g, shot.cue), shot.angle, shot.power, shot.pocket);
    g = r.game; winner = r.winner;
  }
  assert.notEqual(winner, null);
  assert.ok(inHandShots >= 1, "fouls happened and the bot handled ball in hand");
  assert.ok(calls >= 1, "the 8-ball was reached and a pocket was called");
});
