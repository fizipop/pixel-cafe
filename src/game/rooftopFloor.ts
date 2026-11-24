import * as Phaser from "phaser";
import { WALL_H, WORLD_H, WORLD_W, TILE } from "./constants";
import {
  FIREPIT, LIGHT_POSTS, LIGHT_STRANDS, LOGS, PHOTO_STAND, POLAROID_WALL, ROOF_PLANTS, TELESCOPE, logSolid, plantSolid, postSolid, strandPoints,
} from "./rooftopLayout";
import type { FloorBuilder } from "./arcadeFloor";
import { FLOOR3_X, STAIRS } from "@/shared/floors";

const label = (scene: Phaser.Scene, x: number, y: number, text: string, color: string, size = 14) =>
  scene.add
    .text(x, y, text, { fontFamily: "VT323, monospace", fontSize: `${size}px`, color, stroke: "#05030c", strokeThickness: 3 })
    .setOrigin(0.5, 1)
    .setResolution(3);

function glow(scene: Phaser.Scene, x: number, y: number, scale: number, tint: number, alpha: number, flicker = 0) {
  const g = scene.add.image(x, y, "glow").setScale(scale).setTint(tint).setBlendMode(Phaser.BlendModes.ADD).setAlpha(alpha).setDepth(90001);
  if (flicker) scene.tweens.add({ targets: g, alpha: { from: alpha * (1 - flicker), to: alpha }, duration: 700 + ((x * 7) % 500), yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  return g;
}

/** Floor 3, the Rooftop Lounge: deck, skyline, campfire, telescope, Polaroid stand and wall, string lights. */
export function buildRooftopFloor(b: FloorBuilder) {
  const { scene } = b;
  const X0 = FLOOR3_X;

  // ---- room + walls (the glass railing is the back wall; the other three edges are railings too)
  scene.add.image(X0, 0, "roof_bg").setOrigin(0).setDepth(0);
  b.solid(X0, 0, WORLD_W, WALL_H);
  b.solid(X0, 0, TILE, WORLD_H);
  b.solid(X0 + WORLD_W - TILE, 0, TILE, WORLD_H);
  b.solid(X0, WORLD_H - TILE, WORLD_W, TILE);

  const sign = scene.add
    .text(X0 + WORLD_W / 2, 40, "☆  R O O F T O P   L O U N G E  ☆", { fontFamily: "VT323, monospace", fontSize: "26px", color: "#ffe9b0", stroke: "#4a3a70", strokeThickness: 2 })
    .setOrigin(0.5)
    .setResolution(3)
    .setDepth(WALL_H + 2);
  sign.setShadow(0, 0, "#f2c36b", 10, true, true);
  scene.tweens.add({ targets: sign, alpha: { from: 0.75, to: 1 }, duration: 1800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

  // ---- the elevator back down
  const lift = STAIRS[3];
  b.place("elevator_down", lift.x, lift.y);
  b.solid(lift.solid.x, lift.solid.y, lift.solid.w, lift.solid.h);
  glow(scene, lift.x + lift.w / 2, lift.y + 12, 0.5, 0x7fe0a9, 0.28, 0.3);
  label(scene, lift.x + lift.w / 2, lift.y - 2, "ELEVATOR ▼", "#7fe0a9").setDepth(lift.y + lift.h + 1);

  // ---- campfire: stone pit, three flame frames, embers floating up, a warm glow on the deck
  const f = FIREPIT;
  b.place("roof_firepit", f.x, f.y);
  b.solid(f.solid.x, f.solid.y, f.solid.w, f.solid.h);
  const flame = scene.add.image(f.x + 30, f.y + 36, "roof_flame0").setOrigin(0.5, 1).setDepth(f.y + f.h + 1);
  let frame = 0;
  scene.time.addEvent({ delay: 130, loop: true, callback: () => { frame = (frame + 1 + Math.floor(Math.random() * 2)) % 3; flame.setTexture(`roof_flame${frame}`).setFlipX(Math.random() < 0.5); } });
  glow(scene, f.x + 30, f.y + 30, 4.2, 0xff8a3a, 0.4, 0.35);
  glow(scene, f.x + 30, f.y + 26, 1.6, 0xffc060, 0.5, 0.3);
  scene.time.addEvent({
    delay: 260, loop: true,
    callback: () => {
      const e = scene.add.image(f.x + 18 + Math.random() * 24, f.y + 24, "px").setTint(Math.random() < 0.5 ? 0xffb347 : 0xff6a2b).setScale(0.6).setDepth(90004).setAlpha(0.95);
      scene.tweens.add({ targets: e, y: e.y - 34 - Math.random() * 30, x: e.x + (Math.random() - 0.5) * 24, alpha: 0, duration: 1100 + Math.random() * 700, ease: "Sine.easeOut", onComplete: () => e.destroy() });
    },
  });

  // ---- the logs around it
  for (const log of LOGS) {
    b.place(log.vertical ? "roof_log_v" : "roof_log_h", log.x, log.y);
    const l = logSolid(log);
    b.solid(l.x, l.y, l.w, l.h);
  }

  // ---- telescope
  const t = TELESCOPE;
  b.place("roof_telescope", t.x, t.y);
  b.solid(t.solid.x, t.solid.y, t.solid.w, t.solid.h);
  glow(scene, t.x + 24, t.y + 20, 0.9, 0x9fd0e8, 0.22, 0.4);
  label(scene, t.x + 24, t.y - 2, "STARGAZING", "#9fd0e8").setDepth(t.y + t.h + 1);

  // ---- Polaroid stand + wall
  const ps = PHOTO_STAND;
  b.place("roof_photo", ps.x, ps.y);
  b.solid(ps.solid.x, ps.solid.y, ps.solid.w, ps.solid.h);
  glow(scene, ps.x + 26, ps.y + 28, 0.9, 0xffe9b0, 0.2, 0.4);
  label(scene, ps.x + 26, ps.y - 2, "PHOTO STAND", "#ffe9b0").setDepth(ps.y + ps.h + 1);
  const w = POLAROID_WALL;
  b.place("roof_wall", w.x, w.y);
  b.solid(w.solid.x, w.solid.y, w.solid.w, w.solid.h);
  label(scene, w.x + w.w / 2, w.y - 2, "POLAROID WALL", "#f28fad").setDepth(w.y + w.h + 1);

  // ---- plants and the posts that hold up the fairy lights
  for (const [x, y] of ROOF_PLANTS) {
    b.place("roof_planter", x - 14, y - 42).setDepth(y);
    const sb = plantSolid([x, y]);
    b.solid(sb.x, sb.y, sb.w, sb.h);
  }
  for (const [x, y] of LIGHT_POSTS) {
    b.place("roof_post", x - 5, y - 72).setDepth(y);
    const sb = postSolid([x, y]);
    b.solid(sb.x, sb.y, sb.w, sb.h);
  }

  // ---- fairy lights: the wire and bulbs are one picture, each bulb gets a soft twinkling glow
  scene.add.image(X0, 0, "roof_lights").setOrigin(0).setDepth(90000);
  const tints = [0xffd36b, 0xffb86b, 0xfff3a6, 0xff9bd0];
  let n = 0;
  for (const s of LIGHT_STRANDS) {
    for (const p of strandPoints(s, s.bulbs)) {
      const g = scene.add.image(p.x, p.y + 4, "glow").setScale(0.22).setTint(tints[n % 4]).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5).setDepth(90001);
      scene.tweens.add({ targets: g, alpha: { from: 0.18, to: 0.65 }, duration: 900 + (n * 137) % 1100, delay: (n * 211) % 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      n++;
    }
  }

  // ---- the sky: twinkling stars and a shooting star every so often
  for (let i = 0; i < 26; i++) {
    const sx = X0 + 20 + ((i * 193) % (WORLD_W - 40));
    const sy = 4 + ((i * 97) % 44);
    const st = scene.add.image(sx, sy, "px").setScale(i % 3 === 0 ? 1 : 0.6).setTint(i % 2 ? 0xfff6e0 : 0xb8d4ff).setDepth(2).setAlpha(0.9);
    scene.tweens.add({ targets: st, alpha: { from: 0.15, to: 1 }, duration: 700 + ((i * 331) % 1800), delay: (i * 173) % 1500, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
  }
  const streak = () => {
    const x = X0 + 160 + Math.random() * 640;
    const y = 6 + Math.random() * 34;
    const img = scene.add.image(x, y, "roof_shoot").setOrigin(1, 0.5).setRotation(0.38).setDepth(3).setAlpha(0);
    scene.tweens.add({ targets: img, x: x + 190, y: y + 72, alpha: { from: 1, to: 0 }, duration: 750, ease: "Quad.easeIn", onComplete: () => img.destroy() });
    scene.time.delayedCall(5000 + Math.random() * 7000, streak);
  };
  scene.time.delayedCall(2500 + Math.random() * 3000, streak);

  scene.add.image(X0, 0, "vignette").setOrigin(0).setDepth(100000);
}
