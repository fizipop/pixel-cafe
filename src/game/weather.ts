import * as Phaser from "phaser";
import type { Weather } from "@/lib/moods";
import { SKY } from "./props";

const WINDOW_X = [15, 20, 25].map((c) => c * 32); // matches the three windows painted in art.ts
const PANE_Y = 12;
const DROPS_PER_WINDOW = 14;

const TINT: Record<Weather, { color: number; alpha: number }> = {
  dusk: { color: 0x000000, alpha: 0 },
  rain: { color: 0x14213d, alpha: 0.3 },
  sun: { color: 0xfff1c4, alpha: 0.1 },
};

type Drop = { img: Phaser.GameObjects.Image; win: number; speed: number };

/**
 * Everything the "window weather" changes: the sky in the windows, falling rain on the glass
 * and a colour wash over the room. It only reads a Weather value, so it can be driven by the
 * shared WorldStore (and later by the server).
 */
export class WeatherLayer {
  private scene: Phaser.Scene;
  private skies: Phaser.GameObjects.Image[];
  private drops: Drop[] = [];
  private wash: Phaser.GameObjects.Rectangle;
  private current: Weather = "dusk";

  constructor(scene: Phaser.Scene, worldW: number, worldH: number) {
    this.scene = scene;
    this.skies = WINDOW_X.map((x) => scene.add.image(x, PANE_Y, "sky_rain").setOrigin(0).setDepth(1).setVisible(false));
    this.wash = scene.add.rectangle(0, 0, worldW, worldH, 0x000000, 1).setOrigin(0).setDepth(79000).setAlpha(0);

    WINDOW_X.forEach((x, win) => {
      for (let i = 0; i < DROPS_PER_WINDOW; i++) {
        const img = scene.add.image(x + Math.random() * SKY.w, PANE_Y + Math.random() * SKY.h, "drop").setDepth(1.5).setVisible(false).setAlpha(0.75);
        this.drops.push({ img, win, speed: 70 + Math.random() * 60 });
      }
    });
  }

  get weather() {
    return this.current;
  }

  set(w: Weather) {
    this.current = w;
    const skyKey = w === "rain" ? "sky_rain" : w === "sun" ? "sky_sun" : null;
    this.skies.forEach((s) => (skyKey ? s.setTexture(skyKey).setVisible(true) : s.setVisible(false)));
    this.drops.forEach((d) => d.img.setVisible(w === "rain"));
    const t = TINT[w];
    if (t.alpha > 0) this.wash.setFillStyle(t.color, 1); // fading back to dusk keeps the old colour while it fades
    this.scene.tweens.add({ targets: this.wash, alpha: t.alpha, duration: 700 });
  }

  update(dt: number) {
    if (this.current !== "rain") return;
    const sec = dt / 1000;
    for (const d of this.drops) {
      const left = WINDOW_X[d.win];
      d.img.y += d.speed * sec;
      d.img.x -= 8 * sec;
      if (d.img.y > PANE_Y + SKY.h - 5) {
        d.img.y = PANE_Y;
        d.img.x = left + Math.random() * SKY.w;
      }
      if (d.img.x < left) d.img.x = left + SKY.w;
    }
  }
}
