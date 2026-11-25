// Floor 2 in one place: wallets, the one-player games, the shared tables (crash, roulette, blackjack, poker, pool) and Pixel Fighter II. The Room owns the
// players and the seats; it hands this class a small `host` so the arcade can message people and
// look up who they are, and routes the arcade socket events to `handle()`.
import { arcadeSeatInfo } from "../src/game/arcadeLayout.ts";
import type { Floor } from "../src/shared/floors.ts";
import type { ArcadeEvent, BoardRow, BoardView, CrashView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Who } from "./arcadeTypes.ts";
import { BlackjackEngine } from "./blackjack.ts";
import { CrashEngine } from "./crash.ts";
import { FighterEngine } from "./fighter.ts";
import { PokerEngine } from "./poker.ts";
import { PoolEngine } from "./pool.ts";
import { LOWER_IS_BETTER, type BoardId, type Repository } from "./repository.ts";
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
  readonly poker: PokerEngine;
  readonly pool: PoolEngine;
  readonly fighter: FighterEngine;

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
    this.poker = new PokerEngine(ctx, () => this.pushPoker());
    this.pool = new PoolEngine(ctx, () => this.pushPool());
    this.fighter = new FighterEngine(ctx, {
      push: (sockId, view) => this.host.emitTo(sockId, "fg:state", view),
      onStreak: (who, streak) => { this.solo.record("fighter", who, streak); },
      grant: (clientId, amount) => this.solo.rewards.grant(clientId, amount),
    });
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

  private pushPoker() {
    for (const w of this.poker.humans) this.host.emitTo(w.sockId, "pk:state", this.poker.view(w.sockId));
  }
  private pushPool() {
    for (const w of this.pool.sitters) if (w) this.host.emitTo(w.sockId, "pl:state", this.pool.view(w.sockId));
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
    else if (info.table === "rt0") this.roulette.join(w);
    else if (info.table === "pk0") this.poker.sit(info.index, w);
    else this.pool.sit(info.index, w);
  }

  stoodUp(sockId: string, seatId: string) {
    const info = arcadeSeatInfo(seatId);
    if (!info) return;
    if (info.table === "bj0") { this.blackjack.leave(sockId); this.host.emitTo(sockId, "bj:state", null); }
    else if (info.table === "rt0") { this.roulette.leave(sockId); this.host.emitTo(sockId, "roulette:state", null); }
    else if (info.table === "pk0") { this.poker.leave(sockId); this.host.emitTo(sockId, "pk:state", null); }
    else { this.pool.leave(sockId); this.host.emitTo(sockId, "pl:state", null); }
  }

  /** The player left Floor 2 (stairs or disconnect): they stop watching the shared tables. */
  leftFloor(sockId: string) {
    this.crash.leave(sockId);
    this.roulette.leave(sockId);
    this.fighter.leave(sockId);
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
      case "plinko:drop": return this.solo.plinko(w, x.bet, x.gate);
      case "huff:spin": return this.solo.huff(w, x.machine, x.bet);
      case "lottery:enter": return this.solo.lottery(w, x.pick);
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
      case "penguin:state": return this.solo.penguinState(w);
      case "penguin:start": return this.solo.penguinStart(w, x.bet, x.lane);
      case "penguin:step": return this.solo.penguinStep(w);
      case "penguin:cashout": return this.solo.penguinCashout(w);
      case "pk:buyin": return seat?.table === "pk0" ? this.poker.buyIn(w, x.amount) : fail("Sit at the poker table first.");
      case "pk:act": return seat?.table === "pk0" ? this.poker.act(w, x.action, x.amount) : fail("Sit at the poker table first.");
      case "pk:bot": return seat?.table === "pk0" ? this.poker.bot(x.add !== false) : fail("Sit at the poker table first.");
      case "pl:start": return seat?.table === "pl0" ? this.pool.start(w, x.stake, x.ai) : fail("Sit at the pool table first.");
      case "pl:accept": return seat?.table === "pl0" ? this.pool.accept(w, x.accept) : fail("Sit at the pool table first.");
      case "pl:shot": return seat?.table === "pl0" ? this.pool.shoot(w, x.angle, x.power, x.cue, x.pocket) : fail("Sit at the pool table first.");
      case "pl:resign": return seat?.table === "pl0" ? this.pool.resign(w) : fail("Sit at the pool table first.");
      case "fg:join": { const r = this.fighter.join(w, x.char, x.ladder); return r; }
      case "fg:cancel": this.fighter.leave(sockId); this.host.emitTo(sockId, "fg:state", this.fighter.view(sockId)); return { ok: true };
      case "fg:input": this.fighter.input(sockId, x.bits); return { ok: true };
      case "racer:start": return this.solo.runStart("racer", w);
      case "racer:finish": return this.solo.racerFinish(w, x.token, x.totalMs, x.bestLapMs, x.position);
      case "beat:start": return this.solo.runStart("beat", w, x.diff);
      case "beat:finish": return this.solo.beatFinish(w, x.token, x.seq);
      case "arcade:board": return { ok: true, view: this.board(w.clientId) };
      default: return fail("Unknown request.");
    }
  }

  tick(now: number) {
    this.crash.tick(now);
    this.roulette.tick(now);
    this.blackjack.tick(now);
    this.poker.tick(now);
    this.pool.tick(now);
  }

  /** The fast clock (about 30 times a second): real-time fights. */
  tickFast(now: number) {
    this.fighter.tick(now);
  }

  // ------------------------------------------------------------ leaderboards

  board(clientId: string): BoardView {
    const best = (id: BoardId): BoardRow[] =>
      this.repo
        .listBest(id)
        .sort((a, b) => (LOWER_IS_BETTER[id] ? a.record.value - b.record.value : b.record.value - a.record.value) || a.record.ts - b.record.ts)
        .slice(0, BOARD_ROWS)
        .map((r) => ({ name: r.record.name, value: r.record.value, mine: r.clientId === clientId }));
    return {
      penguin: best("penguin"),
      moon: best("moon"),
      drift: best("drift"),
      beat: best("beat"),
      fighter: best("fighter"),
      rich: this.wallets.richest(BOARD_ROWS).map((r) => ({ name: r.name, value: r.beans, mine: r.clientId === clientId })),
    };
  }
}
