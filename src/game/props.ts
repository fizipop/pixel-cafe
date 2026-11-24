import * as Phaser from "phaser";
import { ellipse, make, rect, type Ctx } from "./art";

// Textures for the Phase 3.5 props: jukebox, cafe cat, guestbook, window skies, rain drops.
// (All drawn in code, same as the rest of the art.)

export const JUKEBOX = { w: 32, h: 44 };
export const CAT = { w: 16, h: 14 };
export const SKY = { w: 96, h: 58 };

function drawJukebox(c: Ctx) {
  rect(c, "#2a1a11", 2, 6, 28, 38);
  rect(c, "#2a1a11", 6, 2, 20, 6);
  rect(c, "#2a1a11", 10, 0, 12, 3);
  rect(c, "#8a4a26", 4, 8, 24, 34);
  rect(c, "#8a4a26", 8, 4, 16, 5);
  rect(c, "#8a4a26", 11, 2, 10, 3);
  rect(c, "#b0653a", 4, 8, 2, 34); // edge highlight
  // lit glass window with a record inside
  rect(c, "#1f140d", 7, 9, 18, 17);
  rect(c, "#f2c36b", 8, 10, 16, 15);
  rect(c, "#f7e2a6", 9, 11, 7, 4);
  rect(c, "#2a2a33", 12, 15, 9, 9);
  rect(c, "#c8438f", 15, 18, 3, 3);
  rect(c, "#55556a", 13, 16, 2, 1);
  // coloured light strips
  rect(c, "#d9304a", 5, 9, 2, 17);
  rect(c, "#7fc8a9", 25, 9, 2, 17);
  rect(c, "#f2a93b", 5, 26, 22, 1);
  // chrome control panel with buttons
  rect(c, "#d9c8a0", 8, 28, 16, 6);
  rect(c, "#8a7a6a", 8, 33, 16, 1);
  [10, 14, 18, 22].forEach((x, i) => rect(c, ["#d9304a", "#f2a93b", "#7fc8a9", "#9fb8d8"][i], x, 30, 2, 2));
  // speaker grille
  rect(c, "#2a1a11", 8, 36, 16, 6);
  for (let i = 0; i < 3; i++) rect(c, "#5a3a22", 9, 37 + i * 2, 14, 1);
  // feet
  rect(c, "#2a1a11", 3, 42, 6, 2);
  rect(c, "#2a1a11", 23, 42, 6, 2);
}

// ----------------------------------------------------------------- the cat

type Px = [number, number, number, number, string];

const FUR = "#e0884a";
const STRIPE = "#b8602a";
const BELLY = "#f4e4c1";
const DARK = "#1f140d";
const PINK = "#f28fad";

function catHead(c: Ctx, x: number, y: number) {
  rect(c, FUR, x, y + 1, 6, 5);
  rect(c, FUR, x, y, 1, 2); // ears
  rect(c, FUR, x + 5, y, 1, 2);
  rect(c, PINK, x + 1, y + 1, 1, 1);
  rect(c, STRIPE, x + 2, y + 1, 2, 1);
  rect(c, DARK, x + 1, y + 3, 1, 1); // eyes
  rect(c, DARK, x + 4, y + 3, 1, 1);
  rect(c, PINK, x + 3, y + 4, 1, 1); // nose
}

function paint(c: Ctx, parts: Px[]) {
  for (const [x, y, w, h, col] of parts) rect(c, col, x, y, w, h);
}

function drawCatWalk(legs: 0 | 1) {
  return (c: Ctx) => {
    // tail (up), body, belly, stripes, legs
    paint(c, [[0, 3, 1, 4, STRIPE], [1, 2, 1, 2, FUR]]);
    paint(c, [[1, 6, 9, 5, FUR], [2, 9, 7, 2, BELLY], [3, 6, 1, 3, STRIPE], [6, 6, 1, 3, STRIPE]]);
    catHead(c, 9, 3);
    const a = legs ? 2 : 3;
    const b = legs ? 8 : 7;
    paint(c, [[a, 11, 2, 3, FUR], [b, 11, 2, 3, FUR], [a + 2 - 0, 12, 1, 2, STRIPE], [b + 2, 12, 1, 2, STRIPE]]);
  };
}

