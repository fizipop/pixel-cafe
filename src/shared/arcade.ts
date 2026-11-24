// Pure rules and maths for the Floor 2 mini-games. No sockets, no wallet, no randomness of its own
// (callers pass an `rng` returning 0..1), so everything here is easy to test.
//
// EVERYTHING uses Cafe Beans: a fictional, non-purchasable, non-redeemable token. There is no way to
// buy beans or turn them into anything real.

export const MIN_BET = 5;
export const MAX_BET = 500;
export const START_BEANS = 50; // a brand-new wallet (or the local drink-making balance, whichever is higher, up to SEED_MAX)
export const SEED_MAX = 500;
export const TOPUP_BEANS = 50; // daily starter top-up when you are below MIN_BET
export const BET_PRESETS = [5, 10, 25, 50, 100];

export const validBet = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MIN_BET && (n as number) <= MAX_BET;
export type Rng = () => number;

/** Small deterministic generator (same seed, same numbers): for tests and anything that must replay. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------------- slots

export type SlotSymbol = "cup" | "croissant" | "bean" | "cat" | "seven";
export const SLOT_SYMBOLS: SlotSymbol[] = ["cup", "croissant", "bean", "cat", "seven"];
export const SLOT_NAMES: Record<SlotSymbol, string> = { cup: "Coffee Cup", croissant: "Croissant", bean: "Golden Bean", cat: "Pixel Cat", seven: "Lucky 7" };
/** Relative frequency of each symbol on every reel. */
export const SLOT_WEIGHTS: Record<SlotSymbol, number> = { cup: 10, croissant: 7, bean: 5, cat: 3, seven: 2 };
/** Three of a kind pays bet x this. */
export const SLOT_PAYS: Record<SlotSymbol, number> = { seven: 120, cat: 50, bean: 25, croissant: 12, cup: 7 };
/** Two matching symbols on the first two reels (third different) pays bet x this. */
export const SLOT_PAIR = 0.5;

export function spinReel(rng: Rng): SlotSymbol {
  const total = SLOT_SYMBOLS.reduce((n, s) => n + SLOT_WEIGHTS[s], 0);
  let r = rng() * total;
  for (const s of SLOT_SYMBOLS) {
    r -= SLOT_WEIGHTS[s];
    if (r < 0) return s;
  }
  return "cup";
}

/** Payout multiplier (of the bet) for three reels. */
export function slotMultiplier(r: readonly SlotSymbol[]): number {
  if (r[0] === r[1] && r[1] === r[2]) return SLOT_PAYS[r[0]];
  if (r[0] === r[1]) return SLOT_PAIR;
  return 0;
}

/** Exact long-run return per bean bet, ignoring rounding down (used by tests). */
export function slotRtp(): number {
  const total = SLOT_SYMBOLS.reduce((n, s) => n + SLOT_WEIGHTS[s], 0);
  let rtp = 0;
  for (const a of SLOT_SYMBOLS) for (const b of SLOT_SYMBOLS) for (const c of SLOT_SYMBOLS) {
    const p = (SLOT_WEIGHTS[a] / total) * (SLOT_WEIGHTS[b] / total) * (SLOT_WEIGHTS[c] / total);
    rtp += p * slotMultiplier([a, b, c]);
  }
  return rtp;
}

// ------------------------------------------------------------------------------- mines

export const MINES_TILES = 25; // 5 x 5
export const MINES_MIN = 1;
export const MINES_MAX = 24;
export const MINES_EDGE = 0.97;

export const validMineCount = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= MINES_MIN && (n as number) <= MINES_MAX;

/** Multiplier after `safe` safe tiles have been revealed with `mines` hazards on the board. */
export function minesMultiplier(mines: number, safe: number): number {
  if (safe <= 0) return 1;
  let m = MINES_EDGE;
  for (let i = 0; i < safe; i++) m *= (MINES_TILES - i) / (MINES_TILES - mines - i);
  return Math.floor(m * 100) / 100;
}

/** Pick `mines` distinct hazard tiles (0..24). */
export function placeMines(mines: number, rng: Rng): number[] {
  const tiles = Array.from({ length: MINES_TILES }, (_, i) => i);
  for (let i = tiles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
  }
  return tiles.slice(0, mines).sort((a, b) => a - b);
}

// ------------------------------------------------------------------------------- crash (To the Moon)

export const CRASH_RATE = 0.00011; // multiplier = e^(rate * ms): 2x at ~6.3 s, 10x at ~21 s
export const CRASH_EDGE = 0.96;
export const CRASH_CAP = 200;

/** Where the rocket fizzles out, from one random number. About 4% of rounds crash at 1.00x. */
export function crashPoint(u: number): number {
  const p = Math.floor((100 * CRASH_EDGE) / (1 - Math.min(u, 0.999999)));
  return Math.min(CRASH_CAP * 100, Math.max(100, p)) / 100; // p is in hundredths
}

/** The multiplier `ms` milliseconds into the flight. */
export const crashMultAt = (ms: number) => Math.floor(Math.exp(CRASH_RATE * Math.max(0, ms)) * 100) / 100;
/** How long (ms) the flight lasts before it reaches multiplier `m`. */
export const crashTimeAt = (m: number) => Math.ceil(Math.log(Math.max(1, m)) / CRASH_RATE);

// ------------------------------------------------------------------------------- roulette (European, one zero)

export const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
/** Wheel order, clockwise from the zero. */
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export type RouletteColor = "red" | "black" | "green";
export const rouletteColor = (n: number): RouletteColor => (n === 0 ? "green" : RED_NUMBERS.has(n) ? "red" : "black");

