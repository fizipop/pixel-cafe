// Pure rules for the casino wing's newer games: the Plinko table, the two Huff & Xtra Puff slot machines and the
// 1-1000 lottery booth. Like src/shared/arcade.ts there is no randomness of its own (callers pass an `rng`), no wallet
// and no sockets, so every payout rule here is unit-tested. The server decides every result; the browser only animates
// what the server sent back.
//
// EVERYTHING uses Cafe Beans: a fictional, non-purchasable, non-redeemable play token.
import { mulberry32, type Rng } from "./arcade.ts";

// ================================================================================================ Plinko

/** Rows of pegs the ball falls through, and the slots at the bottom (one more than the rows). */
export const PLINKO_ROWS = 12;
export const PLINKO_SLOTS = PLINKO_ROWS + 1;
/** Payout multiplier of each landing slot, left to right, for a drop from the middle gate. Configurable. */
export const PLINKO_MULTS = [18, 6, 3, 1.6, 1.1, 0.7, 0.4, 0.7, 1.1, 1.6, 3, 6, 18] as const;
/** The board's long-run return every gate is priced to (the tests check each gate lands within a hair of it). */
export const PLINKO_TARGET_RTP = 0.94;
/** The three drop gates at the top: how far (in pegs) from the middle each one releases the ball. */
export const PLINKO_GATES = [-2, 0, 2] as const;
export type PlinkoGate = 0 | 1 | 2;
export const validGate = (g: unknown): g is PlinkoGate => g === 0 || g === 1 || g === 2;

/**
 * The ball's position is counted in half-peg steps from the centre line (-ROWS..ROWS). At every peg it is knocked one
 * half-step left (-1) or right (+1) with even odds; at the side walls it can only bounce back inward. After the last
 * row the position maps straight onto a slot, so the slot always matches the path that was animated.
 */
export function plinkoRun(seed: number, gate: PlinkoGate): { path: (-1 | 1)[]; slot: number } {
  const rng = mulberry32(seed);
  let x = PLINKO_GATES[gate] * 2;
  const path: (-1 | 1)[] = [];
  for (let row = 0; row < PLINKO_ROWS; row++) {
    let d: -1 | 1 = rng() < 0.5 ? -1 : 1;
    if (x + d > PLINKO_ROWS || x + d < -PLINKO_ROWS) d = d === 1 ? -1 : 1; // the wall: bounce back inward
    x += d;
    path.push(d);
  }
  return { path, slot: plinkoSlot(gate, path) };
}

/** Where a path ends up (also used to check that a replayed path is the one that was paid). */
export function plinkoSlot(gate: PlinkoGate, path: readonly number[]): number {
  let x = PLINKO_GATES[gate] * 2;
  for (const d of path) x += d;
  return (x + PLINKO_ROWS) / 2;
}

/** Exact probability of landing in each slot from a gate (dynamic programming over the walls). */
export function plinkoOdds(gate: PlinkoGate): number[] {
  let dist = new Map<number, number>([[PLINKO_GATES[gate] * 2, 1]]);
  for (let row = 0; row < PLINKO_ROWS; row++) {
    const next = new Map<number, number>();
    for (const [x, p] of dist) for (const d of [-1, 1]) {
      let dd = d;
      if (x + dd > PLINKO_ROWS || x + dd < -PLINKO_ROWS) dd = -dd;
      next.set(x + dd, (next.get(x + dd) ?? 0) + p / 2);
    }
    dist = next;
  }
  const out = new Array(PLINKO_SLOTS).fill(0);
  for (const [x, p] of dist) out[(x + PLINKO_ROWS) / 2] += p;
  return out;
}

/**
 * The multiplier row shown (and paid) under the board for each gate. A ball dropped off-centre lands near the
 * high-paying edge far more often, so the side gates' rows are scaled down to the same long-run return as the middle:
 * the drop position changes where the ball is likely to land and what each slot pays, never the overall odds.
 */
