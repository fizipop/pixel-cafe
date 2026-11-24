import test from "node:test";
import assert from "node:assert/strict";
import {
  POLAROID_WALL_CAP, ROAST_RATE_MAX, ROAST_RATE_MIN, ROAST_THRESHOLDS, WISH_MAX, isPackedSprite, packPixels, polaroidSlots, polaroidStamp,
  roastGrade, roastHeat, unpackPixels,
} from "../shared/rooftop.ts";
import { CONSTELLATIONS, constellationAt } from "../lib/constellations.ts";
import { ROOFTOP_BPM, rooftopStep, rooftopStepSeconds } from "../lib/rooftopMusic.ts";
import { FLOOR3_X, STAIRS, floorOfSeat } from "../shared/floors.ts";
import { WALL_H, WORLD_H, WORLD_W, TILE } from "./constants.ts";
import { NavGrid } from "./pathing.ts";
import {
  FIREPIT, LIGHT_STRANDS, LOGS, PHOTO_STAND, POLAROID_WALL, ROOF_PLANTS, TELESCOPE, isFireSeat, rooftopSeats, rooftopSolids, strandPoints,
} from "./rooftopLayout.ts";
import { buildSeats } from "./layout.ts";

const X0 = FLOOR3_X;

// ------------------------------------------------------------------ roasting

test("roast: grades follow the heat thresholds and only the golden window is perfect", () => {
  assert.equal(roastGrade(0), "raw");
  assert.equal(roastGrade(ROAST_THRESHOLDS.toasty - 0.01), "raw");
  assert.equal(roastGrade(ROAST_THRESHOLDS.toasty), "toasty");
  assert.equal(roastGrade(ROAST_THRESHOLDS.golden), "golden");
  assert.equal(roastGrade(ROAST_THRESHOLDS.brown - 0.01), "golden");
  assert.equal(roastGrade(ROAST_THRESHOLDS.brown), "brown");
  assert.equal(roastGrade(ROAST_THRESHOLDS.burnt), "burnt");
  assert.equal(roastGrade(99), "burnt");
});

test("roast: heat grows with time x rate, and the golden window is wide enough to hit at any rate", () => {
  assert.equal(roastHeat(2000, 1), 2);
  assert.equal(roastHeat(-50, 1), 0);
  for (const rate of [ROAST_RATE_MIN, 1, ROAST_RATE_MAX]) {
    const windowMs = ((ROAST_THRESHOLDS.brown - ROAST_THRESHOLDS.golden) / rate) * 1000;
    assert.ok(windowMs >= 800, `golden window at rate ${rate} is ${Math.round(windowMs)}ms`);
  }
});

// ------------------------------------------------------------------ polaroid sprites

test("polaroid: packed sprites round-trip, stay small, and reject garbage", () => {
  const px = Array.from({ length: 1024 }, (_, i) => (i % 32 < 8 ? "" : i % 5 === 0 ? "#FF0000" : "#336699"));
  const packed = packPixels(px);
  assert.ok(isPackedSprite(packed));
  assert.deepEqual(unpackPixels(packed), px.map((c) => c.toLowerCase()));
  assert.ok(JSON.stringify(packed).length < JSON.stringify(px).length / 2);
  assert.deepEqual(unpackPixels(packPixels(Array(1024).fill(""))), Array(1024).fill(""));
  assert.equal(unpackPixels(packPixels([])).length, 1024, "a short sprite is padded, never short");
  for (const bad of [null, {}, { pal: [], runs: [0, 1000] }, { pal: ["red"], runs: [1, 1024] }, { pal: ["#fff"], runs: [2, 1024] }, { pal: [], runs: [0, 1024, 0] }, { pal: [], runs: [0, 0, 0, 1024] }]) {
    assert.equal(isPackedSprite(bad), false, JSON.stringify(bad));
  }
  assert.equal(isPackedSprite({ pal: [], runs: [0, 1024] }), true);
});

test("polaroid: one slot per person, everyone fits inside the 216px picture, names fit in the caption", () => {
  assert.deepEqual(polaroidSlots(0), []);
  for (let n = 1; n <= 6; n++) {
    const slots = polaroidSlots(n);
    assert.equal(slots.length, n);
    for (const s of slots) {
      assert.ok(s.x - (32 * s.scale) / 2 >= -8 && s.x + (32 * s.scale) / 2 <= 224, `n=${n} x=${s.x}`);
      assert.ok(s.y <= 168 && s.y - 32 * s.scale >= -24, `n=${n} y=${s.y}`);
    }
  }
  assert.equal(polaroidSlots(9).length, 6, "never more than six");
  assert.match(polaroidStamp(Date.UTC(2026, 10, 24, 21, 41)), /^[A-Z][a-z]{2} \d{1,2} · \d{1,2}:\d{2} (AM|PM)$/);
  assert.ok(POLAROID_WALL_CAP >= 12 && WISH_MAX >= 40);
});

// ------------------------------------------------------------------ layout

