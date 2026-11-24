import * as Phaser from "phaser";
import { ellipse, make, rect, type Ctx } from "./art";
import { WALL_H, WORLD_H, WORLD_W } from "./constants";
import { FLOOR3_X } from "@/shared/floors";
import { LIGHT_STRANDS, LOGS, strandPoints } from "./rooftopLayout";

// Floor 3 art, drawn in code like the rest of the cafe: a weathered wooden deck, a night-city skyline
// behind a glass railing, a stone firepit with logs, a brass telescope, an instant-camera stand, a
// clothesline "Polaroid Wall", planters and strings of fairy lights.

function hash(x: number, y: number, seed = 0) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

const WOOD = ["#5a4636", "#533f31", "#604b3a", "#4d3a2d"];

// ---------------------------------------------------------------------------- the room

function drawSky(c: Ctx) {
  // night sky, lighter toward the horizon where the city glows
  const bands = ["#080b26", "#0a0e2e", "#0d1236", "#11173f", "#171c48", "#1f2252", "#2a2a5c", "#3a3068", "#4a3a70"];
  const bh = Math.ceil(WALL_H / bands.length);
  bands.forEach((col, i) => rect(c, col, 0, i * bh, WORLD_W, bh));
  // faint dithering where two bands meet
  for (let i = 1; i < bands.length; i++) for (let x = 0; x < WORLD_W; x += 2) if (hash(x, i, 9) > 0.5) rect(c, bands[i], x + (i % 2), i * bh - 1, 1, 1);
  // a crescent moon
  ellipse(c, "#f4ead0", 884, 26, 9, 9);
  ellipse(c, "#0b0f30", 889, 23, 8, 8);
  // stars (the twinkling ones are separate sprites added by the scene)
  for (let i = 0; i < 60; i++) rect(c, hash(i, 1, 4) > 0.6 ? "#fff6e0" : "#9fb8d8", Math.floor(hash(i, 2, 4) * WORLD_W), 3 + Math.floor(hash(i, 3, 4) * 38), 1, 1);
}

function skylineLayer(c: Ctx, seed: number, base: number, minH: number, maxH: number, color: string, window: string[], density: number) {
  let x = -4;
  let n = 0;
  while (x < WORLD_W) {
    const w = 18 + Math.floor(hash(n, seed, 1) * 34);
    const h = minH + Math.floor(hash(n, seed, 2) * (maxH - minH));
    rect(c, color, x, base - h, w, h);
    if (hash(n, seed, 3) > 0.6) rect(c, color, x + Math.floor(w / 2) - 1, base - h - 7, 2, 7); // antenna
    for (let wy = base - h + 4; wy < base - 3; wy += 5) {
      for (let wx = x + 3; wx < x + w - 3; wx += 5) {
        if (hash(wx, wy, seed) < density) rect(c, window[Math.floor(hash(wx, wy, seed + 5) * window.length)], wx, wy, 2, 2);
      }
    }
    x += w + 1 + Math.floor(hash(n, seed, 4) * 4);
    n++;
  }
}

function drawRailing(c: Ctx) {
  // glass safety railing along the back wall: posts, top rail, translucent panes with a glare
  rect(c, "#0b0e22", 0, WALL_H - 22, WORLD_W, 22);
  for (let x = 0; x < WORLD_W; x += 64) {
    rect(c, "#8b9db3", x + 2, WALL_H - 24, 4, 24); // post
    rect(c, "#c4d3e4", x + 2, WALL_H - 24, 1, 24);
    rect(c, "#9fd0e8", x + 6, WALL_H - 20, 58, 16); // glass pane
    rect(c, "#cfeaf6", x + 10, WALL_H - 19, 3, 14); // glare strips
    rect(c, "#cfeaf6", x + 16, WALL_H - 19, 1, 14);
  }
  rect(c, "#8b9db3", 0, WALL_H - 26, WORLD_W, 3); // handrail
  rect(c, "#c4d3e4", 0, WALL_H - 26, WORLD_W, 1);
  rect(c, "#4a5668", 0, WALL_H - 3, WORLD_W, 3); // base channel
}

