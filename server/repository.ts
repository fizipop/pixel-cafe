// Persistence for the shared boards: rumours, guestbook, outfit votes, wallets, arcade scores, star wishes and the Polaroid Wall.
//
// The rest of the server only talks to the `Repository` interface, so moving to Supabase later
// means writing one more class that implements it (the methods are the whole API). Two
// implementations live here:
//   MemoryRepository    - plain in-memory (tests, and the default when no file is given)
//   JsonFileRepository  - the same, plus a debounced atomic write to a local JSON file
//                         (server/data.json by default, gitignored)
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isPackedSprite, type PackedSprite } from "../src/shared/rooftop.ts";

export type RumourRecord = { id: string; text: string; createdAt: number; author: string };
export type GuestRecord = { id: string; name: string; text: string; createdAt: number; author: string };
export type OutfitRecord = { id: string; clientId: string; name: string; pixels: string[]; lastSeen: number };
export type VoteRecord = { day: string; voter: string; target: string }; // client ids; one vote per voter per day
/** Cafe Beans: fictional, non-purchasable, non-redeemable tokens. One wallet per device (client id). */
export type WalletRecord = { beans: number; name: string; topupDay: string; updated: number };
/** A personal best on an arcade board: biggest multiplier, fastest lap (ms, lower is better), top score or longest win streak. */
export type ScoreRecord = { name: string; value: number; ts: number };
export type BoardId = "penguin" | "moon" | "drift" | "beat" | "fighter";
export const BOARD_IDS: BoardId[] = ["penguin", "moon", "drift", "beat", "fighter"];
/** Fastest lap is the only board where a smaller number is better. */
export const LOWER_IS_BETTER: Record<BoardId, boolean> = { penguin: false, moon: false, drift: true, beat: false, fighter: false };
/** Floor 3: an anonymous star wish (`author` is the device id, used only to rate limit and mark "mine"). */
export type WishRecord = { id: string; text: string; ts: number; author: string };
/** Floor 3: one group Polaroid pinned to the Rooftop Polaroid Wall (sprites are stored run-length packed). */
/** An hourly lottery ticket waiting for its draw (removed once settled). */
export type LotteryTicketRecord = { id: string; clientId: string; name: string; pick: number; drawAt: number; boughtAt: number };
/** A finished hourly draw, with every ticket that was in it. */
export type LotteryDrawRecord = { at: number; number: number; entries: { clientId: string; name: string; pick: number; won: boolean }[] };
export type PolaroidRecord = { id: string; ts: number; by: string; people: { name: string; sprite: PackedSprite }[] };

export interface Repository {
  // rumours (newest first)
  listRumours(): RumourRecord[];
  addRumour(r: RumourRecord, cap: number): void;
  removeRumours(ids: string[]): void;
  rumourLikes(id: string): string[];
  setRumourLike(id: string, clientId: string, liked: boolean): void;
  // guestbook (newest first)
  listGuestbook(): GuestRecord[];
  addGuestEntry(e: GuestRecord, cap: number): void;
  lastSignDay(clientId: string): string | undefined;
  setLastSignDay(clientId: string, day: string): void;
  // outfit leaderboard
  listOutfits(): OutfitRecord[];
  upsertOutfit(o: OutfitRecord): void;
  removeOutfitsSeenBefore(cutoff: number): void;
  listVotes(day: string): VoteRecord[];
  addVote(v: VoteRecord): void;
  removeVotesBefore(day: string): void;
  // Floor 2: bean wallets and arcade high scores
  getWallet(clientId: string): WalletRecord | undefined;
  setWallet(clientId: string, w: WalletRecord): void;
  listWallets(): { clientId: string; wallet: WalletRecord }[];
  getBest(board: BoardId, clientId: string): ScoreRecord | undefined;
  setBest(board: BoardId, clientId: string, r: ScoreRecord): void;
  listBest(board: BoardId): { clientId: string; record: ScoreRecord }[];
  // Floor 3: star wishes and the Polaroid Wall (both newest first)
  listWishes(): WishRecord[];
  addWish(w: WishRecord, cap: number): void;
  removeWishesBefore(ts: number): void;
  listPolaroids(): PolaroidRecord[];
  addPolaroid(p: PolaroidRecord, cap: number): void;
  // the hourly lottery: pending tickets and recent draws
  listLotteryTickets(): LotteryTicketRecord[];
  setLotteryTickets(t: LotteryTicketRecord[]): void;
  listLotteryDraws(): LotteryDrawRecord[];
  addLotteryDraw(d: LotteryDrawRecord, cap: number): void;
  /** Write anything pending to durable storage (no-op for memory). */
  flush(): void;
}