test("rooftop layout: seats are unique, on Floor 3, inside the deck and not inside furniture", () => {
  const seats = rooftopSeats();
  assert.equal(seats.length, 6);
  assert.equal(new Set(seats.map((s) => s.id)).size, 6);
  const all = buildSeats();
  assert.equal(new Set(all.map((s) => s.id)).size, all.length, "seat ids unique across all floors");
  const solids = rooftopSolids(STAIRS[3].solid);
  const inside = (x: number, y: number) => x > X0 + TILE && x < X0 + WORLD_W - TILE && y > WALL_H && y < WORLD_H - TILE;
  const blocked = (x: number, y: number) => solids.some((s) => x >= s.x - 4 && x <= s.x + s.w + 4 && y >= s.y - 4 && y <= s.y + s.h + 4);
  for (const s of seats) {
    assert.equal(floorOfSeat(s.id), 3);
    assert.ok(isFireSeat(s.id));
    assert.ok(inside(s.x, s.y), `${s.id} seat`);
    assert.ok(inside(s.exit.x, s.exit.y), `${s.id} exit`);
    assert.equal(blocked(s.exit.x, s.exit.y), false, `${s.id} exit is clear`);
  }
  assert.equal(isFireSeat("f3-fire-7"), false);
  assert.equal(isFireSeat("f2-bj0-1"), false);
  assert.equal(isFireSeat(null), false);
});

test("rooftop layout: furniture does not overlap, and every spot you use is reachable from the elevator", () => {
  const solids = rooftopSolids(STAIRS[3].solid);
  for (let i = 0; i < solids.length; i++) {
    for (let j = i + 1; j < solids.length; j++) {
      const a = solids[i], b = solids[j];
      const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      assert.equal(overlap, false, `solid ${i} overlaps solid ${j}`);
    }
  }
  const nav = new NavGrid(X0 + WORLD_W, WORLD_H, [
    ...solids,
    { x: X0, y: 0, w: WORLD_W, h: WALL_H }, { x: X0, y: 0, w: TILE, h: WORLD_H },
    { x: X0 + WORLD_W - TILE, y: 0, w: TILE, h: WORLD_H }, { x: X0, y: WORLD_H - TILE, w: WORLD_W, h: TILE },
  ]);
  const from = nav.nearestFree(STAIRS[3].arrive.x, STAIRS[3].arrive.y)!;
  const goals = [
    ...rooftopSeats().map((s) => ({ name: s.id, ...s.exit })),
    { name: "telescope", ...TELESCOPE.spot }, { name: "photo stand", ...PHOTO_STAND.spot },
    { name: "wall", ...POLAROID_WALL.spot }, { name: "elevator", ...STAIRS[3].spot }, { name: "firepit", ...FIREPIT.spot },
  ];
  for (const g of goals) {
    assert.ok(nav.isFree(g.x, g.y), `${g.name} is not inside furniture`);
    assert.ok(nav.findPath(from, g), `${g.name} can be reached from the elevator`);
  }
  assert.ok(LOGS.every((l) => l.x > X0 && l.x + l.w < X0 + WORLD_W) && ROOF_PLANTS.every(([x]) => x > X0 + TILE && x < X0 + WORLD_W - TILE));
});

test("rooftop layout: the fairy lights hang between their posts and sag downward", () => {
  for (const s of LIGHT_STRANDS) {
    const pts = strandPoints(s, s.bulbs);
    assert.equal(pts.length, s.bulbs);
    assert.ok(pts.every((p) => p.x >= X0 && p.x <= X0 + WORLD_W && p.y > 0 && p.y < WORLD_H));
    const mid = pts[Math.floor(pts.length / 2)];
    assert.ok(mid.y > s.y0 + s.sag * 0.8, "the middle droops");
  }
});

// ------------------------------------------------------------------ audio + sky

test("rooftop music: a four-bar slow loop with piano chords, plucks, bass and bells", () => {
  assert.ok(ROOFTOP_BPM >= 60 && ROOFTOP_BPM <= 80, "slow and cozy");
  assert.ok(rooftopStepSeconds() > 0.2);
  const steps = Array.from({ length: 64 }, (_, i) => rooftopStep(i));
  assert.equal(steps.filter((s) => s.keys).length, 8, "two chord hits per bar");
  assert.ok(steps.filter((s) => s.pluck).length >= 20);
  assert.ok(steps.filter((s) => s.bell).length >= 4 && steps.filter((s) => s.bell).length <= 12, "the melody is sparse");
  assert.deepEqual(rooftopStep(64), rooftopStep(0), "loops");
  assert.deepEqual(rooftopStep(-64), rooftopStep(0));
  for (const s of steps) for (const f of [...(s.keys ?? []), s.bass ?? 100, s.pluck ?? 100, s.bell ?? 100]) assert.ok(f > 20 && f < 3000);
  assert.notDeepEqual(rooftopStep(0).keys, rooftopStep(16).keys, "the chords change every bar");
});

test("constellations: named, drawn from valid points, and findable by position", () => {
  assert.ok(CONSTELLATIONS.length >= 5);
  assert.equal(new Set(CONSTELLATIONS.map((c) => c.id)).size, CONSTELLATIONS.length);
  for (const c of CONSTELLATIONS) {
    assert.ok(c.name && c.blurb);
    assert.ok(c.points.every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1), c.id);
    assert.ok(c.lines.every(([a, b]) => a !== b && a < c.points.length && b < c.points.length), c.id);
    assert.equal(constellationAt(c.points[0][0], c.points[0][1])?.id === c.id || constellationAt(c.points[1][0], c.points[1][1])?.id === c.id, true, `${c.id} can be hovered`);
  }
  assert.equal(constellationAt(0.5, 0.45), null, "empty sky");
});