function drawDeck(c: Ctx) {
  for (let row = 0; row < WORLD_H / 32; row++) {
    for (let col = 0; col < WORLD_W / 32; col++) {
      const x = col * 32;
      const y = row * 32;
      const base = WOOD[Math.floor(hash(col, row, 7) * WOOD.length)];
      rect(c, base, x, y, 32, 32);
      // three boards per tile running left-right, with seams, nails and the odd knot
      for (let b = 0; b < 3; b++) {
        const by = y + b * 10 + (b > 0 ? 1 : 0);
        rect(c, "#3b2c21", x, by + 9, 32, 1);
        rect(c, "#6f5a47", x, by, 32, 1);
        const seam = x + 4 + Math.floor(hash(col + b * 3, row, 11) * 24);
        rect(c, "#3b2c21", seam, by, 1, 9);
        rect(c, "#8d7860", x + 2, by + 2, 1, 1);
        rect(c, "#8d7860", x + 29, by + 2, 1, 1);
        if (hash(col, row * 3 + b, 21) > 0.93) { rect(c, "#3b2c21", x + 12, by + 3, 4, 3); rect(c, "#4d3a2d", x + 13, by + 4, 2, 1); }
      }
      rect(c, hash(col, row, 31) > 0.5 ? "#5f4b3b" : "#4a382b", x + Math.floor(hash(col, row, 32) * 28), y + Math.floor(hash(col, row, 33) * 28), 3, 1);
    }
  }
  // a round woven rug under the campfire
  const cx = 520 - 0;
  const cy = 428;
  ellipse(c, "#1b1230", cx, cy, 196, 128);
  ellipse(c, "#6a3a30", cx, cy, 190, 122);
  ellipse(c, "#8a4a38", cx, cy, 176, 112);
  ellipse(c, "#2f3a63", cx, cy, 158, 98);
  ellipse(c, "#3d4a7a", cx, cy, 142, 86);
  ellipse(c, "#c9a46a", cx, cy, 124, 74);
  ellipse(c, "#b08a55", cx, cy, 120, 70);
  ellipse(c, "#5a3a4a", cx, cy, 100, 56);
  ellipse(c, "#6e4658", cx, cy, 96, 52);
  for (let a = 0; a < 48; a++) { // fringe stitches
    const ang = (a / 48) * Math.PI * 2;
    rect(c, a % 2 ? "#f2c36b" : "#d9c9a0", Math.round(cx + Math.cos(ang) * 183), Math.round(cy + Math.sin(ang) * 116), 2, 2);
  }
}

function drawBorders(c: Ctx) {
  // the other three edges: a low glass railing with the dark city beyond
  const edge = (x: number, y: number, w: number, h: number) => {
    rect(c, "#070a1e", x, y, w, h);
    for (let i = 0; i < w * h / 70; i++) rect(c, hash(i, x, 5) > 0.5 ? "#f2c36b" : "#9fd0e8", x + Math.floor(hash(i, 1, x) * w), y + Math.floor(hash(i, 2, y + 3) * h), 1, 1);
  };
  edge(0, WALL_H, 32, WORLD_H - WALL_H);
  edge(WORLD_W - 32, WALL_H, 32, WORLD_H - WALL_H);
  edge(0, WORLD_H - 32, WORLD_W, 32);
  // railing lines on the deck side
  rect(c, "#8b9db3", 29, WALL_H, 3, WORLD_H - WALL_H);
  rect(c, "#c4d3e4", 29, WALL_H, 1, WORLD_H - WALL_H);
  rect(c, "#8b9db3", WORLD_W - 32, WALL_H, 3, WORLD_H - WALL_H);
  rect(c, "#c4d3e4", WORLD_W - 32, WALL_H, 1, WORLD_H - WALL_H);
  rect(c, "#8b9db3", 29, WORLD_H - 32, WORLD_W - 58, 3);
  rect(c, "#c4d3e4", 29, WORLD_H - 32, WORLD_W - 58, 1);
  for (let y = WALL_H + 8; y < WORLD_H - 32; y += 64) { rect(c, "#8b9db3", 26, y, 6, 4); rect(c, "#8b9db3", WORLD_W - 32, y, 6, 4); }
  for (let x = 40; x < WORLD_W - 32; x += 64) rect(c, "#8b9db3", x, WORLD_H - 35, 4, 6);
}

