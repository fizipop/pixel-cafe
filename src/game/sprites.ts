import * as Phaser from "phaser";
import { make, rect, type Ctx } from "./art";
import { LOOKS, NPC_TEXTURE_SIZE, renderNpcPixels } from "./npcArt";

// Textures for NPCs, props and emote bubbles (all drawn in code).

function pixelMap(c: Ctx, rows: string[], pal: Record<string, string>, ox: number, oy: number) {
  rows.forEach((row, y) =>
    row.split("").forEach((ch, x) => {
      if (ch !== "." && pal[ch]) rect(c, pal[ch], ox + x, oy + y, 1, 1);
    }),
  );
}

/** A little speech bubble with a pixel icon inside. */
function emote(scene: Phaser.Scene, key: string, rows: string[], pal: Record<string, string>) {
  const w = rows[0].length;
  const h = rows.length;
  const bw = w + 8;
  const bh = h + 8;
  make(scene, key, bw, bh + 4, (c) => {
    const cx = Math.floor(bw / 2);
    rect(c, "#1f140d", 1, 0, bw - 2, bh);
    rect(c, "#1f140d", 0, 1, bw, bh - 2);
    rect(c, "#fff6e0", 2, 1, bw - 4, bh - 2);
    rect(c, "#fff6e0", 1, 2, bw - 2, bh - 4);
    // tail
    rect(c, "#1f140d", cx - 3, bh - 1, 7, 1);
    rect(c, "#1f140d", cx - 2, bh, 5, 1);
    rect(c, "#1f140d", cx - 1, bh + 1, 3, 1);
    rect(c, "#1f140d", cx, bh + 2, 1, 1);
    rect(c, "#fff6e0", cx - 2, bh - 1, 5, 1);
    rect(c, "#fff6e0", cx - 1, bh, 3, 1);
    rect(c, "#fff6e0", cx, bh + 1, 1, 1);
    pixelMap(c, rows, pal, 4, 4);
  });
}

const WAVE = [
  "..f.f.f.f..",
  "..f.f.f.f..",
  "..fffffff..",
  ".fffffffff.",
  "ffffffffff.",
  ".fffffffff.",
  "..fffffff..",
  "...fffff...",
  "...fffff...",
];
const COFFEE = [
  "...s..s....",
  "..s..s.....",
  ".wwwwwwww..",
  ".wcccccwww.",
  ".wcccccw.w.",
  ".wwwwwwwww.",
  "..wwwwwww..",
  "...wwwww...",
];
const HEART = [
  ".wrr..rr...",
  ".rrrr.rrrr.",
  "rrrrrrrrrrr",
  "rrrrrrrrrrr",
  ".rrrrrrrrr.",
  "..rrrrrrr..",
  "...rrrrr...",
  "....rrr....",
  ".....r.....",
];
const NOTE = [
  "...ddd..",
  "...dddd.",
  "...dd.dd",
  "...dd..d",
  "...dd...",
  "...dd...",
  "...dd...",
  ".ddd....",
  "dddd....",
  "dddd....",
  ".dd.....",
];
const DOTS = ["dd.dd.dd", "dd.dd.dd"];

export function buildSpriteTextures(scene: Phaser.Scene) {
  // NPC bodies
  for (const [id, look] of Object.entries(LOOKS)) {
    const key = `npc_${id}`;
    if (scene.textures.exists(key)) continue;
    const pixels = renderNpcPixels(look);
    make(scene, key, NPC_TEXTURE_SIZE, NPC_TEXTURE_SIZE, (c) =>
      pixels.forEach((color, i) => {
        if (color) rect(c, color, i % NPC_TEXTURE_SIZE, Math.floor(i / NPC_TEXTURE_SIZE), 1, 1);
      }),
    );
  }

  // emote bubbles
  emote(scene, "emote_wave", WAVE, { f: "#f1c27d" });
  emote(scene, "emote_coffee", COFFEE, { w: "#d9622b", c: "#4a2f1d", s: "#9a8a7a" });
  emote(scene, "emote_heart", HEART, { r: "#d9304a", w: "#ff9fb0" });
  emote(scene, "emote_note", NOTE, { d: "#1f140d" });
  emote(scene, "emote_dots", DOTS, { d: "#1f140d" });

  // held cups: [kind, liquid, topping]
  const cups: [string, string, string][] = [
    ["espresso", "#3a2314", "#a8703c"],
    ["matcha", "#7fb35a", "#e6f1c8"],
    ["macchiato", "#c68e5b", "#fff0cf"],
    ["cocoa", "#5a3322", "#fff6e0"],
  ];
  for (const [kind, liquid, top] of cups) {
    make(scene, `cup_${kind}`, 8, 8, (c) => {
      rect(c, "#fff6e0", 0, 2, 6, 6);
      rect(c, "#fff6e0", 6, 3, 2, 3);
      rect(c, "#d8c8a0", 0, 7, 6, 1);
      rect(c, liquid, 1, 3, 4, 3);
      rect(c, top, 1, 2, 4, 1); // foam / topping
    });
  }

  make(scene, "cloth", 6, 4, (c) => {
    rect(c, "#fff6e0", 0, 0, 6, 4);
    rect(c, "#d8c8a0", 0, 3, 6, 1);
  });

  // table props
  make(scene, "laptop", 16, 12, (c) => {
    rect(c, "#33333c", 0, 0, 16, 10);
    rect(c, "#7a7a88", 1, 1, 14, 8);
    rect(c, "#f4e4c1", 7, 4, 2, 2);
    rect(c, "#4a4a55", 0, 10, 16, 2);
  });
  make(scene, "book", 12, 8, (c) => {
    rect(c, "#2a4d8f", 0, 0, 12, 8);
    rect(c, "#fff6e0", 1, 1, 5, 6);
    rect(c, "#fff6e0", 6, 1, 5, 6);
    rect(c, "#8a6446", 5, 1, 2, 6);
    rect(c, "#9a8a7a", 2, 2, 3, 1);
    rect(c, "#9a8a7a", 2, 4, 3, 1);
    rect(c, "#9a8a7a", 7, 2, 3, 1);
    rect(c, "#9a8a7a", 7, 4, 3, 1);
  });

  // rumour board
  make(scene, "board", 56, 46, (c) => {
    rect(c, "#2a1a11", 0, 0, 56, 46);
    rect(c, "#4a2f1d", 1, 1, 54, 44);
    rect(c, "#b07a45", 4, 4, 48, 38);
    for (let i = 0; i < 40; i++) rect(c, i % 2 ? "#9a6a3a" : "#c28850", 4 + ((i * 17) % 46), 4 + ((i * 29) % 36), 2, 1);
    const notes: [number, number, number, number, string][] = [
      [7, 7, 14, 12, "#fff6e0"], [24, 6, 12, 14, "#f7d154"], [39, 8, 11, 11, "#f28fad"],
      [9, 24, 12, 13, "#7fc8a9"], [25, 23, 15, 12, "#fff6e0"], [42, 22, 8, 16, "#9fb8d8"],
    ];
    for (const [x, y, w, h, col] of notes) {
      rect(c, "#00000040", x + 1, y + 1, w, h);
      rect(c, col, x, y, w, h);
      for (let ly = y + 4; ly < y + h - 2; ly += 3) rect(c, "#8a7a6a", x + 2, ly, w - 5, 1);
      rect(c, "#d9304a", x + Math.floor(w / 2) - 1, y, 2, 2);
    }
    rect(c, "#f2a93b", 4, 42, 48, 2);
  });
}
