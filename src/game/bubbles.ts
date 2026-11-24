import * as Phaser from "phaser";

export type Anchor = () => { x: number; y: number } | null;

type Entry = {
  box: Phaser.GameObjects.Container;
  anchor: Anchor;
  born: number;
  until: number;
  float: boolean;
};

const DEPTH = 85000;

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

  say(owner: string, anchor: Anchor, text: string, ms = 4200) {
    this.clear(owner);
    const t = this.scene.add
      .text(0, 0, text, {
        fontFamily: "VT323, monospace",
        fontSize: "16px",
        color: "#1f140d",
        align: "center",
        wordWrap: { width: 150 },
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
    this.track(owner, box, anchor, ms, false);
  }

  emote(owner: string, anchor: Anchor, texture: string, ms = 2600) {
    this.clear(owner);
    const img = this.scene.add.image(0, 0, texture).setOrigin(0.5, 1);
    const box = this.scene.add.container(0, 0, [img]).setDepth(DEPTH).setData("what", texture);
    this.track(owner, box, anchor, ms, true);
    if (texture === "emote_wave") {
      this.scene.tweens.add({ targets: img, angle: { from: -14, to: 14 }, duration: 220, yoyo: true, repeat: 5 });
    }
  }

  private track(owner: string, box: Phaser.GameObjects.Container, anchor: Anchor, ms: number, float: boolean) {
    const now = this.scene.time.now;
    box.setScale(0.4).setAlpha(0);
    this.scene.tweens.add({ targets: box, scale: 1, alpha: 1, duration: 150, ease: "Back.Out" });
    this.entries.set(owner, { box, anchor, born: now, until: now + ms, float });
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
  }
}
