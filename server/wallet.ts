// Cafe Beans wallets (server-authoritative). Fictional tokens: they cannot be bought, sold or redeemed.
// One wallet per device (client id), stored through the Repository so it survives restarts.
import { dayKey } from "../src/lib/guestbook.ts";
import { MIN_BET, SEED_MAX, START_BEANS, TOPUP_BEANS } from "../src/shared/arcade.ts";
import type { Repository } from "./repository.ts";

export const EARN_MAX_EACH = 20; // one drink or gift is never worth more than this
export const EARN_PER_MIN = 60; // and drink/gift beans are rate limited so the richest list can't be spammed

export class Wallets {
  private buckets = new Map<string, { tokens: number; t: number }>();

  private repo: Repository;
  private now: () => number;

  constructor(repo: Repository, now: () => number) {
    this.repo = repo;
    this.now = now;
  }

  /** Make sure a wallet exists. A new one starts with START_BEANS, or the device's drink-making beans if higher. */
  ensure(clientId: string, name: string, seed = 0): number {
    const cur = this.repo.getWallet(clientId);
    if (cur) {
      if (cur.name !== name) this.repo.setWallet(clientId, { ...cur, name });
      return cur.beans;
    }
    const start = Math.max(START_BEANS, Math.min(SEED_MAX, Math.floor(Number.isFinite(seed) ? seed : 0)));
    this.repo.setWallet(clientId, { beans: start, name, topupDay: "", updated: this.now() });
    return start;
  }

  balance(clientId: string): number {
    return this.repo.getWallet(clientId)?.beans ?? 0;
  }

  /** Take beans for a bet. False (and nothing changes) if there aren't enough. */
  debit(clientId: string, n: number): boolean {
    const w = this.repo.getWallet(clientId);
    if (!w || !Number.isInteger(n) || n < 0 || w.beans < n) return false;
    this.repo.setWallet(clientId, { ...w, beans: w.beans - n, updated: this.now() });
    return true;
  }

  credit(clientId: string, n: number): number {
    const w = this.repo.getWallet(clientId);
    if (!w || !Number.isInteger(n) || n <= 0) return w?.beans ?? 0;
    const beans = w.beans + n;
    this.repo.setWallet(clientId, { ...w, beans, updated: this.now() });
    return beans;
  }

  /** Beans from making a drink or gifting one. Returns how many were actually granted. */
  earn(clientId: string, amount: unknown): number {
    if (!Number.isInteger(amount) || (amount as number) < 1 || !this.repo.getWallet(clientId)) return 0;
    const t = this.now();
    const b = this.buckets.get(clientId) ?? { tokens: EARN_PER_MIN, t };
    b.tokens = Math.min(EARN_PER_MIN, b.tokens + ((t - b.t) / 60_000) * EARN_PER_MIN);
    b.t = t;
    const grant = Math.min(amount as number, EARN_MAX_EACH, Math.floor(b.tokens));
    b.tokens -= grant;
    this.buckets.set(clientId, b);
    if (grant > 0) this.credit(clientId, grant);
    return grant;
  }

  /** Daily starter top-up so nobody gets stuck: once a day, when you have less than the smallest bet. */
  topup(clientId: string): number {
    const w = this.repo.getWallet(clientId);
    const today = dayKey(this.now());
    if (!w || w.beans >= MIN_BET || w.topupDay === today) return 0;
    this.repo.setWallet(clientId, { ...w, beans: w.beans + TOPUP_BEANS, topupDay: today, updated: this.now() });
    return TOPUP_BEANS;
  }

  richest(n: number): { clientId: string; name: string; beans: number }[] {
    return this.repo
      .listWallets()
      .map(({ clientId, wallet }) => ({ clientId, name: wallet.name, beans: wallet.beans }))
      .sort((a, b) => b.beans - a.beans || a.name.localeCompare(b.name))
      .slice(0, n);
  }
}
