// The arcade overhaul's two physics changes: solid barriers for Neon Drift GP (players and CPUs, with boost pads
// and oil that only fire on real overlap) and lower cloth friction for 8-Ball Pool.
import test from "node:test";
import assert from "node:assert/strict";
import { RACE, confine, newRace, positions, roadFrame, stepRace, track, touchHazards, type Car, type Race, type RaceInput } from "../shared/racer.ts";
import { POCKETS, POOL, PoolSim, newPoolGame, playShot, rackBalls, type PoolBall } from "../shared/pool.ts";
import { mulberry32 } from "../shared/arcade.ts";

// ------------------------------------------------------------------ Neon Drift GP

const STEP = 1000 / 60;
const idle: RaceInput = { left: false, right: false, up: false, down: false, drift: false };
const latOf = (c: Car) => { const tr = track(); return roadFrame(tr, c.x, c.y, c.idx).lat; };
/** How far the car's body pokes past the barrier (0 when inside). */
const breach = (c: Car) => {
  const tr = track();
  const f = roadFrame(tr, c.x, c.y, c.idx);
  const rel = c.angle - Math.atan2(f.ty, f.tx);
  const reach = Math.abs(Math.sin(rel)) * RACE.CAR_HL + Math.abs(Math.cos(rel)) * RACE.CAR_HW;
  return Math.max(0, Math.abs(f.lat) + reach - RACE.EDGE);
};
function run(r: Race, ms: number, inp: (t: number) => RaceInput, each?: (r: Race) => void) {
  const rng = mulberry32(r.seed);
  for (let t = 0; t < ms && !r.done; t += STEP) { stepRace(r, inp(t), STEP, rng); each?.(r); }
}
const afterStart = (r: Race) => run(r, RACE.COUNTDOWN_MS + 50, () => idle);
/** A driver that steers at a point a little ahead, `lat` px off the centreline (0 = follow the road). */
const aimAt = (r: Race, lat = 0, extra: Partial<RaceInput> = {}) => (): RaceInput => {
  const tr = track(), n = tr.pts.length, c = r.cars[0];
  const i = (c.idx + 6) % n, tx = tr.pts[i].x + tr.nx[i] * lat, ty = tr.pts[i].y + tr.ny[i] * lat;
  const want = Math.atan2(ty - c.y, tx - c.x), d = Math.atan2(Math.sin(want - c.angle), Math.cos(want - c.angle));
  return { ...idle, up: true, left: d < -0.05, right: d > 0.05, ...extra };
};

test("racer barriers: holding full lock into the wall never gets the player's body past the barrier", () => {
  for (const dir of ["left", "right"] as const) {
    const r = newRace(4);
    afterStart(r);
    let worst = 0, contacts = 0;
    // steer for a line well outside the barrier, flat out and drifting, for a whole lap's worth of time
    run(r, 20000, aimAt(r, dir === "left" ? -160 : 160, { drift: true }), (rr) => { worst = Math.max(worst, breach(rr.cars[0])); if (rr.cars[0].scrape > 0) contacts++; });
    assert.ok(worst < 0.5, `${dir}: body stayed inside (worst breach ${worst.toFixed(2)} px)`);
    assert.ok(contacts > 0, `${dir}: and it really did reach the barrier`);
  }
});

test("racer barriers: a boost-speed car fired straight at the wall cannot tunnel through, loses speed and sparks", () => {
  const tr = track(), r = newRace(5);
  afterStart(r);
  const c = r.cars[0];
  const i = 150;
  c.idx = i; c.x = tr.pts[i].x; c.y = tr.pts[i].y;
  c.angle = Math.atan2(tr.ny[i], tr.nx[i]); // nose pointed square at the right-hand barrier
  c.vx = tr.nx[i] * RACE.BOOST_MAX * 1.4; c.vy = tr.ny[i] * RACE.BOOST_MAX * 1.4; // faster than the game ever goes
  c.boost = 5000;
  let worst = 0, scraped = false;
  run(r, 600, () => ({ ...idle, up: true }), (rr) => { worst = Math.max(worst, breach(rr.cars[0])); scraped ||= rr.cars[0].scrape > 0 && rr.cars[0].scrapeSide === 1; });
  assert.ok(worst < 0.5, `no tunnelling (worst ${worst.toFixed(2)})`);
  assert.ok(scraped, "contact registered on the right-hand side");
  assert.ok(latOf(c) < RACE.EDGE, "still on the track side of the barrier");
  const v = c.vx * tr.nx[c.idx] + c.vy * tr.ny[c.idx];
  assert.ok(v < 120, `no longer driving into the wall (${v.toFixed(0)} px/s outward)`);
});

