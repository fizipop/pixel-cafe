import * as Phaser from "phaser";
import { WALL_H, WORLD_H, WORLD_W, TILE } from "./constants";
import {
  ARCADE_PLANTS, BLACKJACK, MACHINES, POKER, POOL_TABLE, ROULETTE, TABLE_SOLIDS, arcadeSeats, plantBox,
} from "./arcadeLayout";
import { FLOOR2_X, STAIRS } from "@/shared/floors";

/** What the scene lends this builder: its own furniture helpers (so collisions and depth behave the same everywhere). */
export type FloorBuilder = {
  scene: Phaser.Scene;
  /** `nav` = also block the cafe NPCs' path finding (only Floor 1 furniture needs that). */
  solid: (x: number, y: number, w: number, h: number, nav?: boolean) => void;
  place: (key: string, x: number, y: number, flipX?: boolean) => Phaser.GameObjects.Image;
};

const label = (scene: Phaser.Scene, x: number, y: number, text: string, color: string, size = 16) =>
  scene.add
    .text(x, y, text, { fontFamily: "VT323, monospace", fontSize: `${size}px`, color, stroke: "#05030c", strokeThickness: 3 })
    .setOrigin(0.5, 1)
    .setResolution(3)
    .setDepth(WALL_H + 2);

function neonGlow(scene: Phaser.Scene, x: number, y: number, scale: number, tint: number, alpha = 0.3) {
  const g = scene.add.image(x, y, "glow").setScale(scale).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setDepth(90001);
  scene.tweens.add({ targets: g, alpha: { from: alpha * 0.7, to: alpha }, duration: 900 + ((x * 7) % 700), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  return g;
}

/** The elevator on Floor 1 (so you can get up) plus everything on Floor 2, the Arcade. */
export function buildArcadeFloor(b: FloorBuilder) {
  const { scene } = b;

  // ---- Floor 1: the elevator by the front windows
  const up = STAIRS[1];
  b.place("elevator_up", up.x, up.y);
  b.solid(up.solid.x, up.solid.y, up.solid.w, up.solid.h, true);
  neonGlow(scene, up.x + up.w / 2, up.y + 12, 0.5, 0x7fe0a9, 0.28);
  label(scene, up.x + up.w / 2, up.y - 2, "ELEVATOR ▲", "#7fe0a9", 14).setDepth(up.y + up.h + 1);

  // ---- Floor 2: room, walls
  scene.add.image(FLOOR2_X, 0, "arc_bg").setOrigin(0).setDepth(0);
  b.solid(FLOOR2_X, 0, WORLD_W, WALL_H);
  b.solid(FLOOR2_X, 0, TILE, WORLD_H);
  b.solid(FLOOR2_X + WORLD_W - TILE, 0, TILE, WORLD_H);
  b.solid(FLOOR2_X, WORLD_H - TILE, WORLD_W, TILE);

  // neon sign over the whole room
  const sign = scene.add
    .text(FLOOR2_X + WORLD_W / 2, 52, "★  A R C A D E  ★", { fontFamily: "VT323, monospace", fontSize: "34px", color: "#ff9bd0", stroke: "#ff3b94", strokeThickness: 2 })
    .setOrigin(0.5)
    .setResolution(3)
    .setDepth(WALL_H + 2);
  sign.setShadow(0, 0, "#ff3b94", 12, true, true);
  scene.tweens.add({ targets: sign, alpha: { from: 0.8, to: 1 }, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // the elevator back down
  const down = STAIRS[2];
  b.place("elevator_down", down.x, down.y);
  b.solid(down.solid.x, down.solid.y, down.solid.w, down.solid.h);
  neonGlow(scene, down.x + down.w / 2, down.y + 12, 0.5, 0xf2c36b, 0.28);
  label(scene, down.x + down.w / 2, down.y - 2, "ELEVATOR ▼", "#f2c36b", 14).setDepth(down.y + down.h + 1);

  // cabinets and the leaderboard kiosk
  for (const m of MACHINES) {
    b.place(m.art, m.x, m.y);
    b.solid(m.solid.x, m.solid.y, m.solid.w, m.solid.h);
    neonGlow(scene, m.x + m.w / 2, m.y + 28, m.game ? 1.1 : 0.8, m.glow, m.game ? 0.3 : 0.18);
    if (m.game) {
      const names: Record<string, string> = {
        slots: "SLOTS", mines: "MINES", moon: "TO THE MOON", penguin: "PENGUIN CROSS", board: "TOP SCORES",
        fighter: "FIGHTER II", racer: "NEON DRIFT", beat: "BEAT BATTLE",
      };
      label(scene, m.x + m.w / 2, WALL_H - 4, names[m.game] ?? "", "#fff6e0", 14);
    }
  }

  // tables
  for (const [t, key] of [[BLACKJACK, "bj_table"], [ROULETTE, "rt_table"]] as const) {
    b.place(key, t.x, t.y);
    const sb = TABLE_SOLIDS[key === "bj_table" ? "bj0" : "rt0"];
    b.solid(sb.x, sb.y, sb.w, sb.h);
    neonGlow(scene, t.x + t.w / 2, t.y + 40, 2.2, key === "bj_table" ? 0x7fe0a9 : 0xff9bd0, 0.16);
  }
  label(scene, BLACKJACK.x + BLACKJACK.w / 2, BLACKJACK.y - 18, "BLACKJACK", "#7fe0a9", 16).setDepth(BLACKJACK.y + 90);
  label(scene, ROULETTE.x + ROULETTE.w / 2, ROULETTE.y - 4, "ROULETTE", "#ff9bd0", 16).setDepth(ROULETTE.y + 90);
  b.place("poker_table", POKER.x, POKER.y);
  b.solid(TABLE_SOLIDS.pk0.x, TABLE_SOLIDS.pk0.y, TABLE_SOLIDS.pk0.w, TABLE_SOLIDS.pk0.h);
  neonGlow(scene, POKER.x + POKER.w / 2, POKER.y + 40, 3, 0x7fe0a9, 0.14);
  label(scene, POKER.x + POKER.w / 2, POKER.y + 2, "TEXAS HOLD'EM", "#7fe0a9", 16).setDepth(POKER.y + 100);
  b.place("pool_table", POOL_TABLE.x, POOL_TABLE.y);
  b.solid(TABLE_SOLIDS.pl0.x, TABLE_SOLIDS.pl0.y, TABLE_SOLIDS.pl0.w, TABLE_SOLIDS.pl0.h);
  neonGlow(scene, POOL_TABLE.x + POOL_TABLE.w / 2, POOL_TABLE.y + 50, 3, 0x58a6e0, 0.14);
  label(scene, POOL_TABLE.x + POOL_TABLE.w / 2, POOL_TABLE.y + 4, "8-BALL POOL", "#58a6e0", 16).setDepth(POOL_TABLE.y + 140);
  for (const s of arcadeSeats()) b.place("stool", s.x - 8, s.y - 6).setDepth(s.depth - 2);

  for (const [x, y] of ARCADE_PLANTS) {
    b.place("plant", x - 12, y - 40).setDepth(y);
    const pb = plantBox([x, y]);
    b.solid(pb.x, pb.y, pb.w, pb.h);
  }

  scene.add.image(FLOOR2_X, 0, "vignette").setOrigin(0).setDepth(100000);
}