export type PersistedData = {
  version: 1;
  rumours: RumourRecord[];
  rumourLikes: Record<string, string[]>;
  guestbook: GuestRecord[];
  guestbookDays: Record<string, string>;
  outfits: Record<string, OutfitRecord>; // by client id
  votes: VoteRecord[];
  wallets: Record<string, WalletRecord>;
  penguin: Record<string, ScoreRecord>;
  moon: Record<string, ScoreRecord>;
  drift: Record<string, ScoreRecord>;
  beat: Record<string, ScoreRecord>;
  fighter: Record<string, ScoreRecord>;
  wishes: WishRecord[];
  polaroids: PolaroidRecord[];
  lotteryTickets: LotteryTicketRecord[];
  lotteryDraws: LotteryDrawRecord[];
};

export const emptyData = (): PersistedData => ({
  version: 1, rumours: [], rumourLikes: {}, guestbook: [], guestbookDays: {}, outfits: {}, votes: [],
  wallets: {}, penguin: {}, moon: {}, drift: {}, beat: {}, fighter: {}, wishes: [], polaroids: [], lotteryTickets: [], lotteryDraws: [],
});

const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Turn whatever was on disk into valid data, dropping anything malformed (never throws). */
export function sanitizeData(raw: unknown): PersistedData {
  const out = emptyData();
  if (!isObj(raw)) return out;
  for (const r of list(raw.rumours)) {
    if (isObj(r) && isStr(r.id) && isStr(r.text) && isNum(r.createdAt) && isStr(r.author)) out.rumours.push({ id: r.id, text: r.text, createdAt: r.createdAt, author: r.author });
  }
  if (isObj(raw.rumourLikes)) {
    for (const [id, who] of Object.entries(raw.rumourLikes)) out.rumourLikes[id] = list(who).filter(isStr);
  }
  for (const g of list(raw.guestbook)) {
    if (isObj(g) && isStr(g.id) && isStr(g.name) && isStr(g.text) && isNum(g.createdAt) && isStr(g.author)) out.guestbook.push({ id: g.id, name: g.name, text: g.text, createdAt: g.createdAt, author: g.author });
  }
  if (isObj(raw.guestbookDays)) {
    for (const [id, day] of Object.entries(raw.guestbookDays)) if (isStr(day)) out.guestbookDays[id] = day;
  }
  if (isObj(raw.outfits)) {
    for (const o of Object.values(raw.outfits)) {
      if (isObj(o) && isStr(o.id) && isStr(o.clientId) && isStr(o.name) && isNum(o.lastSeen) && Array.isArray(o.pixels) && o.pixels.length === 1024 && o.pixels.every(isStr)) {
        out.outfits[o.clientId] = { id: o.id, clientId: o.clientId, name: o.name, pixels: o.pixels as string[], lastSeen: o.lastSeen };
      }
    }
  }
  for (const v of list(raw.votes)) {
    if (isObj(v) && isStr(v.day) && isStr(v.voter) && isStr(v.target)) out.votes.push({ day: v.day, voter: v.voter, target: v.target });
  }
  if (isObj(raw.wallets)) {
    for (const [id, w] of Object.entries(raw.wallets)) {
      if (isObj(w) && isNum(w.beans) && isStr(w.name)) {
        out.wallets[id] = { beans: Math.max(0, Math.floor(w.beans)), name: w.name, topupDay: isStr(w.topupDay) ? w.topupDay : "", updated: isNum(w.updated) ? w.updated : 0 };
      }
    }
  }
  for (const board of BOARD_IDS) {
    const src = raw[board];
    if (!isObj(src)) continue;
    for (const [id, r] of Object.entries(src)) {
      if (isObj(r) && isStr(r.name) && isNum(r.value) && r.value >= 0) out[board][id] = { name: r.name, value: r.value, ts: isNum(r.ts) ? r.ts : 0 };
    }
  }
  for (const w of list(raw.wishes)) {
    if (isObj(w) && isStr(w.id) && isStr(w.text) && isNum(w.ts) && isStr(w.author)) out.wishes.push({ id: w.id, text: w.text, ts: w.ts, author: w.author });
  }
  for (const p of list(raw.polaroids)) {
    if (!isObj(p) || !isStr(p.id) || !isNum(p.ts) || !isStr(p.by) || !Array.isArray(p.people)) continue;
    const people: PolaroidRecord["people"] = [];
    for (const q of p.people) if (isObj(q) && isStr(q.name) && isPackedSprite(q.sprite)) people.push({ name: q.name, sprite: q.sprite });
    if (people.length > 0 && people.length <= 6) out.polaroids.push({ id: p.id, ts: p.ts, by: p.by, people });
  }
  const isPick = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 1000;
  for (const t of list(raw.lotteryTickets)) {
    if (isObj(t) && isStr(t.id) && isStr(t.clientId) && isStr(t.name) && isPick(t.pick) && isNum(t.drawAt)) out.lotteryTickets.push({ id: t.id, clientId: t.clientId, name: t.name, pick: t.pick, drawAt: t.drawAt, boughtAt: isNum(t.boughtAt) ? t.boughtAt : 0 });
  }
  for (const d of list(raw.lotteryDraws)) {
    if (!isObj(d) || !isNum(d.at) || !isPick(d.number)) continue;
    const entries: LotteryDrawRecord["entries"] = [];
    for (const e of list(d.entries)) if (isObj(e) && isStr(e.clientId) && isStr(e.name) && isPick(e.pick)) entries.push({ clientId: e.clientId, name: e.name, pick: e.pick, won: e.pick === d.number });
    out.lotteryDraws.push({ at: d.at, number: d.number, entries });
  }
  return out;
}

