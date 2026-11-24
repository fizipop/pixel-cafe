// No-Limit Texas Hold'em for up to six seats: live players and optional house bots. All the rules live
// here (blinds, betting rounds, side pots, showdown, turn timer); the Arcade only routes messages.
// Chips at the table are Cafe Beans taken from your wallet when you buy in and returned when you stand up.
import { newShoe, type Card } from "../src/shared/arcade.ts";
import { bestHand, buildPots, cardValue } from "../src/shared/poker.ts";
import { suitOf } from "../src/shared/arcade.ts";
import type { PkSeatView, PokerView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";

export const PK = {
  SEATS: 6, SB: 5, BB: 10, MIN_BUY: 100, MAX_BUY: 1000, BOT_STACK: 500,
  ACT_MS: 20_000, START_MS: 2500, SHOWDOWN_MS: 5000, BOT_THINK_MIN: 800, BOT_THINK_SPAN: 900,
} as const;

type Phase = PokerView["phase"];
type PSeat = {
  bot: boolean; sockId: string; clientId: string; name: string;
  stack: number; bet: number; total: number; cards: Card[];
  inHand: boolean; folded: boolean; allIn: boolean; acted: boolean;
  left: boolean; // stood up mid-hand: folded, and gone once the hand ends
  reveal: boolean; hand?: string; won: number; botAt: number;
};

const BOT_NAMES = ["Bot Ace", "Bot Luna", "Bot Rex", "Bot Mimi", "Bot Gus"];

export class PokerEngine {
  seats: (PSeat | null)[] = Array(PK.SEATS).fill(null);
  phase: Phase = "wait";
  board: Card[] = [];
  private deck: Card[] = [];
  private dealer = -1;
  private turn: number | null = null;
  private deadline: number | null = null;
  private currentBet = 0;
  private minRaiseSize: number = PK.BB;
  private nextAt: number | null = null;
  private msg = "Sit down, buy in, and add a bot to start a hand.";
  private ctx: EngineCtx;
  private push: () => void;

  constructor(ctx: EngineCtx, push: () => void) {
    this.ctx = ctx;
    this.push = push;
  }

  // ------------------------------------------------------------ seating

  get humans() {
    return this.seats.filter((s): s is PSeat => !!s && !s.bot && !s.left);
  }

  seatOf(sockId: string) {
    return this.seats.findIndex((s) => s && !s.bot && !s.left && s.sockId === sockId);
  }

  sit(index: number, w: Who) {
    if (index < 0 || index >= PK.SEATS || this.seats[index]) return;
    this.seats[index] = {
      bot: false, sockId: w.sockId, clientId: w.clientId, name: w.name, stack: 0, bet: 0, total: 0, cards: [],
      inHand: false, folded: false, allIn: false, acted: false, left: false, reveal: false, won: 0, botAt: 0,
    };
    this.push();
  }

  /** Stand up (or disconnect): your chips go back to your wallet; a live hand is folded for you. */
  leave(sockId: string) {
    const i = this.seatOf(sockId);
    if (i < 0) return;
    const s = this.seats[i]!;
    if (s.stack > 0) { this.ctx.wallets.credit(s.clientId, s.stack); this.ctx.touch(s.clientId); s.stack = 0; }
    if (s.inHand && !s.folded && this.phase !== "wait" && this.phase !== "showdown") {
      s.folded = true; s.left = true;
      if (this.turn === i) this.afterAction(i); else this.checkOnlyOne();
    } else if (s.inHand && this.phase !== "wait" && this.phase !== "showdown") s.left = true; // folded already: gone once the hand ends
    else this.seats[i] = null;
    this.maybeIdle();
    this.push();
  }

  buyIn(w: Who, amount: unknown): { ok: true } | Fail {
    const i = this.seatOf(w.sockId);
    if (i < 0) return fail("Sit at the poker table first.");
    const s = this.seats[i]!;
    if (s.inHand && this.phase !== "wait" && this.phase !== "showdown") return fail("Wait for the next hand to buy chips.");
    if (!Number.isInteger(amount) || (amount as number) < 1) return fail("Pick an amount.");
    const a = amount as number;
    if (s.stack + a > PK.MAX_BUY) return fail(`You can have at most ${PK.MAX_BUY} chips at the table.`);
    if (s.stack + a < PK.MIN_BUY) return fail(`Buy in for at least ${PK.MIN_BUY}.`);
    if (!this.ctx.wallets.debit(w.clientId, a)) return fail("Not enough Cafe Beans.");
    s.stack += a;
    this.ctx.touch(w.clientId);
    this.msg = `${s.name} bought in for ${a}.`;
    this.schedule();
    this.push();
    return { ok: true };
  }

  bots(): number {
    return this.seats.filter((s) => s?.bot).length;
  }

  bot(add: boolean): { ok: true } | Fail {
    if (add) {
      const i = this.seats.findIndex((s) => !s);
      if (i < 0) return fail("The table is full.");
      this.seats[i] = {
        bot: true, sockId: `bot:${i}`, clientId: "", name: BOT_NAMES[i % BOT_NAMES.length], stack: PK.BOT_STACK, bet: 0, total: 0, cards: [],
        inHand: false, folded: false, allIn: false, acted: false, left: false, reveal: false, won: 0, botAt: 0,
      };
      this.schedule();
    } else {
      const i = this.seats.map((s, k) => (s?.bot && !s.inHand ? k : -1)).filter((k) => k >= 0).pop();
      if (i === undefined) return fail(this.bots() ? "Bots can only leave between hands." : "No bots at the table.");
      this.seats[i] = null;
      this.maybeIdle();
    }
    this.push();
    return { ok: true };
  }

  // ------------------------------------------------------------ a hand

  private ready() {
    return this.seats.filter((s) => s && !s.left && s.stack > 0).length >= 2;
  }

  /** After a change between hands: plan the next deal if two players have chips. */
  private schedule() {
    if ((this.phase === "wait") && this.ready() && this.nextAt === null) { this.nextAt = this.ctx.now() + PK.START_MS; this.msg = "A new hand is about to be dealt…"; }
  }

  private maybeIdle() {
    if (this.phase === "wait" && !this.ready()) { this.nextAt = null; this.msg = "Waiting for at least two players with chips. Add a bot to play solo."; }
  }

  private live(s: PSeat | null): s is PSeat {
    return !!s && s.inHand && !s.folded;
  }

  private startHand() {
    this.seats = this.seats.map((s) => (s && s.left ? null : s));
    for (const s of this.seats) if (s?.bot && s.stack < PK.BB * 5) s.stack = PK.BOT_STACK; // the house tops its bots up
    const players = this.seats.map((s, i) => (s && s.stack > 0 ? i : -1)).filter((i) => i >= 0);
    if (players.length < 2) { this.phase = "wait"; this.nextAt = null; this.maybeIdle(); return; }
    const after = (from: number, list: number[]) => list.find((i) => i > from) ?? list[0];
    this.dealer = after(this.dealer, players);
    this.deck = newShoe(this.ctx.rng, 1);
    this.board = [];
    for (const s of this.seats) if (s) { Object.assign(s, { bet: 0, total: 0, cards: [], inHand: false, folded: false, allIn: false, acted: false, reveal: false, hand: undefined, won: 0 }); }
    for (const i of players) { const s = this.seats[i]!; s.inHand = true; s.cards = [this.deck.pop()!, this.deck.pop()!]; }
    const headsUp = players.length === 2;
    const sb = headsUp ? this.dealer : after(this.dealer, players);
    const bb = after(sb, players);
    this.commit(sb, PK.SB);
    this.commit(bb, PK.BB);
    this.currentBet = PK.BB;
    this.minRaiseSize = PK.BB;
    this.phase = "preflop";
    this.nextAt = null;
    this.msg = `New hand. Blinds ${PK.SB}/${PK.BB}.`;
    this.turn = null;
    const first = this.nextActor(bb); // heads-up the dealer (small blind) acts first, otherwise the seat after the big blind
    if (first === null) this.finishRound(); else this.startClock(first);
    this.push();
  }

  /** Put chips in (taken from the stack, capped at what is left). Returns what was actually added. */
  private commit(i: number, amount: number) {
    const s = this.seats[i]!;
    const a = Math.max(0, Math.min(amount, s.stack));
    s.stack -= a; s.bet += a; s.total += a;
    if (s.stack === 0) s.allIn = true;
    return a;
  }

  private startClock(i: number) {
    this.turn = i;
    const s = this.seats[i]!;
    const t = this.ctx.now();
    this.deadline = s.bot ? null : t + PK.ACT_MS;
    s.botAt = s.bot ? t + PK.BOT_THINK_MIN + this.ctx.rng() * PK.BOT_THINK_SPAN : 0;
  }

  /** Who must act next after `from` (null when the betting round is complete). */
  private nextActor(from: number): number | null {
    for (let k = 1; k <= PK.SEATS; k++) {
      const i = (from + k) % PK.SEATS;
      const s = this.seats[i];
      if (this.live(s) && !s.allIn && (!s.acted || s.bet < this.currentBet)) return i;
    }
    return null;
  }

  private checkOnlyOne() {
    const alive = this.seats.filter((s) => this.live(s));
    if (alive.length === 1 && this.phase !== "showdown" && this.phase !== "wait") { this.award(); return true; }
    return false;
  }

  private afterAction(i: number) {
    if (this.checkOnlyOne()) return;
    const n = this.nextActor(i);
    if (n === null) this.finishRound(); else this.startClock(n);
  }

  private finishRound() {
    for (const s of this.seats) if (s) { s.bet = 0; s.acted = false; }
    this.currentBet = 0;
    this.minRaiseSize = PK.BB;
    this.turn = null; this.deadline = null;
    if (this.phase === "river") { this.showdown(); return; }
    const next: Phase = this.phase === "preflop" ? "flop" : this.phase === "flop" ? "turn" : "river";
    this.deck.pop(); // burn
    const n = next === "flop" ? 3 : 1;
    for (let k = 0; k < n; k++) this.board.push(this.deck.pop()!);
    this.phase = next;
    const canAct = this.seats.filter((s) => this.live(s) && !s.allIn);
    if (canAct.length < 2) { this.finishRound(); return; } // everyone left is all-in: run the board out
    const first = this.nextActor(this.dealer);
    if (first === null) this.finishRound(); else this.startClock(first);
  }

  private showdown() {
    const contenders = this.seats.map((s, i) => (this.live(s) ? i : -1)).filter((i) => i >= 0);
    const hands = new Map<number, ReturnType<typeof bestHand>>();
    for (const i of contenders) hands.set(i, bestHand([...this.seats[i]!.cards, ...this.board]));
    const pots = buildPots(this.seats.map((s, i) => ({ seat: i, total: s?.total ?? 0, folded: !this.live(s) })));
    for (const pot of pots) {
      const elig = pot.eligible.filter((i) => hands.has(i));
      const top = Math.max(...elig.map((i) => hands.get(i)!.score));
      const winners = elig.filter((i) => hands.get(i)!.score === top).sort((a, b) => ((a - this.dealer - 1 + PK.SEATS) % PK.SEATS) - ((b - this.dealer - 1 + PK.SEATS) % PK.SEATS));
      const share = Math.floor(pot.amount / winners.length);
      let rem = pot.amount - share * winners.length;
      for (const w of winners) { const gain = share + (rem-- > 0 ? 1 : 0); this.seats[w]!.stack += gain; this.seats[w]!.won += gain; }
    }
    for (const i of contenders) { const s = this.seats[i]!; s.reveal = contenders.length > 1; s.hand = hands.get(i)!.name; }
    const winnerNames = contenders.filter((i) => this.seats[i]!.won > 0).map((i) => `${this.seats[i]!.name} (${hands.get(i)!.name})`);
    this.msg = `${winnerNames.join(" and ")} win${winnerNames.length === 1 ? "s" : ""} the pot.`;
    this.endHand();
  }

  /** Everyone else folded: the last player takes everything without showing. */
  private award() {
    const i = this.seats.findIndex((s) => this.live(s));
    const pot = this.seats.reduce((n, s) => n + (s?.total ?? 0), 0);
    const s = this.seats[i]!;
    s.stack += pot; s.won = pot;
    this.msg = `${s.name} takes the pot of ${pot}; everyone else folded.`;
    this.endHand();
  }

  private endHand() {
    this.seats = this.seats.map((s) => (s && s.left ? null : s)); // anyone who stood up mid-hand is gone now
    this.phase = "showdown";
    this.turn = null; this.deadline = null;
    for (const s of this.seats) if (s) s.bet = 0;
    this.nextAt = this.ctx.now() + PK.SHOWDOWN_MS;
    this.push();
  }

  // ------------------------------------------------------------ actions

  act(w: Who, action: unknown, amount: unknown): { ok: true } | Fail {
    const i = this.seatOf(w.sockId);
    if (i < 0) return fail("You are not seated.");
    if (this.turn !== i) return fail("It is not your turn.");
    return this.apply(i, action, amount);
  }

  private apply(i: number, action: unknown, amount: unknown): { ok: true } | Fail {
    const s = this.seats[i]!;
    const toCall = Math.min(this.currentBet - s.bet, s.stack);
    if (action === "fold") { s.folded = true; this.msg = `${s.name} folds.`; }
    else if (action === "check") {
      if (s.bet < this.currentBet) return fail("You can't check: call or fold.");
      s.acted = true; this.msg = `${s.name} checks.`;
    } else if (action === "call") {
      this.commit(i, toCall); s.acted = true;
      this.msg = toCall === 0 ? `${s.name} checks.` : `${s.name} calls ${toCall}${s.allIn ? " (all-in)" : ""}.`;
    } else if (action === "raise") {
      if (!Number.isInteger(amount)) return fail("Pick a raise amount.");
      const max = s.bet + s.stack;
      const minTo = Math.min(max, this.currentBet + this.minRaiseSize);
      let to = Math.min(max, amount as number);
      if (to < minTo) return fail(`The smallest raise is to ${minTo}.`);
      if (to <= this.currentBet) { // all-in for less than a call
        this.commit(i, toCall); s.acted = true; this.msg = `${s.name} calls ${toCall} (all-in).`;
      } else {
        const size = to - this.currentBet;
        this.commit(i, to - s.bet);
        to = s.bet;
        if (size >= this.minRaiseSize) { this.minRaiseSize = size; for (const o of this.seats) if (o && o !== s) o.acted = false; }
        this.currentBet = Math.max(this.currentBet, to);
        s.acted = true;
        this.msg = `${s.name} ${this.board.length || this.phase !== "preflop" ? "bets" : "raises to"} ${to}${s.allIn ? " (all-in)" : ""}.`;
      }
    } else return fail("Unknown action.");
    this.afterAction(i);
    this.push();
    return { ok: true };
  }

  // ------------------------------------------------------------ bots + clock

  private botStrength(s: PSeat): number {
    const [a, b] = s.cards.map(cardValue);
    if (this.board.length === 0) {
      const hi = Math.max(a, b), lo = Math.min(a, b);
      let v = (hi + lo) / 28 * 0.65 + (a === b ? 0.3 : 0) + (suitOf(s.cards[0]) === suitOf(s.cards[1]) ? 0.05 : 0) + (hi - lo <= 2 ? 0.04 : 0);
      if (a === b && hi >= 10) v += 0.1;
      return Math.min(1, v);
    }
    const h = bestHand([...s.cards, ...this.board]);
    return [0.18, 0.46, 0.7, 0.8, 0.88, 0.9, 0.95, 0.99, 1, 1][h.cat] ?? 0.2;
  }

  private botAct(i: number) {
    const s = this.seats[i]!;
    const strength = this.botStrength(s);
    const toCall = Math.min(this.currentBet - s.bet, s.stack);
    const pot = this.seats.reduce((n, o) => n + (o?.total ?? 0), 0);
    const rng = this.ctx.rng();
    const max = s.bet + s.stack;
    const minTo = Math.min(max, this.currentBet + this.minRaiseSize);
    const raiseTo = (frac: number) => Math.min(max, Math.max(minTo, this.currentBet + Math.round((pot * frac) / 5) * 5));
    if (toCall === 0) {
      if (strength > 0.6 && rng < 0.65) return this.apply(i, "raise", raiseTo(0.4 + rng * 0.5));
      if (strength > 0.35 && rng < 0.2) return this.apply(i, "raise", raiseTo(0.4));
      return this.apply(i, "check", 0);
    }
    const need = toCall / (pot + toCall);
    if (strength > need + 0.3 && rng < 0.4) return this.apply(i, "raise", raiseTo(0.6 + rng * 0.6));
    if (strength + 0.05 >= need || rng < 0.07) return this.apply(i, "call", 0);
    return this.apply(i, "fold", 0);
  }

  tick(now: number) {
    if (this.phase === "wait" || this.phase === "showdown") {
      if (this.nextAt !== null && now >= this.nextAt) { this.nextAt = null; this.phase = "wait"; this.startHand(); }
      return;
    }
    if (this.turn === null) return;
    const s = this.seats[this.turn];
    if (!s) return;
    if (s.bot) { if (now >= s.botAt) this.botAct(this.turn); return; }
    if (this.deadline !== null && now >= this.deadline) {
      const i = this.turn;
      this.msg = `${s.name} ran out of time.`;
      this.apply(i, s.bet >= this.currentBet ? "check" : "fold", 0);
    }
  }

  // ------------------------------------------------------------ views

  view(sockId: string): PokerView {
    const me = this.seatOf(sockId);
    const mine = me >= 0 ? this.seats[me]! : null;
    const showAll = this.phase === "showdown";
    const seats: (PkSeatView | null)[] = this.seats.map((s, i) => {
      if (!s) return null;
      const own = i === me;
      let cards: Card[] = [];
      if (s.inHand && !s.folded) cards = own || (showAll && s.reveal) ? s.cards : ["??", "??"];
      return {
        name: s.name, stack: s.stack, bet: s.bet, folded: s.inHand && s.folded, allIn: s.allIn, bot: s.bot, dealer: i === this.dealer && this.phase !== "wait",
        mine: own, cards, hand: showAll && s.reveal ? s.hand : undefined, won: s.won || undefined,
      };
    });
    const toCall = mine ? Math.min(this.currentBet - mine.bet, mine.stack) : 0;
    return {
      phase: this.phase, seats, board: this.board, pot: this.seats.reduce((n, s) => n + (s?.total ?? 0), 0),
      turn: this.turn, deadline: this.deadline, now: this.ctx.now(), mySeat: me, toCall,
      minRaise: mine ? Math.min(mine.bet + mine.stack, this.currentBet + this.minRaiseSize) : 0,
      maxRaise: mine ? mine.bet + mine.stack : 0,
      canCheck: !!mine && mine.bet >= this.currentBet,
      bots: this.bots(), blinds: { sb: PK.SB, bb: PK.BB }, buyIn: { min: PK.MIN_BUY, max: PK.MAX_BUY }, msg: this.msg,
    };
  }
}