function drawBackground(c: Ctx) {
  drawDeck(c);
  drawSky(c);
  skylineLayer(c, 21, WALL_H - 22, 14, 44, "#1c1a44", ["#4a4a8a", "#6a5a9a", "#f2c36b"], 0.12);
  skylineLayer(c, 22, WALL_H - 22, 10, 34, "#10102c", ["#f2c36b", "#ffe9a0", "#9fd0e8", "#e0884a"], 0.3);
  rect(c, "#7a4a7066", 0, WALL_H - 28, WORLD_W, 6); // haze at street level
  drawRailing(c);
  drawBorders(c);
}

// ---------------------------------------------------------------------------- props

function drawFirepit(c: Ctx) {
  ellipse(c, "#00000066", 30, 44, 30, 6);
  // ring of stones
  const stones = 14;
  for (let i = 0; i < stones; i++) {
    const ang = (i / stones) * Math.PI * 2;
    const x = Math.round(30 + Math.cos(ang) * 24);
    const y = Math.round(32 + Math.sin(ang) * 11);
    rect(c, "#2a2a34", x - 4, y - 3, 9, 8);
    rect(c, i % 2 ? "#8a8a9a" : "#a0a0b0", x - 4, y - 4, 9, 7);
    rect(c, "#c4c4d0", x - 3, y - 4, 4, 2);
  }
  ellipse(c, "#150c08", 30, 31, 20, 8);
  ellipse(c, "#3a1a0c", 30, 31, 17, 6);
  // crossed logs and glowing embers
  rect(c, "#2a1810", 16, 30, 28, 5);
  rect(c, "#4d2e18", 16, 29, 28, 3);
  rect(c, "#2a1810", 22, 26, 5, 14);
  rect(c, "#4d2e18", 22, 26, 3, 14);
  rect(c, "#2a1810", 34, 27, 5, 13);
  rect(c, "#4d2e18", 34, 27, 3, 13);
  for (let i = 0; i < 9; i++) rect(c, i % 3 ? "#f2a93b" : "#ff6a2b", 19 + Math.floor(hash(i, 1, 6) * 22), 29 + Math.floor(hash(i, 2, 6) * 6), 2, 1);
}

function drawFlame(frame: number) {
  return (c: Ctx) => {
    // three layered tongues; each frame leans and flickers a little differently
    const lean = [0, 1, -1][frame];
    const tall = [26, 23, 25][frame];
    const tongue = (cx: number, h: number, w: number, outer: string, mid: string, inner: string) => {
      for (let y = 0; y < h; y++) {
        const t = y / h;
        const half = Math.max(1, Math.round(w * Math.sin(Math.PI * Math.pow(1 - t, 0.7) * 0.5 + 0.35) * (1 - t * 0.5)));
        const x = cx + Math.round(lean * Math.sin(t * 2.4) * 2 * (1 - t));
        const yy = 29 - y;
        rect(c, outer, x - half, yy, half * 2, 1);
        if (half > 2) rect(c, mid, x - half + 2, yy, (half - 2) * 2, 1);
        if (half > 4 && t < 0.6) rect(c, inner, x - half + 4, yy, (half - 4) * 2, 1);
      }
    };
    tongue(12, tall, 9, "#d9501e", "#f2872b", "#ffd36b");
    tongue(5, tall - 9, 5, "#e0641e", "#f2a93b", "#ffe9a0");
    tongue(19, tall - 12, 5, "#e0641e", "#f2a93b", "#ffe9a0");
  };
}

