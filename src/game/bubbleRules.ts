// Pure rules for speech bubbles (no Phaser, so they are unit-tested): bubbles never overlap, and no area shows more
// than NPC_BUBBLE_CAP NPC bubbles at once.

/** Bubbles never touch: this much clear space is kept between any two. */
export const GAP = 4;
/** At most this many NPC bubbles inside any one area (AREA px around a new bubble). */
export const NPC_BUBBLE_CAP = 2;
export const AREA = 420;
export const isNpc = (owner: string) => owner.startsWith("npc:");

/** How a line is said. "direct": someone asked for it (you talked to them, a scripted conversation, a player's own line):
 *  it always shows, and pushes aside any NPC bubble it would overlap. "soft": idle chatter, greetings, reactions: it only
 *  shows if there is room, otherwise it is quietly skipped. */
export type BubbleMode = "direct" | "soft";
export type BubbleRect = { x: number; y: number; w: number; h: number }; // x, y = the anchor (bubble hangs above it)
export type LiveBubble = BubbleRect & { owner: string; born: number; emote: boolean };

/** Do two bubbles hung above anchors a and b collide? */
export function bubblesOverlap(a: BubbleRect, b: BubbleRect) {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + GAP && Math.abs((a.y - a.h / 2) - (b.y - b.h / 2)) < (a.h + b.h) / 2 + GAP;
}

/**
 * Can `owner` put up a bubble at `r`? Soft lines need clear space (and, for NPCs, a free slot under the cap); direct
 * lines make room by clearing the NPC bubbles in their way and, if the area is at its cap, the oldest NPC bubble.
 * A player's own bubble is never cleared by an NPC.
 */
export function roomFor(owner: string, r: BubbleRect, mode: BubbleMode, live: LiveBubble[]): { ok: boolean; clear: string[] } {
  const others = live.filter((b) => b.owner !== owner);
  const blockers = others.filter((b) => bubblesOverlap(r, b));
  const npcNear = others.filter((b) => isNpc(b.owner) && !b.emote && Math.abs(b.x - r.x) < AREA && Math.abs(b.y - r.y) < AREA * 0.7);
  const npcSpeaker = isNpc(owner);
  if (mode === "soft") return { ok: blockers.length === 0 && (!npcSpeaker || npcNear.length < NPC_BUBBLE_CAP), clear: [] };
  if (npcSpeaker && blockers.some((b) => !isNpc(b.owner) && !b.emote)) return { ok: false, clear: [] }; // never cover a player's words
  const clear = new Set(blockers.filter((b) => isNpc(b.owner) || b.emote).map((b) => b.owner));
  if (npcSpeaker) {
    const left = npcNear.filter((b) => !clear.has(b.owner)).sort((a, b) => a.born - b.born);
    while (left.length >= NPC_BUBBLE_CAP) clear.add(left.shift()!.owner);
  }
  return { ok: true, clear: [...clear] };
}