export type RouletteBetKind = "red" | "black" | "odd" | "even" | "low" | "high" | "num";
export const ROULETTE_KINDS: RouletteBetKind[] = ["red", "black", "odd", "even", "low", "high", "num"];
export type RouletteBet = { kind: RouletteBetKind; n?: number; amount: number };

export const validRouletteBet = (b: unknown): b is RouletteBet => {
  const x = b as RouletteBet | null;
  if (!x || typeof x !== "object" || !ROULETTE_KINDS.includes(x.kind) || !validBet(x.amount)) return false;
  return x.kind !== "num" || (Number.isInteger(x.n) && (x.n as number) >= 0 && (x.n as number) <= 36);
};

/** Total returned for a bet when `n` comes up (0 = lost). The stake is included: 2 = even money, 36 = straight up. */
export function rouletteReturn(b: RouletteBet, n: number): number {
  let win = false;
  switch (b.kind) {
    case "red": win = rouletteColor(n) === "red"; break;
    case "black": win = rouletteColor(n) === "black"; break;
    case "odd": win = n > 0 && n % 2 === 1; break;
    case "even": win = n > 0 && n % 2 === 0; break;
    case "low": win = n >= 1 && n <= 18; break;
    case "high": win = n >= 19 && n <= 36; break;
    case "num": win = b.n === n; break;
  }
  if (!win) return 0;
  return b.amount * (b.kind === "num" ? 36 : 2);
}

// ------------------------------------------------------------------------------- blackjack

export type Card = string; // rank + suit letter, e.g. "AS", "10H", "KD"
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const SUITS = ["S", "H", "D", "C"];

export function newShoe(rng: Rng, decks = 4): Card[] {
  const cards: Card[] = [];
  for (let d = 0; d < decks; d++) for (const r of RANKS) for (const s of SUITS) cards.push(r + s);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export const rankOf = (c: Card) => c.slice(0, -1);
export const suitOf = (c: Card) => c.slice(-1);

/** Best total of a hand (aces count 11 while that doesn't bust) and whether it is "soft". */
export function handValue(cards: readonly Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    const r = rankOf(c);
    if (r === "A") { aces++; total += 11; } else if (r === "J" || r === "Q" || r === "K") total += 10; else total += Number(r);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return { total, soft: aces > 0 };
}

export const isBlackjack = (cards: readonly Card[]) => cards.length === 2 && handValue(cards).total === 21;
/** The dealer draws until 17 or more (and stands on every 17). */
export const dealerMustHit = (cards: readonly Card[]) => handValue(cards).total < 17;

export type BjResult = "blackjack" | "win" | "push" | "lose";
/** Compare a finished player hand with the dealer's. `doubled` bets are already folded into `bet`. */
export function settleBlackjack(player: readonly Card[], dealer: readonly Card[]): BjResult {
  const p = handValue(player).total;
  const d = handValue(dealer).total;
  if (p > 21) return "lose";
  if (isBlackjack(player) && !isBlackjack(dealer)) return "blackjack";
  if (isBlackjack(dealer) && !isBlackjack(player)) return "lose";
  if (d > 21 || p > d) return "win";
  return p === d ? "push" : "lose";
}

/** Total returned (stake included) for a result: blackjack pays 3:2, a win 1:1, a push gives the bet back. */
export function blackjackReturn(result: BjResult, bet: number): number {
  switch (result) {
    case "blackjack": return bet + Math.floor((bet * 3) / 2);
    case "win": return bet * 2;
    case "push": return bet;
    default: return 0;
  }
}

// ------------------------------------------------------------------------------- Penguin Cross

export const PENGUIN_TILES = 12; // ice tiles between the start and the far shore
export const PENGUIN_EDGE = 0.97;
export const PENGUIN_MAX_MULT = 1000;
export type PenguinLane = "calm" | "thin" | "cracked";
export const PENGUIN_LANES: Record<PenguinLane, { name: string; blurb: string; p0: number; grow: number }> = {
  calm: { name: "Calm ice", blurb: "Thick ice. Small multipliers, gentle risk.", p0: 0.06, grow: 0.012 },
  thin: { name: "Thin ice", blurb: "Cracks sooner and more often.", p0: 0.12, grow: 0.028 },
  cracked: { name: "Cracked ice", blurb: "Very high variance. Huge multipliers, usually a splash.", p0: 0.2, grow: 0.05 },
};
export const PENGUIN_LANE_IDS = Object.keys(PENGUIN_LANES) as PenguinLane[];
export const validPenguinLane = (l: unknown): l is PenguinLane => typeof l === "string" && Object.hasOwn(PENGUIN_LANES, l);

/** Chance that tile number `step` (1 = the first tile) is weak ice. It climbs with every step. */
export const penguinCrackChance = (lane: PenguinLane, step: number) =>
  Math.min(0.92, PENGUIN_LANES[lane].p0 + PENGUIN_LANES[lane].grow * (Math.max(1, step) - 1));

/** Multiplier after `steps` safe tiles: fair odds minus a 3% edge, so every lane returns about 97%. */
export function penguinMultiplier(lane: PenguinLane, steps: number): number {
  if (steps <= 0) return 1;
  let survive = 1;
  for (let k = 1; k <= steps; k++) survive *= 1 - penguinCrackChance(lane, k);
  return Math.min(PENGUIN_MAX_MULT, Math.floor((PENGUIN_EDGE / survive) * 100) / 100);
}

// ------------------------------------------------------------------------------- free-to-play cabinets

/** Cabinets that cost nothing to play (Pixel Fighter II, Neon Drift GP, Beat Battle) can only ever give beans, so what they give is capped. */
export const FREE_REWARD_CAP = 150; // beans per window
export const FREE_REWARD_WINDOW_MS = 10 * 60_000;