function drawLogH(c: Ctx) {
  const W = 160;
  const H = 18;
  ellipse(c, "#00000044", W / 2, 17, W / 2 - 2, 2);
  rect(c, "#2a1a10", 8, 2, W - 16, 14);
  rect(c, "#6a4326", 8, 2, W - 16, 12);
  rect(c, "#8a5a36", 8, 2, W - 16, 3); // lit top
  rect(c, "#4d2e18", 8, 12, W - 16, 3);
  for (let x = 16; x < W - 16; x += 22) rect(c, "#4d2e18", x, 5 + ((x / 22) % 3), 9, 1); // bark grooves
  for (const ex of [4, W - 12]) { // end rings
    ellipse(c, "#2a1a10", ex + 4, 8, 6, 7);
    ellipse(c, "#c9a06a", ex + 4, 8, 5, 6);
    ellipse(c, "#a67c48", ex + 4, 8, 3, 4);
    ellipse(c, "#8a5a36", ex + 4, 8, 1, 2);
  }
  rect(c, "#4f8a4a", 40, 2, 8, 2); // moss
  rect(c, "#3a6a38", 41, 3, 4, 1);
  void H;
}

function drawLogV(c: Ctx) {
  const W = 18;
  const H = 96;
  ellipse(c, "#00000044", 9, H - 2, 8, 2);
  rect(c, "#2a1a10", 2, 8, 14, H - 16);
  rect(c, "#6a4326", 2, 8, 12, H - 16);
  rect(c, "#8a5a36", 2, 8, 3, H - 16);
  rect(c, "#4d2e18", 12, 8, 3, H - 16);
  for (let y = 16; y < H - 16; y += 18) rect(c, "#4d2e18", 5 + ((y / 18) % 3), y, 1, 8);
  for (const ey of [4, H - 12]) {
    ellipse(c, "#2a1a10", 9, ey + 4, 8, 6);
    ellipse(c, "#c9a06a", 9, ey + 4, 7, 5);
    ellipse(c, "#a67c48", 9, ey + 4, 4, 3);
    ellipse(c, "#8a5a36", 9, ey + 4, 2, 1);
  }
  void W;
}

function drawTelescope(c: Ctx) {
  const BRASS = "#c9972f";
  const BRASS_HI = "#f2d27a";
  const BRASS_LO = "#7a561a";
  ellipse(c, "#00000055", 24, 60, 18, 3);
  // tripod legs
  const leg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) {
      const x = Math.round(x0 + ((x1 - x0) * i) / n);
      const y = Math.round(y0 + ((y1 - y0) * i) / n);
      rect(c, "#3a2a1c", x - 1, y, 3, 1);
      rect(c, "#6a4a2c", x - 1, y, 1, 1);
    }
  };
  leg(24, 34, 9, 60);
  leg(24, 34, 39, 60);
  leg(24, 34, 24, 58);
  rect(c, BRASS_LO, 21, 33, 7, 4); // pivot
  rect(c, BRASS, 21, 32, 7, 3);
  // the tube, tilted up toward the right
  const tube = (t0: number, t1: number, r: number, col: string, hi: string) => {
    for (let t = t0; t <= t1; t += 0.5) {
      const x = Math.round(24 + t * 0.78);
      const y = Math.round(32 - t * 0.62);
      rect(c, col, x - r, y - r, r * 2 + 1, r * 2 + 1);
      rect(c, hi, x - r, y - r, r + 1, 1);
    }
  };
  tube(-6, 8, 3, BRASS_LO, BRASS);
  tube(8, 30, 4, BRASS, BRASS_HI);
  tube(30, 40, 3, BRASS_LO, BRASS);
  for (const t of [8, 19, 30]) { // bands
    const x = Math.round(24 + t * 0.78);
    const y = Math.round(32 - t * 0.62);
    rect(c, "#5a3d10", x - 4, y - 4, 2, 8);
  }
  // lens cap glint at the open end and the eyepiece at the lower end
  rect(c, "#9fd0e8", 41, 4, 3, 3);
  rect(c, "#fff6e0", 42, 4, 1, 1);
  rect(c, "#2a1a10", 19, 37, 5, 3);
}

