import * as Phaser from "phaser";
import { NavGrid, type Point } from "./pathing";
import { Bubbles } from "./bubbles";
import { CAT_AREA } from "./layout";

type State = "sit" | "walk" | "sleep" | "pet";

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** Biscuit, the cafe cat. Wanders around the rug, naps, and enjoys being petted. */
export class Cat {
  x = CAT_AREA.home.x;
  y = CAT_AREA.home.y;
  state: State = "sit";
  readonly sprite: Phaser.GameObjects.Image;

  private shadow: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private path: Point[] = [];
  private timer = rand(1500, 3500);
  private frameClock = 0;
  private scene: Phaser.Scene;
  private nav: NavGrid;
  private bubbles: Bubbles;

  constructor(scene: Phaser.Scene, nav: NavGrid, bubbles: Bubbles) {
    this.scene = scene;
    this.nav = nav;
    this.bubbles = bubbles;
    const free = nav.nearestFree(this.x, this.y);
    if (free) { this.x = free.x; this.y = free.y; }
    this.shadow = scene.add.image(this.x, this.y, "shadow").setScale(0.55).setAlpha(0.8);
    this.sprite = scene.add.image(this.x, this.y, "cat_sit").setOrigin(0.5, 1);
    this.label = scene.add
      .text(this.x, this.y, "Biscuit", {
        fontFamily: "VT323, monospace", fontSize: "13px", color: "#d8b98a",
        stroke: "#1f140d", strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(3)
      .setAlpha(0.85);
  }

  get activity() {
    return this.state;
  }

  head = () => ({ x: this.x, y: this.y - 26 });

  /** Pet the cat: it stops, sits, and a heart pops up. Returns false if it is busy walking away. */
  pet(): void {
    this.state = "pet";
    this.path = [];
    this.timer = 3600;
    this.bubbles.emote("cat", this.head, "emote_heart", 2400);
  }

  private pickDestination() {
    for (let tries = 0; tries < 8; tries++) {
      const to = { x: rand(CAT_AREA.x0, CAT_AREA.x1), y: rand(CAT_AREA.y0, CAT_AREA.y1) };
      if (Math.hypot(to.x - this.x, to.y - this.y) < 50) continue;
      const path = this.nav.findPath({ x: this.x, y: this.y }, to);
      if (path && path.length > 1) { this.path = path.slice(1); return true; }
    }
    return false;
  }

  update(time: number, dt: number) {
    this.timer -= dt;
    switch (this.state) {
      case "sit":
      case "sleep":
      case "pet":
        if (this.timer <= 0) {
          if (this.state === "sit" && Math.random() < 0.3) {
            this.state = "sleep";
            this.timer = rand(9000, 15000);
          } else if (this.pickDestination()) {
            this.state = "walk";
          } else {
            this.state = "sit";
            this.timer = rand(2000, 4000);
          }
        }
        break;
      case "walk": {
        const target = this.path[0];
        if (!target) {
          this.state = "sit";
          this.timer = rand(3000, 7000);
          break;
        }
        const d = Math.hypot(target.x - this.x, target.y - this.y);
        const step = (38 * dt) / 1000;
        if (d <= step) {
          this.x = target.x;
          this.y = target.y;
          this.path.shift();
        } else {
          this.x += ((target.x - this.x) / d) * step;
          this.y += ((target.y - this.y) / d) * step;
          this.sprite.setFlipX(target.x < this.x);
        }
        break;
      }
    }

    this.frameClock += dt;
    const key =
      this.state === "walk" ? (Math.floor(this.frameClock / 160) % 2 ? "cat_walk2" : "cat_walk1")
      : this.state === "sleep" ? "cat_sleep" : "cat_sit";
    this.sprite.setTexture(key).setPosition(Math.round(this.x), Math.round(this.y)).setDepth(this.y);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 1).setDepth(this.y - 1);
    this.label.setPosition(Math.round(this.x), Math.round(this.y) - 16).setDepth(80000);
    // a sleeping cat breathes
    this.sprite.setScale(1, this.state === "sleep" ? 1 + Math.sin(time / 600) * 0.03 : 1);
  }
}
