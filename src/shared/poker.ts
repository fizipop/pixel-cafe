// Texas Hold'em hand evaluation and pot maths. Pure functions (no sockets, no wallet) so they can be tested.
import { rankOf, suitOf, type Card } from "./arcade.ts";

export const HAND_NAMES = ["High Card", "One Pair", "Two Pair", "Three of a Kind", "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush", "Royal Flush"] as const;

const VALUE: Record<string, number> = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13, A: 14 };
export const cardValue = (c: Card) => VALUE[rankOf(c)] ?? 0;

export type Hand = { score: number; cat: number; name: string; best: Card[] };

/** Score of exactly five cards: category in the high digits, then the tie-break values in order (base 15). */
function eval5(cards: Card[]): { score: number; cat: number } {
  const vals = cards.map(cardValue).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // the wheel: A-2-3-4-5
  }
  const counts = new Map<number, number>();
  for (const v of vals) counts.set(v, (counts.get(v) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]); // biggest group first, then highest value
  const shape = groups.map((g) => g[1]).join("");
  let cat = 0;
  let order = groups.map((g) => g[0]);
  if (straightHigh && flush) { cat = straightHigh === 14 ? 9 : 8; order = [straightHigh]; }
  else if (shape === "41") cat = 7;
  else if (shape === "32") cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh) { cat = 4; order = [straightHigh]; }
  else if (shape === "311") cat = 3;
  else if (shape === "221") cat = 2;
  else if (shape === "2111") cat = 1;
  let score = cat;
  for (let i = 0; i < 5; i++) score = score * 15 + (order[i] ?? 0);
  return { score, cat };
}

/** The best five-card hand out of 5 to 7 cards. */
export function bestHand(cards: Card[]): Hand {
  let best: { score: number; cat: number; five: Card[] } | null = null;
  const n = cards.length;
  const pick = (start: number, chosen: Card[]) => {
    if (chosen.length === 5) {
      const r = eval5(chosen);
      if (!best || r.score > best.score) best = { ...r, five: [...chosen] };
      return;
    }
    for (let i = start; i < n; i++) { chosen.push(cards[i]); pick(i + 1, chosen); chosen.pop(); }
  };
  if (n >= 5) pick(0, []);
  const b = best as { score: number; cat: number; five: Card[] } | null;
  return b ? { score: b.score, cat: b.cat, name: HAND_NAMES[b.cat], best: b.five } : { score: -1, cat: -1, name: "—", best: [] };
}

export type Contribution = { seat: number; total: number; folded: boolean };
export type Pot = { amount: number; eligible: number[] };

/** Split everything put in this hand into a main pot and side pots (only players who did not fold can win a pot). */
export function buildPots(contribs: Contribution[]): Pot[] {
  const levels = [...new Set(contribs.filter((c) => !c.folded && c.total > 0).map((c) => c.total))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const c of contribs) amount += Math.max(0, Math.min(c.total, level) - Math.min(c.total, prev));
    const eligible = contribs.filter((c) => !c.folded && c.total >= level).map((c) => c.seat);
    if (amount > 0) pots.push({ amount, eligible });
    prev = level;
  }
  // chips from folded players above the biggest live stack (cannot happen in normal play) go to the last pot
  const live = Math.max(0, ...contribs.filter((c) => !c.folded).map((c) => c.total));
  const extra = contribs.reduce((n, c) => n + Math.max(0, c.total - Math.max(live, prev)), 0);
  if (extra > 0 && pots.length) pots[pots.length - 1].amount += extra;
  return pots;
}