function drawPhotoStand(c: Ctx) {
  ellipse(c, "#00000055", 26, 64, 20, 3);
  const leg = (x0: number, y0: number, x1: number, y1: number) => {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= n; i++) rect(c, "#2f2f3c", Math.round(x0 + ((x1 - x0) * i) / n) - 1, Math.round(y0 + ((y1 - y0) * i) / n), 3, 1);
  };
  leg(26, 36, 10, 64);
  leg(26, 36, 42, 64);
  leg(26, 36, 26, 62);
  rect(c, "#8a8aa0", 22, 33, 9, 4);
  // instant camera: cream body, rainbow stripe, big lens, flash, little photo sliding out
  rect(c, "#0a0716", 4, 6, 44, 30);
  rect(c, "#f4e4c1", 5, 7, 42, 28);
  rect(c, "#fff6e0", 5, 7, 42, 3);
  rect(c, "#d9304a", 5, 12, 42, 2);
  rect(c, "#f2a93b", 5, 14, 42, 2);
  rect(c, "#7fe0a9", 5, 16, 42, 2);
  rect(c, "#58a6e0", 5, 18, 42, 2);
  ellipse(c, "#0a0716", 26, 27, 9, 7);
  ellipse(c, "#3a3a52", 26, 27, 7, 5);
  ellipse(c, "#58a6e0", 26, 27, 5, 4);
  rect(c, "#fff6e0", 24, 25, 2, 2);
  rect(c, "#2a2a3a", 8, 22, 8, 8); // flash window
  rect(c, "#fff3a6", 9, 23, 6, 6);
  rect(c, "#d9304a", 40, 24, 4, 4); // shutter button
  rect(c, "#fff6e0", 10, 2, 16, 6); // the photo peeking out of the top
  rect(c, "#9fb8d8", 12, 3, 12, 3);
  rect(c, "#0a0716", 36, 3, 8, 3); // viewfinder
}

function drawPolaroidWall(c: Ctx) {
  const W = 128;
  const H = 76;
  rect(c, "#0a0716", 0, 2, W, H - 14);
  rect(c, "#6a4a30", 2, 4, W - 4, H - 18); // fence boards
  for (let x = 2; x < W - 2; x += 16) { rect(c, "#8a6844", x, 4, 14, H - 18); rect(c, "#4d3622", x + 14, 4, 2, H - 18); rect(c, "#a0805a", x + 1, 5, 1, H - 20); }
  rect(c, "#3b2a1c", 0, 0, W, 5); // top rail
  rect(c, "#8a6844", 0, 0, W, 2);
  rect(c, "#3b2a1c", 0, H - 15, W, 4); // bottom rail
  // clothesline with pinned Polaroids
  for (let x = 6; x < W - 6; x++) rect(c, "#d9c9a0", x, 16 + Math.round(Math.sin(((x - 6) / (W - 12)) * Math.PI) * 5), 1, 1);
  const tints = ["#f28fad", "#7fc8a9", "#f2c36b", "#9fb8d8", "#c9a0e8", "#f0a070"];
  for (let i = 0; i < 6; i++) {
    const x = 12 + i * 19;
    const y = 18 + Math.round(Math.sin(((x - 6) / (W - 12)) * Math.PI) * 5);
    const tilt = i % 2 ? 1 : 0;
    rect(c, "#0a0716", x - 1, y, 14, 18);
    rect(c, "#fff6e0", x, y + 1, 12, 16);
    rect(c, tints[i], x + 1, y + 2, 10, 9);
    rect(c, "#1c2050", x + 1, y + 6 - tilt, 10, 5); // night sky strip in each photo
    rect(c, "#fff6e0", x + 3, y + 7, 1, 1);
    rect(c, "#8a6a4a", x + 4, y - 1, 3, 3); // clothespin
    rect(c, "#d9c9a0", x + 5, y - 1, 1, 3);
  }
  ellipse(c, "#00000044", W / 2, H - 8, W / 2 - 4, 3);
}

