// Draws one Rooftop Polaroid onto a canvas (browser only). Everything is pixel art at a fixed 240x290
// size: a night-time rooftop backdrop, the people from the photo with their own sprites and names, and
// a handwritten-style caption with the time. Scale it up with CSS (image-rendering: pixelated).
import { GRID } from "./editor";
import { polaroidSlots, polaroidStamp, unpackPixels } from "../shared/rooftop";
import { unescapeHtml } from "../shared/text";
import type { PolaroidView } from "../shared/protocol";

export const POLAROID_W = 240;
export const POLAROID_H = 290;
const PHOTO = { x: 12, y: 12, w: 216, h: 168 };

function hash(n: number, seed = 0) {
  let h = (n * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const seedOf = (id: string) => Array.from(id).reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 7);

const fit = (c: CanvasRenderingContext2D, text: string, max: number) => {
  if (c.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && c.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
};

function backdrop(c: CanvasRenderingContext2D, seed: number) {
  const { x, y, w, h } = PHOTO;
  const sky = ["#0b1030", "#10163f", "#171c4a", "#232658", "#33306a", "#4a3a78"];
  sky.forEach((col, i) => { c.fillStyle = col; c.fillRect(x, y + (i * 100) / sky.length, w, 100 / sky.length + 1); });
  for (let i = 0; i < 40; i++) { // stars
    c.fillStyle = hash(i, seed) > 0.5 ? "#fff6e0" : "#9fb8d8";
    c.fillRect(x + Math.floor(hash(i, seed + 1) * w), y + Math.floor(hash(i, seed + 2) * 70), 1, 1);
  }
  c.fillStyle = "#f4ead0"; // moon
  c.beginPath(); c.arc(x + 30 + hash(1, seed) * 150, y + 18, 7, 0, Math.PI * 2); c.fill();
  // city skyline
  let bx = x - 6;
  let n = 0;
  while (bx < x + w) {
    const bw = 14 + Math.floor(hash(n, seed + 3) * 22);
    const bh = 14 + Math.floor(hash(n, seed + 4) * 36);
    c.fillStyle = "#0e0f2a";
    c.fillRect(bx, y + 96 - bh, bw, bh);
    for (let wy = y + 99 - bh; wy < y + 94; wy += 5) for (let wx = bx + 3; wx < bx + bw - 3; wx += 5) {
      if (hash(wx * 7 + wy, seed + 5) < 0.28) { c.fillStyle = hash(wx, wy) > 0.5 ? "#f2c36b" : "#9fd0e8"; c.fillRect(wx, wy, 2, 2); }
    }
    bx += bw + 1;
    n++;
  }
  // glass railing and the wooden deck
  c.fillStyle = "#9fd0e866"; c.fillRect(x, y + 96, w, 12);
  c.fillStyle = "#c4d3e4"; c.fillRect(x, y + 94, w, 2);
  c.fillStyle = "#4d3a2d"; c.fillRect(x, y + 108, w, h - 108);
  for (let r = 0; r < 6; r++) { c.fillStyle = r % 2 ? "#5a4636" : "#533f31"; c.fillRect(x, y + 108 + r * 11, w, 10); c.fillStyle = "#3b2c21"; c.fillRect(x, y + 118 + r * 11, w, 1); }
  // string lights across the top, with a soft glow each
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const lx = x + 6 + t * (w - 12);
    const ly = y + 6 + Math.sin(t * Math.PI) * 12;
    c.fillStyle = "#1a1426"; c.fillRect(lx, ly - 1, 1, 2);
    c.fillStyle = ["#ffd36b", "#ff9bd0", "#fff3a6"][i % 3]; c.fillRect(lx - 1, ly + 1, 3, 3);
    c.fillStyle = "#ffd36b33"; c.fillRect(lx - 3, ly - 1, 7, 7);
  }
  // warm campfire glow from one side, like the real thing
  const g = c.createRadialGradient(x + (hash(2, seed) > 0.5 ? 12 : w - 12), y + h, 4, x + (hash(2, seed) > 0.5 ? 12 : w - 12), y + h, 120);
  g.addColorStop(0, "rgba(255,140,50,0.45)");
  g.addColorStop(1, "rgba(255,140,50,0)");
  c.fillStyle = g; c.fillRect(x, y, w, h);
}

/** Draws `photo` into a canvas (resizing it to the Polaroid size). `shown` 0..1 fades the picture in, like a print developing. */
export function drawPolaroid(canvas: HTMLCanvasElement, photo: PolaroidView, shown = 1) {
  canvas.width = POLAROID_W;
  canvas.height = POLAROID_H;
  const c = canvas.getContext("2d");
  if (!c) return;
  c.imageSmoothingEnabled = false;
  const seed = seedOf(photo.id);

  // paper
  c.fillStyle = "#1f140d"; c.fillRect(0, 0, POLAROID_W, POLAROID_H);
  c.fillStyle = "#f6efe0"; c.fillRect(1, 1, POLAROID_W - 2, POLAROID_H - 2);
  c.fillStyle = "#e6dcc6"; c.fillRect(1, POLAROID_H - 4, POLAROID_W - 2, 3);

  // the picture
  c.save();
  c.beginPath(); c.rect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h); c.clip();
  backdrop(c, seed);
  const slots = polaroidSlots(photo.people.length);
  const tmp = document.createElement("canvas");
  tmp.width = GRID; tmp.height = GRID;
  const tc = tmp.getContext("2d")!;
  photo.people.forEach((person, i) => {
    const slot = slots[i];
    if (!slot) return;
    tc.clearRect(0, 0, GRID, GRID);
    unpackPixels(person.sprite).forEach((col, k) => { if (col) { tc.fillStyle = col; tc.fillRect(k % GRID, Math.floor(k / GRID), 1, 1); } });
    const size = GRID * slot.scale;
    const px = PHOTO.x + slot.x - size / 2;
    const py = PHOTO.y + slot.y - size;
    c.fillStyle = "#00000055"; // a little shadow under each person
    c.beginPath(); c.ellipse(PHOTO.x + slot.x, PHOTO.y + slot.y - 2, size * 0.28, 3, 0, 0, Math.PI * 2); c.fill();
    c.drawImage(tmp, px, py, size, size);
    if (photo.people.length <= 3) { // names go right under people when there's room
      c.font = "16px VT323, monospace";
      c.textAlign = "center";
      const name = fit(c, unescapeHtml(person.name), 62);
      c.fillStyle = "#05030c"; c.fillText(name, PHOTO.x + slot.x + 1, PHOTO.y + slot.y + 13);
      c.fillStyle = "#fff6e0"; c.fillText(name, PHOTO.x + slot.x, PHOTO.y + slot.y + 12);
    }
  });
  if (shown < 1) { c.fillStyle = `rgba(20,14,28,${1 - shown})`; c.fillRect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h); } // still developing
  c.restore();
  c.fillStyle = "#ffffff18"; c.fillRect(PHOTO.x, PHOTO.y, PHOTO.w, 6); // glossy edge

  // caption: who was there, and when
  c.textAlign = "center";
  c.font = "18px VT323, monospace";
  c.fillStyle = "#3b2a1c";
  const names = photo.people.map((p) => unescapeHtml(p.name));
  const who = names.length <= 1 ? names[0] ?? "" : `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
  c.fillText(fit(c, who, POLAROID_W - 24), POLAROID_W / 2, PHOTO.y + PHOTO.h + 28);
  c.font = "16px VT323, monospace";
  c.fillStyle = "#7a5a3a";
  c.fillText(`Rooftop · ${polaroidStamp(photo.ts)}`, POLAROID_W / 2, PHOTO.y + PHOTO.h + 52);
}
