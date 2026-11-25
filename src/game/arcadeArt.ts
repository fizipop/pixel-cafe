import * as Phaser from "phaser";
import { ellipse, make, rect, type Ctx } from "./art";
import { WALL_H, WORLD_W } from "./constants";
import { FLOOR2_X } from "@/shared/floors";
import { ARCADE_H, BLACKJACK, CASINO_ROW, LOUNGE_AREA, POKER, POOL_TABLE, RIGS, RIG, ROULETTE } from "./arcadeLayout";

const WORLD_H = ARCADE_H; // Floor 2 is taller than the other floors

// Floor 2 art, all drawn in code like the rest of the cafe: a dark patterned arcade carpet,
// glowing neon trim, retro cabinets, card/roulette tables and a leaderboard kiosk.

const NEON = { cyan: "#58e1ff", cyanDim: "#256e8c", pink: "#ff5fa8", pinkDim: "#7a2d57", gold: "#f2c36b", green: "#7fe0a9" };

function hash(x: number, y: number, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// ---------------------------------------------------------------------------- the room

function drawBackground(c: Ctx) {
  // carpet: 32px tiles, each with a stepped diamond and a dot
  for (let row = 0; row < WORLD_H / 32; row++) {
    for (let col = 0; col < WORLD_W / 32; col++) {
      const x = col * 32;
      const y = row * 32;
      const alt = (col + row) % 2 === 0;
      rect(c, alt ? "#1b1330" : "#201638", x, y, 32, 32);
      const line = alt ? "#2f2358" : "#352866";
      for (let i = 0; i < 12; i++) { // diamond outline
        rect(c, line, x + 16 - 1 - i, y + 2 + i, 2, 1);
        rect(c, line, x + 16 - 1 + i, y + 2 + i, 2, 1);
        rect(c, line, x + 16 - 1 - i, y + 29 - i, 2, 1);
        rect(c, line, x + 16 - 1 + i, y + 29 - i, 2, 1);
      }
      rect(c, alt ? "#6a2a62" : "#1f6070", x + 14, y + 14, 4, 4);
      rect(c, alt ? "#9b3a86" : "#2a8a9c", x + 15, y + 15, 2, 2);
      if (hash(col, row, 3) > 0.8) rect(c, "#3a2c70", x + 4 + Math.floor(hash(col, row, 4) * 22), y + 3, 2, 2); // stray sparkle
    }
  }
  // CASINO: a red-and-gold patterned carpet under the slot row, Plinko and the lottery booth
  {
    const x = 60, y = CASINO_ROW - 52, w = 540, h = 180;
    rect(c, "#0d0a1c", x - 4, y - 4, w + 8, h + 8);
    rect(c, "#c8a040", x - 2, y - 2, w + 4, h + 4);
    for (let ty = 0; ty < h; ty += 16) for (let tx = 0; tx < w; tx += 16) {
      rect(c, ((tx + ty) / 16) % 2 ? "#5a0a1c" : "#6a1024", x + tx, y + ty, 16, 16);
      rect(c, "#c8a040", x + tx + 7, y + ty + 7, 2, 2);
      rect(c, "#8a2a3a", x + tx + 3, y + ty + 3, 1, 1); rect(c, "#8a2a3a", x + tx + 12, y + ty + 12, 1, 1);
    }
  }
  // SPORTS LOUNGE: a deep green rug with a pitch-line pattern
  {
    const x = LOUNGE_AREA.x - FLOOR2_X, y = LOUNGE_AREA.y, w = LOUNGE_AREA.w, h = LOUNGE_AREA.h;
    rect(c, "#0d0a1c", x - 3, y - 3, w + 6, h + 6);
    rect(c, "#1c4a2c", x, y, w, h);
    for (let i = 0; i < w; i += 24) rect(c, i % 48 ? "#1f5232" : "#1a4428", x + i, y, 24, h);
    rect(c, "#cfe9d0", x + 6, y + 6, w - 12, 1); rect(c, "#cfe9d0", x + 6, y + h - 7, w - 12, 1);
    rect(c, "#cfe9d0", x + 6, y + 6, 1, h - 12); rect(c, "#cfe9d0", x + w - 7, y + 6, 1, h - 12);
    rect(c, "#cfe9d0", x + w / 2, y + 6, 1, h - 12);
  }
  // NEON DRIFT GP: a chequered-flag mat under the racing rigs
  {
    const x = RIGS[0].x - FLOOR2_X - 14, y = RIGS[0].y - 6, w = RIGS[1].x - RIGS[0].x + RIG.w + 28, h = RIG.cabH + RIG.seatH + 34;
    rect(c, "#0d0a1c", x - 3, y - 3, w + 6, h + 6);
    for (let ty = 0; ty < h; ty += 8) for (let tx = 0; tx < w; tx += 8) rect(c, ((tx + ty) / 8) % 2 ? "#1a1a22" : "#e8e8f0", x + tx, y + ty, 8, 8);
    rect(c, "#f2a93b", x, y, w, 2); rect(c, "#f2a93b", x, y + h - 2, w, 2);
  }
  // two rugs under the tables
  for (const t of [BLACKJACK, ROULETTE, POKER, POOL_TABLE]) {
    const x = t.x - FLOOR2_X - 24;
    const y = t.y - 8;
    const w = t.w + 48;
    const h = t.h + (t === POKER ? 120 : t === POOL_TABLE ? 142 : 70);
    rect(c, "#0d0a1c", x - 4, y - 4, w + 8, h + 8);
    rect(c, "#3a1f58", x, y, w, h);
    rect(c, "#5a2f7a", x + 4, y + 4, w - 8, h - 8);
    rect(c, "#2b1642", x + 8, y + 8, w - 16, h - 16);
    for (let i = 0; i < w - 16; i += 8) { rect(c, "#4a2a6a", x + 8 + i, y + 8, 4, 2); rect(c, "#4a2a6a", x + 8 + i, y + h - 10, 4, 2); }
  }
  // back wall: dark panels, stars, neon rails
  rect(c, "#140d26", 0, 0, WORLD_W, WALL_H);
  for (let x = 0; x < WORLD_W; x += 64) { rect(c, "#1d1336", x, 8, 62, WALL_H - 28); rect(c, "#0e0a1c", x + 62, 8, 2, WALL_H - 28); }
  for (let i = 0; i < 46; i++) rect(c, hash(i, 1) > 0.5 ? "#fff6e0" : "#9fb8d8", Math.floor(hash(i, 2) * WORLD_W), 10 + Math.floor(hash(i, 3) * 50), 1, 1);
  rect(c, "#0a0716", 0, WALL_H - 22, WORLD_W, 22);
  rect(c, NEON.cyanDim, 0, WALL_H - 14, WORLD_W, 4);
  rect(c, NEON.cyan, 0, WALL_H - 13, WORLD_W, 2);
  rect(c, NEON.pinkDim, 0, 2, WORLD_W, 4);
  rect(c, NEON.pink, 0, 3, WORLD_W, 2);
  // wall posters between the cabinets
  const poster = (x: number, y: number, a: string, b: string) => {
    rect(c, "#05030c", x - 2, y - 2, 30, 38);
    rect(c, a, x, y, 26, 34);
    rect(c, b, x + 4, y + 4, 18, 12);
    rect(c, "#fff6e0", x + 6, y + 21, 14, 2);
    rect(c, "#fff6e0", x + 9, y + 26, 8, 2);
  };
  poster(400, 18, "#7a2d57", "#f2c36b");
  poster(440, 18, "#256e8c", "#ff5fa8");
  poster(900, 18, "#3a2c70", "#7fe0a9");
  poster(940, 18, "#7a3a2d", "#58e1ff");
  // side walls + bottom wall, each with a neon edge
  rect(c, "#0d0a1c", 0, WALL_H, 32, WORLD_H - WALL_H);
  rect(c, "#0d0a1c", WORLD_W - 32, WALL_H, 32, WORLD_H - WALL_H);
  rect(c, NEON.pinkDim, 28, WALL_H, 4, WORLD_H - WALL_H);
  rect(c, NEON.pink, 29, WALL_H, 2, WORLD_H - WALL_H);
  rect(c, NEON.pinkDim, WORLD_W - 32, WALL_H, 4, WORLD_H - WALL_H);
  rect(c, NEON.pink, WORLD_W - 31, WALL_H, 2, WORLD_H - WALL_H);
  rect(c, "#0d0a1c", 0, WORLD_H - 32, WORLD_W, 32);
  rect(c, NEON.cyanDim, 32, WORLD_H - 36, WORLD_W - 64, 4);
  rect(c, NEON.cyan, 32, WORLD_H - 35, WORLD_W - 64, 2);
}

// ---------------------------------------------------------------------------- cabinets

type Screen = (c: Ctx, x: number, y: number, w: number, h: number) => void;

function cabinet(c: Ctx, body: string, light: string, marquee: string, screen: Screen, btn: [string, string]) {
  const W = 44;
  ellipse(c, "#00000055", 22, 58, 20, 3);
  rect(c, "#0a0716", 2, 2, W - 4, 58); // outline
  rect(c, body, 3, 6, W - 6, 52);
  rect(c, body, 5, 3, W - 10, 5);
  rect(c, light, 3, 6, 2, 52); // glowing side strips
  rect(c, light, W - 5, 6, 2, 52);
  rect(c, marquee, 7, 4, W - 14, 9); // marquee
  rect(c, "#fff6e0", 10, 7, 6, 3);
  rect(c, "#fff6e0", 19, 7, 4, 3);
  rect(c, "#fff6e0", 26, 7, 8, 3);
  rect(c, "#05030c", 8, 15, W - 16, 24); // screen bezel
  rect(c, "#0b1020", 10, 17, W - 20, 20);
  screen(c, 10, 17, W - 20, 20);
  rect(c, "#ffffff22", 10, 17, W - 20, 3); // glass glare
  rect(c, "#2a2140", 6, 40, W - 12, 8); // control panel
  rect(c, "#3a2f5a", 6, 40, W - 12, 2);
  rect(c, "#05030c", 12, 42, 3, 5); // joystick
  rect(c, "#d9304a", 11, 41, 5, 3);
  rect(c, btn[0], 22, 43, 4, 3);
  rect(c, btn[1], 28, 43, 4, 3);
  rect(c, btn[0], 34, 43, 3, 3);
  rect(c, "#05030c", 8, 50, W - 16, 7); // coin door
  rect(c, "#f2c36b", 19, 52, 6, 3);
  rect(c, "#05030c", 21, 53, 2, 1);
}

const sSlots: Screen = (c, x, y, w, h) => {
  rect(c, "#2a0a1a", x, y, w, h);
  [0, 1, 2].forEach((i) => {
    const rx = x + 1 + i * 8;
    rect(c, "#fff6e0", rx, y + 3, 7, 14);
    if (i === 0) { rect(c, "#8a5a36", rx + 1, y + 7, 5, 5); rect(c, "#fff6e0", rx + 5, y + 8, 1, 2); }
    if (i === 1) { rect(c, "#d9304a", rx + 1, y + 6, 5, 2); rect(c, "#d9304a", rx + 4, y + 8, 2, 6); }
    if (i === 2) { rect(c, "#d9304a", rx + 1, y + 6, 5, 2); rect(c, "#d9304a", rx + 4, y + 8, 2, 6); }
  });
  rect(c, "#f2c36b", x, y + 10, w, 1);
};
const sMines: Screen = (c, x, y, w, h) => {
  rect(c, "#0f2a1c", x, y, w, h);
  for (let r = 0; r < 4; r++) for (let q = 0; q < 5; q++) rect(c, (r * 5 + q) % 7 === 3 ? "#d9304a" : "#4aa070", x + 1 + q * 5, y + 1 + r * 5, 4, 4);
};
const sMoon: Screen = (c, x, y, w, h) => {
  rect(c, "#0c1030", x, y, w, h);
  for (let i = 0; i < 8; i++) rect(c, "#fff6e0", x + ((i * 7) % w), y + ((i * 5) % h), 1, 1);
  ellipse(c, "#e8e0c0", x + 20, y + 5, 4, 4);
  rect(c, "#fff6e0", x + 3, y + 12, 2, 5); // rocket
  rect(c, "#d9304a", x + 3, y + 11, 2, 1);
  rect(c, "#f2a93b", x + 3, y + 17, 2, 2);
  [0, 1, 2].forEach((i) => rect(c, "#9fb8d8", x + 1 + i * 3, y + 18 - i * 2, 1, 1));
};
const sPenguin: Screen = (c, x, y, w, h) => {
  rect(c, "#173a5a", x, y, w, h);
  rect(c, "#2a6a9a", x, y + 14, w, 6); // icy water
  for (const [tx, ty] of [[1, 10], [9, 10], [17, 10]]) rect(c, "#d8f4ff", x + tx, y + ty, 6, 4); // ice tiles
  rect(c, "#9fd0e8", x + 11, y + 11, 2, 1); // a crack
  rect(c, "#05030c", x + 3, y + 3, 4, 7); // the penguin: dark body, white belly, orange beak
  rect(c, "#fff6e0", x + 4, y + 5, 2, 4);
  rect(c, "#f2a93b", x + 7, y + 4, 1, 1);
};
const sFighter: Screen = (c, x, y, w, h) => {
  rect(c, "#2a1030", x, y, w, h);
  rect(c, "#d9304a", x + 1, y + 1, 9, 2); // health bars
  rect(c, "#f2c36b", x + 12, y + 1, 9, 2);
  rect(c, "#4a3a5a", x, y + 16, w, 4);
  rect(c, "#f4f4f4", x + 3, y + 8, 3, 7); // karate fighter
  rect(c, "#f1c27d", x + 3, y + 5, 3, 3);
  rect(c, "#f1c27d", x + 6, y + 9, 3, 1);
  rect(c, "#3a5fd9", x + 17, y + 8, 3, 7); // rival
  rect(c, "#8a6446", x + 17, y + 5, 3, 3);
  rect(c, "#ff8a3a", x + 10, y + 9, 2, 2); // fireball
};
const sRacer: Screen = (c, x, y, w, h) => {
  rect(c, "#1a2a1a", x, y, w, h);
  rect(c, "#3a3a4a", x + 3, y + 2, 4, 16); // a bend of road
  rect(c, "#3a3a4a", x + 3, y + 2, 16, 4);
  rect(c, "#3a3a4a", x + 15, y + 2, 4, 16);
  rect(c, "#fff6e0", x + 5, y + 3, 1, 1);
  rect(c, "#58e1ff", x + 4, y + 10, 2, 3);
  rect(c, "#f2a93b", x + 16, y + 9, 2, 3);
};
const sBeat: Screen = (c, x, y, w, h) => {
  rect(c, "#1a0a2a", x, y, w, h);
  [[0, "#ff5fa8", 4], [1, "#58e1ff", 9], [2, "#7fe0a9", 6], [3, "#f2c36b", 12]].forEach(([i, col, ay]) => {
    rect(c, "#2a1a3a", x + 1 + (i as number) * 5, y, 4, h);
    rect(c, col as string, x + 1 + (i as number) * 5, y + (ay as number), 4, 3);
  });
  rect(c, "#fff6e0", x, y + 16, w, 1); // the hit line
};
const sInvaders: Screen = (c, x, y, w, h) => {
  rect(c, "#0b1a10", x, y, w, h);
  for (let r = 0; r < 2; r++) for (let q = 0; q < 3; q++) {
    const ix = x + 2 + q * 8;
    const iy = y + 2 + r * 6;
    rect(c, "#7fe0a9", ix, iy, 5, 3);
    rect(c, "#7fe0a9", ix + 1, iy - 1, 3, 1);
    rect(c, "#7fe0a9", ix, iy + 3, 1, 1);
    rect(c, "#7fe0a9", ix + 4, iy + 3, 1, 1);
  }
  rect(c, "#fff6e0", x + 10, y + 16, 3, 2);
};

// ---------------------------------------------------------------------------- kiosk, elevator

function drawKiosk(c: Ctx) {
  ellipse(c, "#00000055", 28, 66, 24, 3);
  rect(c, "#0a0716", 4, 2, 48, 66);
  rect(c, "#2a1a3e", 6, 6, 44, 60);
  rect(c, NEON.pink, 6, 6, 2, 60);
  rect(c, NEON.pink, 48, 6, 2, 60);
  rect(c, NEON.pinkDim, 8, 6, 1, 60);
  rect(c, NEON.pink, 10, 2, 36, 7); // marquee
  rect(c, "#fff6e0", 14, 4, 8, 3);
  rect(c, "#fff6e0", 25, 4, 6, 3);
  rect(c, "#fff6e0", 34, 4, 8, 3);
  rect(c, "#05030c", 10, 12, 36, 32); // screen
  rect(c, "#0b1020", 12, 14, 32, 28);
  // trophy + three bars
  rect(c, "#f2c36b", 24, 16, 8, 6);
  rect(c, "#f2c36b", 22, 17, 2, 3);
  rect(c, "#f2c36b", 32, 17, 2, 3);
  rect(c, "#f2c36b", 27, 22, 2, 4);
  rect(c, "#f2c36b", 24, 26, 8, 2);
  [[14, "#d9304a", 8], [24, "#58e1ff", 12], [34, "#7fe0a9", 6]].forEach(([bx, col, bh]) => rect(c, col as string, bx as number, 42 - (bh as number), 8, bh as number));
  rect(c, "#ffffff22", 12, 14, 32, 3);
  rect(c, "#3a2f5a", 10, 46, 36, 10); // ledge + keypad
  [0, 1, 2, 3, 4, 5].forEach((i) => rect(c, i % 2 ? "#f2c36b" : "#58e1ff", 14 + (i % 3) * 8, 48 + Math.floor(i / 3) * 4, 5, 3));
  rect(c, "#0a0716", 12, 58, 32, 8);
}

function drawElevator(dir: "up" | "down") {
  return (c: Ctx) => {
    ellipse(c, "#00000055", 28, 70, 24, 3);
    rect(c, "#0a0716", 2, 2, 52, 70);
    rect(c, "#8a8aa0", 4, 4, 48, 66); // frame
    rect(c, "#b4b4c8", 4, 4, 48, 2);
    rect(c, "#05030c", 8, 16, 40, 54); // opening
    rect(c, "#c8c8d8", 10, 18, 18, 52); // doors
    rect(c, "#a0a0b8", 28, 18, 18, 52);
    rect(c, "#8a8aa0", 27, 18, 2, 52);
    rect(c, "#e0e0f0", 12, 20, 2, 46);
    rect(c, "#e0e0f0", 30, 20, 2, 46);
    // arrow sign above, in neon
    rect(c, "#05030c", 14, 5, 28, 10);
    const col = dir === "up" ? NEON.green : NEON.gold;
    if (dir === "up") { rect(c, col, 27, 6, 2, 8); rect(c, col, 25, 8, 6, 1); rect(c, col, 23, 10, 10, 1); }
    else { rect(c, col, 27, 6, 2, 8); rect(c, col, 25, 12, 6, 1); rect(c, col, 23, 10, 10, 1); }
    rect(c, "#05030c", 49, 34, 3, 8); // call button
    rect(c, "#d9304a", 50, 36, 1, 2);
  };
}

// ---------------------------------------------------------------------------- tables, stool

const FELT = "#1f6b4a";
const FELT_HI = "#2a8560";

function drawCard(c: Ctx, x: number, y: number, red: boolean, back = false) {
  rect(c, back ? "#3a5fd9" : "#fff6e0", x, y, 7, 10);
  rect(c, "#1f140d", x, y, 7, 1);
  rect(c, "#1f140d", x, y + 9, 7, 1);
  rect(c, "#1f140d", x, y, 1, 10);
  rect(c, "#1f140d", x + 6, y, 1, 10);
  if (!back) rect(c, red ? "#d9304a" : "#1f140d", x + 2, y + 3, 3, 3);
}
function drawChips(c: Ctx, x: number, y: number, cols: string[]) {
  cols.forEach((col, i) => {
    rect(c, "#05030c", x - 1, y - i * 2 - 1, 9, 4);
    rect(c, col, x, y - i * 2, 7, 2);
    rect(c, "#fff6e0", x + 3, y - i * 2, 1, 1);
  });
}

function drawBlackjack(c: Ctx) {
  const W = BLACKJACK.w;
  ellipse(c, "#00000055", W / 2, 80, W / 2 - 2, 5);
  // the dealer behind the table: head, white shirt, black vest, red bow tie
  rect(c, "#f1c27d", 74, 0, 12, 11);
  rect(c, "#2a1a11", 74, 0, 12, 3);
  rect(c, "#1f140d", 77, 5, 2, 2);
  rect(c, "#1f140d", 82, 5, 2, 2);
  rect(c, "#fff6e0", 70, 11, 20, 12);
  rect(c, "#1f140d", 70, 14, 7, 9);
  rect(c, "#1f140d", 83, 14, 7, 9);
  rect(c, "#d9304a", 77, 12, 6, 3);
  // table: half-moon of felt in a wooden rim
  rect(c, "#33200f", 0, 24, W, 8);
  ellipse(c, "#5a3a22", W / 2, 24, W / 2, 14);
  rect(c, "#33200f", 0, 24, W, 44);
  rect(c, "#5a3a22", 0, 24, W, 40);
  ellipse(c, "#5a3a22", W / 2, 64, W / 2, 6);
  rect(c, "#33200f", 4, 62, W - 8, 8);
  rect(c, FELT, 6, 26, W - 12, 36);
  ellipse(c, FELT, W / 2, 62, W / 2 - 6, 5);
  rect(c, FELT_HI, 6, 26, W - 12, 2);
  // betting arcs for the four seats + a "BLACKJACK PAYS 3 TO 2" gold line
  for (let i = 0; i < 4; i++) {
    const cx = 20 + i * 40;
    ellipse(c, "#f2c36b", cx, 50, 9, 6);
    ellipse(c, FELT, cx, 50, 7, 4);
  }
  rect(c, "#f2c36b", 28, 34, 104, 1);
  rect(c, "#f2c36b", 50, 38, 60, 2);
  // dealer's cards + chip rack + a couple of stacks
  drawCard(c, 68, 29, false, true);
  drawCard(c, 77, 29, true);
  rect(c, "#05030c", 108, 28, 26, 7);
  [0, 1, 2, 3, 4].forEach((i) => rect(c, ["#d9304a", "#3a5fd9", "#7fe0a9", "#f2c36b", "#fff6e0"][i], 110 + i * 5, 29, 4, 5));
  drawChips(c, 14, 52, ["#d9304a", "#fff6e0"]);
  drawChips(c, 94, 54, ["#3a5fd9", "#3a5fd9", "#f2c36b"]);
}

function drawRoulette(c: Ctx) {
  const W = ROULETTE.w;
  ellipse(c, "#00000055", W / 2, 90, W / 2 - 2, 5);
  rect(c, "#33200f", 0, 22, W, 52);
  rect(c, "#5a3a22", 0, 20, W, 50);
  rect(c, "#33200f", 4, 68, W - 8, 8);
  rect(c, FELT, 5, 23, W - 10, 44);
  rect(c, FELT_HI, 5, 23, W - 10, 2);
  // the wheel: a bowl with red/black pockets and a gold hub
  ellipse(c, "#33200f", 40, 44, 32, 24);
  ellipse(c, "#5a3a22", 40, 43, 30, 22);
  ellipse(c, "#1f140d", 40, 43, 25, 18);
  for (let a = 0; a < 20; a++) {
    const ang = (a / 20) * Math.PI * 2;
    const px = Math.round(40 + Math.cos(ang) * 20);
    const py = Math.round(43 + Math.sin(ang) * 14);
    rect(c, a % 2 ? "#d9304a" : "#1f140d", px - 2, py - 1, 4, 3);
    if (a === 0) rect(c, FELT_HI, px - 2, py - 1, 4, 3);
  }
  ellipse(c, "#8a5a36", 40, 43, 11, 7);
  ellipse(c, "#f2c36b", 40, 43, 5, 3);
  rect(c, "#fff6e0", 56, 36, 2, 2); // the ball
  // the betting grid
  rect(c, "#05030c", 80, 28, 104, 34);
  for (let r = 0; r < 3; r++) for (let q = 0; q < 12; q++) rect(c, (q + r * 3) % 3 === 0 ? "#1f140d" : "#d9304a", 82 + q * 8, 30 + r * 9, 7, 8);
  rect(c, "#2a8560", 82, 57, 100, 3);
  rect(c, "#fff6e0", 82, 57, 24, 1);
  drawChips(c, 150, 66, ["#7fe0a9", "#d9304a", "#fff6e0"]);
  drawChips(c, 70, 66, ["#3a5fd9", "#f2c36b"]);
  drawCard(c, 118, 3, true);
}

function drawPoker(c: Ctx) {
  const W = POKER.w;
  ellipse(c, "#00000055", W / 2, 94, W / 2 - 2, 5);
  rect(c, "#33200f", 4, 24, W - 8, 66); // legs/apron
  rect(c, "#5a3a22", 0, 12, W, 70); // padded rail
  rect(c, "#05030c", 0, 12, W, 2);
  rect(c, "#3a2412", 6, 18, W - 12, 58);
  rect(c, FELT, 10, 20, W - 20, 54); // felt
  rect(c, FELT_HI, 10, 20, W - 20, 2);
  for (let i = 0; i < 5; i++) { rect(c, "#1a5a3c", 56 + i * 26, 38, 22, 14); rect(c, "#2a8560", 56 + i * 26, 38, 22, 1); } // the five board slots
  drawCard(c, 90, 40, true);
  drawCard(c, 116, 40, false);
  drawCard(c, 142, 40, true, true);
  drawChips(c, 28, 66, ["#d9304a", "#fff6e0", "#3a5fd9"]);
  drawChips(c, W - 40, 66, ["#7fe0a9", "#f2c36b"]);
  rect(c, "#f2c36b", W / 2 - 10, 60, 20, 3); // the pot ring
}

function drawPool(c: Ctx) {
  const W = POOL_TABLE.w;
  const H = POOL_TABLE.h;
  ellipse(c, "#00000055", W / 2, H - 6, W / 2 - 2, 5);
  rect(c, "#2a1810", 8, 70, 10, 52); // legs
  rect(c, "#2a1810", W - 18, 70, 10, 52);
  rect(c, "#05030c", 0, 8, W, 74);
  rect(c, "#6a4326", 1, 9, W - 2, 72); // wooden rail
  rect(c, "#8a5a36", 1, 9, W - 2, 3);
  rect(c, "#3a2412", 1, 76, W - 2, 5);
  rect(c, "#1f4a8a", 12, 20, W - 24, 52); // blue felt (so it is not mistaken for the poker table)
  rect(c, "#2a62b0", 12, 20, W - 24, 2);
  for (const [px, py] of [[10, 18], [W / 2 - 4, 16], [W - 18, 18], [10, 66], [W / 2 - 4, 68], [W - 18, 66]]) ellipse(c, "#05030c", px + 4, py + 4, 5, 4);
  const balls = ["#fff6e0", "#f2c36b", "#3a5fd9", "#d9304a", "#7a3ad9", "#f28fad", "#2a8560", "#05030c"];
  balls.forEach((col, i) => { const bx = 150 + (i % 4) * 10 + (i > 3 ? 5 : 0); const by = 38 + Math.floor(i / 4) * 9 + (i % 2); ellipse(c, "#00000055", bx + 1, by + 2, 4, 2); ellipse(c, col, bx, by, 4, 4); rect(c, "#ffffff88", bx - 2, by - 2, 2, 2); });
  ellipse(c, "#fff6e0", 62, 46, 4, 4);
  rect(c, "#8a5a36", 20, 30, 38, 2); // a cue lying on the felt
  rect(c, "#f2c36b", 20, 30, 4, 2);
}

function drawStool(c: Ctx) {
  rect(c, "#05030c", 4, 0, 8, 5);
  ellipse(c, "#d9304a", 8, 4, 6, 3);
  ellipse(c, "#ff7a8a", 8, 3, 4, 1);
  rect(c, "#8a8aa0", 7, 7, 2, 7);
  rect(c, "#555570", 3, 14, 10, 2);
}

// ---------------------------------------------------------------------------- build

export function buildArcadeTextures(scene: Phaser.Scene) {
  make(scene, "arc_bg", WORLD_W, WORLD_H, drawBackground);
  make(scene, "cab_slots", 44, 60, (c) => cabinet(c, "#5a1a3a", "#f2c36b", "#d9304a", sSlots, ["#f2c36b", "#58e1ff"]));
  make(scene, "cab_mines", 44, 60, (c) => cabinet(c, "#143a2a", "#7fe0a9", "#1f6b4a", sMines, ["#7fe0a9", "#d9304a"]));
  make(scene, "cab_moon", 44, 60, (c) => cabinet(c, "#1a2050", "#9fb8d8", "#3a5fd9", sMoon, ["#58e1ff", "#f2c36b"]));
  make(scene, "cab_penguin", 44, 60, (c) => cabinet(c, "#14405a", "#58e1ff", "#256e8c", sPenguin, ["#fff6e0", "#f2a93b"]));
  make(scene, "cab_fighter", 44, 60, (c) => cabinet(c, "#501a24", "#d9304a", "#9a2d3a", sFighter, ["#d9304a", "#f2c36b"]));
  make(scene, "cab_racer", 44, 60, (c) => cabinet(c, "#50381a", "#f2a93b", "#9a6a2d", sRacer, ["#58e1ff", "#d9304a"]));
  make(scene, "cab_beat", 44, 60, (c) => cabinet(c, "#3a1a50", "#ff5fa8", "#7a2d7a", sBeat, ["#58e1ff", "#7fe0a9"]));
  make(scene, "cab_deco0", 44, 60, (c) => cabinet(c, "#3a1a50", "#9b5de5", "#7a2d9a", sInvaders, ["#7fe0a9", "#ff5fa8"]));
  make(scene, "kiosk", 56, 68, drawKiosk);
  make(scene, "elevator_up", 56, 72, drawElevator("up"));
  make(scene, "elevator_down", 56, 72, drawElevator("down"));
  make(scene, "bj_table", BLACKJACK.w, BLACKJACK.h, drawBlackjack);
  make(scene, "rt_table", ROULETTE.w, ROULETTE.h, drawRoulette);
  make(scene, "poker_table", POKER.w, POKER.h, drawPoker);
  make(scene, "pool_table", POOL_TABLE.w, POOL_TABLE.h, drawPool);
  make(scene, "stool", 16, 16, drawStool);
}
