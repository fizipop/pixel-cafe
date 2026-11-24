import * as Phaser from "phaser";

// All art is drawn in code (no image files yet). Later you can swap any of these
// for real sprite sheets without touching the game logic.

import { TILE, COLS, ROWS, WORLD_W, WORLD_H, WALL_H } from "./constants";

export { TILE, COLS, ROWS, WORLD_W, WORLD_H, WALL_H };

export type Ctx = CanvasRenderingContext2D;

export const rect = (c: Ctx, color: string, x: number, y: number, w: number, h: number) => {
  c.fillStyle = color;
  c.fillRect(x, y, w, h);
};

/** Crisp filled ellipse (no anti-aliasing) built from 1px rows. */
export function ellipse(c: Ctx, color: string, cx: number, cy: number, rx: number, ry: number) {
  c.fillStyle = color;
  for (let y = -ry; y <= ry; y++) {
    const w = Math.round(rx * Math.sqrt(1 - (y * y) / (ry * ry)));
    c.fillRect(cx - w, cy + y, w * 2, 1);
  }
}

// deterministic pseudo-random 0..1 from integer coords
function hash(x: number, y: number, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export function make(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex.refresh();
}

// ------------------------------------------------------------ background

function floorTile(c: Ctx, col: number, row: number) {
  const x = col * TILE;
  const y = row * TILE;
  const base = ["#8a5a36", "#82532f", "#905f3a", "#7d4f2d"][Math.floor(hash(col, row) * 4)];
  rect(c, base, x, y, TILE, TILE);
  // two horizontal planks per tile with seams
  rect(c, "#5e3a20", x, y + 15, TILE, 1);
  rect(c, "#5e3a20", x, y + 31, TILE, 1);
  rect(c, "#9d6b43", x, y, TILE, 1);
  rect(c, "#9d6b43", x, y + 16, TILE, 1);
  rect(c, "#5e3a20", x + Math.floor(hash(col, row, 1) * 28) + 2, y, 1, 15);
  rect(c, "#5e3a20", x + Math.floor(hash(col, row, 2) * 28) + 2, y + 16, 1, 15);
  for (let i = 0; i < 5; i++) {
    const px = x + Math.floor(hash(col, row, 10 + i) * 30);
    const py = y + Math.floor(hash(col, row, 20 + i) * 30);
    rect(c, hash(col, row, 30 + i) > 0.5 ? "#99663f" : "#744a2a", px, py, 2, 1);
  }
}

function drawBackground(c: Ctx) {
  for (let r = 0; r < ROWS; r++) for (let col = 0; col < COLS; col++) floorTile(c, col, r);

  // back wall: striped wallpaper + wainscot
  rect(c, "#5b3a2a", 0, 0, WORLD_W, WALL_H);
  for (let x = 0; x < WORLD_W; x += 16) rect(c, x % 32 === 0 ? "#60402e" : "#563627", x, 0, 16, 64);
  rect(c, "#3d271b", 0, 64, WORLD_W, 32);
  for (let x = 0; x < WORLD_W; x += 32) {
    rect(c, "#4a3222", x + 3, 70, 26, 20);
    rect(c, "#33200f", x + 3, 88, 26, 2);
  }
  rect(c, "#8a6446", 0, 62, WORLD_W, 3);
  rect(c, "#1f140d", 0, WALL_H - 2, WORLD_W, 2);

  // side + bottom walls
  rect(c, "#3d271b", 0, WALL_H, TILE, WORLD_H - WALL_H);
  rect(c, "#3d271b", WORLD_W - TILE, WALL_H, TILE, WORLD_H - WALL_H);
  rect(c, "#3d271b", 0, WORLD_H - TILE, WORLD_W, TILE);
  rect(c, "#8a6446", TILE - 3, WALL_H, 3, WORLD_H - WALL_H - TILE);
  rect(c, "#8a6446", WORLD_W - TILE, WALL_H, 3, WORLD_H - WALL_H - TILE);
  rect(c, "#8a6446", 0, WORLD_H - TILE, WORLD_W, 3);
  rect(c, "#1f140d", 0, WORLD_H - 4, WORLD_W, 4);

  // shelves with cups and jars behind the counter
  for (const sy of [30, 56]) {
    rect(c, "#2a1a11", 64, sy + 8, 352, 4);
    rect(c, "#8a6446", 64, sy + 8, 352, 1);
    for (let x = 72; x < 408; x += 14) {
      const r = hash(x, sy);
      const col = ["#f4e4c1", "#d9622b", "#7fc8a9", "#c8438f", "#f2a93b", "#9fb8d8"][Math.floor(r * 6)];
      const h = 5 + Math.floor(hash(x, sy, 3) * 4);
      rect(c, col, x, sy + 8 - h, 8, h);
      rect(c, "#00000033", x + 6, sy + 8 - h, 2, h);
    }
  }

  // windows (dusk light) + light beams on the floor
  for (const wx of [15, 20, 25]) {
    const x = wx * TILE;
    rect(c, "#2a1a11", x - 4, 8, 104, 66);
    const grad = c.createLinearGradient(0, 12, 0, 70);
    grad.addColorStop(0, "#f7d27a");
    grad.addColorStop(1, "#e0884a");
    c.fillStyle = grad;
    c.fillRect(x, 12, 96, 58);
    rect(c, "#2a1a11", x + 46, 12, 4, 58);
    rect(c, "#2a1a11", x, 38, 96, 4);
    rect(c, "#8a6446", x - 6, 72, 108, 4);
    c.fillStyle = "rgba(255, 214, 140, 0.10)";
    c.beginPath();
    c.moveTo(x, WALL_H);
    c.lineTo(x + 96, WALL_H);
    c.lineTo(x + 150, WALL_H + 170);
    c.lineTo(x + 40, WALL_H + 170);
    c.closePath();
    c.fill();
  }

  // rug in the lounge corner
  const rx = 20 * TILE, ry = 11 * TILE, rw = 10 * TILE, rh = 9 * TILE;
  rect(c, "#d9a441", rx - 4, ry - 4, rw + 8, rh + 8);
  rect(c, "#7a2e2b", rx, ry, rw, rh);
  rect(c, "#d9a441", rx + 12, ry + 12, rw - 24, 2);
  rect(c, "#d9a441", rx + 12, ry + rh - 14, rw - 24, 2);
  rect(c, "#d9a441", rx + 12, ry + 12, 2, rh - 24);
  rect(c, "#d9a441", rx + rw - 14, ry + 12, 2, rh - 24);
  for (let x = rx + 24; x < rx + rw - 24; x += 16) {
    rect(c, "#a0443a", x, ry + 20, 8, 8);
    rect(c, "#a0443a", x, ry + rh - 28, 8, 8);
  }

  // front door + mat
  const dx = 15 * TILE;
  rect(c, "#1f140d", dx - 4, WORLD_H - TILE - 24, 72, 28 + 24);
  rect(c, "#6b4429", dx, WORLD_H - TILE - 20, 64, 48);
  rect(c, "#9fb8d8", dx + 8, WORLD_H - TILE - 14, 20, 24);
  rect(c, "#9fb8d8", dx + 36, WORLD_H - TILE - 14, 20, 24);
  rect(c, "#f2a93b", dx + 29, WORLD_H - TILE + 8, 3, 3);
  rect(c, "#3a2a22", dx - 4, WORLD_H - TILE * 2 - 4, 72, 24);
  rect(c, "#5a4034", dx, WORLD_H - TILE * 2, 64, 16);
}

// ------------------------------------------------------------- furniture

function drawCounter(c: Ctx) {
  rect(c, "#6b4429", 0, 8, 32, 24);
  rect(c, "#8a5a36", 0, 8, 32, 2);
  rect(c, "#4a2f1d", 0, 28, 32, 4);
  rect(c, "#5a3a22", 15, 10, 2, 18);
  rect(c, "#e0b070", 0, 0, 32, 9);
  rect(c, "#f0c88a", 0, 0, 32, 2);
  rect(c, "#b88850", 0, 7, 32, 2);
}

function drawTable(c: Ctx) {
  ellipse(c, "#00000040", 32, 46, 28, 8);
  rect(c, "#4a3222", 28, 34, 8, 16);
  rect(c, "#33200f", 20, 48, 24, 4);
  ellipse(c, "#6b4429", 32, 25, 29, 17);
  ellipse(c, "#c28850", 32, 22, 29, 17);
  ellipse(c, "#d29a5f", 32, 21, 26, 14);
  // cup + plate
  ellipse(c, "#f4e4c1", 24, 22, 6, 3);
  rect(c, "#fff6e0", 21, 17, 6, 5);
  rect(c, "#6b3f22", 22, 17, 4, 1);
  rect(c, "#fff6e0", 27, 18, 2, 2);
  // napkin holder
  rect(c, "#d9622b", 40, 18, 5, 5);
  rect(c, "#f4e4c1", 41, 16, 3, 3);
}

function drawChairFront(c: Ctx) {
  rect(c, "#4a2f1d", 3, 0, 18, 13);
  rect(c, "#6b4429", 4, 1, 16, 11);
  rect(c, "#8a5a36", 5, 2, 14, 2);
  rect(c, "#b07a45", 2, 13, 20, 8);
  rect(c, "#c8905a", 2, 13, 20, 2);
  rect(c, "#4a2f1d", 3, 21, 3, 7);
  rect(c, "#4a2f1d", 18, 21, 3, 7);
}

function drawChairBack(c: Ctx) {
  rect(c, "#4a2f1d", 2, 0, 20, 20);
  rect(c, "#6b4429", 3, 1, 18, 18);
  rect(c, "#8a5a36", 4, 2, 16, 2);
  rect(c, "#4a2f1d", 7, 6, 2, 10);
  rect(c, "#4a2f1d", 12, 6, 2, 10);
  rect(c, "#4a2f1d", 16, 6, 2, 10);
  rect(c, "#33200f", 3, 20, 3, 8);
  rect(c, "#33200f", 18, 20, 3, 8);
}

function drawChairSide(c: Ctx) {
  rect(c, "#4a2f1d", 0, 0, 5, 20);
  rect(c, "#6b4429", 1, 1, 3, 18);
  rect(c, "#b07a45", 0, 14, 20, 7);
  rect(c, "#c8905a", 0, 14, 20, 2);
  rect(c, "#4a2f1d", 1, 21, 3, 7);
  rect(c, "#4a2f1d", 15, 21, 3, 7);
}

function drawSofaBack(c: Ctx) {
  // viewed from the front: backrest at the top, seat towards the viewer
  rect(c, "#5e2020", 0, 4, 96, 20);
  rect(c, "#8f3b3b", 4, 0, 88, 22);
  rect(c, "#a84848", 6, 2, 84, 3);
  rect(c, "#a84848", 8, 22, 80, 14);
  rect(c, "#6a2a2a", 47, 22, 2, 14);
  rect(c, "#7a3030", 0, 10, 10, 30);
  rect(c, "#7a3030", 86, 10, 10, 30);
  rect(c, "#8f3b3b", 2, 10, 6, 6);
  rect(c, "#8f3b3b", 88, 10, 6, 6);
  rect(c, "#33200f", 4, 40, 4, 4);
  rect(c, "#33200f", 88, 40, 4, 4);
}

function drawSofaFront(c: Ctx) {
  // we see the back of the sofa
  rect(c, "#5e2020", 0, 0, 96, 40);
  rect(c, "#8f3b3b", 3, 2, 90, 34);
  rect(c, "#a84848", 5, 4, 86, 3);
  rect(c, "#6a2a2a", 47, 6, 2, 28);
  rect(c, "#7a3030", 0, 0, 8, 40);
  rect(c, "#7a3030", 88, 0, 8, 40);
  rect(c, "#33200f", 4, 40, 4, 4);
  rect(c, "#33200f", 88, 40, 4, 4);
}

function drawCoffeeTable(c: Ctx) {
  ellipse(c, "#00000040", 28, 24, 24, 6);
  rect(c, "#4a3222", 24, 16, 8, 8);
  ellipse(c, "#6b4429", 28, 12, 26, 9);
  ellipse(c, "#c28850", 28, 10, 26, 9);
  ellipse(c, "#f4e4c1", 18, 10, 5, 2);
  rect(c, "#fff6e0", 16, 6, 5, 4);
  rect(c, "#9fb8d8", 34, 7, 8, 5);
}

function drawPlant(c: Ctx) {
  rect(c, "#8a3f22", 5, 28, 14, 12);
  rect(c, "#c0643a", 3, 26, 18, 4);
  rect(c, "#33200f", 5, 26, 14, 2);
  ellipse(c, "#2e6b3a", 12, 16, 11, 12);
  ellipse(c, "#3b8a4a", 8, 14, 7, 9);
  ellipse(c, "#3b8a4a", 16, 12, 7, 10);
  ellipse(c, "#58b062", 12, 8, 5, 6);
  rect(c, "#2e6b3a", 11, 18, 2, 8);
}

function drawLamp(c: Ctx) {
  rect(c, "#1f140d", 6, 0, 2, 16);
  rect(c, "#d9622b", 1, 16, 12, 3);
  rect(c, "#f2a93b", 2, 19, 10, 3);
  rect(c, "#fff6c8", 4, 22, 6, 2);
}

function drawMachine(c: Ctx) {
  rect(c, "#33333c", 0, 8, 28, 28);
  rect(c, "#5a5a66", 2, 10, 24, 24);
  rect(c, "#7a7a88", 2, 10, 24, 3);
  rect(c, "#1f1f26", 6, 16, 16, 8);
  rect(c, "#d9622b", 20, 26, 3, 3);
  rect(c, "#33333c", 11, 24, 6, 5);
  rect(c, "#fff6e0", 11, 29, 6, 5);
  rect(c, "#33333c", 0, 0, 28, 8);
  rect(c, "#5a5a66", 2, 2, 24, 4);
}

function drawRegister(c: Ctx) {
  rect(c, "#2a2a30", 0, 8, 20, 10);
  rect(c, "#4a4a55", 1, 9, 18, 8);
  rect(c, "#7fc8a9", 3, 0, 14, 8);
  rect(c, "#1f6f78", 4, 1, 12, 5);
  rect(c, "#f4e4c1", 12, 12, 5, 3);
}

function drawCup(c: Ctx) {
  rect(c, "#fff6e0", 0, 2, 6, 6);
  rect(c, "#fff6e0", 6, 3, 2, 3);
  rect(c, "#6b3f22", 1, 2, 4, 1);
}

function drawVignette(c: Ctx) {
  const g = c.createRadialGradient(WORLD_W / 2, WORLD_H / 2, 260, WORLD_W / 2, WORLD_H / 2, 640);
  g.addColorStop(0, "rgba(20, 8, 2, 0)");
  g.addColorStop(1, "rgba(20, 8, 2, 0.6)");
  c.fillStyle = g;
  c.fillRect(0, 0, WORLD_W, WORLD_H);
}

function drawGlow(c: Ctx) {
  const g = c.createRadialGradient(96, 96, 0, 96, 96, 96);
  g.addColorStop(0, "rgba(255, 190, 100, 1)");
  g.addColorStop(1, "rgba(255, 190, 100, 0)");
  c.fillStyle = g;
  c.fillRect(0, 0, 192, 192);
}

export function buildTextures(scene: Phaser.Scene) {
  make(scene, "px", 2, 2, (c) => rect(c, "#ffffff", 0, 0, 2, 2));
  make(scene, "bg", WORLD_W, WORLD_H, drawBackground);
  make(scene, "counter", 32, 32, drawCounter);
  make(scene, "table", 64, 56, drawTable);
  make(scene, "chair_front", 24, 28, drawChairFront);
  make(scene, "chair_back", 24, 28, drawChairBack);
  make(scene, "chair_side", 20, 28, drawChairSide);
  make(scene, "sofa_back", 96, 44, drawSofaBack);
  make(scene, "sofa_front", 96, 44, drawSofaFront);
  make(scene, "coffee_table", 56, 28, drawCoffeeTable);
  make(scene, "plant", 24, 40, drawPlant);
  make(scene, "lamp", 14, 24, drawLamp);
  make(scene, "machine", 28, 36, drawMachine);
  make(scene, "register", 20, 18, drawRegister);
  make(scene, "cup", 8, 8, drawCup);
  make(scene, "vignette", WORLD_W, WORLD_H, drawVignette);
  make(scene, "glow", 192, 192, drawGlow);
  make(scene, "shadow", 28, 10, (c) => ellipse(c, "rgba(0,0,0,0.35)", 14, 5, 13, 4));
  make(scene, "puff", 4, 4, (c) => rect(c, "#fff6e0", 0, 0, 4, 4));
}
