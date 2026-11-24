// The 8-Ball Pool table on Floor 2: two stools, a match against the house bot or the other person sitting
// down, and an optional friendly stake in Cafe Beans. The server runs every shot with the shared physics
// (src/shared/pool.ts); the browser replays the same shot to animate it.
import { chooseShot, newPoolGame, playShot, type PoolGame } from "../src/shared/pool.ts";
import type { PoolBallView, PoolView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";

export const POOL_STAKES = [0, 10, 25, 50, 100];
export const POOL_TURN_MS = 45_000;
export const POOL_OFFER_MS = 20_000;
export const POOL_BOT_MS = 1600;
export const POOL_BOT_PAYOUT = 1.8; // beating the bot returns 1.8x your stake; a loss forfeits it
const BOT = "House Bot";

type Phase = PoolView["phase"];
const lite = (balls: PoolGame["balls"]): PoolBallView[] => balls.map((b) => ({ id: b.id, x: b.x, y: b.y, out: b.out }));

export class PoolEngine {
  sitters: (Who | null)[] = [null, null];
  phase: Phase = "lobby";
  private game: PoolGame = newPoolGame();
  private sides: [Who | null, Who | null] = [null, null]; // who plays side 0 and 1 (null = the bot)
  private stake = 0;
  private vsBot = false;
  private offerFrom = -1;
  private deadline: number | null = null;
  private botAt = 0;
  private timeouts = 0;
  private shot: PoolView["shot"] = null;
  private seq = 0;
  private winner: 0 | 1 | null = null;
  private msg = "Sit down, then start a match against the house bot or whoever takes the other stool.";
  private returned = new Map<string, number>();
  private overAt = 0;
  private ctx: EngineCtx;
  private push: () => void;

  constructor(ctx: EngineCtx, push: () => void) {
    this.ctx = ctx;
    this.push = push;
  }

  private sideOf(sockId: string): 0 | 1 | -1 {
    return this.sides[0]?.sockId === sockId ? 0 : this.sides[1]?.sockId === sockId ? 1 : -1;
  }

  sit(index: number, w: Who) {
    if (index < 0 || index > 1 || this.sitters[index]) return;
    this.sitters[index] = w;
    if (this.phase === "over") this.reset("Take a seat and start a new match.");
    this.push();
  }

  leave(sockId: string) {
    const i = this.sitters.findIndex((s) => s?.sockId === sockId);
    if (i < 0) return;
    const side = this.sideOf(sockId);
    this.sitters[i] = null;
    if (this.phase === "play" && side !== -1) this.finish(side === 0 ? 1 : 0, `${this.sitterName(side)} left the table.`);
    else if (this.phase === "offer") this.reset("The challenge was cancelled.");
    this.push();
  }

  private sitterName(side: 0 | 1) {
    return this.sides[side]?.name ?? BOT;
  }

  private reset(msg: string) {
    this.phase = "lobby"; this.game = newPoolGame(); this.sides = [null, null]; this.stake = 0; this.vsBot = false;
    this.deadline = null; this.winner = null; this.shot = null; this.timeouts = 0; this.msg = msg; this.returned.clear();
  }

  // ------------------------------------------------------------ starting

  start(w: Who, stake: unknown, ai: unknown): { ok: true } | Fail {
    const mine = this.sitters.findIndex((s) => s?.sockId === w.sockId);
    if (mine < 0) return fail("Sit at the pool table first.");
    if (this.phase === "play" || this.phase === "offer") return fail("A match is already under way.");
    if (!POOL_STAKES.includes(stake as number)) return fail("Pick a stake.");
    const st = stake as number;
    if (ai === true) {
      if (!this.ctx.wallets.debit(w.clientId, st)) return fail("Not enough Cafe Beans for that stake.");
      if (st) this.ctx.touch(w.clientId);
      this.begin([w, null], st, true);
    } else {
      const other = this.sitters.find((s) => s && s.sockId !== w.sockId);
      if (!other) return fail("Nobody is on the other stool yet. Play the house bot, or wait for someone.");
      if (this.ctx.wallets.balance(w.clientId) < st) return fail("Not enough Cafe Beans for that stake.");
      this.phase = "offer"; this.stake = st; this.offerFrom = mine;
      this.sides = [w, other]; this.deadline = this.ctx.now() + POOL_OFFER_MS;
      this.msg = `${w.name} challenges ${other.name}${st ? ` for ${st} beans each` : " to a friendly game"}.`;
    }
    this.push();
    return { ok: true };
  }

  accept(w: Who, accept: unknown): { ok: true } | Fail {
    if (this.phase !== "offer") return fail("Nobody has challenged you.");
    if (this.sides[1]?.sockId !== w.sockId) return fail("That challenge isn't for you.");
    const host = this.sides[0]!;
    if (accept !== true) { this.reset(`${w.name} declined the challenge.`); this.push(); return { ok: true }; }
    const st = this.stake;
    if (this.ctx.wallets.balance(w.clientId) < st) return fail("Not enough Cafe Beans for that stake.");
    if (!this.ctx.wallets.debit(host.clientId, st)) { this.reset(`${host.name} can no longer cover the stake.`); this.push(); return fail("The other player can no longer cover the stake."); }
    this.ctx.wallets.debit(w.clientId, st);
    if (st) { this.ctx.touch(host.clientId); this.ctx.touch(w.clientId); }
    this.begin([host, w], st, false);
    this.push();
    return { ok: true };
  }

  private begin(sides: [Who | null, Who | null], stake: number, vsBot: boolean) {
    this.sides = sides; this.stake = stake; this.vsBot = vsBot;
    this.game = newPoolGame(0);
    this.phase = "play"; this.winner = null; this.shot = null; this.timeouts = 0;
    this.startTurn();
    this.msg = `Break! ${this.sides[0]!.name} shoots first.`;
  }

  private startTurn() {
    const t = this.ctx.now();
    this.deadline = t + POOL_TURN_MS;
    this.botAt = t + POOL_BOT_MS;
  }

  // ------------------------------------------------------------ shots

  shootNow(side: 0 | 1, angle: number, power: number) {
    const before = lite(this.game.balls);
    const out = playShot(this.game, angle, power);
    const name = (s: 0 | 1) => this.sides[s]?.name ?? BOT;
    this.game = out.game;
    this.seq++;
    this.shot = { from: before, angle, power, by: side, seq: this.seq };
    this.timeouts = 0;
    if (out.winner !== null) { this.finish(out.winner, `${name(out.winner)} wins: ${out.reason}`); return; }
    const g = this.game.groups[side];
    const grp = (x: string | null) => (x ? ` (${x}s)` : "");
    this.msg = out.foul
      ? `${out.foul} ${name(this.game.turn)} shoots next.`
      : this.game.turn === side ? `${name(side)} sinks one${grp(g)} and shoots again.` : `${name(side)} missed. ${name(this.game.turn)}'s turn.`;
    this.startTurn();
  }

  shoot(w: Who, angle: unknown, power: unknown): { ok: true } | Fail {
    if (this.phase !== "play") return fail("There is no match in progress.");
    const side = this.sideOf(w.sockId);
    if (side < 0) return fail("You are not in this match.");
    if (this.game.turn !== side) return fail("It's not your turn.");
    if (typeof angle !== "number" || typeof power !== "number" || !Number.isFinite(angle) || !Number.isFinite(power) || power <= 0) return fail("Bad shot.");
    this.shootNow(side, angle, Math.min(1, power));
    this.push();
    return { ok: true };
  }

  resign(w: Who): { ok: true } | Fail {
    const side = this.sideOf(w.sockId);
    if (this.phase !== "play" || side < 0) return fail("There is no match to leave.");
    this.finish(side === 0 ? 1 : 0, `${w.name} resigned.`);
    this.push();
    return { ok: true };
  }

  private finish(winner: 0 | 1, why: string) {
    this.phase = "over"; this.winner = winner; this.deadline = null; this.overAt = this.ctx.now();
    const win = this.sides[winner];
    if (this.stake > 0) {
      const pay = this.vsBot ? (win ? Math.floor(this.stake * POOL_BOT_PAYOUT) : 0) : this.stake * 2;
      if (win && pay > 0) { this.ctx.wallets.credit(win.clientId, pay); this.ctx.touch(win.clientId); this.returned.set(win.sockId, pay); }
    }
    this.msg = why;
  }

  // ------------------------------------------------------------ clock

  tick(now: number) {
    if (this.phase === "offer" && this.deadline !== null && now >= this.deadline) { this.reset("The challenge timed out."); this.push(); return; }
    if (this.phase === "over" && now - this.overAt > 30_000 && this.sitters.every((s) => !s)) this.reset("Sit down to play.");
    if (this.phase !== "play") return;
    const turn = this.game.turn;
    if (this.sides[turn] === null && this.vsBot) {
      if (now >= this.botAt) { const s = chooseShot(this.game, this.ctx.rng, 0.72); this.shootNow(turn, s.angle, s.power); this.push(); }
    } else if (this.deadline !== null && now >= this.deadline) {
      this.timeouts++;
      if (this.timeouts >= 2) { this.finish(turn === 0 ? 1 : 0, `${this.sides[turn]!.name} ran out of time twice.`); this.push(); return; }
      this.game = { ...this.game, turn: turn === 0 ? 1 : 0 };
      this.msg = `${this.sides[turn]!.name} ran out of time. ${this.sides[this.game.turn]?.name ?? BOT}'s turn.`;
      this.startTurn();
      this.push();
    }
  }

  // ------------------------------------------------------------ view

  view(sockId: string): PoolView {
    const me = this.sideOf(sockId);
    const seated = this.sitters.findIndex((s) => s?.sockId === sockId);
    const playersFor = (): PoolView["players"] =>
      this.phase === "lobby"
        ? this.sitters.map((s) => (s ? { name: s.name, bot: false, mine: s.sockId === sockId, group: null } : null))
        : [0, 1].map((i) => {
            const s = this.sides[i];
            if (!s && !(this.vsBot && i === 1)) return null;
            return { name: s?.name ?? BOT, bot: !s, mine: s?.sockId === sockId, group: this.game.groups[i] };
          });
    return {
      phase: this.phase,
      players: playersFor(),
      turn: this.game.turn, me, balls: lite(this.game.balls), shot: this.shot, stake: this.stake, vsBot: this.vsBot,
      host: seated >= 0 && (this.phase === "lobby" || this.phase === "over"),
      deadline: this.deadline, now: this.ctx.now(), winner: this.winner, msg: this.msg,
      returned: this.returned.get(sockId) ?? null,
    };
  }
}
