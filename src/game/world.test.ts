import { test } from "node:test";
import assert from "node:assert/strict";
import { newTable, tttReduce, chooseMove, bestMoves, findWinner, type TttState, type TttAction } from "./tictactoe.ts";
import { WorldStore, newWorld, worldReduce, loadWorldPrefs, saveWorldPrefs } from "./worldState.ts";
import { reactionFor, favoriteOf } from "./gifts.ts";

const run = (s: TttState, ...acts: TttAction[]) => {
  let cur = s;
  for (const a of acts) {
    const n = tttReduce(cur, a);
    assert.ok(n, `rejected ${JSON.stringify(a)}`);
    cur = n;
  }
  return cur;
};
const seated = () => run(newTable(), { type: "join", side: "X", by: "player:me" }, { type: "join", side: "O", by: "npc:theo" });

test("tictactoe: joining, turns and wins", () => {
  let s = seated();
  assert.equal(tttReduce(s, { type: "move", idx: 0, by: "npc:theo" }), null, "O cannot start");
  s = run(s, { type: "move", idx: 0, by: "player:me" }, { type: "move", idx: 3, by: "npc:theo" },
    { type: "move", idx: 1, by: "player:me" }, { type: "move", idx: 4, by: "npc:theo" });
  assert.equal(tttReduce(s, { type: "move", idx: 4, by: "player:me" }), null, "occupied cell");
  assert.equal(tttReduce(s, { type: "move", idx: 9, by: "player:me" }), null, "off the board");
  s = run(s, { type: "move", idx: 2, by: "player:me" });
  assert.equal(s.winner, "X");
  assert.deepEqual(s.line, [0, 1, 2]);
  assert.equal(s.scores.X, 1);
  assert.equal(tttReduce(s, { type: "move", idx: 5, by: "npc:theo" }), null, "game is over");
});

test("tictactoe: draw, reset alternates the starter", () => {
  // X O X / X O O / O X X  -> draw
  const order = [0, 1, 2, 4, 3, 5, 7, 6, 8];
  let s = seated();
  order.forEach((idx, n) => { s = run(s, { type: "move", idx, by: n % 2 === 0 ? "player:me" : "npc:theo" }); });
  assert.equal(s.winner, "draw");
  assert.equal(s.scores.draw, 1);
  s = run(s, { type: "reset", by: "player:me" });
  assert.equal(s.round, 1);
  assert.equal(s.turn, "O", "O starts the second round");
  assert.ok(s.board.every((c) => c === null));
  assert.equal(tttReduce(s, { type: "reset", by: "player:stranger" }), null, "only players can reset");
});

test("tictactoe: a real player can take an NPC's seat, but not another player's", () => {
  let s = seated();
  assert.equal(tttReduce(s, { type: "join", side: "O", by: "player:b" })?.players.O, "player:b");
  s = run(s, { type: "join", side: "O", by: "player:b" });
  assert.equal(tttReduce(s, { type: "join", side: "O", by: "player:c" }), null);
  assert.equal(tttReduce(s, { type: "join", side: "X", by: "player:b" }), null, "cannot play both sides");
  s = run(s, { type: "move", idx: 4, by: "player:me" });
  s = run(s, { type: "leave", by: "player:b" });
  assert.equal(s.players.O, null);
  assert.ok(s.board.every((c) => c === null), "abandoned game is cleared");
});

test("tictactoe: the NPC never loses without a blunder and can be beaten with one", () => {
  // Every possible human game against a perfect O must not end in an X win.
  const play = (board: (null | "X" | "O")[], turn: "X" | "O"): void => {
    const w = findWinner(board);
    if (w.winner) { assert.notEqual(w.winner, "X", "perfect O lost"); return; }
    if (turn === "X") {
      board.forEach((c, i) => { if (!c) { const b = board.slice(); b[i] = "X"; play(b, "O"); } });
    } else {
      const m = chooseMove(board, "O", () => 0.99, 0);
      const b = board.slice(); b[m] = "O"; play(b, "X");
    }
  };
  play(Array(9).fill(null), "X");
  // blunder branch picks a legal cell
  const m = chooseMove(["X", "O", null, null, null, null, null, null, null], "O", () => 0.1, 0.25);
  assert.ok(m >= 2 && m <= 8);
  assert.deepEqual(bestMoves(["X", "X", null, "O", "O", null, null, null, null], "O").includes(5), true, "O takes its own win");
  assert.deepEqual(bestMoves(["X", "X", null, null, "O", null, null, null, null], "O"), [2], "O blocks");
});

test("world store: mood, weather, listeners, snapshots", () => {
  const w = new WorldStore(newWorld());
  const seen: string[] = [];
  const off = w.subscribe((s, a) => seen.push(`${s.mood}/${s.weather}/${a?.type ?? "load"}`));
  assert.ok(w.dispatch({ type: "setMood", mood: "bossa" }));
  assert.ok(w.dispatch({ type: "setMood", mood: "bossa" }), "same value is accepted but silent");
  assert.ok(w.dispatch({ type: "setWeather", weather: "rain" }));
  assert.equal(w.dispatch({ type: "setMood", mood: "metal" as never }), false);
  assert.deepEqual(seen, ["bossa/dusk/setMood", "bossa/rain/setWeather"]);
  assert.ok(w.dispatch({ type: "ttt", action: { type: "join", side: "X", by: "player:me" } }));
  assert.equal(w.getState().table.players.X, "player:me");
  off();
  w.dispatch({ type: "setMood", mood: "rain" });
  assert.equal(seen.length, 3, "unsubscribed");
  // a snapshot survives a JSON round trip (what Socket.IO would send)
  const copy = JSON.parse(JSON.stringify(w.getState()));
  const w2 = new WorldStore();
  w2.load(copy);
  assert.deepEqual(w2.getState(), w.getState());
  assert.equal(worldReduce(w.getState(), { type: "setWeather", weather: "sun" })?.weather, "sun");
});

test("world prefs: saved and restored, bad data falls back", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  saveWorldPrefs({ ...newWorld(), mood: "rain", weather: "sun" }, store);
  assert.deepEqual(loadWorldPrefs(store), { mood: "rain", weather: "sun" });
  mem.set("pixelcafe.world.v1", '{"mood":"nope","weather":5}');
  assert.deepEqual(loadWorldPrefs(store), { mood: "dusk", weather: "dusk" });
});

test("gifts: favourites are recognised", () => {
  assert.equal(favoriteOf("kai"), "espresso");
  assert.equal(reactionFor("kai", "espresso").loved, true);
  assert.equal(reactionFor("kai", "cocoa").loved, false);
  assert.equal(reactionFor("ollie", "cocoa").loved, true);
  assert.ok(reactionFor("theo", "cocoa", 1).line.length > 5);
  assert.ok(reactionFor("stranger", "cocoa").line.length > 0);
});
