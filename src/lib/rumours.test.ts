import test from "node:test";
import assert from "node:assert/strict";
import {
  addRumour, allRumours, loadState, sortRumours, toggleLike, validateRumour, timeAgo,
  RUMOUR_MAX, RUMOUR_TTL_MS, POST_COOLDOWN_MS, likesOf,
} from "./rumours.ts";

const fakeStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("validateRumour: trims, collapses whitespace, enforces 200 chars", () => {
  const ok = validateRumour("  hello   cozy\n world ");
  assert.deepEqual(ok, { ok: true, text: "hello cozy world" });
  assert.ok(validateRumour("a".repeat(RUMOUR_MAX)).ok);
  assert.ok(!validateRumour("a".repeat(RUMOUR_MAX + 1)).ok);
  assert.ok(!validateRumour("   ").ok);
});

test("validateRumour: blocks links, emails, phone numbers, @mentions", () => {
  for (const bad of ["go to https://x.com", "visit www.cool.site", "mail me bob@mail.com", "call 416 555 0199 now", "hey @someone you suck", "check foo.gg"]) {
    assert.ok(!validateRumour(bad).ok, bad);
  }
  assert.ok(validateRumour("Lofi at 2pm, table 3, 5 people, great vibes!").ok);
});

test("addRumour: saves, cools down, rejects duplicates, persists", () => {
  const store = fakeStore();
  const t0 = 1_000_000;
  const r1 = addRumour("The tea is great", t0, store, () => "id1");
  assert.ok(r1.ok);
  const r2 = addRumour("Another one", t0 + 1000, store, () => "id2");
  assert.ok(!r2.ok && /moment/.test(r2.reason));
  const r3 = addRumour("The tea is great", t0 + POST_COOLDOWN_MS + 1, store, () => "id3");
  assert.ok(!r3.ok && /already/.test(r3.reason));
  const r4 = addRumour("Another one", t0 + POST_COOLDOWN_MS + 1, store, () => "id4");
  assert.ok(r4.ok);
  assert.equal(loadState(t0 + POST_COOLDOWN_MS + 2, store).posts.length, 2);
});

test("loadState: posts expire after 48h, samples never do", () => {
  const store = fakeStore();
  const t0 = 5_000_000;
  addRumour("old news", t0, store, () => "old");
  const later = t0 + RUMOUR_TTL_MS + 1;
  assert.equal(loadState(later, store).posts.length, 0);
  assert.ok(allRumours(loadState(later, store)).every((r) => r.sample));
  assert.ok(allRumours(loadState(later, store)).length >= 5);
});

test("sort + likes: popular orders by likes, new puts fresh posts first", () => {
  const store = fakeStore();
  const t0 = 9_000_000;
  addRumour("fresh post", t0, store, () => "mine");
  let state = loadState(t0 + 1, store);
  const fresh = sortRumours(allRumours(state), "new", state.liked);
  assert.equal(fresh[0].id, "mine");
  state = toggleLike("s1", t0 + 1, store);
  assert.ok(state.liked.includes("s1"));
  const pop = sortRumours(allRumours(state), "popular", state.liked);
  assert.equal(pop[0].id, "s5"); // 31 likes
  assert.equal(likesOf(allRumours(state).find((r) => r.id === "s1")!, state.liked), 15);
  state = toggleLike("s1", t0 + 2, store);
  assert.ok(!state.liked.includes("s1"));
});

test("timeAgo", () => {
  assert.equal(timeAgo({ id: "x", text: "", createdAt: 0, likes: 0, sample: true }, 99), "pinned by the cafe");
  assert.equal(timeAgo({ id: "x", text: "", createdAt: 0, likes: 0 }, 30_000), "just now");
  assert.equal(timeAgo({ id: "x", text: "", createdAt: 0, likes: 0 }, 5 * 60_000), "5m ago");
  assert.equal(timeAgo({ id: "x", text: "", createdAt: 0, likes: 0 }, 3 * 3600_000), "3h ago");
});