test("racer barriers: a car pinned nose-first against the wall recovers and drives on", () => {
  const tr = track(), r = newRace(6);
  afterStart(r);
  const c = r.cars[0];
  const i = 200, startIdx = i;
  const lim = RACE.EDGE - RACE.CAR_HL;
  c.idx = i; c.x = tr.pts[i].x + tr.nx[i] * lim; c.y = tr.pts[i].y + tr.ny[i] * lim;
  c.angle = Math.atan2(tr.ny[i], tr.nx[i]); c.vx = 0; c.vy = 0;
  const visited0 = c.visited;
  let top = 0;
  run(r, 5000, aimAt(r), (rr) => { top = Math.max(top, Math.hypot(rr.cars[0].vx, rr.cars[0].vy)); });
  assert.ok(c.visited - visited0 > 20 || c.idx - startIdx > 20, `made progress along the lap (visited ${c.visited - visited0})`);
  assert.ok(top > RACE.MAX * 0.85, `back up to racing speed (${top.toFixed(0)} px/s)`);
  assert.ok(breach(c) < 0.5);
});

test("racer barriers: every CPU stays inside the barriers, and a whole race still finishes with sane laps and positions", () => {
  const r = newRace(11);
  let worst = 0;
  run(r, 400000, aimAt(r), (rr) => { for (const c of rr.cars) worst = Math.max(worst, breach(c)); });
  assert.ok(worst < 0.5, `all 20 cars stayed inside (worst ${worst.toFixed(2)})`);
  assert.ok(r.done, "the race ended");
  const tr = track();
  assert.ok(r.cars[0].finishedAt !== null, "the player finished");
  for (const c of r.cars.slice(1)) {
    // the race ends 4 s after the player finishes, so the back of the field may still be on its last lap
    assert.ok(c.lap >= RACE.LAPS - 1, `${c.name} is on its last lap or done (lap ${c.lap})`);
    assert.ok(c.best >= tr.minLapMs && c.best < 60000, `${c.name}: best lap ${c.best} is legal`);
    if (c.finishedAt !== null) assert.equal(c.lap, RACE.LAPS);
  }
  const pos = positions(r);
  assert.deepEqual([...pos].sort((a, b) => a - b), Array.from({ length: RACE.FIELD }, (_, k) => k + 1), "positions are a permutation");
});

test("racer barriers: a chaotic player ramming the field never leaves anyone stuck or through a wall", () => {
  for (const seed of [3, 17, 29]) {
    const r = newRace(seed), pick = mulberry32(seed * 7 + 1);
    let held: RaceInput = idle, worst = 0, longest = 0;
    const slow = new Map<number, number>();
    run(r, 70000, (t) => {
      if (Math.floor(t / 400) !== Math.floor((t - STEP) / 400)) held = { up: pick() < 0.85, down: pick() < 0.1, left: pick() < 0.4, right: pick() < 0.4, drift: pick() < 0.3 };
      return held;
    }, (rr) => {
      for (const c of rr.cars) {
        worst = Math.max(worst, breach(c));
        if (c.human || rr.t < RACE.COUNTDOWN_MS + 500) continue;
        const s = Math.hypot(c.vx, c.vy) < 40 ? (slow.get(c.id) ?? 0) + STEP : 0;
        slow.set(c.id, s); longest = Math.max(longest, s);
      }
    });
    assert.ok(worst < 0.5, `seed ${seed}: nobody breached a barrier (${worst.toFixed(2)})`);
    assert.ok(longest < 6000, `seed ${seed}: no CPU was stuck (longest crawl ${(longest / 1000).toFixed(1)} s)`);
  }
});

test("racer: a player holding the throttle laps the circuit, and lap times stay above the server's minimum", () => {
  const r = newRace(12), tr = track();
  run(r, 300000, aimAt(r));
  const me = r.cars[0];
  assert.equal(me.lap, RACE.LAPS);
  assert.ok(me.finishedAt !== null && me.best >= tr.minLapMs, `best lap ${me.best} >= ${tr.minLapMs}`);
});

test("racer hazards: boost pads fire once per pass and only when the car is really over them", () => {
  const tr = track(), r = newRace(1);
  const c = r.cars[0];
  const k = 1, i = tr.padIdx[k], p = tr.pads[k];
  const put = (along: number, lat: number) => { c.x = p.x + tr.tx[i] * along + tr.nx[i] * lat; c.y = p.y + tr.ty[i] * along + tr.ny[i] * lat; c.idx = i; };
  const ev: string[] = [];
  // beside the pad (in the next lane over) nothing happens
  c.boost = 0; c.pad = -1; put(0, RACE.PAD_HW + RACE.CAR_HW + 4); touchHazards(c, tr, ev as never);
  assert.equal(c.boost, 0); assert.equal(ev.length, 0);
  // just short of it, nothing
  put(-(RACE.PAD_HL + RACE.CAR_HL), 0); touchHazards(c, tr, ev as never);
  assert.equal(c.boost, 0);
  // rolling across it: exactly one boost
  for (let a = -40; a <= 40; a += 2) { put(a, 3); c.boost = Math.max(0, c.boost - 100); touchHazards(c, tr, ev as never); }
  assert.deepEqual(ev, ["boost"], "one trigger for one pass");
  // sitting on it does not re-trigger, coming back for a second pass does
  put(0, 0); touchHazards(c, tr, ev as never); touchHazards(c, tr, ev as never);
  assert.equal(ev.length, 2, "re-entered after leaving: one more");
});

