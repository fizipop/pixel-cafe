// Free-to-play cabinets (Pixel Fighter II, Neon Drift GP, Beat Battle) cost nothing, so all they can do is
// hand out Cafe Beans. A rolling cap per device keeps that small, whatever a client claims.
import { FREE_REWARD_CAP, FREE_REWARD_WINDOW_MS } from "../src/shared/arcade.ts";

export class FreeRewards {
  private buckets = new Map<string, { start: number; total: number }>();
  private now: () => number;

  constructor(now: () => number) {
    this.now = now;
  }

  /** How many of `amount` beans may actually be paid out right now. */
  grant(clientId: string, amount: number): number {
    const t = this.now();
    let b = this.buckets.get(clientId);
    if (!b || t - b.start >= FREE_REWARD_WINDOW_MS) { b = { start: t, total: 0 }; this.buckets.set(clientId, b); }
    const ok = Math.max(0, Math.min(Math.floor(amount), FREE_REWARD_CAP - b.total));
    b.total += ok;
    return ok;
  }
}