function drawCatSit(c: Ctx) {
  paint(c, [[1, 9, 2, 5, STRIPE], [2, 12, 3, 2, STRIPE]]); // tail wrapped round
  paint(c, [[3, 6, 8, 8, FUR], [5, 9, 4, 5, BELLY], [4, 6, 1, 3, STRIPE], [8, 6, 1, 3, STRIPE]]);
  catHead(c, 5, 0);
  paint(c, [[3, 13, 3, 1, STRIPE], [8, 13, 3, 1, STRIPE]]);
}

function drawCatSleep(c: Ctx) {
  paint(c, [[1, 8, 13, 5, FUR], [2, 11, 11, 2, BELLY], [3, 8, 1, 3, STRIPE], [6, 8, 1, 3, STRIPE], [9, 8, 1, 3, STRIPE]]);
  paint(c, [[0, 11, 4, 3, STRIPE]]); // tail curled around the front
  paint(c, [[10, 7, 5, 5, FUR], [10, 6, 1, 2, FUR], [14, 6, 1, 2, FUR], [11, 10, 3, 1, DARK], [12, 11, 1, 1, PINK]]);
  paint(c, [[2, 13, 12, 1, "#00000030"]]);
}

// --------------------------------------------------------------- the window skies

function sky(top: string, bottom: string, draw: (c: Ctx) => void) {
  return (c: Ctx) => {
    const g = c.createLinearGradient(0, 0, 0, SKY.h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    c.fillStyle = g;
    c.fillRect(0, 0, SKY.w, SKY.h);
    draw(c);
    rect(c, "#2a1a11", 46, 0, 4, SKY.h); // window bars
    rect(c, "#2a1a11", 0, 26, SKY.w, 4);
  };
}

// ------------------------------------------------- Phase 5: private table, fashion stand, crown, padlock

/** The 6-seat private table: a long oval with a candle and a little "reserved" card. */
function drawTableLong(c: Ctx) {
  ellipse(c, "#00000040", 48, 46, 46, 8);
  rect(c, "#4a3222", 20, 34, 8, 16);
  rect(c, "#4a3222", 68, 34, 8, 16);
  rect(c, "#33200f", 12, 48, 24, 4);
  rect(c, "#33200f", 60, 48, 24, 4);
  ellipse(c, "#4a2f4a", 48, 25, 47, 17); // plum-coloured rim so it reads as "private"
  ellipse(c, "#8a6a9a", 48, 22, 47, 17);
  ellipse(c, "#a888b8", 48, 21, 44, 14);
  // candle + two cups
  rect(c, "#fff6e0", 46, 14, 4, 7);
  rect(c, "#f2a93b", 47, 11, 2, 3);
  rect(c, "#f2c36b", 47, 10, 2, 1);
  ellipse(c, "#f4e4c1", 28, 23, 5, 3);
  rect(c, "#fff6e0", 26, 18, 5, 5);
  ellipse(c, "#f4e4c1", 68, 23, 5, 3);
  rect(c, "#fff6e0", 66, 18, 5, 5);
}

/** Mannequin on a stand with a little star banner: the Fashion Stand. */
function drawOutfitStand(c: Ctx) {
  ellipse(c, "#00000040", 20, 52, 16, 4);
  rect(c, "#33200f", 8, 48, 24, 4); // base
  rect(c, "#4a2f1d", 10, 46, 20, 3);
  rect(c, "#8a6446", 19, 22, 2, 25); // pole
  // mannequin torso (a plain little top) and head
  rect(c, "#e8d8b8", 14, 8, 12, 14);
  rect(c, "#d9c8a0", 14, 18, 12, 4);
  rect(c, "#e8d8b8", 11, 9, 3, 6);
  rect(c, "#e8d8b8", 26, 9, 3, 6);
  rect(c, "#e8d8b8", 17, 3, 6, 6);
  rect(c, "#c8438f", 14, 12, 12, 3); // sash
  // banner with a star
  rect(c, "#2a1a11", 2, 0, 1, 12);
  rect(c, "#f2a93b", 3, 1, 8, 9);
  rect(c, "#fff6e0", 6, 3, 2, 5);
  rect(c, "#fff6e0", 4, 5, 6, 1);
  rect(c, "#2a1a11", 30, 0, 1, 10);
  rect(c, "#7fc8a9", 31, 1, 8, 7);
  rect(c, "#fff6e0", 34, 3, 2, 3);
}

function drawCrown(c: Ctx) {
  rect(c, "#8a5a10", 0, 5, 9, 1);
  rect(c, "#f2c36b", 0, 2, 9, 3);
  rect(c, "#f2c36b", 0, 0, 1, 3);
  rect(c, "#f2c36b", 4, 0, 1, 3);
  rect(c, "#f2c36b", 8, 0, 1, 3);
  rect(c, "#fff3a6", 1, 3, 1, 1);
  rect(c, "#d9304a", 4, 3, 1, 1);
  rect(c, "#7fc8a9", 7, 3, 1, 1);
}

function drawLock(c: Ctx) {
  rect(c, "#2a1a11", 2, 0, 6, 6);
  rect(c, "#c8c0b0", 3, 1, 4, 5);
  rect(c, "#2a1a11", 4, 2, 2, 4);
  rect(c, "#2a1a11", 0, 4, 10, 8);
  rect(c, "#f2a93b", 1, 5, 8, 6);
  rect(c, "#2a1a11", 4, 7, 2, 3);
}

export function buildPropTextures(scene: Phaser.Scene) {
  make(scene, "table_long", 96, 56, drawTableLong);
  make(scene, "outfit_stand", 40, 56, drawOutfitStand);
  make(scene, "crown", 9, 6, drawCrown);
  make(scene, "lock_icon", 10, 12, drawLock);
  make(scene, "jukebox", JUKEBOX.w, JUKEBOX.h, drawJukebox);
  make(scene, "cat_walk1", CAT.w, CAT.h, drawCatWalk(0));
  make(scene, "cat_walk2", CAT.w, CAT.h, drawCatWalk(1));
  make(scene, "cat_sit", CAT.w, CAT.h, drawCatSit);
  make(scene, "cat_sleep", CAT.w, CAT.h, drawCatSleep);

  make(scene, "guestbook", 14, 9, (c) => {
    rect(c, "#00000040", 1, 2, 13, 7);
    rect(c, "#6b2a2a", 0, 0, 14, 8); // red leather cover
    rect(c, "#fff6e0", 1, 1, 6, 6);
    rect(c, "#fff6e0", 7, 1, 6, 6);
    rect(c, "#8a6446", 6, 1, 2, 6);
    [2, 4].forEach((y) => { rect(c, "#9a8a7a", 2, y, 4, 1); rect(c, "#9a8a7a", 8, y, 4, 1); });
    rect(c, "#d9304a", 10, 6, 1, 3); // ribbon
  });

  make(scene, "drop", 1, 5, (c) => rect(c, "#b8d4f0", 0, 0, 1, 5));
  make(scene, "mini_note", 5, 7, (c) => {
    rect(c, "#fff6e0", 3, 0, 1, 5);
    rect(c, "#fff6e0", 1, 4, 3, 2);
    rect(c, "#fff6e0", 4, 0, 1, 1);
  });

  make(scene, "sky_rain", SKY.w, SKY.h, sky("#4b5a7a", "#25304c", (c) => {
    rect(c, "#5d6c8c", 6, 6, 30, 8);
    rect(c, "#5d6c8c", 14, 3, 20, 6);
    rect(c, "#56668a", 58, 10, 32, 8);
    rect(c, "#56668a", 66, 6, 20, 6);
    rect(c, "#1e2742", 0, 48, SKY.w, 10); // far rooftops in the dark
    for (let x = 4; x < SKY.w; x += 14) rect(c, "#1e2742", x, 44 - ((x * 7) % 9), 9, 12);
    for (let x = 8; x < SKY.w; x += 22) rect(c, "#f2c36b", x, 48, 2, 2); // a few lit windows
  }));
  make(scene, "sky_sun", SKY.w, SKY.h, sky("#8fd0f0", "#f7f2cf", (c) => {
    rect(c, "#fff3a6", 70, 5, 12, 12); // sun
    rect(c, "#fffbd0", 72, 7, 8, 8);
    rect(c, "#ffffff", 8, 8, 26, 6);
    rect(c, "#ffffff", 14, 5, 14, 5);
    rect(c, "#ffffff", 40, 16, 20, 5);
    rect(c, "#9fd89a", 0, 50, SKY.w, 8); // trees and hills
    for (let x = 2; x < SKY.w; x += 16) rect(c, "#6fbf74", x, 44 - ((x * 5) % 7), 11, 14);
  }));
}
