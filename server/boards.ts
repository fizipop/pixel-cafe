// In-memory shared boards (rumours + guestbook). Swap the Maps for a database later; the
// methods are the whole API the room uses.
import {
  POST_COOLDOWN_MS, RUMOUR_TTL_MS, SAMPLE_RUMOURS, validateRumour, validateText,
} from "../src/lib/rumours.ts";
import { NOTE_MAX, SAMPLE_ENTRIES, dayKey } from "../src/lib/guestbook.ts";
import { escapeHtml } from "../src/shared/text.ts";
import type { GuestbookView, Result, RumourView } from "../src/shared/protocol.ts";

type Clock = () => number;
const MAX_POSTS = 300;

type Post = { id: string; text: string; createdAt: number; author: string };

export class RumourBoard {
  private posts: Post[] = []; // newest first
  private likes = new Map<string, Set<string>>(); // post id -> client ids that liked it
  private lastPost = new Map<string, number>();
  private seq = 0;
  private now: Clock;

  constructor(now: Clock = Date.now) {
    this.now = now;
  }

  /** Drop posts older than 48 hours. Returns true if anything was removed. */
  prune(): boolean {
    const cutoff = this.now() - RUMOUR_TTL_MS;
    const keep = this.posts.filter((p) => p.createdAt > cutoff);
    if (keep.length === this.posts.length) return false;
    for (const p of this.posts) if (p.createdAt <= cutoff) this.likes.delete(p.id);
    this.posts = keep;
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
    if (this.posts.some((p) => p.text === text)) return { ok: false, reason: "Someone already pinned that one." };
    this.lastPost.set(clientId, t);
    this.posts.unshift({ id: `r${t.toString(36)}${(this.seq++).toString(36)}`, text, createdAt: t, author: clientId });
    if (this.posts.length > MAX_POSTS) this.posts.length = MAX_POSTS;
    return { ok: true };
  }

  /** Toggle your like. Returns false for unknown posts. */
  like(clientId: string, id: string): boolean {
    this.prune();
    const known = this.posts.some((p) => p.id === id) || SAMPLE_RUMOURS.some((s) => s.id === id);
    if (!known) return false;
    const set = this.likes.get(id) ?? new Set<string>();
    if (!set.delete(clientId)) set.add(clientId);
    this.likes.set(id, set);
    return true;
  }

  view(clientId: string): RumourView[] {
    const v = (id: string, text: string, createdAt: number, base: number, author: string | null, sample: boolean): RumourView => {
      const set = this.likes.get(id);
      const likedByMe = !!set?.has(clientId);
      return { id, text, createdAt, likes: base + (set?.size ?? 0), likedByMe, mine: author === clientId, ...(sample ? { sample: true } : {}) };
    };
    return [
      ...this.posts.map((p) => v(p.id, p.text, p.createdAt, 0, p.author, false)),
      ...SAMPLE_RUMOURS.map((s) => v(s.id, s.text, 0, s.likes, null, true)),
    ];
  }
}

type Signed = { id: string; name: string; text: string; createdAt: number; author: string };

export class Guestbook {
  private entries: Signed[] = []; // newest first
  private lastDay = new Map<string, string>();
  private seq = 0;
  private now: Clock;

  constructor(now: Clock = Date.now) {
    this.now = now;
  }

  sign(clientId: string, name: string, raw: string): Result {
    const t = this.now();
    if (this.lastDay.get(clientId) === dayKey(t)) {
      return { ok: false, reason: "You already signed today's page. Come back tomorrow!" };
    }
    const v = validateText(raw, NOTE_MAX);
    if (!v.ok) return v;
    this.lastDay.set(clientId, dayKey(t));
    this.entries.unshift({ id: `g${t.toString(36)}${(this.seq++).toString(36)}`, name, text: escapeHtml(v.text), createdAt: t, author: clientId });
    if (this.entries.length > MAX_POSTS) this.entries.length = MAX_POSTS;
    return { ok: true };
  }

  view(clientId: string): GuestbookView {
    return {
      entries: [
        ...this.entries.map((e) => ({ id: e.id, name: e.name, text: e.text, createdAt: e.createdAt, mine: e.author === clientId })),
        ...SAMPLE_ENTRIES,
      ],
      signedToday: this.lastDay.get(clientId) === dayKey(this.now()),
    };
  }
}