export const PLINKO_TABLES: Record<PlinkoGate, number[]> = (() => {
  const raw = (g: PlinkoGate) => plinkoOdds(g).reduce((s, p, i) => s + p * PLINKO_MULTS[i], 0);
  const table = (g: PlinkoGate) => {
    const k = PLINKO_TARGET_RTP / raw(g);
    return PLINKO_MULTS.map((m) => Math.max(0.1, Math.floor(m * k * 20) / 20)); // round down to 0.05
  };
  return { 0: table(0), 1: table(1), 2: table(2) };
})();
export const plinkoMult = (gate: PlinkoGate, slot: number) => PLINKO_TABLES[gate][slot] ?? 0;
export const plinkoRtp = (gate: PlinkoGate) => plinkoOdds(gate).reduce((s, p, i) => s + p * plinkoMult(gate, i), 0);

// ================================================================================================ Huff & Xtra Puff

// Two original "three little houses" machines: building materials (hay, planks, a trowel), the straw, wood and brick
// houses, a wild pig, and a scatter that triggers each machine's bonus.
export type HuffSym = "hay" | "plank" | "trowel" | "straw" | "wood" | "brick" | "pig" | "key" | "hammer";
export const HUFF_NAMES: Record<HuffSym, string> = {
  hay: "Hay Bale", plank: "Planks", trowel: "Trowel", straw: "Straw House", wood: "Wood House", brick: "Brick House",
  pig: "Wild Pig", key: "Wind-Up Key", hammer: "Golden Hammer",
};
export type HuffMachine = "huff" | "huffBonus";

export type HuffWin = { sym: HuffSym; count: number; mult: number; line?: number; ways?: number };
export type HuffSpin = {
  grid: HuffSym[][]; // [reel][row], row 0 at the top
  wins: HuffWin[];
  win: number; // beans won on this spin (after any bonus multiplier)
  free: boolean; // a free spin inside the bonus
  mult: number; // the bonus multiplier applied to this spin
  level?: number; // Huff & Xtra Puff Bonus: house level during the free spins (0 straw .. 3 mansion)
  scatters: number;
};
export type HuffResult = { spins: HuffSpin[]; total: number; bonus: null | { kind: "windup" | "build"; spins: number; level?: number; mansion?: boolean }; jackpot: boolean };

/** Machine 3: HUFF & XTRA PUFF. 3 reels x 3 rows, 5 paylines, wild pig, Wind-Up Key scatter. */
export const HUFF = {
  reels: 3, rows: 3,
  weights: { hay: 30, plank: 26, trowel: 22, straw: 13, wood: 8, brick: 4, pig: 3, key: 4, hammer: 0 } as Record<HuffSym, number>,
  /** Three in a line pays bet x this (the bet covers all five lines). */
  pays: { hay: 1.5, plank: 2.5, trowel: 3.5, straw: 7, wood: 14, brick: 35, pig: 70, key: 0, hammer: 0 } as Record<HuffSym, number>,
  /** Natural Brick Houses across the middle line: the jackpot. */
  jackpot: 250,
  /** [row of reel 0, reel 1, reel 2] for each line: middle, top, bottom, then the two diagonals. */
  lines: [[1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0]],
  scatterNeeded: 3, freeSpins: 6, freeMult: 2, retrigger: 2, maxFree: 20,
} as const;

