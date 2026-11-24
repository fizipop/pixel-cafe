// Floor 2 in one place: wallets, the one-player games and the three shared tables. The Room owns the
// players and the seats; it hands this class a small `host` so the arcade can message people and
// look up who they are, and routes the arcade socket events to `handle()`.
import { arcadeSeatInfo } from "../src/game/arcadeLayout.ts";
import type { Floor } from "../src/shared/floors.ts";
import type { ArcadeEvent, BoardRow, BoardView, CrashView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Who } from "./arcadeTypes.ts";
import { BlackjackEngine } from "./blackjack.ts";
import { CrashEngine } from "./crash.ts";
import type { Repository } from "./repository.ts";
import { RouletteEngine } from "./roulette.ts";
import { SoloGames } from "./solo.ts";
import { Wallets } from "./wallet.ts";

export type ArcadeHost = {
  now: () => number;
  rng: () => number;
  emitTo: (sockId: string, event: string, payload: unknown) => void;
  socketsOf: (clientId: string) => string[];
  who: (sockId: string) => Who | undefined;
  floorOf: (sockId: string) => Floor | undefined;
};

const BOARD_ROWS = 10;

export class Arcade {
  readonly wallets: Wallets;
  readonly solo: SoloGames;
  readonly crash: CrashEngine;
  readonly roulette: RouletteEngine;
  readonly blackjack: BlackjackEngine;

  private repo: Repository;
  private host: ArcadeHost;

  constructor(repo: Repository, host: ArcadeHost) {
    this.repo = repo;
    this.host = host;
    this.wallets = new Wallets(repo, host.now);
    const ctx: EngineCtx = { now: host.now, rng: host.rng, wallets: this.wallets, touch: (id) => this.pushWallet(id) };
    this.solo = new SoloGames(ctx, repo);
    this.crash = new CrashEngine(ctx, () => this.pushCrash(), (who, mult) => this.recordMoon(who, mult));
    this.roulette = new RouletteEngine(ctx, () => this.pushRoulette());
    this.blackjack = new BlackjackEngine(ctx, () => this.pushBlackjack());
  }

  // ------------------------------------------------------------ wallet

  /** Tell every open tab of this device its balance (and add the daily top-up if it just ran dry). */
  pushWallet(clientId: string) {
    const topup = this.wallets.topup(clientId);
    const msg = { beans: this.wallets.balance(clientId), ...(topup ? { topup } : {}) };
    for (const s of this.host.socketsOf(clientId)) this.host.emitTo(s, "wallet", msg);
  }

  // ------------------------------------------------------------ shared pushes

  private pushCrash() {
    for (const w of this.crash.subs.values()) this.host.emitTo(w.sockId, "crash:state", this.crash.view(w.clientId));
  }
  private pushRoulette() {
    for (const w of this.roulette.subs.values()) this.host.emitTo(w.sockId, "roulette:state", this.roulette.view(w.clientId));
  }
  private pushBlackjack() {
    for (const w of this.blackjack.sitters) if (w) this.host.emitTo(w.sockId, "bj:state", this.blackjack.view(w.sockId));
  }

  private recordMoon(w: { clientId: string; name: string }, mult: number) {
    const prev = this.repo.getBest("moon", w.clientId);
    if (mult > 1 && (!prev || mult > prev.value)) this.repo.setBest("moon", w.clientId, { name: w.name, value: mult, ts: this.host.now() });
  }

  // ------------------------------------------------------------ seats (called by the Room)

  seated(sockId: string, seatId: string) {
    const info = arcadeSeatInfo(seatId);
    const w = this.host.who(sockId);
    if (!info || !w) return;
    if (info.table === "bj0") this.blackjack.sit(info.index, w);
    else this.roulette.join(w);
  }

  stoodUp(sockId: string, seatId: string) {
    const info = arcadeSeatInfo(seatId);
    if (!info) return;
    if (info.table === "bj0") { this.blackjack.leave(sockId); this.host.emitTo(sockId, "bj:state", null); }
    else { this.roulette.leave(sockId); this.host.emitTo(sockId, "roulette:state", null); }
  }

  /** The player left Floor 2 (stairs or disconnect): they stop watching the shared tables. */
  leftFloor(sockId: string) {
    this.crash.leave(sockId);
    this.roulette.leave(sockId);
  }

  // ------------------------------------------------------------ requests

  handle(sockId: string, event: ArcadeEvent, d: unknown, seatId: string | null): unknown {
    const w = this.host.who(sockId);
    if (!w) return fail("Not in the cafe.");
    if (this.host.floorOf(sockId) !== 2) return fail("Take the stairs up to the Arcade first.");
    const x = (d ?? {}) as Record<string, unknown>;
    const seat = arcadeSeatInfo(seatId);
    switch (event) {
      case "slots:spin": return this.solo.slots(w, x.bet);
      case "mines:state": return this.solo.minesState(w);
      case "mines:start": return this.solo.minesStart(w, x.bet, x.mines);
      case "mines:reveal": return this.solo.minesReveal(w, x.tile);
      case "mines:cashout": return this.solo.minesCashout(w);
      case "crash:join": this.crash.join(w); return { ok: true, view: this.crash.view(w.clientId) as CrashView };
      case "crash:leave": this.crash.leave(sockId); return { ok: true };
      case "crash:bet": return this.crash.bet(w, x.amount, x.auto);
      case "crash:cashout": return this.crash.cashout(w);
      case "roulette:join": this.roulette.join(w); return { ok: true, view: this.roulette.view(w.clientId) };
      case "roulette:leave": if (seat?.table !== "rt0") this.roulette.leave(sockId); return { ok: true };
      case "roulette:bet": return this.roulette.bet(w, x);
      case "roulette:clear": return this.roulette.clear(w);
      case "bj:bet": return seat?.table === "bj0" ? this.blackjack.bet(w, x.amount) : fail("Sit at the blackjack table first.");
      case "bj:hit": return seat?.table === "bj0" ? this.blackjack.hit(w) : fail("Sit at the blackjack table first.");
      case "bj:stand": return seat?.table === "bj0" ? this.blackjack.stand(w) : fail("Sit at the blackjack table first.");
      case "bj:double": return seat?.table === "bj0" ? this.blackjack.double(w) : fail("Sit at the blackjack table first.");
      case "ice:start": return this.solo.iceStart(w);
      case "ice:finish": return this.solo.iceFinish(w, x.token, x.score);
      case "arcade:board": return { ok: true, view: this.board(w.clientId) };
      default: return fail("Unknown request.");
    }
  }

  tick(now: number) {
    this.crash.tick(now);
    this.roulette.tick(now);
    this.blackjack.tick(now);
  }

  // ------------------------------------------------------------ leaderboards

  board(clientId: string): BoardView {
    const best = (id: "ice" | "moon"): BoardRow[] =>
      this.repo
        .listBest(id)
        .sort((a, b) => b.record.value - a.record.value || a.record.ts - b.record.ts)
        .slice(0, BOARD_ROWS)
        .map((r) => ({ name: r.record.name, value: r.record.value, mine: r.clientId === clientId }));
    return {
      ice: best("ice"),
      moon: best("moon"),
      rich: this.wallets.richest(BOARD_ROWS).map((r) => ({ name: r.name, value: r.beans, mine: r.clientId === clientId })),
    };
  }
}
