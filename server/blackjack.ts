// Blackjack: one shared table with four seats against the house. Players bet, everyone is dealt in,
// then each seat plays in turn (Hit / Stand / Double Down); the dealer draws to 17 and bets settle.
// Blackjack pays 3:2, a win 1:1, a push returns the bet.
import { blackjackReturn, dealerMustHit, handValue, isBlackjack, newShoe, settleBlackjack, validBet, type Card } from "../src/shared/arcade.ts";
import type { BjSeatView, BlackjackView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";

export const BJ_SEATS = 4;
export const BJ_BET_MS = 12000;
export const BJ_TURN_MS = 20000;
export const BJ_DEALER_STEP_MS = 800;
export const BJ_RESULT_MS = 5000;
const HIDDEN = "??";

type Hand = {
  seat: number;
  clientId: string;
  name: string;
  bet: number;
  cards: Card[];
  status: "playing" | "stand" | "bust" | "blackjack";
  result?: ReturnType<typeof settleBlackjack>;
  payout?: number;
  left: boolean; // stood up mid-hand: auto-stands, still settles
};

export class BlackjackEngine {
  phase: BlackjackView["phase"] = "bet";
  deadline: number | null = null;
  readonly sitters: (Who | null)[] = Array.from({ length: BJ_SEATS }, () => null);
  private hands: Hand[] = [];
  private pending = new Map<number, { amount: number }>(); // bets placed during the betting phase, by seat
  private dealer: Card[] = [];
  private shoe: Card[] = [];
  private turn: number | null = null; // index into hands
  private revealed = false;
  private nextStep = 0;
  private rigged: Card[] | null = null;

  private ctx: EngineCtx;
  private onChange: () => void;

  constructor(ctx: EngineCtx, onChange: () => void) {
    this.ctx = ctx;
    this.onChange = onChange;
  }

  // ------------------------------------------------------------ seating

  sit(index: number, w: Who) {
    if (index < 0 || index >= BJ_SEATS) return;
    this.sitters[index] = w;
    this.onChange();
  }

  /** The player stood up. Their bet (if any) is settled by the house: an unbet seat just empties. */
  leave(sockId: string) {
    const i = this.sitters.findIndex((s) => s?.sockId === sockId);
    if (i < 0) return;
    const w = this.sitters[i] as Who;
    this.sitters[i] = null;
    const p = this.pending.get(i);
    if (p && this.phase === "bet") {
      this.pending.delete(i); // not dealt in yet: bet goes straight back
      this.ctx.wallets.credit(w.clientId, p.amount);
      this.ctx.touch(w.clientId);
      if (this.pending.size === 0) this.deadline = null;
    }
    const h = this.hands.find((x) => x.seat === i && x.clientId === w.clientId);
    if (h) {
      h.left = true;
      if (this.phase === "play" && this.turn !== null && this.hands[this.turn] === h) this.advance();
    }
    this.onChange();
  }

  seatOf(sockId: string) {
    return this.sitters.findIndex((s) => s?.sockId === sockId);
  }

  // ------------------------------------------------------------ actions

  bet(w: Who, amount: unknown): { ok: true } | Fail {
    const i = this.seatOf(w.sockId);
    if (i < 0) return fail("Sit at the table first.");
    if (this.phase !== "bet") return fail("Wait for the next round to place a bet.");
    if (this.pending.has(i)) return fail("You already bet this round.");
    if (!validBet(amount)) return fail("Pick a valid bet.");
    if (!this.ctx.wallets.debit(w.clientId, amount)) return fail("Not enough Cafe Beans.");
    this.pending.set(i, { amount });
    this.ctx.touch(w.clientId);
    const everyone = this.sitters.every((s, k) => !s || this.pending.has(k));
    if (everyone) this.deadline = this.ctx.now() + 600; // all seated players are in: deal right away
    else if (this.deadline === null) this.deadline = this.ctx.now() + BJ_BET_MS;
    this.onChange();
    return { ok: true };
  }

  private current(w: Who): Hand | Fail {
    if (this.phase !== "play" || this.turn === null) return fail("It isn't your turn.");
    const h = this.hands[this.turn];
    if (h.clientId !== w.clientId || this.sitters[h.seat]?.sockId !== w.sockId || h.left) return fail("It isn't your turn.");
    return h;
  }

  hit(w: Who): { ok: true } | Fail {
    const h = this.current(w);
    if ("ok" in h) return h;
    h.cards.push(this.draw());
    const t = handValue(h.cards).total;
    if (t > 21) h.status = "bust";
    else if (t === 21) h.status = "stand";
    if (h.status !== "playing") this.advance();
    else this.armTurn();
    this.onChange();
    return { ok: true };
  }

  stand(w: Who): { ok: true } | Fail {
    const h = this.current(w);
    if ("ok" in h) return h;
    h.status = "stand";
    this.advance();
    this.onChange();
    return { ok: true };
  }

  double(w: Who): { ok: true } | Fail {
    const h = this.current(w);
    if ("ok" in h) return h;
    if (h.cards.length !== 2) return fail("You can only double on your first two cards.");
    if (!this.ctx.wallets.debit(h.clientId, h.bet)) return fail("Not enough Cafe Beans to double.");
    this.ctx.touch(h.clientId);
    h.bet *= 2;
    h.cards.push(this.draw());
    h.status = handValue(h.cards).total > 21 ? "bust" : "stand";
    this.advance();
    this.onChange();
    return { ok: true };
  }

  // ------------------------------------------------------------ the round

  private draw(): Card {
    if (this.shoe.length < 10) this.shoe = newShoe(this.ctx.rng);
    return this.shoe.pop() as Card;
  }

  /** Tests only: the next round is dealt from these cards, in order (player 1, dealer, player 1, dealer, ...). */
  rig(top: Card[]) {
    this.rigged = [...Array.from({ length: 30 }, () => "2S"), ...[...top].reverse()];
  }

  private deal() {
    this.shoe = this.rigged ?? newShoe(this.ctx.rng);
    this.rigged = null;
    this.hands = [];
    for (const [seat, p] of [...this.pending].sort((a, b) => a[0] - b[0])) {
      const s = this.sitters[seat];
      if (!s) continue;
      this.hands.push({ seat, clientId: s.clientId, name: s.name, bet: p.amount, cards: [], status: "playing", left: false });
    }
    this.pending.clear();
    this.dealer = [];
    for (let round = 0; round < 2; round++) {
      for (const h of this.hands) h.cards.push(this.draw());
      this.dealer.push(this.draw());
    }
    this.revealed = false;
    for (const h of this.hands) if (isBlackjack(h.cards)) h.status = "blackjack";
    this.phase = "play";
    this.deadline = null;
    this.turn = null;
    this.advance(-1);
  }

  /** Move to the next hand that still has to act; when none is left the dealer plays. */
  private advance(from = this.turn ?? -1) {
    for (let i = from + 1; i < this.hands.length; i++) {
      const h = this.hands[i];
      if (h.status === "playing" && !h.left) { this.turn = i; this.armTurn(); return; }
      if (h.status === "playing" && h.left) h.status = "stand";
    }
    this.turn = null;
    this.phase = "dealer";
    this.revealed = true;
    this.deadline = null;
    this.nextStep = this.ctx.now() + BJ_DEALER_STEP_MS;
  }

  private armTurn() {
    this.deadline = this.ctx.now() + BJ_TURN_MS;
  }

  private settle() {
    for (const h of this.hands) {
      h.result = settleBlackjack(h.cards, this.dealer);
      h.payout = blackjackReturn(h.result, h.bet);
      if (h.payout > 0) { this.ctx.wallets.credit(h.clientId, h.payout); this.ctx.touch(h.clientId); }
    }
    this.phase = "payout";
    this.deadline = this.ctx.now() + BJ_RESULT_MS;
  }

  tick(now: number) {
    if (this.phase === "bet") {
      if (this.deadline !== null && now >= this.deadline && this.pending.size > 0) { this.deal(); this.onChange(); }
    } else if (this.phase === "play") {
      if (this.deadline !== null && now >= this.deadline && this.turn !== null) {
        this.hands[this.turn].status = "stand"; // ran out of time
        this.advance();
        this.onChange();
      }
    } else if (this.phase === "dealer") {
      if (now < this.nextStep) return;
      const needsDealer = this.hands.some((h) => h.status === "stand"); // all bust / all blackjack: the dealer doesn't draw
      if (needsDealer && dealerMustHit(this.dealer)) {
        this.dealer.push(this.draw());
        this.nextStep = now + BJ_DEALER_STEP_MS;
      } else this.settle();
      this.onChange();
    } else if (this.deadline !== null && now >= this.deadline) {
      this.hands = [];
      this.dealer = [];
      this.revealed = false;
      this.phase = "bet";
      this.deadline = null;
      this.onChange();
    }
  }

  // ------------------------------------------------------------ what players see

  view(sockId: string): BlackjackView {
    const mySeat = this.seatOf(sockId);
    const dealerShown = this.revealed ? this.dealer : this.dealer.map((c, i) => (i === 1 ? HIDDEN : c));
    const seats: (BjSeatView | null)[] = this.sitters.map((s, i) => {
      const h = this.hands.find((x) => x.seat === i);
      if (h) {
        return {
          name: h.name, bet: h.bet, cards: h.cards, total: handValue(h.cards).total,
          status: h.status, result: h.result, payout: h.payout, mine: i === mySeat,
        };
      }
      if (!s) return null;
      const p = this.pending.get(i);
      return { name: s.name, bet: p?.amount ?? 0, cards: [], total: 0, status: p ? "bet" : "waiting", mine: i === mySeat };
    });
    // a hand left behind by someone who stood up is still shown until the round ends
    const hand = this.turn !== null ? this.hands[this.turn] : null;
    const mine = hand && this.phase === "play" && mySeat >= 0 && hand.seat === mySeat && !hand.left ? hand : null;
    return {
      phase: this.phase,
      deadline: this.deadline,
      now: this.ctx.now(),
      dealer: dealerShown,
      dealerTotal: this.revealed ? handValue(this.dealer).total : null,
      seats,
      turn: hand ? hand.seat : null,
      mySeat,
      canDouble: !!mine && mine.cards.length === 2,
    };
  }
}