test("racer hazards: oil only catches a car that overlaps the slick, once, and respects the spin cooldown", () => {
  const tr = track(), r = newRace(1);
  const c = r.cars[0];
  const k = 0, i = tr.oilIdx[k], p = tr.oil[k];
  const put = (along: number, lat: number) => { c.x = p.x + tr.tx[i] * along + tr.nx[i] * lat; c.y = p.y + tr.ty[i] * along + tr.ny[i] * lat; c.idx = i; };
  const ev: string[] = [];
  c.oil = 0; c.slick = -1; c.vx = 200; c.vy = 0;
  put(0, -(RACE.OIL_RY + 14)); touchHazards(c, tr, ev as never);
  assert.equal(c.oil, 0, "passing beside the slick is safe");
  put(0, 0); touchHazards(c, tr, ev as never);
  assert.equal(c.oil, RACE.OIL_MS); assert.equal(c.vx, 150); assert.deepEqual(ev, ["oil"]);
  c.oil = 0; touchHazards(c, tr, ev as never);
  assert.equal(ev.length, 1, "still on the same slick: no second hit");
  put(60, 0); touchHazards(c, tr, ev as never); // left it
  c.oil = 500; put(0, 0); touchHazards(c, tr, ev as never);
  assert.equal(ev.length, 1, "a car still spinning is not caught again (cooldown kept)");
});

test("racer: rivals deflect each other and a shove can't push a car through the barrier", () => {
  const tr = track(), r = newRace(2);
  afterStart(r);
  const [a, b] = [r.cars[0], r.cars[1]];
  const i = 60;
  const place = (c: Car, lat: number, along: number) => { c.idx = i; c.x = tr.pts[i].x + tr.nx[i] * lat + tr.tx[i] * along; c.y = tr.pts[i].y + tr.ny[i] * lat + tr.ty[i] * along; c.angle = Math.atan2(tr.ty[i], tr.tx[i]); };
  for (const c of r.cars.slice(2)) { c.x = -9999; c.y = -9999; c.finishedAt = 0; }
  place(a, RACE.EDGE - RACE.CAR_HW - 2, 0); place(b, RACE.EDGE - RACE.CAR_HW - 14, 0);
  a.vx = b.vx = tr.tx[i] * 200; a.vy = b.vy = tr.ty[i] * 200;
  b.vx += tr.nx[i] * 260; b.vy += tr.ny[i] * 260; // b swerves into a, which is against the wall
  run(r, 300, () => ({ ...idle, up: true }));
  assert.ok(breach(a) < 0.5 && breach(b) < 0.5, "neither car ends up inside the wall");
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= RACE.CAR_R * 2 - 1, "they are pushed apart");
  void confine;
});

// ------------------------------------------------------------------ 8-Ball Pool friction

/** Distance a lone ball rolls on an open table from a given power (no cushions in the way). */
function rollDistance(power: number) {
  const sim = new PoolSim([{ id: 0, x: 20, y: POOL.H / 2, vx: 0, vy: 0, out: false }], 0, power);
  let travelled = 0, px = sim.balls[0].x, py = sim.balls[0].y, bounced = false;
  while (!sim.done) {
    sim.step();
    const b = sim.balls[0];
    travelled += Math.hypot(b.x - px, b.y - py); px = b.x; py = b.y;
    if (b.x >= POOL.W - POOL.R - 0.01) bounced = true;
  }
  return { travelled, steps: sim.steps, bounced };
}

test("pool friction: balls keep their momentum longer than the old 280 px/s² constant drag", () => {
  const old = (p: number) => { const v = POOL.VMAX * p; return (v * v) / (2 * 280); };
  for (const p of [0.08, 0.15, 0.3, 0.5]) {
    const d = rollDistance(p).travelled;
    assert.ok(d > old(p) * 1.3, `power ${p}: rolls ${d.toFixed(0)} px (was ${old(p).toFixed(0)})`);
  }
  // a gentle tap still rolls a useful distance instead of dying on the spot
  assert.ok(rollDistance(0.08).travelled > 40, "a soft touch travels two ball-widths and more");
  // and a medium shot covers the table length
  assert.ok(rollDistance(0.5).bounced, "half power reaches the far cushion");
});

