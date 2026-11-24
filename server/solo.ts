// The one-player Floor 2 games: Pixel Slots, Cafe Mines and Penguin Cross, plus the checks for the Neon Drift GP
// and Beat Battle cabinets. All results are decided (or verified) here on the server (the browser only animates
// them), and all stakes are fictional Cafe Beans.
import {
  MINES_TILES, PENGUIN_TILES, minesMultiplier, penguinCrackChance, penguinMultiplier, placeMines, slotMultiplier, spinReel, validBet,
  validMineCount, validPenguinLane, type PenguinLane, type SlotSymbol,
} from "../src/shared/arcade.ts";
import { beansFor, chartFor, isDifficulty, songMsFor, rankOf, scoreRun, type Difficulty } from "../src/shared/beat.ts";
import { RACE, raceBeans, track } from "../src/shared/racer.ts";
import type { MinesView, PenguinView, RunFinish, SlotsResult } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";
import { LOWER_IS_BETTER, type BoardId, type Repository } from "./repository.ts";
import { FreeRewards } from "./rewards.ts";

type PenguinGame = { bet: number; lane: PenguinLane; steps: number };
type MinesGame = { bet: number; mines: number; hazards: number[]; revealed: number[] };

export class SoloGames {
  private mines = new Map<string, MinesGame>(); // by client id
  private penguin = new Map<string, PenguinGame>();
  private runs = new Map<string, { token: number; at: number; diff: Difficulty }>();
  private lastToken = 0;
  readonly rewards: FreeRewards;

  private ctx: EngineCtx;
  private repo: Repository;

  constructor(ctx: EngineCtx, repo: Repository) {
    this.ctx = ctx;
    this.repo = repo;
    this.rewards = new FreeRewards(ctx.now);
  }

  // ------------------------------------------------------------ slots

  slots(w: Who, bet: unknown): ({ ok: true } & SlotsResult) | Fail {
    if (!validBet(bet)) return fail("Pick a valid bet.");
    if (!this.ctx.wallets.debit(w.clientId, bet)) return fail("Not enough Cafe Beans.");
    const reels: SlotSymbol[] = [spinReel(this.ctx.rng), spinReel(this.ctx.rng), spinReel(this.ctx.rng)];
    const mult = slotMultiplier(reels);
    const win = Math.floor(bet * mult);
    if (win > 0) this.ctx.wallets.credit(w.clientId, win);
    this.ctx.touch(w.clientId);
    return { ok: true, reels, mult, win, beans: this.ctx.wallets.balance(w.clientId) };
  }

  // ------------------------------------------------------------ mines

  private minesView(w: Who, g: MinesGame, over?: MinesView["over"], payout?: number): MinesView {
    const safe = g.revealed.length;
    return {
      active: !over,
      bet: g.bet,
      mines: g.mines,
      revealed: [...g.revealed],
      mult: minesMultiplier(g.mines, safe),
      next: safe < MINES_TILES - g.mines ? minesMultiplier(g.mines, safe + 1) : minesMultiplier(g.mines, safe),
      over,
      payout,
      hazards: over ? g.hazards : undefined,
      beans: this.ctx.wallets.balance(w.clientId),
    };
  }

  minesState(w: Who): { ok: true; view: MinesView } | Fail {
    const g = this.mines.get(w.clientId);
    return g ? { ok: true, view: this.minesView(w, g) } : fail("No round in progress.");
  }

  minesStart(w: Who, bet: unknown, mines: unknown): { ok: true; view: MinesView } | Fail {
    if (this.mines.has(w.clientId)) return fail("Finish your current round first.");
    if (!validBet(bet)) return fail("Pick a valid bet.");
    if (!validMineCount(mines)) return fail("Pick between 1 and 24 hazards.");
    if (!this.ctx.wallets.debit(w.clientId, bet)) return fail("Not enough Cafe Beans.");
    const g: MinesGame = { bet, mines, hazards: placeMines(mines, this.ctx.rng), revealed: [] };
    this.mines.set(w.clientId, g);
    this.ctx.touch(w.clientId);
    return { ok: true, view: this.minesView(w, g) };
  }