export class MemoryRepository implements Repository {
  protected data: PersistedData;

  constructor(initial: PersistedData = emptyData()) {
    this.data = initial;
  }

  /** Called after every mutation; the file repository uses it to schedule a save. */
  protected changed(): void {}

  listRumours() { return this.data.rumours; }
  addRumour(r: RumourRecord, cap: number) {
    this.data.rumours.unshift(r);
    if (this.data.rumours.length > cap) this.removeRumours(this.data.rumours.slice(cap).map((x) => x.id));
    this.changed();
  }
  removeRumours(ids: string[]) {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    this.data.rumours = this.data.rumours.filter((r) => !gone.has(r.id));
    for (const id of ids) delete this.data.rumourLikes[id];
    this.changed();
  }
  rumourLikes(id: string) { return this.data.rumourLikes[id] ?? []; }
  setRumourLike(id: string, clientId: string, liked: boolean) {
    const set = new Set(this.data.rumourLikes[id] ?? []);
    if (liked) set.add(clientId); else set.delete(clientId);
    this.data.rumourLikes[id] = [...set];
    this.changed();
  }

  listGuestbook() { return this.data.guestbook; }
  addGuestEntry(e: GuestRecord, cap: number) {
    this.data.guestbook.unshift(e);
    if (this.data.guestbook.length > cap) this.data.guestbook.length = cap;
    this.changed();
  }
  lastSignDay(clientId: string) { return this.data.guestbookDays[clientId]; }
  setLastSignDay(clientId: string, day: string) {
    this.data.guestbookDays[clientId] = day;
    this.changed();
  }

