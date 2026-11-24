// Community Outfit Leaderboard rules: who can be voted for, one upvote per player per day,
// no self-votes, and who currently wears the #1 crown. Storage goes through the Repository.
import { createHash } from "node:crypto";
import { dayKey } from "../src/lib/guestbook.ts";
import type { OutfitEntry, OutfitView, Result } from "../src/shared/protocol.ts";
import type { Repository } from "./repository.ts";

type Clock = () => number;

export const OUTFIT_TTL_MS = 48 * 60 * 60 * 1000; // visitors stay on the stand for two days
export const OUTFIT_MAX = 24; // how many outfits the stand shows

/** Public id for an outfit. A hash, so other players never learn anyone's device id. */
export const outfitId = (clientId: string) => `o${createHash("sha256").update(clientId).digest("hex").slice(0, 12)}`;

export class OutfitBoard {
  private repo: Repository;
  private now: Clock;

  constructor(repo: Repository, now: Clock = Date.now) {
    this.repo = repo;
    this.now = now;
    this.prune();
  }

  /** Remember (or refresh) someone's current outfit. Called on join and when they switch characters. */
  seen(clientId: string, name: string, pixels: string[]) {
    this.repo.upsertOutfit({ id: outfitId(clientId), clientId, name, pixels, lastSeen: this.now() });
  }

  /** Forget visitors older than 48h and votes from before yesterday. True if any outfit was dropped. */
  prune(): boolean {
    const before = this.repo.listOutfits().length;
    this.repo.removeOutfitsSeenBefore(this.now() - OUTFIT_TTL_MS);
    this.repo.removeVotesBefore(dayKey(this.now() - 24 * 60 * 60 * 1000));
    return this.repo.listOutfits().length !== before;
  }

  private tally(day: string): Map<string, number> {
    const counts = new Map<string, number>();
    for (const v of this.repo.listVotes(day)) counts.set(v.target, (counts.get(v.target) ?? 0) + 1);
    return counts;
  }

  /** Client ids of today's #1 outfit(s): the highest vote count, ties share the crown, at least one vote. */
  crowned(): Set<string> {
    const counts = this.tally(dayKey(this.now()));
    const known = new Set(this.repo.listOutfits().map((o) => o.clientId));
    let top = 0;
    for (const [id, n] of counts) if (known.has(id)) top = Math.max(top, n);
    const out = new Set<string>();
    if (top > 0) for (const [id, n] of counts) if (n === top && known.has(id)) out.add(id);
    return out;
  }

  vote(voter: string, targetPublicId: string): Result {
    const day = dayKey(this.now());
    const target = this.repo.listOutfits().find((o) => o.id === targetPublicId);
    if (!target) return { ok: false, reason: "That outfit has left the stand." };
    if (target.clientId === voter) return { ok: false, reason: "You can't vote for your own outfit." };
    if (this.repo.listVotes(day).some((v) => v.voter === voter)) {
      return { ok: false, reason: "You already used today's vote. Come back tomorrow!" };
    }
    this.repo.addVote({ day, voter, target: target.clientId });
    return { ok: true };
  }

  /** The stand as one player sees it: today's leaders first, then people in the cafe, then recent visitors. */
  view(clientId: string, online: ReadonlySet<string>): OutfitView {
    const day = dayKey(this.now());
    const counts = this.tally(day);
    const crown = this.crowned();
    const myVote = this.repo.listVotes(day).find((v) => v.voter === clientId)?.target;
    const rows = this.repo.listOutfits().map((o) => ({
      seen: o.lastSeen,
      entry: {
        id: o.id, name: o.name, pixels: o.pixels,
        votes: counts.get(o.clientId) ?? 0,
        inCafe: online.has(o.clientId),
        mine: o.clientId === clientId,
        votedByMe: myVote === o.clientId,
        crowned: crown.has(o.clientId),
      } satisfies OutfitEntry,
    }));
    rows.sort((a, b) => b.entry.votes - a.entry.votes || Number(b.entry.inCafe) - Number(a.entry.inCafe) || b.seen - a.seen);
    return { day, votedToday: myVote !== undefined, entries: rows.slice(0, OUTFIT_MAX).map((r) => r.entry) };
  }
}