  minesReveal(w: Who, tile: unknown): { ok: true; view: MinesView } | Fail {
    const g = this.mines.get(w.clientId);
    if (!g) return fail("Start a round first.");
    if (!Number.isInteger(tile) || (tile as number) < 0 || (tile as number) >= MINES_TILES) return fail("No such tile.");
    const t = tile as number;
    if (g.revealed.includes(t)) return fail("Already opened.");
    if (g.hazards.includes(t)) {
      this.mines.delete(w.clientId);
      return { ok: true, view: this.minesView(w, g, "hit", 0) }; // the hazard tiles come back in `hazards`
    }
    g.revealed.push(t);
    if (g.revealed.length === MINES_TILES - g.mines) return this.minesCash(w, g, "cleared"); // every safe tile found
    return { ok: true, view: this.minesView(w, g) };
  }

  minesCashout(w: Who): { ok: true; view: MinesView } | Fail {
    const g = this.mines.get(w.clientId);
    if (!g) return fail("No round in progress.");
    return this.minesCash(w, g, "cashed");
  }

  private minesCash(w: Who, g: MinesGame, over: "cashed" | "cleared") {
    this.mines.delete(w.clientId);
    const payout = Math.floor(g.bet * minesMultiplier(g.mines, g.revealed.length));
    if (payout > 0) this.ctx.wallets.credit(w.clientId, payout);
    this.ctx.touch(w.clientId);
    return { ok: true as const, view: this.minesView(w, g, over, payout) };
  }

  // ------------------------------------------------------------ penguin cross

  private penguinView(w: Who, g: PenguinGame, over?: PenguinView["over"], payout?: number): PenguinView {
    const steps = g.steps;
    return {
      active: !over, bet: g.bet, lane: g.lane, steps, tiles: PENGUIN_TILES,
      mult: penguinMultiplier(g.lane, steps),
      next: steps < PENGUIN_TILES ? penguinMultiplier(g.lane, steps + 1) : penguinMultiplier(g.lane, steps),
      chance: penguinCrackChance(g.lane, steps + 1),
      over, payout, beans: this.ctx.wallets.balance(w.clientId),
    };
  }

  penguinState(w: Who): { ok: true; view: PenguinView } | Fail {
    const g = this.penguin.get(w.clientId);
    return g ? { ok: true, view: this.penguinView(w, g) } : fail("No crossing in progress.");
  }

  penguinStart(w: Who, bet: unknown, lane: unknown): { ok: true; view: PenguinView } | Fail {
    if (this.penguin.has(w.clientId)) return fail("Finish your current crossing first.");
    if (!validBet(bet)) return fail("Pick a valid bet.");
    if (!validPenguinLane(lane)) return fail("Pick an ice lane.");
    if (!this.ctx.wallets.debit(w.clientId, bet)) return fail("Not enough Cafe Beans.");
    const g: PenguinGame = { bet, lane, steps: 0 };
    this.penguin.set(w.clientId, g);
    this.ctx.touch(w.clientId);
    return { ok: true, view: this.penguinView(w, g) };
  }

  /** Step onto the next tile: it holds (multiplier up) or it cracks and the bet is lost. */
  penguinStep(w: Who): { ok: true; view: PenguinView } | Fail {
    const g = this.penguin.get(w.clientId);
    if (!g) return fail("Start a crossing first.");
    if (this.ctx.rng() < penguinCrackChance(g.lane, g.steps + 1)) {
      this.penguin.delete(w.clientId);
      return { ok: true, view: this.penguinView(w, g, "cracked", 0) };
    }
    g.steps++;
    if (g.steps >= PENGUIN_TILES) return this.penguinCash(w, g, "shore"); // made it across: paid automatically
    return { ok: true, view: this.penguinView(w, g) };
  }

  penguinCashout(w: Who): { ok: true; view: PenguinView } | Fail {
    const g = this.penguin.get(w.clientId);
    if (!g) return fail("No crossing in progress.");
    if (g.steps < 1) return fail("Take at least one step first.");
    return this.penguinCash(w, g, "cashed");
  }