  listOutfits() { return Object.values(this.data.outfits); }
  upsertOutfit(o: OutfitRecord) {
    this.data.outfits[o.clientId] = o;
    this.changed();
  }
  removeOutfitsSeenBefore(cutoff: number) {
    let any = false;
    for (const [k, o] of Object.entries(this.data.outfits)) if (o.lastSeen < cutoff) { delete this.data.outfits[k]; any = true; }
    if (any) this.changed();
  }
  listVotes(day: string) { return this.data.votes.filter((v) => v.day === day); }
  addVote(v: VoteRecord) {
    this.data.votes.push(v);
    this.changed();
  }
  removeVotesBefore(day: string) {
    const keep = this.data.votes.filter((v) => v.day >= day); // "YYYY-MM-DD" sorts as text
    if (keep.length === this.data.votes.length) return;
    this.data.votes = keep;
    this.changed();
  }

  getWallet(clientId: string) { return this.data.wallets[clientId]; }
  setWallet(clientId: string, w: WalletRecord) {
    this.data.wallets[clientId] = w;
    this.changed();
  }
  listWallets() { return Object.entries(this.data.wallets).map(([clientId, wallet]) => ({ clientId, wallet })); }
  getBest(board: BoardId, clientId: string) { return this.data[board][clientId]; }
  setBest(board: BoardId, clientId: string, r: ScoreRecord) {
    this.data[board][clientId] = r;
    this.changed();
  }
  listBest(board: BoardId) { return Object.entries(this.data[board]).map(([clientId, record]) => ({ clientId, record })); }

  listWishes() { return this.data.wishes; }
  addWish(w: WishRecord, cap: number) {
    this.data.wishes.unshift(w);
    if (this.data.wishes.length > cap) this.data.wishes.length = cap;
    this.changed();
  }
  removeWishesBefore(ts: number) {
    const keep = this.data.wishes.filter((w) => w.ts >= ts);
    if (keep.length === this.data.wishes.length) return;
    this.data.wishes = keep;
    this.changed();
  }
  listPolaroids() { return this.data.polaroids; }
  addPolaroid(p: PolaroidRecord, cap: number) {
    this.data.polaroids.unshift(p);
    if (this.data.polaroids.length > cap) this.data.polaroids.length = cap;
    this.changed();
  }
  listLotteryTickets() { return this.data.lotteryTickets; }
  setLotteryTickets(t: LotteryTicketRecord[]) { this.data.lotteryTickets = t; this.changed(); }
  listLotteryDraws() { return this.data.lotteryDraws; }
  addLotteryDraw(d: LotteryDrawRecord, cap: number) {
    this.data.lotteryDraws.unshift(d);
    if (this.data.lotteryDraws.length > cap) this.data.lotteryDraws.length = cap;
    this.changed();
  }

  flush() {}
}

export class JsonFileRepository extends MemoryRepository {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private file: string;
  private debounceMs: number;

  constructor(file: string, debounceMs = 300) {
    super(JsonFileRepository.read(file));
    this.file = file;
    this.debounceMs = debounceMs;
  }

  private static read(file: string): PersistedData {
    if (!existsSync(file)) return emptyData();
    try {
      return sanitizeData(JSON.parse(readFileSync(file, "utf8")));
    } catch (err) {
      // keep the unreadable file for inspection instead of silently overwriting it
      const backup = `${file}.corrupt-${Date.now()}`;
      try { renameSync(file, backup); } catch { /* ignore */ }
      console.error(`Could not read ${file} (${(err as Error).message}). Moved it to ${backup} and starting empty.`);
      return emptyData();
    }
  }

  protected override changed() {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.debounceMs);
    this.timer.unref?.();
  }

  override flush() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data));
      renameSync(tmp, this.file); // atomic: a crash mid-write never leaves half a file
    } catch (err) {
      console.error(`Could not save ${this.file}:`, err);
    }
  }
}
