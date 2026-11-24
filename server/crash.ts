// To the Moon: one shared rocket for everybody watching the terminal. The server alone decides when
// it fizzles out; players bet while it is on the pad and cash out (or set an auto cash-out) in flight.
import { CRASH_CAP, crashMultAt, crashPoint, validBet } from "../src/shared/arcade.ts";
import type { CrashView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";

export const CRASH_WAIT_MS = 8000;
export const CRASH_REST_MS = 3500;

type Bet = { name: string; amount: number; auto?: number; cashedAt?: number; payout?: number };

export class CrashEngine {
  phase: CrashView["phase"] = "wait";
  deadline: number | null = null;
  readonly subs = new Map<string, Who>(); // by socket id
  readonly bets = new Map<string, Bet>(); // by client id
  history: number[] = [];
  private startAt = 0;
  private point = 1;
  private mult = 1;
  private restUntil = 0;
  private lastSent = -1;

  private ctx: EngineCtx;
  private onChange: () => void;
  private onCashout: (who: { clientId: string; name: string }, mult: number) => void;

  constructor(ctx: EngineCtx, onChange: () => void, onCashout: (who: { clientId: string; name: string }, mult: number) => void) {
    this.ctx = ctx;
    this.onChange = onChange;
    this.onCashout = onCashout;
  }

  join(w: Who) {
    this.subs.set(w.sockId, w);
    if (this.phase === "wait" && this.deadline === null) this.deadline = this.ctx.now() + CRASH_WAIT_MS;
    this.onChange();
  }

  leave(sockId: string) {
    if (this.subs.delete(sockId)) this.onChange();
  }

  bet(w: Who, amount: unknown, auto: unknown): { ok: true } | Fail {
    if (this.phase !== "wait") return fail("The rocket is already flying. Wait for the next one.");
    if (!validBet(amount)) return fail("Pick a valid bet.");
    if (this.bets.has(w.clientId)) return fail("You already have a bet on this flight.");
    let target: number | undefined;
    if (auto !== undefined && auto !== null) {
      if (typeof auto !== "number" || !Number.isFinite(auto) || auto < 1.01 || auto > CRASH_CAP) return fail("Auto cash-out must be between 1.01x and 200x.");
      target = Math.floor(auto * 100) / 100;
    }
    if (!this.ctx.wallets.debit(w.clientId, amount)) return fail("Not enough Cafe Beans.");
    this.bets.set(w.clientId, { name: w.name, amount, auto: target });
    this.ctx.touch(w.clientId);
    this.onChange();
    return { ok: true };
  }

  cashout(w: Who): { ok: true; mult: number; payout: number } | Fail {
    const b = this.bets.get(w.clientId);
    if (!b) return fail("You have no bet on this flight.");
    if (b.cashedAt) return fail("Already cashed out.");
    if (this.phase !== "fly") return fail(this.phase === "wait" ? "Wait for take-off." : "Too late, it already crashed.");
    const m = crashMultAt(this.ctx.now() - this.startAt);
    if (m >= this.point) {
      this.tick(this.ctx.now()); // it crashed between ticks
      return fail("Too late, it already crashed.");
    }
    return this.pay(w.clientId, b, m);
  }

  private pay(clientId: string, b: Bet, m: number) {
    b.cashedAt = m;
    b.payout = Math.floor(b.amount * m);
    this.ctx.wallets.credit(clientId, b.payout);
    this.ctx.touch(clientId);
    this.onCashout({ clientId, name: b.name }, m);
    this.onChange();
    return { ok: true as const, mult: m, payout: b.payout };
  }

  tick(now: number) {
    if (this.phase === "wait") {
      if (this.deadline === null && this.subs.size > 0) { this.deadline = now + CRASH_WAIT_MS; this.onChange(); }
      if (this.deadline !== null && now >= this.deadline) {
        this.point = crashPoint(this.ctx.rng());
        this.startAt = now;
        this.mult = 1;
        this.lastSent = -1;
        this.phase = "fly";
        this.deadline = null;
        this.onChange();
      }
      return;
    }
    if (this.phase === "fly") {
      const m = crashMultAt(now - this.startAt);
      if (m >= this.point) {
        for (const [id, b] of this.bets) if (!b.cashedAt && b.auto !== undefined && b.auto < this.point) this.pay(id, b, b.auto);
        this.mult = this.point;
        this.phase = "crashed";
        this.restUntil = now + CRASH_REST_MS;
        this.history = [...this.history, this.point].slice(-10);
        this.onChange();
        return;
      }
      for (const [id, b] of this.bets) if (!b.cashedAt && b.auto !== undefined && b.auto <= m) this.pay(id, b, b.auto);
      this.mult = m;
      if (m !== this.lastSent) { this.lastSent = m; this.onChange(); }
      return;
    }
    if (now >= this.restUntil) {
      this.bets.clear();
      this.phase = "wait";
      this.mult = 1;
      this.deadline = this.subs.size > 0 ? now + CRASH_WAIT_MS : null;
      this.onChange();
    }
  }

  view(clientId: string): CrashView {
    const mine = this.bets.get(clientId);
    return {
      phase: this.phase,
      deadline: this.deadline,
      now: this.ctx.now(),
      mult: this.mult,
      history: this.history,
      players: [...this.bets.values()].map((b) => ({ name: b.name, amount: b.amount, cashedAt: b.cashedAt })),
      mine: mine ? { amount: mine.amount, auto: mine.auto, cashedAt: mine.cashedAt, payout: mine.payout } : null,
    };
  }
}