/** Machine 4: HUFF & XTRA PUFF BONUS. 5 reels x 3 rows, 243 ways, wild pig on reels 2-4, Golden Hammer scatter. */
export const HUFF_BONUS = {
  reels: 5, rows: 3,
  weights: { hay: 26, plank: 24, trowel: 20, straw: 12, wood: 9, brick: 6, pig: 4, key: 0, hammer: 3 } as Record<HuffSym, number>,
  /** 3, 4 or 5 of a kind from the leftmost reel, per way, pays bet x this. */
  pays: {
    hay: [0.08, 0.2, 0.5], plank: [0.1, 0.25, 0.6], trowel: [0.12, 0.3, 0.8], straw: [0.25, 0.7, 2],
    wood: [0.4, 1, 3], brick: [0.7, 2, 6], pig: [0, 0, 0], key: [0, 0, 0], hammer: [0, 0, 0],
  } as Record<HuffSym, [number, number, number]>,
  scatterNeeded: 3, freeSpins: 8,
  /** House levels in the free spins: straw, wood, brick, mansion, and what each one multiplies wins by. */
  levelMult: [1, 2, 3, 5], levelNames: ["Straw", "Wood", "Brick", "Mansion"],
  /** Hammers needed in the free spins to build up to the next level. */
  hammersPerLevel: 2,
  /** Reaching the mansion pays this (x bet) once, on top of the spins. */
  mansionPrize: 50,
} as const;

const SYMS: HuffSym[] = ["hay", "plank", "trowel", "straw", "wood", "brick", "pig", "key", "hammer"];

function draw(rng: Rng, w: Record<HuffSym, number>, noWild = false): HuffSym {
  const syms = SYMS.filter((s) => w[s] > 0 && !(noWild && s === "pig"));
  let r = rng() * syms.reduce((n, s) => n + w[s], 0);
  for (const s of syms) { r -= w[s]; if (r < 0) return s; }
  return syms[0];
}

export function huffGrid(machine: HuffMachine, rng: Rng): HuffSym[][] {
  const m = machine === "huff" ? HUFF : HUFF_BONUS;
  return Array.from({ length: m.reels }, (_, reel) =>
    Array.from({ length: m.rows }, () => draw(rng, m.weights, machine === "huffBonus" && (reel === 0 || reel === 4))));
}

const countScatter = (grid: HuffSym[][], s: HuffSym) => grid.reduce((n, reel) => n + reel.filter((x) => x === s).length, 0);

/** Line wins on the 3x3 machine (wild pig substitutes for anything except the key). */
export function huffLineWins(grid: HuffSym[][]): { wins: HuffWin[]; mult: number; jackpot: boolean } {
  const wins: HuffWin[] = [];
  let mult = 0, jackpot = false;
  HUFF.lines.forEach((rows, line) => {
    const cells = rows.map((row, reel) => grid[reel][row]);
    if (cells.includes("key")) return;
    const base = cells.find((c) => c !== "pig") ?? "pig";
    if (!cells.every((c) => c === base || c === "pig")) return;
    const natural = cells.every((c) => c === base);
    const pay = line === 0 && base === "brick" && natural ? HUFF.jackpot : HUFF.pays[base];
    if (line === 0 && base === "brick" && natural) jackpot = true;
    wins.push({ sym: base, count: 3, mult: pay, line });
    mult += pay;
  });
  return { wins, mult, jackpot };
}

/** Ways wins on the 5x3 machine: for each symbol, matching reels from the left (pig is wild), times the ways. */
export function huffWaysWins(grid: HuffSym[][]): { wins: HuffWin[]; mult: number } {
  const wins: HuffWin[] = [];
  let mult = 0;
  for (const sym of ["hay", "plank", "trowel", "straw", "wood", "brick"] as HuffSym[]) {
    let ways = 1, count = 0;
    for (const reel of grid) {
      const hits = reel.filter((c) => c === sym || c === "pig").length;
      if (!hits) break;
      ways *= hits; count++;
    }
    if (count < 3) continue;
    const pay = HUFF_BONUS.pays[sym][count - 3] * ways;
    wins.push({ sym, count, mult: pay, ways });
    mult += pay;
  }
  return { wins, mult };
}

/**
 * One paid spin of a Huff machine, including any bonus it triggers (the free spins are played right here, so the whole
 * result, and the one payout, are settled in a single server request).
 */
