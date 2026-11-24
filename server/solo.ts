// The one-player Floor 2 games: Pixel Slots, Cafe Mines and Cat Ice Jump. All results are decided
// here on the server (the browser only animates them), and all stakes are fictional Cafe Beans.
import {
  ICE_MAX_RATE, MINES_TILES, iceBeans, minesMultiplier, placeMines, slotMultiplier, spinReel, validBet, validMineCount,
  type SlotSymbol,
} from "../src/shared/arcade.ts";
import type { IceFinish, MinesView, SlotsResult } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";
import type { Repository } from "./repository.ts";

type MinesGame = { bet: number; mines: number; hazards: number[]; revealed: number[] };

export class SoloGames {
  private mines = new Map<string, MinesGame>(); // by client id
  private ice = new Map<string, { token: number; at: number }>();
  private lastIceToken = 0;

  private ctx: EngineCtx;
  private repo: Repository;

  constructor(ctx: EngineCtx, repo: Repository) {
    this.ctx = ctx;
    this.repo = repo;
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

  // ------------------------------------------------------------ cat ice jump

  iceStart(w: Who): { ok: true; token: number } {
    const token = ++this.lastIceToken;
    this.ice.set(w.clientId, { token, at: this.ctx.now() });
    return { ok: true, token };
  }

  iceFinish(w: Who, token: unknown, score: unknown): ({ ok: true } & IceFinish) | Fail {
    const run = this.ice.get(w.clientId);
    if (!run || run.token !== token) return fail("That run has already been recorded.");
    this.ice.delete(w.clientId);
    if (!Number.isInteger(score) || (score as number) < 0) return fail("Bad score.");
    const elapsed = Math.max(0, (this.ctx.now() - run.at) / 1000);
    const s = score as number;
    if (s > Math.floor(elapsed * ICE_MAX_RATE) + 10) return fail("That score is too high for the time it took.");
    const beans = iceBeans(s);
    if (beans > 0) { this.ctx.wallets.credit(w.clientId, beans); this.ctx.touch(w.clientId); }
    const prev = this.repo.getBest("ice", w.clientId);
    const best = s > 0 && (!prev || s > prev.value);
    if (best) this.repo.setBest("ice", w.clientId, { name: w.name, value: s, ts: this.ctx.now() });
    else if (prev && prev.name !== w.name) this.repo.setBest("ice", w.clientId, { ...prev, name: w.name });
    const board = this.repo.listBest("ice").sort((a, b) => b.record.value - a.record.value);
    const idx = board.findIndex((r) => r.clientId === w.clientId);
    return { ok: true, beans, best, score: s, rank: idx >= 0 ? idx + 1 : null };
  }
}
