// The Arcade & Casino expansion: zones, rigs, dance floor, lounge, the crowd and the Pixel Restaurant crew, the big
// screen's football match, the announcer's rules, and the Neon Drift terrain clearance.
import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCADE_H, BIG_SCREEN, DANCE_PADS, LOUNGE_SOFAS, MACHINES, RIG, RIGS, ROULETTE, arcadeSeats, arcadeSolids, arcadeWalls, loungeSeats, rigSeats,
} from "./arcadeLayout.ts";
import { ARCADE_CROWD, ALL_NPC_SEATS, CREW, CREW_TABLE, CREW_TALKS, crowdSpots } from "./crowd.ts";
import { buildSeats } from "./layout.ts";
import { LOOKS, renderNpcBackPixels, renderNpcPixels } from "./npcArt.ts";
import { NavGrid } from "./pathing.ts";
import { FLOOR2_X, STAIRS, WORLD_TOTAL_H, WORLD_TOTAL_W, clampToFloor, floorBounds } from "../shared/floors.ts";
import { PITCH, newMatch, stepMatch } from "./sportsSim.ts";
import { AnnounceQueue, LINE_PRIORITY, moodOf } from "../lib/announcer.ts";
import { CLEAR_MAX, groundClearance } from "../shared/racer.ts";
import { RACE, track } from "../shared/racer.ts";

const nav2 = () => new NavGrid(WORLD_TOTAL_W, ARCADE_H, [...arcadeSolids(STAIRS[2].solid), ...arcadeWalls()]);

test("floor 2 is taller, and the server, camera and physics all know it", () => {
  assert.equal(floorBounds(2).h, ARCADE_H);
  assert.ok(ARCADE_H > 768);
  assert.ok(WORLD_TOTAL_H >= ARCADE_H);
  assert.deepEqual(clampToFloor(2, FLOOR2_X + 10, ARCADE_H - 50), { x: FLOOR2_X + 10, y: ARCADE_H - 50 });
  assert.equal(clampToFloor(1, 10, ARCADE_H - 50).y, 768, "Floor 1 is still its old size");
});

test("racing rigs: each seat sits in front of its own cabinet, and sitting there opens Neon Drift GP (not a table)", () => {
  const seats = rigSeats();
  assert.equal(seats.length, RIGS.length);
  RIGS.forEach((r, i) => {
    const s = seats[i];
    assert.ok(s.x > r.x && s.x < r.x + RIG.w, "the seat is centred on its rig");
    assert.ok(s.y > r.y + RIG.cabH - 4 && s.y < r.y + RIG.cabH + RIG.seatH, "in the seat area, right in front of the screen");
    assert.ok(s.exit.y > r.y + RIG.cabH + RIG.seatH, "you climb out behind the seat");
  });
  assert.ok(RIGS[1].x - RIGS[0].x >= RIG.w + 8, "twin rigs side by side with a gap");
});

test("beat battle: two stations, each with a dance pad on the floor right in front of it, the pad being the play spot", () => {
  const beats = MACHINES.filter((m) => m.game === "beat");
  assert.equal(beats.length, 2);
  assert.equal(DANCE_PADS.length, 2);
  beats.forEach((m, i) => {
    const p = DANCE_PADS[i];
    assert.ok(m.spot.x > p.x && m.spot.x < p.x + p.w && m.spot.y > p.y && m.spot.y < p.y + p.h, "you stand on the pad to play");
    assert.ok(p.y >= m.y + m.h - 4, "the pad is in front of its cabinet");
  });
  assert.ok(DANCE_PADS[1].x >= DANCE_PADS[0].x + DANCE_PADS[0].w, "the pads don't overlap");
});

test("sports lounge: couches face the big screen, and every couch seat can be reached", () => {
  for (const s of LOUNGE_SOFAS) assert.ok(s.y > BIG_SCREEN.y + BIG_SCREEN.h && s.x >= BIG_SCREEN.x - 20 && s.x + 96 <= BIG_SCREEN.x + BIG_SCREEN.w + 20);
  const nav = nav2(), from = nav.nearestFree(STAIRS[2].arrive.x, STAIRS[2].arrive.y)!;
  for (const s of loungeSeats()) { assert.ok(nav.isFree(s.exit.x, s.exit.y), s.id); assert.ok(nav.findPath(from, s.exit), `${s.id} reachable`); }
});

