// Small shared types for the Floor 2 game engines (crash, roulette, blackjack, solo games).
import type { Wallets } from "./wallet.ts";

/** A connected player as the engines see them. */
export type Who = { sockId: string; clientId: string; name: string };

export type EngineCtx = {
  now: () => number;
  rng: () => number; // 0..1
  wallets: Wallets;
  /** A wallet changed (bet taken, win paid): the room tells that player their new balance. */
  touch: (clientId: string) => void;
};

export type Fail = { ok: false; reason: string };
export const fail = (reason: string): Fail => ({ ok: false, reason });
