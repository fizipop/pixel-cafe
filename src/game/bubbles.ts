import * as Phaser from "phaser";
import { bubblesOverlap, isNpc, roomFor, type BubbleMode, type LiveBubble } from "./bubbleRules";

export type Anchor = () => { x: number; y: number } | null;

type Entry = {
  box: Phaser.GameObjects.Container;
  anchor: Anchor;
  born: number;
  until: number;
  float: boolean;
  w: number; // the bubble's size, for overlap checks (it hangs above its anchor)
  h: number;
  soft: boolean; // ambient chatter: the first to give way
};

const DEPTH = 90100; // above the hanging lamps and glows, below the vignette
export { NPC_BUBBLE_CAP, bubblesOverlap, type BubbleMode } from "./bubbleRules";

/** One floating speech bubble or emote per speaker, following an anchor (usually a head). */
export class Bubbles {
  private scene: Phaser.Scene;
  private entries = new Map<string, Entry>();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  has(owner: string) {
    return this.entries.has(owner);
  }

  /** The texture key or text currently shown for an owner (handy for tests). */
  describe(owner: string): string | null {
    return (this.entries.get(owner)?.box.getData("what") as string | undefined) ?? null;
  }

  /** Show a speech bubble. Returns false if a soft line was skipped for lack of room. */
  say(owner: string, anchor: Anchor, text: string, ms = 4200, mode: BubbleMode = isNpc(owner) ? "soft" : "direct"): boolean {
    const a = anchor();
    // estimate the size before building it (VT323 16px: ~7px a glyph, wrapped at 128px)
    const est = { w: Math.min(142, text.length * 7 + 14), h: Math.ceil((text.length * 7) / 128) * 16 + 8 };
    if (a && !this.makeRoom(owner, { x: a.x, y: a.y, ...est }, mode)) return false;
    this.clear(owner);
    const t = this.scene.add
      .text(0, 0, text, {
        fontFamily: "VT323, monospace",
        fontSize: "16px",
        color: "#1f140d",
        align: "center",
        wordWrap: { width: 128 }, // compact: a bubble never swallows the neighbours
      })
      .setOrigin(0.5)
      .setResolution(3);
    const w = Math.ceil(t.width) + 14;
    const h = Math.ceil(t.height) + 8;
    const g = this.scene.add.graphics();
    g.fillStyle(0x1f140d);
    g.fillRect(-w / 2 + 1, -h - 6, w - 2, h);
    g.fillRect(-w / 2, -h - 5, w, h - 2);
    g.fillStyle(0xfff6e0);
    g.fillRect(-w / 2 + 2, -h - 5, w - 4, h - 2);
    g.fillRect(-w / 2 + 1, -h - 4, w - 2, h - 4);
    g.fillStyle(0x1f140d);
    g.fillRect(-3, -7, 7, 1);
    g.fillRect(-3, -6, 7, 1);
    g.fillRect(-2, -5, 5, 1);
    g.fillRect(-1, -4, 3, 1);
    g.fillRect(0, -3, 1, 1);
    g.fillStyle(0xfff6e0);
    g.fillRect(-2, -7, 5, 1);
    g.fillRect(-2, -6, 5, 1);
    g.fillRect(-1, -5, 3, 1);
    g.fillRect(0, -4, 1, 1);
    t.setPosition(0, -6 - h / 2);
    const box = this.scene.add.container(0, 0, [g, t]).setDepth(DEPTH).setData("what", text);
    this.track(owner, box, anchor, ms, false, w, h + 6, mode === "soft");
    return true;
  }

  /**
   * Find room for a bubble of this size at this anchor. Soft lines need clear space and a free slot under the NPC cap;
   * direct lines make room by clearing the NPC bubbles in the way (and the oldest one if the area is at its cap).
   * Players' own bubbles are never cleared by NPCs.
   */
  private makeRoom(owner: string, r: { x: number; y: number; w: number; h: number }, mode: BubbleMode): boolean {
    const live: LiveBubble[] = [];
    for (const [o, e] of this.entries) { const a = e.anchor(); if (a) live.push({ owner: o, x: a.x, y: a.y, w: e.w, h: e.h, born: e.born, emote: e.float }); }
    const d = roomFor(owner, r, mode, live);
    if (d.ok) for (const o of d.clear) this.clear(o);
    return d.ok;
  }


  emote(owner: string, anchor: Anchor, texture: string, ms = 2600) {
    const a = anchor();
    if (a && isNpc(owner) && !this.makeRoom(owner, { x: a.x, y: a.y, w: 18, h: 18 }, "soft")) return; // emotes never land on a bubble
    this.clear(owner);
    const img = this.scene.add.image(0, 0, texture).setOrigin(0.5, 1);
    const box = this.scene.add.container(0, 0, [img]).setDepth(DEPTH).setData("what", texture);
    this.track(owner, box, anchor, ms, true, 18, 18, true);
    if (texture === "emote_wave") {
      this.scene.tweens.add({ targets: img, angle: { from: -14, to: 14 }, duration: 220, yoyo: true, repeat: 5 });
    }
  }

  private track(owner: string, box: Phaser.GameObjects.Container, anchor: Anchor, ms: number, float: boolean, w: number, h: number, soft: boolean) {
    const now = this.scene.time.now;
    box.setScale(0.4).setAlpha(0);
    this.scene.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 150, ease: "Back.Out" });
    this.entries.set(owner, { box, anchor, born: now, until: now + ms, float, w, h, soft });
    this.place(this.entries.get(owner)!, now);
  }

  clear(owner: string) {
    const e = this.entries.get(owner);
    if (!e) return;
    this.scene.tweens.killTweensOf(e.box);
    e.box.destroy();
    this.entries.delete(owner);
  }

  private place(e: Entry, now: number) {
    const a = e.anchor();
    if (!a) return e.box.setVisible(false);
    const bob = e.float ? Math.round(Math.sin((now - e.born) / 260) * 2) : 0;
    e.box.setVisible(true).setPosition(Math.round(a.x), Math.round(a.y) + bob);
  }

  update(now: number) {
    for (const [owner, e] of this.entries) {
      if (now >= e.until) {
        this.clear(owner);
        continue;
      }
      this.place(e, now);
      if (e.until - now < 300) e.box.setAlpha((e.until - now) / 300);
    }
    // speakers move (walking NPCs, players): if two bubbles drift into each other, the softer, older one fades out early
    const live = [...this.entries].map(([o, e]) => ({ o, e, a: e.anchor() })).filter((q) => q.a && q.e.until - now > 300);
    for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
      const p = live[i], q = live[j];
      if (!bubblesOverlap({ ...p.a!, w: p.e.w, h: p.e.h }, { ...q.a!, w: q.e.w, h: q.e.h })) continue;
      const loser = p.e.soft !== q.e.soft ? (p.e.soft ? p : q) : isNpc(p.o) !== isNpc(q.o) ? (isNpc(p.o) ? p : q) : p.e.born <= q.e.born ? p : q;
      loser.e.until = Math.min(loser.e.until, now + 300);
    }
  }
}