test("the arcade crowd: every NPC spot is clear, reachable, and out of the way of every Press E spot and seat", () => {
  const nav = nav2(), from = nav.nearestFree(STAIRS[2].arrive.x, STAIRS[2].arrive.y)!;
  const seats = buildSeats();
  const keep = [...MACHINES.filter((m) => m.game).map((m) => ({ n: m.id, ...m.spot })), ...arcadeSeats().map((s) => ({ n: s.id, ...s.exit })), { n: "elevator", ...STAIRS[2].spot }];
  for (const p of crowdSpots(seats)) {
    assert.ok(p.x > 0, `${p.id}: its seat exists`);
    assert.ok(nav.isFree(p.x, p.y), `${p.id} at ${p.x},${p.y} is not inside furniture`);
    assert.ok(nav.findPath(from, p), `${p.id} at ${p.x},${p.y} is reachable`);
    for (const k of keep) assert.ok(Math.hypot(k.x - p.x, k.y - p.y) >= 24, `${p.id} stands on ${k.n}'s spot`);
  }
  const archetypes = new Set(ARCADE_CROWD.map((s) => s.tag));
  assert.ok(archetypes.size >= 8, "a varied crowd");
  for (const s of ARCADE_CROWD) { assert.ok(s.lines.length >= 3, s.id); assert.equal(new Set(s.lines).size, s.lines.length, `${s.id}: no repeated lines`); }
});

test("Togi: at the roulette table, interactable, energetic, with his own reactions", () => {
  const togi = ARCADE_CROWD.find((s) => s.id === "togi")!;
  assert.ok(togi);
  const d = Math.hypot(togi.home.x - ROULETTE.x, togi.home.y - (ROULETTE.y + ROULETTE.h / 2));
  assert.ok(d < 80, `next to the roulette table (${d.toFixed(0)}px)`);
  assert.equal(togi.idle, "hype");
  assert.ok(togi.react?.jackpot && togi.react.lose && togi.greet?.length && togi.lines.length >= 5);
  assert.ok(LOOKS.togi, "his own look");
});

test("Pixel Restaurant crew: four friends at one table, distinct looks (the twins alike but distinguishable), conversations", () => {
  assert.deepEqual(CREW.map((c) => c.name), ["Faizan", "Puneet", "Cris", "Nick"]);
  const seats = new Set(CREW.map((c) => c.seatId));
  assert.equal(seats.size, 4);
  for (const s of seats) assert.ok(s!.startsWith(`t${CREW_TABLE}-`), "all at the same table");
  for (const c of CREW) { assert.equal(c.behavior, "sitter"); assert.equal(c.idle, "type"); assert.ok(c.lines.length >= 5 && c.greet?.length); assert.equal(ALL_NPC_SEATS[c.seatId!], `npc:${c.id}`); }
  const px = Object.fromEntries(CREW.map((c) => [c.id, renderNpcPixels(LOOKS[c.id]).join()]));
  assert.equal(new Set(Object.values(px)).size, 4, "four different sprites");
  // the twins share a face (skin and eyes) but not clothes
  assert.equal(LOOKS.cris.pal.s, LOOKS.nick.pal.s);
  assert.notEqual(LOOKS.cris.pal.t, LOOKS.nick.pal.t);
  // every conversation line belongs to a crew member, and talks rotate between people
  for (const talk of CREW_TALKS) { for (const [who] of talk) assert.ok(CREW.some((c) => c.id === who), who); assert.ok(new Set(talk.map(([w]) => w)).size >= 3); }
  const text = [...CREW.flatMap((c) => c.lines), ...CREW_TALKS.flat().map(([, l]) => l)].join(" ");
  assert.match(text, /Pixel Restaurant/);
});

