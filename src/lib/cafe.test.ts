import { test } from "node:test";
import assert from "node:assert/strict";
import { sliderPos, rate, newZone, beansFor, DRINKS, MAKE_MS } from "./drinks.ts";
import { addBeans, loadProfile } from "./profile.ts";
import { signBook, loadState, canSign, allEntries, pageOf, pageCount, dayKey, NOTE_MAX, SAMPLE_ENTRIES } from "./guestbook.ts";

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

test("drinks: four drinks with unique keys and sane difficulty", () => {
  assert.equal(DRINKS.length, 4);
  assert.equal(new Set(DRINKS.map((d) => d.key)).size, 4);
  assert.equal(MAKE_MS, 3000);
  for (const d of DRINKS) assert.ok(d.half > 0.03 && d.half < 0.2 && d.period > 600);
});

test("drinks: slider sweeps 0..1..0 and ratings follow the sweet spot", () => {
  assert.equal(sliderPos(0, 1000), 0);
  assert.equal(sliderPos(500, 1000), 0.5);
  assert.equal(sliderPos(1000, 1000), 1);
  assert.equal(sliderPos(1500, 1000), 0.5);
  assert.equal(sliderPos(2000, 1000), 0);
  const zone = { center: 0.5, half: 0.1 };
  assert.equal(rate(0.5, zone), "perfect");
  assert.equal(rate(0.53, zone), "perfect");
  assert.equal(rate(0.58, zone), "good");
  assert.equal(rate(0.9, zone), "meh");
  assert.deepEqual(["perfect", "good", "meh"].map((r) => beansFor(r as never)), [5, 3, 1]);
  for (let i = 0; i < 50; i++) {
    const z = newZone("espresso", Math.random);
    assert.ok(z.center >= 0.25 && z.center <= 0.75);
  }
});

test("a player can always reach the sweet spot inside the 3 seconds", () => {
  for (const d of DRINKS) {
    const zone = { center: 0.3, half: d.half };
    let best = "meh";
    for (let t = 0; t <= MAKE_MS; t += 16) if (rate(sliderPos(t, d.period), zone) === "perfect") best = "perfect";
    assert.equal(best, "perfect", d.id);
  }
});

test("beans persist and never go negative", () => {
  const s = memStore();
  assert.deepEqual(loadProfile(s), { beans: 0, drinks: 0 });
  assert.deepEqual(addBeans(5, true, s), { beans: 5, drinks: 1 });
  assert.deepEqual(addBeans(2, false, s), { beans: 7, drinks: 1 });
  assert.deepEqual(addBeans(-9, false, s), { beans: 7, drinks: 1 });
  assert.deepEqual(loadProfile(s), { beans: 7, drinks: 1 });
});

test("guestbook: sign once per day, validate, paginate", () => {
  const s = memStore();
  const day1 = new Date(2026, 10, 22, 20).getTime();
  const r = signBook("  Lovely   evening  ", "CozyFox1", day1, s, () => "a");
  assert.ok(r.ok);
  assert.equal(allEntries(loadState(s))[0].text, "Lovely evening");
  assert.ok(!canSign(loadState(s), day1 + 3600_000));
  const again = signBook("Second try", "CozyFox1", day1 + 3600_000, s);
  assert.ok(!again.ok);
  const nextDay = new Date(2026, 10, 23, 9).getTime();
  assert.ok(canSign(loadState(s), nextDay));
  assert.ok(!signBook("x".repeat(NOTE_MAX + 1), "n", nextDay, s).ok, "too long");
  assert.ok(!signBook("see www.spam.com", "n", nextDay, s).ok, "links blocked");
  assert.ok(!signBook("   ", "n", nextDay, s).ok, "empty");
  assert.ok(signBook("Back again", "CozyFox1", nextDay, s, () => "b").ok);
  const list = allEntries(loadState(s));
  assert.deepEqual(list.slice(0, 2).map((e) => e.id), ["b", "a"], "newest first");
  assert.equal(list.length, 2 + SAMPLE_ENTRIES.length);
  assert.equal(pageCount(list.length), 4);
  assert.equal(pageOf(list, 0).length, 2);
  assert.equal(pageOf(list, 99).length, 2, "page is clamped");
  assert.equal(dayKey(day1), "2026-11-22");
});
