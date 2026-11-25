import * as Phaser from "phaser";
import { WALL_H, WORLD_W, TILE } from "./constants";
import {
  ARCADE_H, ARCADE_PLANTS, BIG_SCREEN, BLACKJACK, DANCE_PADS, LOUNGE_SOFAS, LOUNGE_TABLES, MACHINES, POKER, POOL_TABLE, RIG, RIGS, ROULETTE,
  TABLE_SOLIDS, ZONE_SIGNS, arcadeWalls, loungeSolids, plantBox, rigSeats, rigSolids, tableSeatList,
} from "./arcadeLayout";
import { FLOOR2_X, STAIRS } from "@/shared/floors";
import { drawMatch, newMatch, stepMatch } from "./sportsSim";

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

/** The elevator on Floor 1 (so you can get up) plus everything on Floor 2, the Arcade & Casino. */
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
  for (const w of arcadeWalls(TILE, WALL_H)) b.solid(w.x, w.y, w.w, w.h);

  // neon zone signs over each area (the big screen hangs where the old room-wide sign was)
  for (const z of ZONE_SIGNS) {
    const t = label(scene, z.x, z.y, z.text, z.color, z.y < WALL_H ? 18 : 16);
    t.setShadow(0, 0, z.color, 8, true, true);
    t.setDepth(z.y < WALL_H ? WALL_H + 2 : z.y + 200);
    scene.tweens.add({ targets: t, alpha: { from: 0.82, to: 1 }, duration: 800 + ((z.x * 3) % 500), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }

  // the elevator back down
  const down = STAIRS[2];
  b.place("elevator_down", down.x, down.y);
  b.solid(down.solid.x, down.solid.y, down.solid.w, down.solid.h);
  neonGlow(scene, down.x + down.w / 2, down.y + 12, 0.5, 0xf2c36b, 0.28);
  label(scene, down.x + down.w / 2, down.y - 2, "ELEVATOR ▼", "#f2c36b", 14).setDepth(down.y + down.h + 1);

  // ---- Beat Battle dance floor: two pads with real arrow panels lit in time (pure floor art, under everything)
  DANCE_PADS.forEach((p, k) => {
    scene.add.image(p.x, p.y, "dance_pad").setOrigin(0).setDepth(1);
    const arrows: [number, number, number][] = [[p.x + 24, p.y + 9, 0], [p.x + 24, p.y + 39, 180], [p.x + 9, p.y + 24, -90], [p.x + 39, p.y + 24, 90]];
    arrows.forEach(([x, y, ang], i) => {
      const a = scene.add.image(x, y, i % 2 ? "dance_arrow_b" : "dance_arrow").setAngle(ang).setDepth(2).setAlpha(0.35);
      // a four-step chase at about 120 bpm, each pad offset so the two floors don't flash in unison
      scene.tweens.add({ targets: a, alpha: { from: 0.35, to: 1 }, duration: 250, yoyo: true, repeat: -1, repeatDelay: 1500, delay: i * 500 + k * 250 });
    });
    neonGlow(scene, p.x + 24, p.y + 24, 0.7, 0xff5fa8, 0.12);
  });

  // ---- cabinets, the casino machines and the leaderboard kiosk
  for (const m of MACHINES) {
    b.place(m.art, m.x, m.y);
    b.solid(m.solid.x, m.solid.y, m.solid.w, m.solid.h);
    neonGlow(scene, m.x + m.w / 2, m.y + 28, m.game ? 1.1 : 0.8, m.glow, m.game ? 0.3 : 0.18);
    if (m.sign) {
      const onWall = m.y <= WALL_H + 8;
      label(scene, m.x + m.w / 2, onWall ? WALL_H - 4 : m.y - 2, m.sign, "#fff6e0", onWall ? 14 : 13).setDepth(onWall ? WALL_H + 2 : m.y + m.h + 2);
    }
  }

  // ---- Neon Drift GP racing rigs: the cabinet, then the bucket seat in front of it (drawn over whoever sits in it)
  const seats = rigSeats();
  RIGS.forEach((r, i) => {
    b.place("rig_cab", r.x, r.y);
    b.place("rig_seat", r.x, r.y + RIG.cabH).setDepth(seats[i].depth + 1);
    neonGlow(scene, r.x + RIG.w / 2, r.y + 20, 0.9, 0xf2a93b, 0.24);
  });
  for (const s of rigSolids()) b.solid(s.x, s.y, s.w, s.h);

  // ---- tables
  for (const [t, key] of [[BLACKJACK, "bj_table"], [ROULETTE, "rt_table"]] as const) {
    b.place(key, t.x, t.y);
    const sb = TABLE_SOLIDS[key === "bj_table" ? "bj0" : "rt0"];
    b.solid(sb.x, sb.y, sb.w, sb.h);
    neonGlow(scene, t.x + t.w / 2, t.y + 40, 2.2, key === "bj_table" ? 0x7fe0a9 : 0xff9bd0, 0.16);
  }
  label(scene, BLACKJACK.x + BLACKJACK.w / 2, BLACKJACK.y - 4, "BLACKJACK", "#7fe0a9", 16).setDepth(BLACKJACK.y + 90);
  label(scene, ROULETTE.x + ROULETTE.w / 2, ROULETTE.y - 4, "ROULETTE", "#ff9bd0", 16).setDepth(ROULETTE.y + 90);
  b.place("poker_table", POKER.x, POKER.y);
  b.solid(TABLE_SOLIDS.pk0.x, TABLE_SOLIDS.pk0.y, TABLE_SOLIDS.pk0.w, TABLE_SOLIDS.pk0.h);
  neonGlow(scene, POKER.x + POKER.w / 2, POKER.y + 40, 3, 0x7fe0a9, 0.14);
  label(scene, POKER.x + POKER.w / 2, POKER.y + 2, "TEXAS HOLD'EM", "#7fe0a9", 16).setDepth(POKER.y + 100);
  b.place("pool_table", POOL_TABLE.x, POOL_TABLE.y);
  b.solid(TABLE_SOLIDS.pl0.x, TABLE_SOLIDS.pl0.y, TABLE_SOLIDS.pl0.w, TABLE_SOLIDS.pl0.h);
  neonGlow(scene, POOL_TABLE.x + POOL_TABLE.w / 2, POOL_TABLE.y + 50, 3, 0x58a6e0, 0.14);
  label(scene, POOL_TABLE.x + POOL_TABLE.w / 2, POOL_TABLE.y + 4, "8-BALL POOL", "#58a6e0", 16).setDepth(POOL_TABLE.y + 140);
  for (const s of tableSeatList()) b.place("stool", s.x - 8, s.y - 6).setDepth(s.depth - 2);

  // ---- the sports lounge: a live broadcast on the big screen, couches facing it, snack tables
  buildLounge(b);

  for (const [x, y] of ARCADE_PLANTS) {
    b.place("plant", x - 12, y - 40).setDepth(y);
    const pb = plantBox([x, y]);
    b.solid(pb.x, pb.y, pb.w, pb.h);
  }

  scene.add.image(FLOOR2_X, 0, "vignette").setOrigin(0).setDisplaySize(WORLD_W, ARCADE_H).setDepth(100000);
}

/** The big screen shows an endless fictional football match, redrawn about 12 times a second, only while it is in view. */
function buildLounge(b: FloorBuilder) {
  const { scene } = b;
  const S = BIG_SCREEN;
  b.place("screen_frame", S.x - 6, S.y - 6).setDepth(WALL_H - 10);
  const tex = scene.textures.createCanvas("sports_live", S.w, S.h)!;
  scene.add.image(S.x, S.y, "sports_live").setOrigin(0).setDepth(WALL_H - 9);
  const glare = scene.add.image(S.x + S.w / 2, S.y + S.h / 2 + 30, "glow").setScale(2.2, 1).setTint(0x7fe0a9).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.12).setDepth(90001);
  void glare;
  const match = newMatch(20261125);
  let frame = 0, last = scene.time.now;
  const draw = () => {
    const now = scene.time.now, dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    const view = scene.cameras.main.worldView;
    stepMatch(match, dt); // the match keeps playing even off screen (cheap), but is only painted when visible
    if (view.right < S.x || view.x > S.x + S.w || view.bottom < S.y || view.y > S.y + S.h + 200) return;
    frame++;
    drawMatch(tex.getContext(), match, S.w, S.h, frame);
    tex.refresh();
  };
  draw();
  scene.time.addEvent({ delay: 83, loop: true, callback: draw });
  for (const s of LOUNGE_SOFAS) b.place("sofa_front", s.x, s.y);
  for (const t of LOUNGE_TABLES) b.place("lounge_table", t.x, t.y);
  for (const s of loungeSolids()) b.solid(s.x, s.y, s.w, s.h);
}