test("NPC seats: every chair an NPC sits in exists, and the server keeps players out of all of them", () => {
  const ids = new Set(buildSeats().map((s) => s.id));
  for (const [seat, who] of Object.entries(ALL_NPC_SEATS)) { assert.ok(ids.has(seat), seat); assert.match(who, /^npc:/); }
  const back = renderNpcBackPixels(LOOKS.marco), front = renderNpcPixels(LOOKS.marco);
  assert.notDeepEqual(back, front, "sports fans are seen from behind");
});

test("big screen: an endless fictional match with a running clock, goals, and everyone staying on the pitch", () => {
  const m = newMatch(5);
  const kinds = new Set<string>();
  let goals = 0;
  for (let i = 0; i < 12 * 60 * 6; i++) { // six minutes of screen time at 12 frames a second
    const before = m.score[0] + m.score[1];
    stepMatch(m, 1 / 12);
    if (m.event) kinds.add(m.event.kind);
    goals += Math.max(0, m.score[0] + m.score[1] - before);
    assert.ok(m.ball.x >= -5 && m.ball.x <= PITCH.w + 5 && m.ball.y >= -5 && m.ball.y <= PITCH.h + 5, "ball on the pitch");
  }
  assert.ok(m.t > 60 * 60 || kinds.has("fulltime"), "the clock runs");
  assert.ok(goals > 0, "somebody scores");
  assert.ok(kinds.has("kickoff") && kinds.has("goal"));
});

test("announcer: one line at a time, big moments cut in, small ones wait their turn, nothing repeats too fast", () => {
  const q = new AnnounceQueue();
  assert.equal(q.decide("WINNER!", 0), "start");
  q.started("WINNER!", 0, 1500);
  assert.equal(q.decide("SO CLOSE!", 100), "interrupt", "a notable line cuts off a minor one");
  assert.equal(q.decide("BETTER LUCK NEXT TIME!", 100), "drop", "same priority waits");
  q.started("JACKPOT!", 200, 2000);
  assert.equal(q.decide("BIG WIN!", 300), "drop", "nothing interrupts a jackpot");
  assert.equal(q.decide("K.O.!", 300), "drop", "not even another major line");
  q.finished();
  assert.equal(q.decide("WINNER!", 3000), "drop", "WINNER! is on its cooldown");
  assert.equal(q.decide("WINNER!", 6000), "start");
  assert.equal(LINE_PRIORITY["JACKPOT!"], 3);
  assert.equal(LINE_PRIORITY["HUFF AND PUFF BONUS!"], 3);
  assert.equal(moodOf("JACKPOT!"), "jackpot");
  assert.equal(moodOf("BETTER LUCK NEXT TIME!"), "lose");
  assert.equal(moodOf("GET READY!"), "neutral");
});

test("neon drift terrain: the ground beside each road sample is clamped to that sample's side of the medial axis", () => {
  const tr = track(), n = tr.pts.length;
  let insideHairpin = Infinity, open = 0;
  for (let i = 0; i < n; i++) for (const side of [-1, 1] as const) {
    const c = groundClearance(tr.pts, tr.nx, tr.ny, i, side);
    assert.ok(c >= 0 && c <= CLEAR_MAX);
    insideHairpin = Math.min(insideHairpin, c);
    if (c >= 280) open++;
    // at the clamped distance, no other stretch of the circuit's centreline is clearly nearer: the ground drawn there
    // belongs to this strip, so it can never be painted across another strip's road
    const x = tr.pts[i].x + tr.nx[i] * side * c, y = tr.pts[i].y + tr.ny[i] * side * c;
    for (let j = 0; j < n; j++) if (j !== i) assert.ok(Math.hypot(tr.pts[j].x - x, tr.pts[j].y - y) >= c * 0.96 - 2 - 1e-9, `sample ${i} side ${side}`);
  }
  assert.ok(insideHairpin < RACE.EDGE, "the inside of the tightest hairpin is clamped inside the barrier line");
  assert.ok(open > n / 2, "open country stays wide open");
});