  private penguinCash(w: Who, g: PenguinGame, over: "cashed" | "shore") {
    this.penguin.delete(w.clientId);
    const mult = penguinMultiplier(g.lane, g.steps);
    const payout = Math.floor(g.bet * mult);
    if (payout > 0) this.ctx.wallets.credit(w.clientId, payout);
    this.ctx.touch(w.clientId);
    if (mult > 1) this.record("penguin", w, mult);
    return { ok: true as const, view: this.penguinView(w, g, over, payout) };
  }

  // ------------------------------------------------------------ boards

  /** Save a personal best (if it is one) and say where it ranks. */
  record(board: BoardId, w: Who, value: number): { best: boolean; rank: number | null } {
    const lower = LOWER_IS_BETTER[board];
    const prev = this.repo.getBest(board, w.clientId);
    const best = !prev || (lower ? value < prev.value : value > prev.value);
    if (best) this.repo.setBest(board, w.clientId, { name: w.name, value, ts: this.ctx.now() });
    else if (prev && prev.name !== w.name) this.repo.setBest(board, w.clientId, { ...prev, name: w.name });
    const list = this.repo.listBest(board).sort((a, b) => (lower ? a.record.value - b.record.value : b.record.value - a.record.value) || a.record.ts - b.record.ts);
    const idx = list.findIndex((r) => r.clientId === w.clientId);
    return { best, rank: idx >= 0 ? idx + 1 : null };
  }

  // ------------------------------------------------------------ Neon Drift GP and Beat Battle (a run is started, then finished)

  runStart(game: "racer" | "beat", w: Who, diff?: unknown): { ok: true; token: number } {
    const token = ++this.lastToken;
    this.runs.set(`${game}:${w.clientId}`, { token, at: this.ctx.now(), diff: isDifficulty(diff) ? diff : "normal" }); // Beat Battle remembers which level you started
    return { ok: true, token };
  }

  private takeRun(game: "racer" | "beat", w: Who, token: unknown) {
    const key = `${game}:${w.clientId}`;
    const run = this.runs.get(key);
    if (!run || run.token !== token) return null;
    this.runs.delete(key); // a run can be submitted once, good or bad
    return run;
  }

  racerFinish(w: Who, token: unknown, totalMs: unknown, bestLapMs: unknown, position: unknown): ({ ok: true } & RunFinish) | Fail {
    const run = this.takeRun("racer", w, token);
    if (!run) return fail("That race has already been recorded.");
    const min = track().minLapMs;
    if (!Number.isInteger(totalMs) || !Number.isInteger(bestLapMs) || !Number.isInteger(position) || (position as number) < 1 || (position as number) > RACE.FIELD) return fail("Bad race result.");
    const total = totalMs as number, lap = bestLapMs as number;
    if (lap < min || total < RACE.LAPS * min || lap * RACE.LAPS > total + 5) return fail("Those lap times are not possible on this track.");
    if (this.ctx.now() - run.at < RACE.COUNTDOWN_MS + total - 3000) return fail("That race finished faster than real time.");
    const beans = this.rewards.grant(w.clientId, raceBeans(position as number));
    if (beans > 0) { this.ctx.wallets.credit(w.clientId, beans); this.ctx.touch(w.clientId); }
    const r = this.record("drift", w, lap);
    return { ok: true, beans, best: r.best, rank: r.rank, value: lap };
  }

  beatFinish(w: Who, token: unknown, seq: unknown): ({ ok: true; rankLetter: string; score: number; maxCombo: number } & RunFinish) | Fail {
    const run = this.takeRun("beat", w, token);
    if (!run) return fail("That song has already been recorded.");
    const chart = chartFor(run.diff);
    const s = scoreRun(seq, chart);
    if (!s) return fail("Bad run data.");
    if (this.ctx.now() - run.at < songMsFor(run.diff) - 4000) return fail("That song finished faster than real time.");
    const letter = rankOf(s, chart.length);
    const beans = this.rewards.grant(w.clientId, beansFor(letter, run.diff));
    if (beans > 0) { this.ctx.wallets.credit(w.clientId, beans); this.ctx.touch(w.clientId); }
    const r = s.failed ? { best: false, rank: null } : this.record("beat", w, s.score);
    return { ok: true, beans, best: r.best, rank: r.rank, value: s.score, rankLetter: letter, score: s.score, maxCombo: s.maxCombo };
  }
}
