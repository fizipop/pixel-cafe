// Pure rules of the casino wing: Plinko odds and fairness, the Huff & Xtra Puff paytables and bonuses, the lottery draw.
import test from "node:test";
import assert from "node:assert/strict";
import { mulberry32 } from "../shared/arcade.ts";
import {
  HUFF, HUFF_BONUS, LOTTERY, PLINKO_GATES, PLINKO_ROWS, PLINKO_SLOTS, PLINKO_TABLES, PLINKO_TARGET_RTP, huffLineWins, huffPlay, huffRtp, huffWaysWins,
  lotteryDraw, plinkoOdds, plinkoRtp, plinkoRun, plinkoSlot, validGate, validLotteryNumber, type HuffSym,
} from "../shared/casino.ts";

test("plinko: odds sum to one, every gate is priced to the same return, and the paths are reproducible from the seed", () => {
  for (const g of [0, 1, 2] as const) {
    const odds = plinkoOdds(g);
    assert.equal(odds.length, PLINKO_SLOTS);
    assert.ok(Math.abs(odds.reduce((a, b) => a + b, 0) - 1) < 1e-12);
    const rtp = plinkoRtp(g);
    assert.ok(rtp <= PLINKO_TARGET_RTP + 1e-9 && rtp > 0.88, `gate ${g}: return ${rtp.toFixed(3)}`);
    assert.equal(PLINKO_TABLES[g].length, PLINKO_SLOTS);
  }
  assert.deepEqual(PLINKO_TABLES[0], PLINKO_TABLES[2], "the two side gates mirror each other");
  assert.deepEqual([...PLINKO_TABLES[1]], [...PLINKO_TABLES[1]].reverse(), "the middle row is symmetric");
  for (let seed = 1; seed < 400; seed++) {
    const g = (seed % 3) as 0 | 1 | 2;
    const a = plinkoRun(seed, g), b = plinkoRun(seed, g);
    assert.deepEqual(a, b, "same seed, same path");
    assert.equal(a.path.length, PLINKO_ROWS);
    assert.ok(a.slot >= 0 && a.slot < PLINKO_SLOTS && Number.isInteger(a.slot));
    assert.equal(plinkoSlot(g, a.path), a.slot);
    let x = PLINKO_GATES[g] * 2;
    for (const d of a.path) { x += d; assert.ok(Math.abs(x) <= PLINKO_ROWS, "the ball never leaves the board"); }
  }
  // the simulated landing frequencies match the exact odds
  const counts = new Array(PLINKO_SLOTS).fill(0);
  for (let seed = 0; seed < 40000; seed++) counts[plinkoRun(seed * 7919 + 1, 1).slot]++;
  const odds = plinkoOdds(1);
  for (let i = 4; i <= 8; i++) assert.ok(Math.abs(counts[i] / 40000 - odds[i]) < 0.012, `slot ${i}`);
  assert.ok(validGate(0) && validGate(2) && !validGate(3) && !validGate("1"));
});

const g3 = (rows: HuffSym[][]): HuffSym[][] => [0, 1, 2].map((reel) => rows.map((r) => r[reel])); // rows -> [reel][row]

test("huff & xtra puff: lines, the wild pig, the key scatter and the brick-house jackpot", () => {
  const bricks = huffLineWins(g3([["hay", "plank", "trowel"], ["brick", "brick", "brick"], ["straw", "wood", "hay"]]));
  assert.equal(bricks.jackpot, true);
  assert.equal(bricks.mult, HUFF.jackpot);
  const wild = huffLineWins(g3([["hay", "plank", "trowel"], ["brick", "pig", "brick"], ["straw", "wood", "plank"]]));
  assert.equal(wild.jackpot, false, "the jackpot needs three natural brick houses");
  assert.equal(wild.mult, HUFF.pays.brick);
  const diag = huffLineWins(g3([["wood", "plank", "hay"], ["trowel", "wood", "straw"], ["hay", "plank", "wood"]]));
  assert.deepEqual(diag.wins.map((w) => [w.sym, w.line]), [["wood", 3]]);
  const keys = huffLineWins(g3([["key", "key", "key"], ["hay", "plank", "trowel"], ["straw", "wood", "hay"]]));
  assert.equal(keys.mult, 0, "keys are scatters, not a line win");
});

test("huff & xtra puff bonus: ways pay left to right with the wild pig, and the build bonus climbs house levels", () => {
  const grid: HuffSym[][] = [["wood", "hay", "hay"], ["pig", "wood", "plank"], ["wood", "trowel", "hay"], ["straw", "straw", "straw"], ["hay", "plank", "trowel"]];
  const w = huffWaysWins(grid);
  const wood = w.wins.find((x) => x.sym === "wood")!;
  assert.equal(wood.count, 3);
  assert.equal(wood.ways, 1 * 2 * 1);
  assert.equal(wood.mult, HUFF_BONUS.pays.wood[0] * 2);
  // play until each machine triggers its bonus and check the bonus maths
  const rng = mulberry32(99);
  let windup = false, build = false;
  for (let i = 0; i < 20000 && !(windup && build); i++) {
    const a = huffPlay("huff", 10, rng);
    if (a.bonus) {
      windup = true;
      assert.equal(a.bonus.kind, "windup");
      assert.equal(a.spins.length - 1, a.bonus.spins);
      assert.ok(a.bonus.spins >= HUFF.freeSpins && a.bonus.spins <= HUFF.maxFree);
      assert.ok(a.spins.slice(1).every((s) => s.free && s.mult === HUFF.freeMult));
    }
    const b = huffPlay("huffBonus", 10, rng);
    if (b.bonus) {
      build = true;
      assert.equal(b.bonus.kind, "build");
      assert.equal(b.spins.length - 1, HUFF_BONUS.freeSpins);
      const levels = b.spins.slice(1).map((s) => s.level!);
      for (let k = 1; k < levels.length; k++) assert.ok(levels[k] >= levels[k - 1], "the house only ever gets built up");
      assert.ok(b.spins.slice(1).every((s) => s.mult === HUFF_BONUS.levelMult[s.level!]));
    }
  }
  assert.ok(windup && build, "both bonuses trigger");
});

test("huff machines: long-run returns stay under 100% (fictional beans, but the house still wins)", () => {
  for (const m of ["huff", "huffBonus"] as const) {
    const rtp = huffRtp(m, 120_000, 3);
    assert.ok(rtp > 0.75 && rtp < 0.99, `${m}: ${rtp.toFixed(3)}`);
  }
});

test("lottery: 1-1000, fair draws, 20 to enter, 10,000 jackpot", () => {
  assert.equal(LOTTERY.COST, 20);
  assert.equal(LOTTERY.JACKPOT, 10_000);
  assert.ok(validLotteryNumber(1) && validLotteryNumber(1000) && !validLotteryNumber(0) && !validLotteryNumber(1001) && !validLotteryNumber(2.5));
  assert.equal(lotteryDraw(() => 0), 1);
  assert.equal(lotteryDraw(() => 0.999999), 1000);
  const rng = mulberry32(4);
  const seen = new Array(1001).fill(0);
  for (let i = 0; i < 200_000; i++) { const d = lotteryDraw(rng); assert.ok(d >= 1 && d <= 1000); seen[d]++; }
  const min = Math.min(...seen.slice(1)), max = Math.max(...seen.slice(1));
  assert.ok(min > 120 && max < 290, `roughly uniform (${min}..${max} of an expected 200)`);
});
