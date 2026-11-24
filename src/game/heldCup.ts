import * as Phaser from "phaser";

import type { DrinkKind } from "@/lib/drinks";
export type { DrinkKind };

/** A little cup in someone's hand, with two puffs of steam. Used by the player and NPCs. */
export class HeldCup {
  private img: Phaser.GameObjects.Image;
  private puffs: Phaser.GameObjects.Image[];
  private active = false;
  kind: DrinkKind | null = null;

  constructor(scene: Phaser.Scene) {
    this.img = scene.add.image(0, 0, "cup_coffee").setVisible(false);
    this.puffs = [0, 1].map(() => scene.add.image(0, 0, "puff").setVisible(false).setScale(0.5));
  }

  destroy() {
    this.img.destroy();
    this.puffs.forEach((p) => p.destroy());
  }

  get visible() {
    return this.active;
  }

  show(kind: DrinkKind) {
    this.kind = kind;
    this.active = true;
    this.img.setTexture(`cup_${kind}`).setVisible(true);
  }

  hide() {
    this.active = false;
    this.kind = null;
    this.img.setVisible(false);
    this.puffs.forEach((p) => p.setVisible(false));
  }

  follow(x: number, y: number, depth: number, time: number) {
    if (!this.active) return;
    this.img.setPosition(Math.round(x), Math.round(y)).setDepth(depth);
    this.puffs.forEach((p, i) => {
      const t = (time / 1100 + i * 0.5) % 1;
      p.setVisible(true)
        .setPosition(Math.round(x + (i ? 1 : -1)), Math.round(y - 5 - t * 7))
        .setAlpha(0.55 * (1 - t))
        .setDepth(depth + 1);
    });
  }
}
