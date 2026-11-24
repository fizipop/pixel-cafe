// Roulette: one shared wheel. Everyone seated at the table (or watching from beside it) sees the same
// spin; bets close when the wheel starts, and winnings are paid when the ball settles.
import { MAX_BET, rouletteReturn, validRouletteBet, type RouletteBet } from "../src/shared/arcade.ts";
import type { RouletteView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";

export const ROULETTE_BET_MS = 15000;
export const ROULETTE_SPIN_MS = 5000;
export const ROULETTE_REST_MS = 5000;
export const ROULETTE_TABLE_LIMIT = MAX_BET * 2; // total staked per player per spin
export const ROULETTE_MAX_BETS = 12; // separate bets per player per spin

export class RouletteEngine {
  phase: RouletteView["phase"] = "bet";
  deadline: number | null = null;
  result: number | null = null;
  history: number[] = [];
  readonly subs = new Map<string, Who>(); // by socket id
  private bets = new Map<string, { name: string; list: RouletteBet[] }>(); // by client id
  private returned = new Map<string, number>();
  private phaseEnds = 0;

  private ctx: EngineCtx;
  private onChange: () => void;

  constructor(ctx: EngineCtx, onChange: () => void) {
    this.ctx = ctx;
    this.onChange = onChange;
  }

  /** Seated players are always in; watchers join on opening the terminal. */
  join(w: Who) {
    this.subs.set(w.sockId, w);
    if (this.phase === "bet" && this.deadline === null) this.deadline = this.ctx.now() + ROULETTE_BET_MS;
    this.onChange();
  }

  leave(sockId: string) {
    if (this.subs.delete(sockId)) this.onChange();
  }

  bet(w: Who, raw: unknown): { ok: true } | Fail {
    if (this.phase !== "bet") return fail("Bets are closed. Wait for the next spin.");
    if (!validRouletteBet(raw)) return fail("That isn't a valid bet.");
    const b: RouletteBet = { kind: raw.kind, n: raw.kind === "num" ? raw.n : undefined, amount: raw.amount };
    const entry = this.bets.get(w.clientId) ?? { name: w.name, list: [] };
    if (entry.list.length >= ROULETTE_MAX_BETS) return fail("That's plenty of chips on the table.");
    if (entry.list.reduce((n, x) => n + x.amount, 0) + b.amount > ROULETTE_TABLE_LIMIT) return fail("Table limit reached for this spin.");
    if (!this.ctx.wallets.debit(w.clientId, b.amount)) return fail("Not enough Cafe Beans.");
    entry.list.push(b);
    this.bets.set(w.clientId, entry);
    this.ctx.touch(w.clientId);
    this.onChange();
    return { ok: true };
  }

  /** Take your chips back (only while betting is open). */
  clear(w: Who): { ok: true } | Fail {
    if (this.phase !== "bet") return fail("Bets are closed.");
    const entry = this.bets.get(w.clientId);
    if (!entry || entry.list.length === 0) return { ok: true };
    const total = entry.list.reduce((n, x) => n + x.amount, 0);
    this.bets.delete(w.clientId);
    this.ctx.wallets.credit(w.clientId, total);
    this.ctx.touch(w.clientId);
    this.onChange();
    return { ok: true };
  }

  tick(now: number) {
    if (this.phase === "bet") {
      if (this.deadline === null && this.subs.size > 0) { this.deadline = now + ROULETTE_BET_MS; this.onChange(); }
      if (this.deadline !== null && now >= this.deadline) {
        this.result = Math.floor(this.ctx.rng() * 37);
        this.phase = "spin";
        this.deadline = this.phaseEnds = now + ROULETTE_SPIN_MS;
        this.onChange();
      }
    } else if (this.phase === "spin") {
      if (now < this.phaseEnds) return;
      const n = this.result as number;
      this.returned.clear();
      for (const [clientId, entry] of this.bets) {
        const back = entry.list.reduce((sum, b) => sum + rouletteReturn(b, n), 0);
        this.returned.set(clientId, back);
        if (back > 0) { this.ctx.wallets.credit(clientId, back); this.ctx.touch(clientId); }
      }
      this.history = [...this.history, n].slice(-12);
      this.phase = "result";
      this.deadline = this.phaseEnds = now + ROULETTE_REST_MS;
      this.onChange();
    } else if (now >= this.phaseEnds) {
      this.bets.clear();
      this.returned.clear();
      this.result = null;
      this.phase = "bet";
      this.deadline = this.subs.size > 0 ? now + ROULETTE_BET_MS : null;
      this.onChange();
    }
  }

  view(clientId: string): RouletteView {
    const mine = this.bets.get(clientId);
    return {
      phase: this.phase,
      deadline: this.deadline,
      now: this.ctx.now(),
      result: this.phase === "bet" ? null : this.result,
      spinMs: ROULETTE_SPIN_MS,
      history: this.history,
      mine: mine ? mine.list : [],
      watching: this.bets.size,
      returned: this.phase === "result" ? (mine ? this.returned.get(clientId) ?? 0 : null) : null,
    };
  }
}