export function huffPlay(machine: HuffMachine, bet: number, rng: Rng): HuffResult {
  const spins: HuffSpin[] = [];
  let bonus: HuffResult["bonus"] = null, jackpot = false;
  if (machine === "huff") {
    const one = (free: boolean, m: number) => {
      const grid = huffGrid("huff", rng);
      const r = huffLineWins(grid);
      jackpot ||= r.jackpot;
      const spin: HuffSpin = { grid, wins: r.wins, win: Math.floor(bet * r.mult * m), free, mult: m, scatters: countScatter(grid, "key") };
      spins.push(spin);
      return spin;
    };
    const first = one(false, 1);
    if (first.scatters >= HUFF.scatterNeeded) {
      let left: number = HUFF.freeSpins, total: number = HUFF.freeSpins;
      while (left > 0) {
        left--;
        const s = one(true, HUFF.freeMult);
        if (s.scatters >= HUFF.scatterNeeded && total < HUFF.maxFree) { const add = Math.min(HUFF.retrigger, HUFF.maxFree - total); left += add; total += add; }
      }
      bonus = { kind: "windup", spins: total };
    }
  } else {
    const B = HUFF_BONUS;
    const one = (free: boolean, level: number) => {
      const grid = huffGrid("huffBonus", rng);
      const r = huffWaysWins(grid);
      const m = free ? B.levelMult[level] : 1;
      const spin: HuffSpin = { grid, wins: r.wins, win: Math.floor(bet * r.mult * m), free, mult: m, scatters: countScatter(grid, "hammer"), ...(free ? { level } : {}) };
      spins.push(spin);
      return spin;
    };
    const first = one(false, 0);
    if (first.scatters >= B.scatterNeeded) {
      let level = 0, hammers = 0, mansion = false;
      for (let k = 0; k < B.freeSpins; k++) {
        const s = one(true, level);
        hammers += s.scatters;
        while (level < 3 && hammers >= B.hammersPerLevel) { hammers -= B.hammersPerLevel; level++; }
        if (level === 3 && !mansion) mansion = true;
      }
      bonus = { kind: "build", spins: B.freeSpins, level, mansion };
      if (mansion) jackpot = true;
    }
  }
  let total = spins.reduce((n, s) => n + s.win, 0);
  if (bonus?.mansion) total += Math.floor(bet * HUFF_BONUS.mansionPrize);
  return { spins, total, bonus, jackpot };
}

/** Long-run return per bean (Monte Carlo with a fixed seed, so the number is stable): used by the tests. */
export function huffRtp(machine: HuffMachine, spins = 200_000, seed = 7): number {
  const rng = mulberry32(seed);
  let paid = 0;
  for (let i = 0; i < spins; i++) paid += huffPlay(machine, 100, rng).total;
  return paid / (spins * 100);
}

// ================================================================================================ Lottery

/** The 1-1000 lottery booth: pick a number, pay a fixed entry, an exact match pays the jackpot. Instant draw. */
export const LOTTERY = { MIN: 1, MAX: 1000, COST: 20, JACKPOT: 10_000 } as const;
export const validLotteryNumber = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= LOTTERY.MIN && (n as number) <= LOTTERY.MAX;
/** A fair draw: every number 1-1000 equally likely. */
export const lotteryDraw = (rng: Rng) => LOTTERY.MIN + Math.min(LOTTERY.MAX - LOTTERY.MIN, Math.floor(rng() * (LOTTERY.MAX - LOTTERY.MIN + 1)));

// ------------------------------------------------------------------ the hourly lottery
// Same ticket (pick 1-1000, 20 beans) and the same 10,000 jackpot, but tickets go into the next draw on the hour,
// shared by everyone in the cafe. Each ticket is settled exactly once, when its draw runs.
export const HOURLY_MS = 60 * 60 * 1000;
/** A player can hold at most this many tickets for any one hourly draw. */
export const HOURLY_MAX_TICKETS = 10;
/** The top of the next hour after `now` (the draw a ticket bought now goes into). */
export const nextHourlyDraw = (now: number) => (Math.floor(now / HOURLY_MS) + 1) * HOURLY_MS;