function drawPlanter(c: Ctx) {
  ellipse(c, "#00000055", 14, 41, 12, 3);
  rect(c, "#0a0716", 5, 24, 18, 16);
  rect(c, "#b8613a", 6, 24, 16, 15); // terracotta pot
  rect(c, "#d9784a", 6, 24, 16, 3);
  rect(c, "#8a4528", 18, 26, 4, 13);
  rect(c, "#8a4528", 6, 37, 16, 2);
  rect(c, "#3a2418", 7, 25, 14, 2);
  for (let i = 0; i < 26; i++) { // leafy bush
    const x = 14 + Math.round((hash(i, 1, 8) - 0.5) * 22);
    const y = 14 + Math.round((hash(i, 2, 8) - 0.5) * 22);
    ellipse(c, hash(i, 3, 8) > 0.5 ? "#2f7a4a" : "#3f9a5a", x, y, 4, 3);
  }
  for (let i = 0; i < 9; i++) rect(c, "#5ac07a", 6 + Math.round(hash(i, 4, 8) * 16), 6 + Math.round(hash(i, 5, 8) * 16), 2, 1);
  for (const [x, y] of [[9, 12], [19, 9], [14, 17], [22, 16]]) { rect(c, "#f28fad", x, y, 3, 3); rect(c, "#fff6e0", x + 1, y + 1, 1, 1); }
}

function drawPost(c: Ctx) {
  rect(c, "#0a0716", 1, 0, 8, 72);
  rect(c, "#6a4a30", 2, 2, 6, 68);
  rect(c, "#8a6844", 2, 2, 2, 68);
  rect(c, "#3b2a1c", 6, 2, 2, 68);
  rect(c, "#f2c36b", 1, 0, 8, 3); // lantern cap
  rect(c, "#2a1810", 0, 66, 10, 6); // base plate
}

function drawShootingStar(c: Ctx) {
  for (let i = 0; i < 28; i++) rect(c, `rgba(255,246,224,${(i / 28) * 0.9})`, i, 1 + Math.round((28 - i) * 0.05), 1, 1);
  rect(c, "#ffffff", 28, 1, 2, 2);
}

/** The strings of fairy lights are baked into one see-through picture (wire + bulbs); the scene adds the twinkle. */
function drawLights(c: Ctx) {
  for (const s of LIGHT_STRANDS) {
    const pts = strandPoints(s, 160);
    for (const p of pts) rect(c, "#1a1426", Math.round(p.x - FLOOR3_X), Math.round(p.y), 1, 1);
    strandPoints(s, s.bulbs).forEach((p, i) => {
      const x = Math.round(p.x - FLOOR3_X);
      const y = Math.round(p.y);
      rect(c, "#1a1426", x, y + 1, 1, 2);
      rect(c, ["#ffd36b", "#ffb86b", "#fff3a6", "#ff9bd0"][i % 4], x - 1, y + 3, 3, 3);
    });
  }
}

// ---------------------------------------------------------------------------- build

export function buildRooftopTextures(scene: Phaser.Scene) {
  make(scene, "roof_bg", WORLD_W, WORLD_H, drawBackground);
  make(scene, "roof_firepit", 60, 52, drawFirepit);
  for (let f = 0; f < 3; f++) make(scene, `roof_flame${f}`, 24, 32, drawFlame(f));
  make(scene, "roof_log_h", LOGS[0].w, LOGS[0].h, drawLogH);
  make(scene, "roof_log_v", LOGS[2].w, LOGS[2].h, drawLogV);
  make(scene, "roof_telescope", 48, 64, drawTelescope);
  make(scene, "roof_photo", 52, 68, drawPhotoStand);
  make(scene, "roof_wall", 128, 76, drawPolaroidWall);
  make(scene, "roof_planter", 28, 44, drawPlanter);
  make(scene, "roof_post", 10, 72, drawPost);
  make(scene, "roof_shoot", 30, 4, drawShootingStar);
  make(scene, "roof_lights", WORLD_W, WORLD_H, drawLights);
}
