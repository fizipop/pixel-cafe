import * as Phaser from "phaser";
import { GRID } from "@/lib/editor";
import { HeldCup } from "./heldCup";
import { sitPose } from "./seats";
import type { Seat } from "./layout";
import type { DrinkKind } from "@/lib/drinks";
import { unescapeHtml } from "@/shared/text";
import type { PlayerState } from "@/shared/protocol";

/** Higher = snappier. Remote positions ease toward the latest network position. */
const SMOOTH_MS = 80;

/** Another real player: sprite, shadow, name, held drink, smooth movement and a seated pose. */
export class RemotePlayer {
  readonly id: string;
  private scene: Phaser.Scene;
  private texKey: string;
  private img: Phaser.GameObjects.Image;
  private shadow: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private badge: Phaser.GameObjects.Image;
  private cup: HeldCup;
  private art = { minY: 8, maxY: 31 };

  x: number;
  y: number;
  private tx: number;
  private ty: number;
  private flip: boolean;
  private serverMoving: boolean;
  private lastX: number;
  private lastY: number;
  seat: Seat | null = null;

  constructor(scene: Phaser.Scene, s: PlayerState) {
    this.scene = scene;
    this.id = s.id;
    this.texKey = `remote_${s.id}`;
    this.x = this.tx = this.lastX = s.x;
    this.y = this.ty = this.lastY = s.y;
    this.flip = s.flip;
    this.serverMoving = s.moving;
    this.paint(s.pixels);
    this.shadow = scene.add.image(s.x, s.y, "shadow");
    this.img = scene.add.image(s.x, s.y, this.texKey).setOrigin(0.5, 1);
    this.label = scene.add
      .text(s.x, s.y, unescapeHtml(s.name), {
        fontFamily: "VT323, monospace", fontSize: "16px", color: "#fff6e0", stroke: "#1f140d", strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(3);
    this.badge = scene.add.image(0, 0, "cup_espresso").setVisible(false);
    this.cup = new HeldCup(scene);
    this.setDrink(s.drink);
  }

  /** Where chat bubbles and emotes float: just above the name. */
  head = () => ({ x: this.img.x, y: this.label.y - this.label.height - 2 });

  private paint(pixels: string[]) {
    const tex = this.scene.textures.exists(this.texKey)
      ? (this.scene.textures.get(this.texKey) as Phaser.Textures.CanvasTexture)
      : this.scene.textures.createCanvas(this.texKey, GRID, GRID);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, GRID, GRID);
    let minY = GRID;
    let maxY = -1;
    pixels.forEach((color, i) => {
      if (!color) return;
      const y = Math.floor(i / GRID);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      ctx.fillStyle = color;
      ctx.fillRect(i % GRID, y, 1, 1);
    });
    tex.refresh();
    this.art = maxY < 0 ? { minY: 8, maxY: 31 } : { minY, maxY };
  }

  /** They switched characters: repaint the same texture, so it changes live. */
  setPixels(pixels: string[]) {
    this.paint(pixels);
  }

  setDrink(kind: DrinkKind | null) {
    if (kind) this.cup.show(kind);
    else this.cup.hide();
  }

  setTarget(x: number, y: number, flip: boolean, moving: boolean) {
    this.tx = x;
    this.ty = y;
    this.flip = flip;
    this.serverMoving = moving;
  }

  update(time: number, dtMs: number) {
    if (this.seat) {
      this.x = this.tx = this.seat.x;
      this.y = this.ty = this.seat.y;
    } else {
      const k = 1 - Math.exp(-dtMs / SMOOTH_MS);
      this.x += (this.tx - this.x) * k;
      this.y += (this.ty - this.y) * k;
      if (Math.hypot(this.tx - this.x, this.ty - this.y) < 0.2) { this.x = this.tx; this.y = this.ty; }
    }
    const moved = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;
    const moving = !this.seat && (this.serverMoving || moved > 0.4) && moved > 0.05;

    const { minY, maxY } = this.art;
    if (this.seat) {
      const pose = sitPose(minY, maxY);
      this.img
        .setCrop(0, 0, GRID, pose.cropH)
        .setFlipX(this.seat.flipX)
        .setScale(1)
        .setPosition(this.seat.x, this.seat.y + pose.lift)
        .setDepth(this.seat.depth);
      this.shadow.setVisible(false);
    } else {
      const phase = Math.abs(Math.sin(time / 95));
      const hop = moving ? Math.round(phase * 3) : 0;
      const feet = GRID - 1 - maxY;
      this.img
        .setCrop()
        .setFlipX(this.flip)
        .setScale(moving ? 1 + (1 - phase) * 0.04 : 1, moving ? 1 - (1 - phase) * 0.06 : 1)
        .setPosition(Math.round(this.x), Math.round(this.y) + 4 + feet - hop)
        .setDepth(this.y + 4);
      this.shadow.setVisible(true).setPosition(Math.round(this.x), Math.round(this.y) + 2).setScale(1 - hop * 0.06).setDepth(this.y + 3);
    }

    const artTop = this.img.y - (GRID - minY);
    this.label.setPosition(Math.round(this.img.x), Math.round(artTop) - 4).setDepth(80000);
    if (this.cup.visible && this.cup.kind) {
      this.badge
        .setTexture(`cup_${this.cup.kind}`)
        .setVisible(true)
        .setPosition(Math.round(this.label.x - this.label.width / 2 - 6), Math.round(this.label.y - this.label.height / 2))
        .setDepth(80001);
    } else this.badge.setVisible(false);
    const handY = artTop + (maxY - minY + 1) * 0.62;
    this.cup.follow(this.img.x + (this.img.flipX ? -9 : 9), handY, this.img.depth + 1, time);
  }

  destroy() {
    this.img.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.badge.destroy();
    this.cup.hide();
    this.cup.destroy();
    if (this.scene.textures.exists(this.texKey)) this.scene.textures.remove(this.texKey);
  }
}
