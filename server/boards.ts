// Shared boards (rumours + guestbook). All data goes through a Repository (see repository.ts),
// so the storage can change (memory, JSON file, Supabase) without touching these rules.
import {
  POST_COOLDOWN_MS, RUMOUR_TTL_MS, SAMPLE_RUMOURS, validateRumour, validateText,
} from "../src/lib/rumours.ts";
import { NOTE_MAX, SAMPLE_ENTRIES, dayKey } from "../src/lib/guestbook.ts";
import { escapeHtml } from "../src/shared/text.ts";
import type { GuestbookView, Result, RumourView } from "../src/shared/protocol.ts";
import type { Repository } from "./repository.ts";

type Clock = () => number;
const MAX_POSTS = 300;
const newId = (prefix: string, t: number) => `${prefix}${t.toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export class RumourBoard {
  private lastPost = new Map<string, number>();
  private repo: Repository;
  private now: Clock;

  constructor(repo: Repository, now: Clock = Date.now) {
    this.repo = repo;
    this.now = now;
    this.prune(); // posts that expired while the server was off
  }

  /** Drop posts older than 48 hours. Returns true if anything was removed. */
  prune(): boolean {
    const cutoff = this.now() - RUMOUR_TTL_MS;
    const old = this.repo.listRumours().filter((p) => p.createdAt <= cutoff).map((p) => p.id);
    if (old.length === 0) return false;
    this.repo.removeRumours(old);
    return true;
  }

  post(clientId: string, raw: string): Result {
    this.prune();
    const v = validateRumour(raw);
    if (!v.ok) return v;
    const t = this.now();
    const last = this.lastPost.get(clientId) ?? 0;
    if (t - last < POST_COOLDOWN_MS) {
      return { ok: false, reason: `Give it a moment: you can pin another in ${Math.ceil((POST_COOLDOWN_MS - (t - last)) / 1000)}s.` };
    }
    const text = escapeHtml(v.text);
    if (this.repo.listRumours().some((p) => p.text === text)) return { ok: false, reason: "Someone already pinned that one." };
    this.lastPost.set(clientId, t);
    this.repo.addRumour({ id: newId("r", t), text, createdAt: t, author: clientId }, MAX_POSTS);
    return { ok: true };
  }

  /** Toggle your like. Returns false for unknown posts. */
  like(clientId: string, id: string): boolean {
    this.prune();
    const known = this.repo.listRumours().some((p) => p.id === id) || SAMPLE_RUMOURS.some((s) => s.id === id);
    if (!known) return false;
    this.repo.setRumourLike(id, clientId, !this.repo.rumourLikes(id).includes(clientId));
    return true;
  }

  view(clientId: string): RumourView[] {
    this.prune();
    const v = (id: string, text: string, createdAt: number, base: number, author: string | null, sample: boolean): RumourView => {
      const likes = this.repo.rumourLikes(id);
      return { id, text, createdAt, likes: base + likes.length, likedByMe: likes.includes(clientId), mine: author === clientId, ...(sample ? { sample: true } : {}) };
    };
    return [
      ...this.repo.listRumours().map((p) => v(p.id, p.text, p.createdAt, 0, p.author, false)),
      ...SAMPLE_RUMOURS.map((s) => v(s.id, s.text, 0, s.likes, null, true)),
    ];
  }
}

export class Guestbook {
  private repo: Repository;
  private now: Clock;

  constructor(repo: Repository, now: Clock = Date.now) {
    this.repo = repo;
    this.now = now;
  }

  sign(clientId: string, name: string, raw: string): Result {
    const t = this.now();
    if (this.repo.lastSignDay(clientId) === dayKey(t)) {
      return { ok: false, reason: "You already signed today's page. Come back tomorrow!" };
    }
    const v = validateText(raw, NOTE_MAX);
    if (!v.ok) return v;
    this.repo.setLastSignDay(clientId, dayKey(t));
    this.repo.addGuestEntry({ id: newId("g", t), name, text: escapeHtml(v.text), createdAt: t, author: clientId }, MAX_POSTS);
    return { ok: true };
  }

  view(clientId: string): GuestbookView {
    return {
      entries: [
        ...this.repo.listGuestbook().map((e) => ({ id: e.id, name: e.name, text: e.text, createdAt: e.createdAt, mine: e.author === clientId })),
        ...SAMPLE_ENTRIES,
      ],
      signedToday: this.repo.lastSignDay(clientId) === dayKey(this.now()),
    };
  }
}
