// The hourly Lucky Bean Lottery. Same rules as the instant booth (pick 1-1000, 20 Cafe Beans a ticket, an exact match
// pays 10,000) but every ticket goes into the next draw on the hour, shared by the whole cafe.
//   * the ticket is paid for when it is bought, and the number is drawn on the hour by the server
//   * every ticket is settled exactly once: it is removed from the pending list in the same step that pays it
//   * pending tickets are saved with the rest of the cafe's data, so a restart never loses one; a draw that came due
//     while the server was down runs on the first tick after it is back
import { HOURLY_MAX_TICKETS, LOTTERY, lotteryDraw, nextHourlyDraw, validLotteryNumber } from "../src/shared/casino.ts";
import type { HourlyLotteryView } from "../src/shared/protocol.ts";
import { fail, type EngineCtx, type Fail, type Who } from "./arcadeTypes.ts";
import type { LotteryDrawRecord, Repository } from "./repository.ts";

const KEEP_DRAWS = 24;

export class HourlyLottery {
  private seq = 0;
  private ctx: EngineCtx;
  private repo: Repository;
  constructor(ctx: EngineCtx, repo: Repository) {
    this.ctx = ctx;
    this.repo = repo;
  }

  buy(w: Who, pick: unknown): ({ ok: true; view: HourlyLotteryView }) | Fail {
    if (!validLotteryNumber(pick)) return fail(`Pick a whole number from ${LOTTERY.MIN} to ${LOTTERY.MAX}.`);
    const now = this.ctx.now(), drawAt = nextHourlyDraw(now);
    const mine = this.repo.listLotteryTickets().filter((t) => t.clientId === w.clientId && t.drawAt === drawAt);
    if (mine.length >= HOURLY_MAX_TICKETS) return fail(`You already hold ${HOURLY_MAX_TICKETS} tickets for this draw.`);
    if (!this.ctx.wallets.debit(w.clientId, LOTTERY.COST)) return fail(`A ticket costs ${LOTTERY.COST} Cafe Beans.`);
    const id = `h${drawAt.toString(36)}-${(++this.seq).toString(36)}-${Math.floor(this.ctx.rng() * 1e9).toString(36)}`;
    this.repo.setLotteryTickets([...this.repo.listLotteryTickets(), { id, clientId: w.clientId, name: w.name, pick: pick as number, drawAt, boughtAt: now }]);
    this.ctx.touch(w.clientId);
    return { ok: true, view: this.view(w.clientId) };
  }

  /** Run every draw whose hour has come (oldest first). Returns the draws that ran. */
  tick(now = this.ctx.now()): LotteryDrawRecord[] {
    const due = [...new Set(this.repo.listLotteryTickets().filter((t) => t.drawAt <= now).map((t) => t.drawAt))].sort((a, b) => a - b);
    const ran: LotteryDrawRecord[] = [];
    for (const at of due) {
      const tickets = this.repo.listLotteryTickets().filter((t) => t.drawAt === at);
      const number = lotteryDraw(this.ctx.rng);
      // settle: take the tickets out first, then pay the winners (a ticket can never be paid twice)
      this.repo.setLotteryTickets(this.repo.listLotteryTickets().filter((t) => t.drawAt !== at));
      const entries = tickets.map((t) => ({ clientId: t.clientId, name: t.name, pick: t.pick, won: t.pick === number }));
      for (const e of entries) if (e.won) this.ctx.wallets.credit(e.clientId, LOTTERY.JACKPOT);
      const draw = { at, number, entries };
      this.repo.addLotteryDraw(draw, KEEP_DRAWS);
      for (const id of new Set(entries.map((e) => e.clientId))) this.ctx.touch(id);
      ran.push(draw);
    }
    return ran;
  }

  view(clientId: string): HourlyLotteryView {
    const now = this.ctx.now();
    const draws = this.repo.listLotteryDraws();
    const last = draws[0];
    return {
      now,
      nextDrawAt: nextHourlyDraw(now),
      maxTickets: HOURLY_MAX_TICKETS,
      mine: this.repo.listLotteryTickets().filter((t) => t.clientId === clientId).map((t) => ({ id: t.id, pick: t.pick, drawAt: t.drawAt })),
      last: last ? { at: last.at, number: last.number, tickets: last.entries.length, winners: last.entries.filter((e) => e.won).map((e) => e.name) } : null,
      results: draws.flatMap((d) => d.entries.filter((e) => e.clientId === clientId).map((e) => ({ at: d.at, number: d.number, pick: e.pick, won: e.won }))).slice(0, 12),
    };
  }
}
