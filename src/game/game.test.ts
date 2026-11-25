import test from "node:test";
import assert from "node:assert/strict";
import { SeatState } from "./seats.ts";
import { NavGrid } from "./pathing.ts";
import { buildSeats, TABLES, SOFAS } from "./layout.ts";
import { LOOKS, renderNpcPixels, NPC_H } from "./npcArt.ts";
import { WORLD_W, WORLD_H, WALL_H, TILE } from "./constants.ts";

// ---------------- seats
test("SeatState: sit, occupied, stand, move seats", () => {
  const s = new SeatState();
  assert.ok(s.sit("player:a", "x1"));
  assert.ok(!s.sit("npc:b", "x1"), "occupied seat refuses a second occupant");
  assert.ok(s.sit("player:a", "x1"), "re-sitting in your own seat is fine");
  assert.ok(s.sit("player:a", "x2"), "moving to a free seat works");
  assert.ok(s.isFree("x1") && !s.isFree("x2"));
  assert.equal(s.seatOf("player:a"), "x2");
  assert.equal(s.stand("player:a"), "x2");
  assert.equal(s.stand("player:a"), undefined);
  assert.deepEqual(s.snapshot(), {});
});

test("SeatState: snapshot round-trips and notifies listeners", () => {
  const a = new SeatState();
  const seen: unknown[] = [];
  a.onChange((snap) => seen.push(snap));
  a.sit("player:1", "s1");
  a.sit("npc:2", "s2");
  assert.equal(seen.length, 2);
  const b = new SeatState();
  b.load(a.snapshot());
  assert.equal(b.occupantOf("s1"), "player:1");
  assert.equal(b.seatOf("npc:2"), "s2");
  assert.ok(!b.sit("player:9", "s2"));
});

// ---------------- layout
test("buildSeats: 6 tables x 4 chairs + 4 sofa seats + 6 private-table seats + 16 arcade stools + 2 racing rigs + 8 lounge couch seats + 6 campfire logs, unique ids", () => {
  const seats = buildSeats();
  assert.equal(seats.length, TABLES.length * 4 + SOFAS.length * 2 + 6 + 8 + 8 + 2 + 8 + 6);
  assert.equal(new Set(seats.map((s) => s.id)).size, seats.length);
  for (const s of seats.filter((x) => !x.id.startsWith("f2-") && !x.id.startsWith("f3-"))) {
    assert.ok(s.exit.x > TILE && s.exit.x < WORLD_W - TILE, `${s.id} exit x in room`);
    assert.ok(s.exit.y > WALL_H && s.exit.y < WORLD_H - TILE, `${s.id} exit y in room`);
  }
});

// ---------------- pathing
test("NavGrid: path goes around a wall and never touches blocked cells", () => {
  const solids = [{ x: 200, y: 0, w: 32, h: 300 }]; // vertical wall with a gap at the bottom
  const nav = new NavGrid(600, 400, solids);
  const path = nav.findPath({ x: 100, y: 100 }, { x: 400, y: 100 });
  assert.ok(path && path.length >= 3, "needs to detour");
  for (let i = 1; i < path.length; i++) assert.ok(nav.lineClear(path[i - 1], path[i]), "each leg is clear");
  assert.ok(path.some((p) => p.y > 300), "goes through the gap");
});

test("NavGrid: unreachable goal returns null; blocked goal snaps to nearest free cell", () => {
  const sealed = new NavGrid(400, 400, [{ x: 100, y: 0, w: 32, h: 400 }]);
  assert.equal(sealed.findPath({ x: 20, y: 200 }, { x: 300, y: 200 }), null);
  const nav = new NavGrid(400, 400, [{ x: 150, y: 150, w: 60, h: 60 }]);
  const near = nav.nearestFree(180, 180);
  assert.ok(near && nav.isFree(near.x, near.y));
});

// ---------------- NPC art
test("NPC art: 32x32, bottom-aligned, every NPC looks different", () => {
  const rendered = Object.entries(LOOKS).map(([id, look]) => [id, renderNpcPixels(look)] as const);
  const keys = new Set<string>();
  for (const [id, px] of rendered) {
    assert.equal(px.length, 32 * 32, id);
    const rows = px.map((c, i) => (c ? Math.floor(i / 32) : -1)).filter((r) => r >= 0);
    assert.equal(Math.max(...rows), 31, `${id} feet on bottom row`);
    assert.ok(Math.max(...rows) - Math.min(...rows) + 1 <= NPC_H + 2, `${id} height`);
    for (const c of px) assert.ok(c === "" || /^#[0-9a-f]{6}$/i.test(c), `${id} bad colour ${c}`);
    keys.add(px.join(","));
  }
  assert.equal(keys.size, rendered.length);
});
