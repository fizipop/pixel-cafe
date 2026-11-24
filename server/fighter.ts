// Pixel Fighter II on the server: the CPU ladder and live 1v1 matches. The shared engine (src/shared/fighter.ts)
// runs here at 60 steps a second; players send their buttons, everyone watching gets snapshots. Winning
// pays a few Cafe Beans (capped, see rewards.ts) and builds a win streak that goes on the leaderboard.
import { BTN, CHARACTERS, LADDER, cpuButtons, ladderBeans, newBrain, newMatch, stepMatch, type Brain, type FightMatch } from "../src/shared/fighter.ts";
import type { FighterView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";

export const FIGHT_STEP_MS = 1000 / 60;
export const PVP_BEANS = 15;
export const PVP_REWARD_GAP_MS = 45_000;
const MAX_STEPS_PER_TICK = 8; // after a stall, don't try to catch up with seconds of fighting at once

type Entrant = { w: Who; char: number; bits: number };
type Bout = {
  match: FightMatch; e: [Entrant, Entrant | null]; // null = CPU
  ladder: number | null; level: number; brain: Brain; last: number; acc: number; ended: boolean; result: FighterView["result"];
};

export class FighterEngine {
  private bouts = new Map<string, Bout>(); // by socket id of each human in it
  private queue: Entrant | null = null;
  private stage = new Map<string, number>(); // ladder progress by client id
  private streak = new Map<string, number>();
  private lastPvpReward = new Map<string, number>();
  private ctx: EngineCtx;
  private push: (sockId: string, view: FighterView) => void;
  private onStreak: (w: Who, streak: number) => void;
  private grant: (clientId: string, amount: number) => number;

  constructor(ctx: EngineCtx, hooks: { push: (sockId: string, view: FighterView) => void; onStreak: (w: Who, streak: number) => void; grant: (clientId: string, amount: number) => number }) {
    this.ctx = ctx;
    this.push = hooks.push;
    this.onStreak = hooks.onStreak;
    this.grant = hooks.grant;
  }

  private rngFn = () => this.ctx.rng();

  join(w: Who, char: unknown, ladder: unknown): { ok: true; view: FighterView } | Fail {
    if (!Number.isInteger(char) || (char as number) < 0 || (char as number) >= CHARACTERS.length) return fail("Pick a fighter.");
    this.leave(w.sockId);
    const me: Entrant = { w, char: char as number, bits: 0 };
    if (ladder === true) {
      const stage = Math.min(this.stage.get(w.clientId) ?? 0, LADDER.length - 1);
      const foe = LADDER[stage];
      this.start(me, null, stage, foe.char, foe.level);
    } else if (this.queue && this.queue.w.clientId !== w.clientId) {
      const other = this.queue;
      this.queue = null;
      this.start(other, me, null, 0, 0);
    } else this.queue = me;
    return { ok: true, view: this.view(w.sockId) };
  }

  private start(a: Entrant, b: Entrant | null, ladder: number | null, cpuChar: number, level: number) {
    const bout: Bout = {
      match: newMatch(a.char, b ? b.char : cpuChar), e: [a, b], ladder, level, brain: newBrain(), last: this.ctx.now(), acc: 0, ended: false, result: null,
    };
    this.bouts.set(a.w.sockId, bout);
    if (b) this.bouts.set(b.w.sockId, bout);
    this.pushAll(bout);
  }

  leave(sockId: string) {
    if (this.queue?.w.sockId === sockId) this.queue = null;
    const bout = this.bouts.get(sockId);
    if (!bout) return;
    this.bouts.delete(sockId);
    const [a, b] = bout.e;
    if (b && !bout.ended) { // walking out of a live match forfeits it; the other player sees the result
      this.conclude(bout, a.w.sockId === sockId ? 1 : 0, true);
      this.pushAll(bout);
    }
  }

  input(sockId: string, bits: unknown) {
    const bout = this.bouts.get(sockId);
    if (!bout || !Number.isInteger(bits)) return;
    const side = bout.e[0].w.sockId === sockId ? 0 : 1;
    const e = bout.e[side];
    if (e) e.bits = (bits as number) & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.BLOCK | BTN.DOWN | BTN.LIGHT | BTN.HEAVY | BTN.SPECIAL);
  }

  /** Step every running match up to `now`, then send snapshots. */
  tick(now: number) {
    const seen = new Set<Bout>();
    for (const bout of this.bouts.values()) {
      if (seen.has(bout)) continue;
      seen.add(bout);
      if (bout.ended) continue;
      bout.acc += Math.min(now - bout.last, FIGHT_STEP_MS * MAX_STEPS_PER_TICK);
      bout.last = now;
      let steps = 0;
      while (bout.acc >= FIGHT_STEP_MS && steps < MAX_STEPS_PER_TICK) {
        bout.acc -= FIGHT_STEP_MS; steps++;
        const m = bout.match;
        const p0 = bout.e[0].bits;
        const p1 = bout.e[1] ? bout.e[1].bits : cpuButtons(m, 1, bout.brain, bout.level, this.rngFn);
        stepMatch(m, p0, p1);
        if (m.phase === "over" && m.winner !== null) { this.conclude(bout, m.winner, false); break; }
      }
      this.pushAll(bout);
      bout.match.ev = [];
    }
  }

  private conclude(bout: Bout, winner: 0 | 1, forfeit: boolean) {
    if (bout.ended) return;
    bout.ended = true;
    const m = bout.match;
    if (forfeit) { m.winner = winner; m.phase = "over"; }
    const humans = bout.e.map((e, i) => ({ e, i })).filter((x): x is { e: Entrant; i: number } => !!x.e);
    for (const { e, i } of humans) {
      const won = i === winner;
      const cid = e.w.clientId;
      let beans = 0;
      const streak = won ? (this.streak.get(cid) ?? 0) + 1 : 0;
      this.streak.set(cid, streak);
      if (won) {
        if (bout.ladder !== null) {
          beans = this.grant(cid, ladderBeans(bout.ladder));
          this.stage.set(cid, bout.ladder + 1 >= LADDER.length ? 0 : bout.ladder + 1);
        } else if (this.ctx.now() - (this.lastPvpReward.get(cid) ?? -Infinity) >= PVP_REWARD_GAP_MS) {
          this.lastPvpReward.set(cid, this.ctx.now());
          beans = this.grant(cid, PVP_BEANS);
        }
        if (beans > 0) { this.ctx.wallets.credit(cid, beans); this.ctx.touch(cid); }
        this.onStreak(e.w, streak);
      }
      bout.result = { won, beans, ladderDone: won && bout.ladder !== null && bout.ladder + 1 >= LADDER.length };
    }
  }

  view(sockId: string): FighterView {
    const bout = this.bouts.get(sockId);
    const queued = this.queue?.w.sockId === sockId;
    if (!bout) {
      return { mode: queued ? "queue" : "menu", match: null, chars: [0, 0], names: ["", ""], me: 0, ladder: null, streak: 0, best: 0, result: null };
    }
    const me: 0 | 1 = bout.e[0].w.sockId === sockId ? 0 : 1;
    const cid = bout.e[me]!.w.clientId;
    return {
      mode: bout.ended ? "over" : "fight", match: bout.match,
      chars: [bout.match.f[0].c, bout.match.f[1].c],
      names: [bout.e[0].w.name, bout.e[1] ? bout.e[1].w.name : `CPU ${CHARACTERS[bout.match.f[1].c].name}`],
      me, ladder: bout.ladder, streak: this.streak.get(cid) ?? 0, best: 0, result: bout.result,
    };
  }

  private pushAll(bout: Bout) {
    for (const e of bout.e) if (e && this.bouts.get(e.w.sockId) === bout) this.push(e.w.sockId, this.view(e.w.sockId));
  }

  /** Is anyone playing? (so the room only needs the fast timer while someone is). */
  get active() {
    return [...this.bouts.values()].some((b) => !b.ended);
  }
}