test("pool friction: every shot still comes to rest naturally, well inside the step budget", () => {
  for (const p of [0.05, 0.3, 0.7, 1]) {
    const { steps } = rollDistance(p);
    assert.ok(steps < POOL.MAX_STEPS * 0.5, `power ${p}: rests after ${(steps * POOL.DT).toFixed(1)} s`);
  }
  const brk = new PoolSim(rackBalls(), 0.01, 1).run();
  assert.ok(brk.steps < POOL.MAX_STEPS, "a full break settles");
  assert.ok(brk.balls.every((b) => b.out || (b.vx === 0 && b.vy === 0)), "everything stopped");
  assert.ok(brk.balls.every((b) => b.out || (b.x >= POOL.R - 1e-6 && b.x <= POOL.W - POOL.R + 1e-6 && b.y >= POOL.R - 1e-6 && b.y <= POOL.H - POOL.R + 1e-6)), "no ball escaped the cushions");
});

test("pool friction: the ball slows smoothly (rolling resistance plus a little cloth drag), never stopping abruptly", () => {
  const sim = new PoolSim([{ id: 0, x: 20, y: POOL.H / 2, vx: 0, vy: 0, out: false }], 0.0, 0.35);
  const speeds: number[] = [];
  while (!sim.done) { sim.step(); speeds.push(Math.hypot(sim.balls[0].vx, sim.balls[0].vy)); }
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] <= speeds[i - 1] + 1e-9 || speeds[i - 1] === 0 || Math.abs(speeds[i] - speeds[i - 1]) > 50, "monotonic apart from cushion contacts");
  const lastMoving = speeds.filter((v) => v > 0).at(-1)!;
  assert.ok(lastMoving <= POOL.STOP + 1, `it creeps to a halt (last speed ${lastMoving.toFixed(1)})`);
});

test("pool friction: the break is energetic, collisions stay stable (no overlaps), and pockets still catch balls", () => {
  const brk = new PoolSim(rackBalls(), 0.01, 1);
  let maxSpeedAfter = 0;
  for (let i = 0; i < 240; i++) brk.step();
  for (const b of brk.balls) if (!b.out && b.id !== 0) maxSpeedAfter = Math.max(maxSpeedAfter, Math.hypot(b.vx, b.vy));
  assert.ok(maxSpeedAfter > 250, `object balls still flying a second after the break (${maxSpeedAfter.toFixed(0)} px/s)`);
  brk.run();
  const live = brk.balls.filter((b) => !b.out);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) assert.ok(Math.hypot(live[i].x - live[j].x, live[i].y - live[j].y) >= POOL.R * 2 - 0.5, "no balls left overlapping");
  // a straight pot into a corner pocket at gentle and firm speeds
  for (const power of [0.25, 0.6]) {
    const balls: PoolBall[] = [{ id: 0, x: 200, y: 200, vx: 0, vy: 0, out: false }, { id: 3, x: 200 - 60 / Math.SQRT2, y: 200 - 60 / Math.SQRT2, vx: 0, vy: 0, out: false }];
    const sim = new PoolSim(balls, Math.atan2(-1, -1), power).run();
    assert.ok(sim.events.pocketed.includes(3), `power ${power}: the 3 drops`);
    assert.equal(sim.events.pocketOf?.[3], 0);
    void POCKETS;
  }
});

test("pool friction: a bank shot off one cushion comes back cleanly (angle in = angle out, speed reduced)", () => {
  const sim = new PoolSim([{ id: 0, x: 200, y: 300, vx: 0, vy: 0, out: false }], -Math.PI / 4, 0.4);
  let vIn = 0, vOut = 0, bounced = false;
  while (!sim.done) {
    const before = { ...sim.balls[0] };
    sim.step();
    const b = sim.balls[0];
    if (!bounced && before.vy < 0 && b.vy > 0) { bounced = true; vIn = Math.hypot(before.vx, before.vy); vOut = Math.hypot(b.vx, b.vy); assert.ok(Math.abs(Math.abs(Math.atan2(b.vy, b.vx)) - Math.PI / 4) < 0.12, "mirror angle (within the cushion's energy loss)"); }
  }
  assert.ok(bounced, "it hit the top cushion");
  assert.ok(vOut < vIn && vOut > vIn * 0.75, `the cushion takes some pace off (${vIn.toFixed(0)} -> ${vOut.toFixed(0)})`);
});

test("pool: rules and determinism are unchanged by the friction change", () => {
  const g = newPoolGame();
  const a = playShot(g, 0.01, 1), b = playShot(g, 0.01, 1);
  assert.deepEqual(a.game.balls, b.game.balls);
  assert.equal(a.game.breaking, false);
});
