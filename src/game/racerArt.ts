// Neon Drift GP: a late-90s 32-bit arcade racer presentation. The simulation (src/shared/racer.ts) is flat top-down
// physics; this file turns it into a behind-the-car 3D view by projecting the real track centreline, road edges,
// barriers, hills, scenery and cars through a perspective camera, then draws a metal-framed arcade dashboard.
//   * cars are real 3D polygon models (flat-shaded with metallic sheen gradients, glass, lights, wheels, spoilers),
//     painter-sorted per face, so they have correct perspective and rotate properly as they yaw; three body styles
//     keep the player's car distinct from the CPU field
//   * the road is built strip by strip: asphalt grain and tyre wear, lane dashes, red/white curbs, grass run-off,
//     a steel barrier exactly where the physics barrier is, layered canyon walls, and sprite-scaled pines and rocks
//   * barrier contact throws sparks and shakes the camera
import { RACE, STRIPES, cliffAt, elevation, fmtTime, positions, roadFrame, track, type Car, type Race } from "../shared/racer";

export const VW = 800;
export const VH = 450;
const HOR = 176; // screen y of the horizon
const FOC = 470; // focal length in px
const NEAR = 6;
const CAM_BACK = 70;
const CAM_H = 26;
const DRAW = 104; // how many centreline samples ahead we draw (about 1300 world units)
const HAZE: RGB = [207, 233, 245];
const ORDINAL = ["1st", "2nd", "3rd"];
const ord = (n: number) => ORDINAL[n - 1] ?? `${n}th`;

type RGB = [number, number, number];
const hexRgb = (h: string): RGB => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const wrapAng = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const rgb = (c: RGB) => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
/** Blend a colour towards the horizon haze: far things melt into the sky. */
const fogC = (c: RGB, t: number): RGB => [c[0] + (HAZE[0] - c[0]) * t, c[1] + (HAZE[1] - c[1]) * t, c[2] + (HAZE[2] - c[2]) * t];
const fog = (c: RGB, t: number) => rgb(fogC(c, t));
const lit = (c: RGB, k: number): RGB => [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)];
const add = (c: RGB, k: number): RGB => [clamp(c[0] + k, 0, 255), clamp(c[1] + k, 0, 255), clamp(c[2] + k, 0, 255)];
const vnoise = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };
// the sun: high, behind-left of the usual direction of travel
const SUN = (() => { const v = [-0.45, -0.35, 0.82], l = Math.hypot(v[0], v[1], v[2]); return v.map((x) => x / l); })();

// ------------------------------------------------------------------ road cache

type Road = { n: number; tx: Float64Array; ty: Float64Array; rx: Float64Array; ry: Float64Array; z: Float64Array; turn: Float64Array; cliffL: Float64Array; cliffR: Float64Array; spacing: number; minX: number; minY: number; maxX: number; maxY: number; padAt: Map<number, number>; oilAt: Map<number, number> };
let road: Road | null = null;

function roadCache(): Road {
  if (road) return road;
  const tr = track();
  const n = tr.pts.length;
  const mk = () => new Float64Array(n);
  const r: Road = { n, tx: tr.tx, ty: tr.ty, rx: tr.nx, ry: tr.ny, z: mk(), turn: mk(), cliffL: mk(), cliffR: mk(), spacing: tr.length / n, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, padAt: new Map(), oilAt: new Map() };
  const ang = mk();
  for (let i = 0; i < n; i++) {
    ang[i] = Math.atan2(r.ty[i], r.tx[i]);
    r.z[i] = elevation(i, n);
    r.minX = Math.min(r.minX, tr.pts[i].x); r.maxX = Math.max(r.maxX, tr.pts[i].x); r.minY = Math.min(r.minY, tr.pts[i].y); r.maxY = Math.max(r.maxY, tr.pts[i].y);
  }
  for (let i = 0; i < n; i++) {
    r.turn[i] = wrapAng(ang[(i + 5) % n] - ang[i]);
    r.cliffL[i] = cliffAt(i, n, -1);
    r.cliffR[i] = cliffAt(i, n, 1);
  }
  tr.padIdx.forEach((i, k) => r.padAt.set(i, k));
  tr.oilIdx.forEach((i, k) => r.oilAt.set(i, k));
  return (road = r);
}

// ------------------------------------------------------------------ prerendered art (sky layers, scenery sprites)

type Art = { gradient: HTMLCanvasElement; far: HTMLCanvasElement; near: HTMLCanvasElement; clouds: HTMLCanvasElement; pines: HTMLCanvasElement[]; rocks: HTMLCanvasElement[]; bush: HTMLCanvasElement };
let art: Art | null = null;
const FAR_W = Math.round(Math.PI * 2 * FOC * 0.55);
const NEAR_W = Math.round(Math.PI * 2 * FOC * 0.9);
const CLOUD_W = Math.round(Math.PI * 2 * FOC * 0.35);

function offscreen(w: number, h: number) {
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  return { cv, c: cv.getContext("2d")!, };
}

/** Per-pixel shaded mountain range: rock lit on the sun side, strata, and snow on the high peaks of the far range. */
function ridge(w: number, h: number, harm: number[], amp: number, seed: number, rock: RGB[], snow: boolean) {
  const { cv, c } = offscreen(w, h);
  const img = c.createImageData(w, h), d = img.data;
  const H = new Float64Array(w + 1);
  for (let x = 0; x <= w; x++) {
    let y = 0;
    harm.forEach((k, i) => { y += Math.sin((x / w) * Math.PI * 2 * k + seed + i * 1.7) / (i + 1); });
    y += (vnoise(x / 9 + seed) - 0.5) * 0.35 + (vnoise(x / 3 + seed * 3) - 0.5) * 0.1;
    H[x] = h - 8 - amp * (0.55 + (0.45 * y) / 1.6) * (0.6 + 0.4 * Math.abs(Math.sin((x / w) * Math.PI * 2 * (harm[0] * 2.5) + seed)));
  }
  for (let x = 0; x < w; x++) {
    const slope = H[x + 1] - H[Math.max(0, x - 1)]; // > 0 going down to the right: that face looks toward the sun (left)
    for (let y = Math.max(0, Math.floor(H[x])); y < h; y++) {
      const depth = (y - H[x]) / (h - H[x] + 1);
      let t = 0.55 + clamp(slope * 0.35, -0.35, 0.35) - depth * 0.35 + (vnoise(x * 0.3 + y * 0.9) - 0.5) * 0.18 + (Math.sin(y * 0.7 + x * 0.05) > 0.85 ? -0.12 : 0);
      t = clamp(t);
      const k = t * (rock.length - 1), i0 = Math.min(rock.length - 2, Math.floor(k));
      let col: RGB = [rock[i0][0] + (rock[i0 + 1][0] - rock[i0][0]) * (k - i0), rock[i0][1] + (rock[i0 + 1][1] - rock[i0][1]) * (k - i0), rock[i0][2] + (rock[i0 + 1][2] - rock[i0][2]) * (k - i0)];
      if (snow && H[x] < h - amp * 0.82 && y - H[x] < (h - amp * 0.82 - H[x]) * 0.9 + vnoise(x * 0.4) * 4) col = slope > 0 ? [248, 252, 255] : [196, 214, 236];
      const i = (y * w + x) * 4;
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

/** A detailed pine: a trunk and tiers of drooping branch skirts, lit from the left, with needle texture. */
function pineSprite(seed: number) {
  const W = 72, H = 150;
  const { cv, c } = offscreen(W, H);
  const img = c.createImageData(W, H), d = img.data;
  const set = (x: number, y: number, col: RGB) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255; };
  for (let y = H - 30; y < H; y++) for (let x = W / 2 - 3; x < W / 2 + 3; x++) set(x, y, x < W / 2 - 1 ? [110, 72, 44] : x < W / 2 + 1 ? [84, 52, 32] : [58, 36, 22]);
  const tiers = 8;
  const G: RGB[] = [[14, 44, 26], [22, 62, 34], [32, 84, 44], [48, 108, 56], [72, 134, 70]];
  for (let k = tiers - 1; k >= 0; k--) {
    const top = 4 + k * 15 + hash(seed + k) * 3, bottom = top + 26 + k * 1.6;
    const half = 6 + k * 3.6 + hash(seed * 3 + k) * 3;
    for (let y = Math.floor(top); y < bottom; y++) {
      const t = (y - top) / (bottom - top);
      const w = half * Math.pow(t, 0.8);
      for (let x = Math.floor(W / 2 - w - 2); x <= W / 2 + w + 2; x++) {
        const u = (x - W / 2) / Math.max(1, w);
        const droop = Math.abs(u) > 0.7 ? (Math.abs(u) - 0.7) * 6 : 0; // branch tips droop
        if (Math.abs(u) > 1 + (hash(x * 13 + y * 7 + seed) - 0.5) * 0.35 || y > bottom - 2 + droop * 0 - (1 - Math.abs(u)) * 3 * (hash(x + seed) > 0.5 ? 1 : 0)) continue;
        const shade = 0.62 - u * 0.32 - t * 0.12 + (hash(x * 3.1 + y * 5.7 + seed) - 0.5) * 0.35 + (y > bottom - 4 ? -0.25 : 0);
        set(x, y, G[clamp(Math.round(shade * (G.length - 1)), 0, G.length - 1)]);
        void droop;
      }
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function rockSprite(seed: number) {
  const W = 64, H = 40;
  const { cv, c } = offscreen(W, H);
  const img = c.createImageData(W, H), d = img.data;
  const R: RGB[] = [[70, 38, 24], [110, 60, 34], [150, 88, 50], [190, 124, 76], [218, 162, 108]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = (x - W / 2) / (W / 2), v = (H - y) / H;
    const prof = (1 - u * u) * (0.75 + 0.25 * Math.sin(u * 5 + seed)) + (vnoise(x * 0.3 + seed) - 0.5) * 0.15;
    if (v > prof) continue;
    const nx = -u, ny = v / Math.max(0.05, prof);
    const t = 0.45 + nx * 0.3 + (ny - 0.5) * 0.35 + (hash(x * 7 + y * 13 + seed) - 0.5) * 0.25 + (Math.sin(y * 1.3 + x * 0.2) > 0.8 ? -0.2 : 0);
    const col = R[clamp(Math.round(t * (R.length - 1)), 0, R.length - 1)];
    const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function bushSprite() {
  const W = 48, H = 26;
  const { cv, c } = offscreen(W, H);
  const img = c.createImageData(W, H), d = img.data;
  const G: RGB[] = [[18, 52, 24], [30, 76, 32], [48, 102, 42], [74, 128, 56], [108, 156, 74]];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let f = 0;
    for (let k = 0; k < 5; k++) { const bx = 8 + k * 8, by = H - 6 - Math.sin(k * 1.9) * 4, br = 7 + (k % 2) * 3; f = Math.max(f, 1 - Math.hypot(x - bx, (y - by) * 1.2) / br); }
    if (f <= 0) continue;
    const t = 0.4 + f * 0.4 - (x / W - 0.5) * 0.4 - (y / H) * 0.2 + (hash(x * 5 + y * 11) - 0.5) * 0.3;
    const col = G[clamp(Math.round(t * (G.length - 1)), 0, G.length - 1)];
    const i = (y * W + x) * 4; d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function buildArt(): Art {
  const g = offscreen(VW, HOR + 2);
  const gr = g.c.createLinearGradient(0, 0, 0, HOR);
  gr.addColorStop(0, "#1250c4"); gr.addColorStop(0.45, "#3a8eea"); gr.addColorStop(0.82, "#9fd9f7"); gr.addColorStop(1, "#d6eef8");
  g.c.fillStyle = gr; g.c.fillRect(0, 0, VW, HOR + 2);
  const sun = g.c.createRadialGradient(610, 62, 4, 610, 62, 150); sun.addColorStop(0, "rgba(255,252,220,0.95)"); sun.addColorStop(0.25, "rgba(255,240,170,0.45)"); sun.addColorStop(1, "rgba(255,240,170,0)");
  g.c.fillStyle = sun; g.c.fillRect(0, 0, VW, HOR + 2);
  const far = ridge(FAR_W, 120, [3, 7, 11], 92, 1.3, [[96, 120, 160], [120, 144, 184], [146, 170, 206], [176, 196, 226]].map((x) => x as RGB), true);
  const near = ridge(NEAR_W, 100, [4, 9, 15], 70, 4.2, [[92, 52, 36], [128, 72, 44], [166, 98, 58], [200, 134, 84], [222, 170, 118]].map((x) => x as RGB), false);
  const cl = offscreen(CLOUD_W, 140);
  for (let i = 0; i < 9; i++) {
    const cx = (i + hash(i + 3) * 0.7) * (CLOUD_W / 9), cy = 22 + hash(i * 5) * 70, s = 0.8 + hash(i * 9) * 0.9;
    for (const dx of [-CLOUD_W, 0, CLOUD_W]) for (const [ox, oy, r] of [[0, 0, 14], [16, -6, 17], [34, -1, 14], [48, 3, 10], [-14, 4, 10]] as [number, number, number][]) {
      for (const pass of [0, 1]) {
        const x = cx + dx + ox * s, y = cy + oy * s + (pass ? 0 : 3 * s);
        const rg = cl.c.createRadialGradient(x - r * s * 0.3, y - r * s * 0.35, 1, x, y, r * s);
        rg.addColorStop(0, pass ? "#ffffff" : "#d4e6f4"); rg.addColorStop(1, pass ? "#eef6fc" : "#a9c9e6");
        cl.c.fillStyle = rg; cl.c.beginPath(); cl.c.arc(x, y, r * s, 0, Math.PI * 2); cl.c.fill();
      }
    }
  }
  return { gradient: g.cv, far, near, clouds: cl.cv, pines: [pineSprite(1), pineSprite(7), pineSprite(13)], rocks: [rockSprite(2), rockSprite(5)], bush: bushSprite() };
}

function scrollLayer(c: CanvasRenderingContext2D, img: HTMLCanvasElement, camA: number, k: number, y: number) {
  const w = img.width;
  let u = (camA * FOC * k) % w;
  if (u < 0) u += w;
  const x0 = VW / 2 - u;
  for (let x = x0 - w; x < VW; x += w) if (x + w > 0) c.drawImage(img, x, y);
}

// ------------------------------------------------------------------ projection helpers

let camX = 0, camY = 0, camZ = 0, cosA = 1, sinA = 0;
const QX = new Float64Array(16), QY = new Float64Array(16), QZ = new Float64Array(16);
const PF = new Float64Array(16), PL = new Float64Array(16), PZ = new Float64Array(16);
const OF = new Float64Array(24), OL = new Float64Array(24), OZ = new Float64Array(24);

/** Fill the world polygon in QX/QY/QZ (n points) with the near plane clipped away. */
function fillPoly(c: CanvasRenderingContext2D, n: number, fill: string | CanvasGradient) {
  for (let i = 0; i < n; i++) {
    const dx = QX[i] - camX, dy = QY[i] - camY;
    PF[i] = dx * cosA + dy * sinA; PL[i] = -dx * sinA + dy * cosA; PZ[i] = QZ[i];
  }
  let m = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ain = PF[i] >= NEAR, bin = PF[j] >= NEAR;
    if (ain) { OF[m] = PF[i]; OL[m] = PL[i]; OZ[m] = PZ[i]; m++; }
    if (ain !== bin) { const t = (NEAR - PF[i]) / (PF[j] - PF[i]); OF[m] = NEAR; OL[m] = PL[i] + (PL[j] - PL[i]) * t; OZ[m] = PZ[i] + (PZ[j] - PZ[i]) * t; m++; }
  }
  if (m < 3) return;
  c.fillStyle = fill;
  c.beginPath();
  for (let i = 0; i < m; i++) {
    const k = FOC / OF[i];
    const sx = VW / 2 + OL[i] * k, sy = HOR + (camZ - OZ[i]) * k;
    if (i) c.lineTo(sx, sy); else c.moveTo(sx, sy);
  }
  c.closePath(); c.fill();
}

function quad(c: CanvasRenderingContext2D, fill: string, ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number, dx: number, dy: number, dz: number) {
  QX[0] = ax; QY[0] = ay; QZ[0] = az; QX[1] = bx; QY[1] = by; QZ[1] = bz; QX[2] = cx; QY[2] = cy; QZ[2] = cz; QX[3] = dx; QY[3] = dy; QZ[3] = dz;
  fillPoly(c, 4, fill);
}

/** A strip quad between lateral offsets o0..o1 (world units from the centreline) across samples i..j. */
function band(c: CanvasRenderingContext2D, fill: string, cx0: number, cy0: number, rx0: number, ry0: number, z0: number, cx1: number, cy1: number, rx1: number, ry1: number, z1: number, o0: number, o1: number, h0 = 0, h1 = 0) {
  quad(c, fill, cx0 + rx0 * o0, cy0 + ry0 * o0, z0 + h0, cx0 + rx0 * o1, cy0 + ry0 * o1, z0 + h1, cx1 + rx1 * o1, cy1 + ry1 * o1, z1 + h1, cx1 + rx1 * o0, cy1 + ry1 * o0, z1 + h0);
}

/** Project one world point; returns false when it is behind the camera. */
const P = { x: 0, y: 0, k: 0, f: 0 };
function project(x: number, y: number, z: number): boolean {
  const dx = x - camX, dy = y - camY;
  const f = dx * cosA + dy * sinA;
  if (f < NEAR) return false;
  const k = FOC / f;
  P.x = VW / 2 + (-dx * sinA + dy * cosA) * k; P.y = HOR + (camZ - z) * k; P.k = k; P.f = f;
  return true;
}

// ------------------------------------------------------------------ 3D car models

type Face = { v: number[]; role: "body" | "bodyD" | "glass" | "tail" | "head" | "tyre" | "rim" | "stripe" | "wing" | "dark" | "grille"; decal?: boolean; twoSided?: boolean };
type Model = { verts: number[][]; faces: Face[]; exhaust: [number, number, number][]; tail: [number, number, number][] };

/** Build a car body from cross-section rings along its length (u forward, v right, h up), plus a cabin, wing and wheels. */
function buildModel(style: 0 | 1 | 2): Model {
  const verts: number[][] = [], faces: Face[] = [];
  const V = (u: number, v: number, h: number) => { verts.push([u, v, h]); return verts.length - 1; };
  // stations: [u, rocker half-width, shoulder half-width, shoulder height]
  const ST: number[][] = style === 0
    ? [[-12.6, 6.6, 6.0, 4.1], [-9.5, 7.1, 6.6, 4.5], [2.5, 7.1, 6.5, 4.0], [8.5, 6.7, 6.0, 3.0], [12.6, 5.6, 4.6, 2.0]] // player: low wedge supercar
    : style === 1
      ? [[-12.5, 6.5, 6.1, 4.6], [-9.5, 6.9, 6.5, 4.9], [3, 6.9, 6.5, 4.6], [9, 6.6, 6.0, 3.7], [12.5, 5.8, 5.0, 2.8]] // GT coupe
      : [[-12.4, 6.6, 6.3, 5.0], [-10, 6.9, 6.6, 5.2], [3.5, 6.9, 6.5, 4.8], [9, 6.6, 6.1, 4.0], [12.4, 6.0, 5.4, 3.1]]; // rally hatch
  const rings = ST.map(([u, wr, ws, hs]) => [V(u, -wr, 1.0), V(u, -wr, 2.6), V(u, -ws, hs), V(u, ws, hs), V(u, wr, 2.6), V(u, wr, 1.0)]);
  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s], b = rings[s + 1];
    faces.push({ v: [a[0], b[0], b[1], a[1]], role: "bodyD" }, { v: [a[1], b[1], b[2], a[2]], role: "body" }, { v: [a[2], b[2], b[3], a[3]], role: "body" }, { v: [a[3], b[3], b[4], a[4]], role: "body" }, { v: [a[4], b[4], b[5], a[5]], role: "bodyD" });
  }
  faces.push({ v: [...rings[0]].reverse(), role: "body" }, { v: [...rings[rings.length - 1]], role: "grille" });
  // cabin / glasshouse
  const cab = style === 0 ? { r0: -7.5, f0: 3.0, r1: -5, f1: 0, w0: 6.0, w1: 4.6, h: 7.0, hb0: 4.4, hb1: 4.0 }
    : style === 1 ? { r0: -8.2, f0: 3.5, r1: -5.5, f1: 0.8, w0: 6.1, w1: 4.9, h: 8.2, hb0: 4.8, hb1: 4.6 }
      : { r0: -10.2, f0: 3.8, r1: -9.6, f1: 0.8, w0: 6.3, w1: 5.2, h: 8.7, hb0: 5.1, hb1: 4.8 };
  const bl = V(cab.r0, -cab.w0, cab.hb0), br = V(cab.r0, cab.w0, cab.hb0), fl = V(cab.f0, -cab.w0, cab.hb1), fr = V(cab.f0, cab.w0, cab.hb1);
  const tbl = V(cab.r1, -cab.w1, cab.h), tbr = V(cab.r1, cab.w1, cab.h), tfl = V(cab.f1, -cab.w1, cab.h), tfr = V(cab.f1, cab.w1, cab.h);
  faces.push({ v: [fl, fr, tfr, tfl], role: "glass" }, { v: [br, bl, tbl, tbr], role: "glass" }, { v: [bl, fl, tfl, tbl], role: "glass" }, { v: [fr, br, tbr, tfr], role: "glass" }, { v: [tbl, tfl, tfr, tbr], role: "body" });
  // livery stripe: down the hood, roof and deck
  const sw = style === 0 ? 2.2 : 1.4;
  const stripe = (u0: number, u1: number, h0: number, h1: number) => faces.push({ v: [V(u0, -sw, h0 + 0.06), V(u1, -sw, h1 + 0.06), V(u1, sw, h1 + 0.06), V(u0, sw, h0 + 0.06)], role: "stripe", decal: true });
  stripe(cab.f0 + 0.3, ST[ST.length - 1][0] - 0.3, cab.hb1 - 0.1, ST[ST.length - 1][3]);
  stripe(cab.r1, cab.f1, cab.h, cab.h);
  // rear wing on posts (the rally hatch gets a roof spoiler instead)
  if (style !== 2) {
    const wy = style === 0 ? 7.3 : 6.6, wh = style === 0 ? 7.6 : 6.6;
    const a = V(-13.4, -wy, wh), b = V(-10.6, -wy, wh + 0.3), cc = V(-10.6, wy, wh + 0.3), d = V(-13.4, wy, wh);
    faces.push({ v: [a, b, cc, d], role: "wing", twoSided: true });
    const a2 = V(-13.4, -wy, wh - 0.8), d2 = V(-13.4, wy, wh - 0.8);
    faces.push({ v: [a2, a, d, d2], role: "dark" });
    for (const s of [-1, 1]) faces.push({ v: [V(-12, s * 4.2, 4.2), V(-11.2, s * 4.2, 4.2), V(-11.4, s * 4.2, wh), V(-12.2, s * 4.2, wh)], role: "dark", twoSided: true });
  } else {
    faces.push({ v: [V(cab.r1 - 0.2, -cab.w1, cab.h), V(cab.r1 + 1.2, -cab.w1, cab.h + 0.1), V(cab.r1 + 1.2, cab.w1, cab.h + 0.1), V(cab.r1 - 0.2, cab.w1, cab.h)].reverse(), role: "wing", twoSided: true });
  }
  // tail lights and headlights (sitting just proud of the end panels)
  const r0 = ST[0], rf = ST[ST.length - 1];
  for (const s of [-1, 1]) {
    faces.push({ v: [V(r0[0] - 0.05, s * 2.2, 2.9), V(r0[0] - 0.05, s * (r0[2] - 0.4), 2.9), V(r0[0] - 0.05, s * (r0[2] - 0.4), r0[3] - 0.5), V(r0[0] - 0.05, s * 2.2, r0[3] - 0.5)], role: "tail", decal: true, twoSided: true });
    faces.push({ v: [V(rf[0] + 0.05, s * 1.6, 1.6), V(rf[0] + 0.05, s * (rf[2] - 0.3), 1.6), V(rf[0] + 0.05, s * (rf[2] - 0.3), rf[3] - 0.2), V(rf[0] + 0.05, s * 1.6, rf[3] - 0.2)], role: "head", decal: true, twoSided: true });
  }
  // wheels: 8-sided tyres with a rim face on the outside
  const wheel = (u: number, side: number) => {
    const R = 2.5, w0 = side * 6.0, w1 = side * 7.5, n = 8;
    const ring0: number[] = [], ring1: number[] = [];
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; ring0.push(V(u + Math.cos(a) * R, w0, R + Math.sin(a) * R)); ring1.push(V(u + Math.cos(a) * R, w1, R + Math.sin(a) * R)); }
    for (let k = 0; k < n; k++) faces.push({ v: [ring0[k], ring0[(k + 1) % n], ring1[(k + 1) % n], ring1[k]], role: "tyre" });
    faces.push({ v: side > 0 ? ring1 : [...ring1].reverse(), role: "rim" });
  };
  for (const u of [-8.3, 8.2]) for (const s of [-1, 1]) wheel(u, s);
  return { verts, faces, exhaust: [[-12.7, -3.2, 1.8], [-12.7, 3.2, 1.8]], tail: [[r0[0], -(2.2 + r0[2] - 0.4) / 2, (2.9 + r0[3] - 0.5) / 2], [r0[0], (2.2 + r0[2] - 0.4) / 2, (2.9 + r0[3] - 0.5) / 2]] };
}
const MODELS: Model[] = [buildModel(0), buildModel(1), buildModel(2)];

// per-face precomputation: local normals (oriented outward from the model's centre)
const NORMALS = MODELS.map((m) => m.faces.map((f) => {
  const [a, b, c] = [m.verts[f.v[0]], m.verts[f.v[1]], m.verts[f.v[2]]];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l);
  const cen = f.v.reduce((s, i) => [s[0] + m.verts[i][0], s[1] + m.verts[i][1], s[2] + m.verts[i][2]], [0, 0, 0]).map((x) => x / f.v.length);
  if (n[0] * cen[0] + n[1] * cen[1] + n[2] * (cen[2] - 3.6) < 0) n = n.map((x) => -x);
  return n;
}));

const SX = new Float64Array(64), SY = new Float64Array(64), SF = new Float64Array(64), SOK = new Uint8Array(64);
const WX = new Float64Array(64), WY = new Float64Array(64), WZ = new Float64Array(64);

function drawCarModel(c: CanvasRenderingContext2D, car: Car, gz: number, fogT: number, tick: number, lod: boolean) {
  const style = car.human ? 0 : ((car.id % 2) + 1) as 1 | 2;
  const m = MODELS[style], N = NORMALS[style];
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  // spinning out on oil: the body yaws visibly
  const body = hexRgb(car.color), stripe = hexRgb(STRIPES[car.id % STRIPES.length]);
  // world positions and projections of every vertex
  for (let i = 0; i < m.verts.length; i++) {
    const [u, v, h] = m.verts[i];
    const x = car.x + ca * u - sa * v, y = car.y + sa * u + ca * v, z = gz + h;
    WX[i] = x; WY[i] = y; WZ[i] = z;
    const dx = x - camX, dy = y - camY, f = dx * cosA + dy * sinA;
    SF[i] = f; SOK[i] = f > NEAR ? 1 : 0;
    if (SOK[i]) { const k = FOC / f; SX[i] = VW / 2 + (-dx * sinA + dy * cosA) * k; SY[i] = HOR + (camZ - z) * k; }
  }
  // ground shadow (the car's footprint pushed away from the sun)
  QX[0] = car.x + ca * 13.5 - sa * -7.6 - SUN[0] * 3; QY[0] = car.y + sa * 13.5 + ca * -7.6 - SUN[1] * 3;
  QX[1] = car.x + ca * 13.5 - sa * 7.6 - SUN[0] * 3; QY[1] = car.y + sa * 13.5 + ca * 7.6 - SUN[1] * 3;
  QX[2] = car.x + ca * -13.5 - sa * 7.6 - SUN[0] * 3; QY[2] = car.y + sa * -13.5 + ca * 7.6 - SUN[1] * 3;
  QX[3] = car.x + ca * -13.5 - sa * -7.6 - SUN[0] * 3; QY[3] = car.y + sa * -13.5 + ca * -7.6 - SUN[1] * 3;
  QZ[0] = QZ[1] = QZ[2] = QZ[3] = gz + 0.05;
  fillPoly(c, 4, `rgba(10,8,16,${0.5 * (1 - fogT)})`);
  // visible faces, far to near
  const order: { i: number; d: number }[] = [];
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    if (lod && (f.role === "stripe" || f.role === "rim" || f.role === "dark")) continue;
    let ok = true, d = 0, cx = 0, cy = 0, cz = 0;
    for (const vi of f.v) { if (!SOK[vi]) { ok = false; break; } d += SF[vi]; cx += WX[vi]; cy += WY[vi]; cz += WZ[vi]; }
    if (!ok) continue;
    const n = f.v.length;
    cx /= n; cy /= n; cz /= n;
    const ln = N[fi], nx = ca * ln[0] - sa * ln[1], ny = sa * ln[0] + ca * ln[1], nz = ln[2];
    if (!f.twoSided && nx * (camX - cx) + ny * (camY - cy) + nz * (camZ - cz) <= 0) continue; // back face
    order.push({ i: fi, d: d / n - (f.decal ? 0.6 : 0) });
  }
  order.sort((a, b) => b.d - a.d);
  for (const { i: fi } of order) {
    const f = m.faces[fi], ln = N[fi];
    const nx = ca * ln[0] - sa * ln[1], ny = sa * ln[0] + ca * ln[1], nz = ln[2];
    const ndl = nx * SUN[0] + ny * SUN[1] + nz * SUN[2];
    let col: RGB;
    let sheen = false;
    switch (f.role) {
      case "body": col = lit(body, 0.5 + 0.62 * clamp(ndl)); sheen = nz > 0.55; break;
      case "bodyD": col = lit(body, 0.32 + 0.4 * clamp(ndl)); break;
      case "stripe": col = lit(stripe, 0.55 + 0.55 * clamp(ndl)); break;
      case "grille": col = lit([40, 38, 52], 0.7 + 0.5 * clamp(ndl)); break;
      case "glass": col = nz > 0.2 ? [70, 120, 170] : lit([30, 46, 80], 0.8 + 0.6 * clamp(ndl)); sheen = true; break;
      case "tail": col = car.braking ? [255, 70, 60] : [150, 18, 30]; break;
      case "head": col = [255, 246, 200]; break;
      case "tyre": col = lit([34, 32, 38], 0.6 + 0.6 * clamp(ndl)); break;
      case "rim": col = lit([180, 186, 200], 0.55 + 0.6 * clamp(ndl)); break;
      case "wing": col = lit(stripe, 0.45 + 0.6 * clamp(Math.abs(ndl))); break;
      default: col = lit([28, 26, 36], 0.7 + 0.4 * clamp(ndl));
    }
    // metallic paint / glass: a gradient across the face with a sky reflection and a bright streak
    let fill: string | CanvasGradient = fog(col, fogT);
    if (sheen && !lod) {
      let y0 = Infinity, y1 = -Infinity, xa = 0;
      for (const vi of f.v) { y0 = Math.min(y0, SY[vi]); y1 = Math.max(y1, SY[vi]); xa += SX[vi]; }
      if (y1 - y0 > 3) {
        const g = c.createLinearGradient(xa / f.v.length - (y1 - y0) * 0.3, y0, xa / f.v.length + (y1 - y0) * 0.3, y1);
        const hi = add(col, f.role === "glass" ? 70 : 85), lo = lit(col, 0.72);
        g.addColorStop(0, fog(hi, fogT)); g.addColorStop(0.38, fog(col, fogT)); g.addColorStop(0.46, fog(add(col, 110), fogT)); g.addColorStop(0.54, fog(col, fogT)); g.addColorStop(1, fog(lo, fogT));
        fill = g;
      }
    }
    c.fillStyle = fill;
    c.beginPath();
    f.v.forEach((vi, k) => (k ? c.lineTo(SX[vi], SY[vi]) : c.moveTo(SX[vi], SY[vi])));
    c.closePath(); c.fill();
    if (!lod && (f.role === "body" || f.role === "bodyD")) { c.strokeStyle = fog(lit(col, 0.8), fogT); c.lineWidth = 0.6; c.stroke(); } // panel seams soften the facets
  }
  // light glows: brake lights, headlights, turbo flames
  const glow = (lx: number, ly: number, lz: number, r: number, col: string) => {
    if (!project(car.x + ca * lx - sa * ly, car.y + sa * lx + ca * ly, gz + lz)) return;
    const rr = r * P.k;
    if (rr < 1) return;
    const g = c.createRadialGradient(P.x, P.y, 0, P.x, P.y, rr); g.addColorStop(0, col); g.addColorStop(1, col.replace(/[\d.]+\)$/, "0)"));
    c.fillStyle = g; c.beginPath(); c.arc(P.x, P.y, rr, 0, Math.PI * 2); c.fill();
  };
  if (car.braking) for (const [u, v, h] of m.tail) glow(u - 0.4, v, h, 4.5, "rgba(255,60,50,0.7)");
  if (car.boost > 0) for (const [u, v, h] of m.exhaust) {
    const len = 5 + Math.sin(tick * 1.7 + v) * 1.5;
    glow(u - len * 0.4, v, h, 2.6, "rgba(255,255,230,0.95)");
    glow(u - len, v, h, 3.6, "rgba(88,200,255,0.75)");
  }
}

// ------------------------------------------------------------------ the view

type Puff = { x: number; y: number; vx: number; vy: number; r: number; a: number };
type SparkP = { x: number; y: number; vx: number; vy: number; life: number };

export class RacerView {
  private camA = 0;
  private ready = false;
  private zCam = 0;
  private rpm = 0;
  private lastLap = 0;
  private seenLine = false;
  private prevStart = 0;
  private bestSeen = Infinity;
  private splitText = "";
  private splitGood = true;
  private splitT = 0;
  private lapFlash = 0;
  private lapFlashText = "";
  private puffs: Puff[] = [];
  private sparks: SparkP[] = [];
  private shakeY = 0;
  private shakeX = 0;
  private lastScrape = 0;
  private lastSpeed = 0;

  render(c: CanvasRenderingContext2D, r: Race, tick: number) {
    const tr = track();
    const rd = roadCache();
    art ??= buildArt();
    const me = r.cars[0];
    const n = rd.n;
    if (!this.ready) { this.camA = me.angle; this.zCam = rd.z[me.idx] + CAM_H; this.ready = true; }
    this.camA += wrapAng(me.angle - this.camA) * 0.13;
    cosA = Math.cos(this.camA); sinA = Math.sin(this.camA);
    camX = me.x - cosA * CAM_BACK; camY = me.y - sinA * CAM_BACK;
    // keep the camera inside the barriers so a wall can never fill the screen
    const ci = nearestIdx(camX, camY, me.idx, tr.pts);
    const cf = roadFrame(tr, camX, camY, ci);
    const lim = RACE.EDGE - 8; // inside the barrier, so it is never between the camera and your car
    if (Math.abs(cf.lat) > lim) { const o = (Math.abs(cf.lat) - lim) * Math.sign(cf.lat); camX -= cf.nx * o; camY -= cf.ny * o; }
    const zCar = this.zAt(me, rd);
    this.zCam += (zCar + CAM_H - this.zCam) * 0.22;
    const speed = Math.hypot(me.vx, me.vy);
    const off = Math.abs(roadFrame(tr, me.x, me.y, me.idx).lat) > RACE.ROAD / 2;
    // camera shake: rough ground, and a jolt when you hit the barrier
    if (me.scrape > this.lastScrape + 100 && this.lastSpeed - speed > 25) { this.shakeX = clamp((this.lastSpeed - speed) / 30, 1, 7); }
    this.lastScrape = me.scrape; this.lastSpeed = speed;
    this.shakeY = off && speed > 60 ? (Math.random() - 0.5) * 2.4 : this.shakeY * 0.6;
    this.shakeX *= 0.82;
    camZ = this.zCam + this.shakeY + (Math.random() - 0.5) * this.shakeX * 0.5;
    c.save();
    if (this.shakeX > 0.3) c.translate((Math.random() - 0.5) * this.shakeX * 2, 0);

    // sky, scrolling mountains and clouds
    c.drawImage(art.gradient, 0, 0);
    scrollLayer(c, art.clouds, this.camA, 0.35, 8 - (camZ - 34) * 0.1);
    scrollLayer(c, art.far, this.camA, 0.55, HOR - 116);
    scrollLayer(c, art.near, this.camA, 0.9, HOR - 96);
    const hz = c.createLinearGradient(0, HOR - 26, 0, HOR + 4); hz.addColorStop(0, "rgba(207,233,245,0)"); hz.addColorStop(1, "rgba(207,233,245,1)");
    c.fillStyle = hz; c.fillRect(0, HOR - 26, VW, 30);
    const ground = c.createLinearGradient(0, HOR, 0, VH); ground.addColorStop(0, "#cfe9f5"); ground.addColorStop(0.06, "#86b866"); ground.addColorStop(0.4, "#5a9a44"); ground.addColorStop(1, "#3a7a30");
    c.fillStyle = ground; c.fillRect(0, HOR, VW, VH - HOR);

    // cars bucketed by the strip their rear bumper sits on, so they are painted in depth order with the road
    const i0 = me.idx - 10;
    const buckets = new Map<number, Car[]>();
    for (const car of r.cars) {
      const along = (car.x - tr.pts[car.idx].x) * rd.tx[car.idx] + (car.y - tr.pts[car.idx].y) * rd.ty[car.idx] - RACE.CAR_HL;
      const seg = car.idx + Math.floor(along / rd.spacing);
      const k = (((seg - i0) % n) + n) % n;
      const kk = k > n - 8 ? k - n : k;
      if (kk < -8 || kk >= DRAW) continue;
      const a = buckets.get(kk) ?? []; a.push(car); buckets.set(kk, a);
    }

    const ROAD_HALF = RACE.ROAD / 2, EDGE = RACE.EDGE;
    const GRASS: RGB[] = ["#3f9c3b", "#378c33", "#4aa844", "#2f7f2c"].map(hexRgb);
    const ASPH: [RGB, RGB] = [hexRgb("#50535f"), hexRgb("#4a4d59")];
    const RED = hexRgb("#d8272f"), WHITE = hexRgb("#f6f1e6");
    const ROCK: RGB[] = ["#6a3220", "#8a4628", "#a95e34", "#c27a46", "#d49a5a"].map(hexRgb);

    for (let k = DRAW - 1; k >= -8; k--) {
      const i = (((i0 + k) % n) + n) % n, j = (i + 1) % n;
      const cx0 = tr.pts[i].x, cy0 = tr.pts[i].y, cx1 = tr.pts[j].x, cy1 = tr.pts[j].y;
      const rx0 = rd.rx[i], ry0 = rd.ry[i], rx1 = rd.rx[j], ry1 = rd.ry[j];
      const z0 = rd.z[i], z1 = rd.z[j];
      const fdx = cx1 - camX, fdy = cy1 - camY;
      const fDepth = fdx * cosA + fdy * sinA;
      const fogT = clamp((fDepth - 260) / 1050) ** 1.15 * 0.97;
      const near = fDepth < 700;
      const B = (fill: string, o0: number, o1: number, h0 = 0, h1 = 0) => band(c, fill, cx0, cy0, rx0, ry0, z0, cx1, cy1, rx1, ry1, z1, o0, o1, h0, h1);
      // terrain: mown stripes and patchy tones out to the horizon on both sides
      const stripeTone = ((i / 3) | 0) & 1;
      B(fog(GRASS[stripeTone], fogT), -280, -EDGE); B(fog(GRASS[stripeTone], fogT), EDGE, 280);
      if (near) for (const s of [-1, 1]) for (let p = 0; p < 3; p++) { // tonal patches so the grass isn't flat
        const o = EDGE + 18 + hash(i * 3 + p * 17 + s) * 150, w = 8 + hash(i * 7 + p) * 26;
        if (hash(i * 11 + p * 5 + s) < 0.5) B(fog(GRASS[2 + (p & 1)], fogT), s * o, s * (o + w));
      }
      B(fog(lit(GRASS[stripeTone], 0.92), fogT), -EDGE, -ROAD_HALF - 11); B(fog(lit(GRASS[stripeTone], 0.92), fogT), ROAD_HALF + 11, EDGE); // run-off strip
      // canyon walls behind the barrier: leaning rock in strata with ledges and crevices
      for (const s of [-1, 1] as const) {
        const h0 = (s < 0 ? rd.cliffL[i] : rd.cliffR[i]) * (0.88 + hash(i * 3 + s) * 0.24), h1 = (s < 0 ? rd.cliffL[j] : rd.cliffR[j]) * (0.88 + hash(j * 3 + s) * 0.24);
        if (h0 < 5 && h1 < 5) continue;
        const o0 = EDGE + 14 + hash(i) * 14, o1 = EDGE + 14 + hash(j) * 14, lean = 0.3;
        const side = s < 0 ? 1.08 : 0.8; // the left walls face the sun
        const bands = near ? 5 : 3;
        for (let b = 0; b < bands; b++) {
          const f0 = b / bands, f1 = (b + 1) / bands;
          const rockT = clamp(0.3 + f0 * 0.5 + (hash(i * 7 + b) - 0.5) * 0.3);
          const tone = lit(ROCK[Math.round(rockT * (ROCK.length - 1))], side * (0.9 + hash(i * 5 + b * 3) * 0.16));
          quad(c, fog(tone, fogT),
            cx0 + rx0 * s * (o0 + h0 * f0 * lean), cy0 + ry0 * s * (o0 + h0 * f0 * lean), z0 + h0 * f0,
            cx1 + rx1 * s * (o1 + h1 * f0 * lean), cy1 + ry1 * s * (o1 + h1 * f0 * lean), z1 + h1 * f0,
            cx1 + rx1 * s * (o1 + h1 * f1 * lean), cy1 + ry1 * s * (o1 + h1 * f1 * lean), z1 + h1 * f1,
            cx0 + rx0 * s * (o0 + h0 * f1 * lean), cy0 + ry0 * s * (o0 + h0 * f1 * lean), z0 + h0 * f1);
          if (near && b < bands - 1) { const fl = f1 - 0.015; quad(c, fog(lit(tone, 0.6), fogT), cx0 + rx0 * s * (o0 + h0 * fl * lean), cy0 + ry0 * s * (o0 + h0 * fl * lean), z0 + h0 * fl, cx1 + rx1 * s * (o1 + h1 * fl * lean), cy1 + ry1 * s * (o1 + h1 * fl * lean), z1 + h1 * fl, cx1 + rx1 * s * (o1 + h1 * f1 * lean), cy1 + ry1 * s * (o1 + h1 * f1 * lean), z1 + h1 * f1, cx0 + rx0 * s * (o0 + h0 * f1 * lean), cy0 + ry0 * s * (o0 + h0 * f1 * lean), z0 + h0 * f1); }
        }
        // lit cap along the top edge
        quad(c, fog(lit(ROCK[4], side * 1.05), fogT), cx0 + rx0 * s * (o0 + h0 * lean), cy0 + ry0 * s * (o0 + h0 * lean), z0 + h0, cx1 + rx1 * s * (o1 + h1 * lean), cy1 + ry1 * s * (o1 + h1 * lean), z1 + h1, cx1 + rx1 * s * (o1 + h1 * lean + 6), cy1 + ry1 * s * (o1 + h1 * lean + 6), z1 + h1 + 1, cx0 + rx0 * s * (o0 + h0 * lean + 6), cy0 + ry0 * s * (o0 + h0 * lean + 6), z0 + h0 + 1);
        if ((i & 3) === 0) { const a0 = 0.25 + hash(i) * 0.2; quad(c, fog([58, 28, 18], fogT), cx0 + rx0 * s * (o0 + h0 * a0 * lean), cy0 + ry0 * s * (o0 + h0 * a0 * lean), z0 + h0 * a0, cx0 + rx0 * s * (o0 + 1.6 + h0 * a0 * lean), cy0 + ry0 * s * (o0 + 1.6 + h0 * a0 * lean), z0 + h0 * a0, cx0 + rx0 * s * (o0 + 1.6 + h0 * 0.85 * lean), cy0 + ry0 * s * (o0 + 1.6 + h0 * 0.85 * lean), z0 + h0 * 0.85, cx0 + rx0 * s * (o0 + h0 * 0.85 * lean), cy0 + ry0 * s * (o0 + h0 * 0.85 * lean), z0 + h0 * 0.85); }
        // a shadow where the wall meets the ground
        B(`rgba(30,14,8,${0.35 * (1 - fogT)})`, s * (o0 - 8), s * o0);
      }
      // red-and-white rumble curbs with a shaded lip
      const curbCol = (i >> 1) & 1 ? RED : WHITE;
      for (const s of [-1, 1] as const) {
        B(fog(curbCol, fogT), s * ROAD_HALF, s * (ROAD_HALF + 8));
        B(fog(lit(curbCol, 0.72), fogT), s * (ROAD_HALF + 8), s * (ROAD_HALF + 11));
      }
      // asphalt: alternating bands, grain flecks, dark tyre-worn racing lines, the odd patch and skid mark
      const as = ASPH[(i >> 1) & 1];
      B(fog(as, fogT), -ROAD_HALF, ROAD_HALF);
      B(fog(lit(as, 0.8), fogT), -ROAD_HALF, -ROAD_HALF + 3); B(fog(lit(as, 0.8), fogT), ROAD_HALF - 3, ROAD_HALF); // shaded road edges
      if (fDepth < 900) {
        const wear = fog(lit(as, 0.82), fogT), grain = fog(lit(as, 1.22), fogT), dark = fog(lit(as, 0.68), fogT);
        for (const o of [-28, -17, 17, 28]) B(wear, o - 4, o + 4);
        for (let gk = 0; gk < 6; gk++) { const o = (hash(i * 5 + gk) - 0.5) * 88; B(gk & 1 ? grain : dark, o, o + 1.2); }
        if (hash(i * 13) < 0.08) { const o = (hash(i * 17) - 0.5) * 50; B(fog(lit(as, 1.12), fogT), o - 9, o + 9); } // tar patch
        if (Math.abs(rd.turn[i]) > 0.18 && near) { const s = rd.turn[i] > 0 ? 1 : -1, o = s * (14 + hash(i) * 14); B(fog([28, 28, 32], fogT * 0.8 + 0.1), o - 2.2, o); B(fog([28, 28, 32], fogT * 0.8 + 0.1), o + 6, o + 8.2); } // skid marks through the bends
      }
      const line = fog([240, 238, 228], fogT);
      for (const s of [-1, 1] as const) B(line, s * (ROAD_HALF - 6), s * (ROAD_HALF - 3.5));
      if (((i / 2) | 0) % 2 === 0) for (const o of [-16, 16]) B(line, o - 1, o + 1); // lane dashes
      // start / finish chequers
      if (i === 0) {
        for (let col = 0; col < 12; col++) for (let row = 0; row < 2; row++) {
          const a = -ROAD_HALF + (col * RACE.ROAD) / 12, b = a + RACE.ROAD / 12;
          const p0 = row / 2, p1 = (row + 1) / 2;
          const px = (o: number, p: number) => cx0 + (cx1 - cx0) * p + (rx0 + (rx1 - rx0) * p) * o, py = (o: number, p: number) => cy0 + (cy1 - cy0) * p + (ry0 + (ry1 - ry0) * p) * o, pz = z0 + (z1 - z0) * p0;
          quad(c, fog((col + row) & 1 ? [8, 6, 16] : [250, 246, 236], fogT), px(a, p0), py(a, p0), pz, px(b, p0), py(b, p0), pz, px(b, p1), py(b, p1), pz, px(a, p1), py(a, p1), pz);
        }
      }
      // boost pads and oil slicks painted on the tarmac
      const padK = rd.padAt.get(i);
      if (padK !== undefined) this.drawPad(c, tr.pads[padK], rd, i, z0, tick, fogT);
      const oilK = rd.oilAt.get(i);
      if (oilK !== undefined) this.drawOil(c, tr.oil[oilK], rd, i, z0, fogT);
      // the steel barrier: the solid edge the physics enforces (W-beam rail on posts)
      for (const s of [-1, 1] as const) {
        const towardSun = s < 0 ? 1.1 : 0.85;
        B(fog(lit([150, 156, 172], towardSun), fogT), s * EDGE, s * EDGE, 2.2, 4.6);
        B(fog(lit([105, 110, 126], towardSun), fogT), s * EDGE, s * EDGE, 0.6, 2.2);
        B(fog([235, 238, 245], fogT), s * EDGE, s * EDGE, 4.6, 5.1);
        if ((i & 1) === 0 && near) { const p0 = s * (EDGE + 0.3); quad(c, fog([60, 62, 74], fogT), cx0 + rx0 * p0, cy0 + ry0 * p0, z0, cx0 + rx0 * p0 + rd.tx[i] * 1.4, cy0 + ry0 * p0 + rd.ty[i] * 1.4, z0, cx0 + rx0 * p0 + rd.tx[i] * 1.4, cy0 + ry0 * p0 + rd.ty[i] * 1.4, z0 + 4.6, cx0 + rx0 * p0, cy0 + ry0 * p0, z0 + 4.6); }
      }
      // roadside scenery at this sample
      this.scenery(c, rd, i, z0, fogT, tick);
      // cars on this strip
      const here = buckets.get(k);
      if (here) for (const car of here.sort((a, b) => (a.human ? 1 : 0) - (b.human ? 1 : 0))) this.drawCar(c, car, me, rd, tick, fogT);
    }

    // barrier sparks (yours and anyone scraping in view) and tyre smoke
    this.spawnSparks(r, rd);
    this.sparks = this.sparks.filter((s) => (s.life -= 0.05) > 0);
    for (const s of this.sparks) {
      s.x += s.vx; s.y += s.vy; s.vy += 0.35;
      c.strokeStyle = s.life > 0.6 ? "#fffbe0" : s.life > 0.3 ? "#ffd04a" : "#ff7a2a"; c.lineWidth = s.life > 0.5 ? 2 : 1.4;
      c.beginPath(); c.moveTo(s.x, s.y); c.lineTo(s.x - s.vx * 1.6, s.y - s.vy * 1.6); c.stroke();
    }
    // speed lines when turbo is lit or we are really moving
    const rush = clamp((speed - 250) / 220) + (me.boost > 0 ? 0.6 : 0);
    if (rush > 0.05) {
      c.strokeStyle = `rgba(255,255,255,${0.18 * clamp(rush)})`; c.lineWidth = 1.4;
      for (let s = 0; s < 14; s++) {
        const a = hash(s * 13 + Math.floor(tick / 2)) * Math.PI * 2, r0 = 230 + hash(s) * 60, r1 = r0 + 70 + rush * 70;
        c.beginPath(); c.moveTo(VW / 2 + Math.cos(a) * r0, HOR + 90 + Math.sin(a) * r0 * 0.6); c.lineTo(VW / 2 + Math.cos(a) * r1, HOR + 90 + Math.sin(a) * r1 * 0.6); c.stroke();
      }
    }
    if (me.drifting && tick % 2 === 0) for (const sx of [-1, 1]) this.puffs.push({ x: VW / 2 + sx * 40, y: 372, vx: sx * (0.4 + Math.random() * 0.8), vy: -0.3 - Math.random() * 0.4, r: 6, a: 0.55 });
    this.puffs = this.puffs.filter((p) => (p.a -= 0.018) > 0);
    for (const p of this.puffs) { p.x += p.vx; p.y += p.vy; p.r += 0.9; c.fillStyle = `rgba(235,235,245,${p.a})`; c.beginPath(); c.arc(p.x, p.y, p.r, 0, Math.PI * 2); c.fill(); }
    const vg = c.createRadialGradient(VW / 2, VH / 2, 230, VW / 2, VH / 2, 500); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(1, "rgba(0,0,0,0.38)");
    c.fillStyle = vg; c.fillRect(0, 0, VW, VH);
    c.restore();

    this.hud(c, r, me, speed, tick, rd);
  }

  private spawnSparks(r: Race, rd: Road) {
    for (const car of r.cars) {
      if (car.scrape < 150 || Math.hypot(car.vx, car.vy) < 30) continue;
      const ca = Math.cos(car.angle), sa = Math.sin(car.angle), s = car.scrapeSide;
      const lx = (Math.random() - 0.5) * 18, ly = s * 7.2;
      if (!project(car.x + ca * lx - sa * ly, car.y + sa * lx + ca * ly, this.zAt(car, rd) + 1.5) || P.f > 500) continue;
      const nSp = car.human ? 4 : 2;
      const dir = (-ly * cosA * 0) + (s * ((-sa) * -sinA + ca * cosA) > 0 ? 1 : -1); void dir;
      for (let q = 0; q < nSp; q++) this.sparks.push({ x: P.x, y: P.y, vx: (Math.random() - 0.5) * 7 * Math.min(1.5, P.k * 3), vy: -1.5 - Math.random() * 4 * Math.min(1.5, P.k * 3), life: 0.8 + Math.random() * 0.4 });
    }
    if (this.sparks.length > 160) this.sparks.splice(0, this.sparks.length - 160);
  }

  private zAt(car: Car, rd: Road) {
    const i = car.idx, n = rd.n;
    const tr = track();
    const along = (car.x - tr.pts[i].x) * rd.tx[i] + (car.y - tr.pts[i].y) * rd.ty[i];
    const slope = (rd.z[(i + 1) % n] - rd.z[(i + n - 1) % n]) / (2 * rd.spacing);
    return rd.z[i] + slope * along;
  }

  private drawCar(c: CanvasRenderingContext2D, car: Car, me: Car, rd: Road, tick: number, fogT: number) {
    const gz = this.zAt(car, rd);
    if (!project(car.x, car.y, gz)) return;
    if (car !== me && P.f < 26) return; // right beside the camera: out of shot
    const w = 14 * P.k;
    if (w < 2) return;
    drawCarModel(c, car, gz, fogT * 0.8, tick, w < 22);
    if (car !== me && w > 34 && project(car.x, car.y, gz + 11)) { // rivals get a little tag when they are close
      c.font = "bold 11px Impact, sans-serif"; c.textAlign = "center"; c.textBaseline = "alphabetic";
      c.fillStyle = "rgba(5,3,12,0.55)"; const tw = c.measureText(car.name).width + 8; c.fillRect(P.x - tw / 2, P.y - 14, tw, 13);
      c.fillStyle = "#fff6e0"; c.fillText(car.name, P.x, P.y - 4);
    }
  }

  private drawPad(c: CanvasRenderingContext2D, p: { x: number; y: number }, rd: Road, i: number, z: number, tick: number, fogT: number) {
    const tx = rd.tx[i], ty = rd.ty[i], rx = rd.rx[i], ry = rd.ry[i];
    const at = (a: number, b: number, k: number) => { QX[k] = p.x + tx * a + rx * b; QY[k] = p.y + ty * a + ry * b; QZ[k] = z + 0.02; };
    const glow = 0.5 + 0.35 * Math.sin(tick / 6);
    const HL = RACE.PAD_HL, HW = RACE.PAD_HW; // exactly the area the physics tests
    for (let k = 0; k < 4; k++) at([-HL, HL, HL, -HL][k], [-HW, -HW, HW, HW][k], k);
    fillPoly(c, 4, `rgba(20,90,150,${0.85 * (1 - fogT)})`);
    for (let k = 0; k < 4; k++) at([-HL + 2, HL - 2, HL - 2, -HL + 2][k], [-HW + 2, -HW + 2, HW - 2, HW - 2][k], k);
    fillPoly(c, 4, `rgba(40,160,220,${0.8 * (1 - fogT)})`);
    for (const off of [-11, 0, 11]) {
      const pts: [number, number][] = [[7, 0], [-1, 13], [-6, 13], [2, 0], [-6, -13], [-1, -13]];
      pts.forEach(([a, b], k) => at(a + off, b, k));
      fillPoly(c, 6, `rgba(220,255,255,${(glow + (off === ((Math.floor(tick / 5) % 3) - 1) * 11 ? 0.3 : 0)) * (1 - fogT)})`);
    }
  }

  private drawOil(c: CanvasRenderingContext2D, p: { x: number; y: number }, rd: Road, i: number, z: number, fogT: number) {
    const tx = rd.tx[i], ty = rd.ty[i], rx = rd.rx[i], ry = rd.ry[i];
    for (const [sc, col] of [[1, "rgba(5,3,12,0.92)"], [0.62, "rgba(60,40,90,0.7)"], [0.32, "rgba(155,93,229,0.45)"]] as [number, string][]) {
      for (let k = 0; k < 14; k++) { const a = (k / 14) * Math.PI * 2, e1 = Math.cos(a) * RACE.OIL_RX * sc * (1 + 0.12 * Math.sin(a * 3)), e2 = Math.sin(a) * RACE.OIL_RY * sc; QX[k] = p.x + tx * e1 + rx * e2; QY[k] = p.y + ty * e1 + ry * e2; QZ[k] = z + 0.03; }
      fillPoly(c, 14, fogT > 0.5 ? "rgba(5,3,12,0.4)" : col);
    }
  }

  /** Trees, rocks, chevron signs, billboards and the overhead gantries beside / over the road at sample `i`. */
  private scenery(c: CanvasRenderingContext2D, rd: Road, i: number, z: number, fogT: number, tick: number) {
    const tr = track();
    const A = art!;
    const px = tr.pts[i].x, py = tr.pts[i].y, rx = rd.rx[i], ry = rd.ry[i];
    const sprite = (img: HTMLCanvasElement, o: number, worldH: number) => {
      if (!project(px + rx * o, py + ry * o, z)) return;
      const h = worldH * P.k, w = (h * img.width) / img.height;
      if (h < 3 || P.x + w / 2 < 0 || P.x - w / 2 > VW) return;
      c.globalAlpha = 1 - fogT * 0.85;
      c.drawImage(img, P.x - w / 2, P.y - h, w, h);
      c.globalAlpha = 1;
    };
    // pines, bushes and boulders on the open side, all behind the barrier
    if (i % 3 === 0) for (const s of [-1, 1] as const) {
      const wall = s < 0 ? rd.cliffL[i] : rd.cliffR[i];
      if (wall > 4) { if (hash(i * 23 + s) < 0.3) sprite(A.rocks[i & 1], s * (RACE.EDGE + 6 + hash(i) * 6), 9 + hash(i * 3) * 6); continue; }
      const roll = hash(i * 11 + s * 3);
      const o = s * (RACE.EDGE + 26 + hash(i * 17 + s) * 150);
      if (roll < 0.55) sprite(A.pines[(i + (s > 0 ? 1 : 0)) % 3], o, 46 + hash(i) * 26);
      else if (roll < 0.75) sprite(A.bush, o, 10 + hash(i * 5) * 5);
      else if (roll < 0.85) sprite(A.rocks[(i >> 1) & 1], o, 12 + hash(i * 7) * 8);
    }
    // chevron boards on the outside of tight bends, behind the barrier
    const turn = rd.turn[i];
    if (Math.abs(turn) > 0.2 && i % 4 === 0) {
      const s = turn > 0 ? -1 : 1, wall = s < 0 ? rd.cliffL[i] : rd.cliffR[i];
      if (wall < 4 && project(px + rx * s * (RACE.EDGE + 6), py + ry * s * (RACE.EDGE + 6), z)) {
        const k = P.k, w = 14 * k;
        if (w > 4) {
          const bx = P.x, by = P.y;
          c.fillStyle = fog([30, 24, 20], fogT); c.fillRect(bx - w * 0.05, by - w * 1.2, w * 0.1, w * 1.2);
          c.fillStyle = fog([255, 206, 38], fogT); c.fillRect(bx - w / 2, by - w * 1.9, w, w * 0.95);
          c.fillStyle = fog([200, 150, 20], fogT); c.fillRect(bx - w / 2, by - w * 0.98, w, w * 0.06);
          c.strokeStyle = fog([20, 16, 24], fogT); c.lineWidth = Math.max(1.5, w * 0.11); c.lineJoin = "miter";
          const d = turn > 0 ? 1 : -1;
          c.beginPath(); c.moveTo(bx - d * w * 0.16, by - w * 1.78); c.lineTo(bx + d * w * 0.16, by - w * 1.42); c.lineTo(bx - d * w * 0.16, by - w * 1.1); c.stroke();
        }
      }
    }
    // billboards
    if (i % 36 === 12) {
      const s = i % 72 === 12 ? 1 : -1, wall = s < 0 ? rd.cliffL[i] : rd.cliffR[i];
      if (wall < 4 && project(px + rx * s * 96, py + ry * s * 96, z)) {
        const k = P.k, w = 46 * k, h = 20 * k;
        if (w > 12) {
          const label = ["PIXEL CAFE", "TURBO BEANS", "NEON GP", "LATTE LAP"][(i / 36) % 4 | 0];
          c.fillStyle = fog([38, 28, 22], fogT); c.fillRect(P.x - w * 0.36, P.y - h * 1.9, w * 0.05, h * 1.9); c.fillRect(P.x + w * 0.31, P.y - h * 1.9, w * 0.05, h * 1.9);
          const g = c.createLinearGradient(0, P.y - h * 3, 0, P.y - h * 1.5); g.addColorStop(0, fog([255, 120, 60], fogT)); g.addColorStop(1, fog([217, 48, 74], fogT));
          c.fillStyle = g; c.fillRect(P.x - w / 2, P.y - h * 3, w, h * 1.5); c.strokeStyle = fog([250, 240, 220], fogT); c.lineWidth = Math.max(1, w * 0.02); c.strokeRect(P.x - w / 2, P.y - h * 3, w, h * 1.5);
          if (w > 40) { c.font = `bold ${Math.round(h * 0.7)}px Impact, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = fog([255, 250, 230], fogT); c.fillText(label, P.x, P.y - h * 2.25); }
        }
      }
    }
    // overhead gantries every 90 samples (the first one is START / FINISH); the legs stand behind the barriers
    if (i % 90 === 0) {
      const H = 56, span = RACE.EDGE + 4;
      const pl = [px - rx * span, py - ry * span], pr = [px + rx * span, py + ry * span];
      const a = project(pl[0], pl[1], z), ax = P.x, ay = P.y, ak = P.k;
      const b = project(pl[0], pl[1], z + H), by = P.y;
      const c2 = project(pr[0], pr[1], z), cx = P.x, cy = P.y;
      const d = project(pr[0], pr[1], z + H), dy2 = P.y;
      if (a && b && c2 && d) {
        const pw = Math.max(2, 5 * ak);
        const steel = fog([96, 102, 122], fogT), steelD = fog([44, 48, 64], fogT), steelL = fog([170, 176, 196], fogT);
        for (const [x, y0, y1] of [[ax, ay, by], [cx, cy, dy2]] as const) { c.fillStyle = steel; c.fillRect(x - pw / 2, y1, pw, y0 - y1); c.fillStyle = steelL; c.fillRect(x - pw / 2, y1, pw * 0.25, y0 - y1); c.fillStyle = steelD; c.fillRect(x + pw * 0.15, y1, pw * 0.35, y0 - y1); }
        c.fillStyle = steel; c.fillRect(ax - pw, by - pw * 1.2, cx - ax + pw * 2, pw * 2.2);
        c.fillStyle = steelL; c.fillRect(ax - pw, by - pw * 1.2, cx - ax + pw * 2, pw * 0.4);
        c.strokeStyle = steelD; c.lineWidth = Math.max(1, pw * 0.25);
        const nTruss = 14;
        c.beginPath(); for (let t = 0; t <= nTruss; t++) { const xx = ax + ((cx - ax) * t) / nTruss; c.moveTo(xx, by - pw * 1.1); c.lineTo(xx + ((cx - ax) / nTruss) * 0.5, by + pw * 0.9); c.lineTo(xx + (cx - ax) / nTruss, by - pw * 1.1); } c.stroke();
        const bh = (ay - by) * 0.4, bt = by + pw;
        const start = i === 0;
        const bg = c.createLinearGradient(0, bt, 0, bt + bh);
        if (start) { bg.addColorStop(0, "#fff6e0"); bg.addColorStop(1, "#d8cfb8"); } else { bg.addColorStop(0, "#ffd21f"); bg.addColorStop(1, "#e6a000"); }
        c.fillStyle = bg; c.fillRect(ax + pw, bt, cx - ax - pw * 2, bh);
        if (!start) { c.save(); c.beginPath(); c.rect(ax + pw, bt, cx - ax - pw * 2, bh); c.clip(); c.fillStyle = "#1c1424"; for (let s = -4; s < 40; s++) { const x0 = ax + pw + s * bh * 0.5; c.beginPath(); c.moveTo(x0, bt + bh); c.lineTo(x0 + bh * 0.25, bt + bh); c.lineTo(x0 + bh * 0.25 + bh * 0.35, bt + bh * 0.7); c.lineTo(x0 + bh * 0.35, bt + bh * 0.7); c.fill(); } c.restore(); }
        c.strokeStyle = steelD; c.lineWidth = Math.max(1, pw * 0.3); c.strokeRect(ax + pw, bt, cx - ax - pw * 2, bh);
        if (bh > 14) { c.font = `bold ${Math.round(bh * 0.6)}px Impact, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle"; c.fillStyle = "#1c1424"; c.fillText(start ? "START / FINISH" : "CAUTION  ·  PIXEL CAFE GP", (ax + cx) / 2, bt + bh / 2 + 1); }
        if (Math.floor(tick / 18) % 2 === 0) for (const x of [ax, cx]) { const bg2 = c.createRadialGradient(x, by - pw * 1.8, 1, x, by - pw * 1.8, pw * 2.6); bg2.addColorStop(0, "rgba(255,200,60,0.95)"); bg2.addColorStop(1, "rgba(255,200,60,0)"); c.fillStyle = bg2; c.beginPath(); c.arc(x, by - pw * 1.8, pw * 2.6, 0, Math.PI * 2); c.fill(); }
      }
    }
  }

  // ------------------------------------------------------------------ HUD

  private hud(c: CanvasRenderingContext2D, r: Race, me: Car, speed: number, tick: number, rd: Road) {
    const FONT = "Impact, 'Arial Black', sans-serif";
    const text = (t: string, x: number, y: number, size: number, fill: string | CanvasGradient, align: CanvasTextAlign = "left", outline = "#0a0612", w = 4) => {
      c.font = `italic ${size}px ${FONT}`; c.textAlign = align; c.textBaseline = "alphabetic"; c.lineJoin = "round";
      c.lineWidth = w; c.strokeStyle = outline; c.strokeText(t, x, y); c.fillStyle = fill; c.fillText(t, x, y);
    };
    const pos = positions(r)[0];
    const lapNow = Math.max(0, r.t - RACE.COUNTDOWN_MS - me.lapStart);
    const gold = (y0: number, y1: number) => { const g = c.createLinearGradient(0, y0, 0, y1); g.addColorStop(0, "#fff7b0"); g.addColorStop(0.5, "#ffd21f"); g.addColorStop(1, "#ff9a1f"); return g; };

    // lap tracking: split against your best lap so far, and the final-lap call
    if (me.crossed && !this.seenLine) { this.seenLine = true; this.prevStart = me.lapStart; }
    if (me.lap > this.lastLap) {
      const justRan = me.lapStart - this.prevStart;
      this.prevStart = me.lapStart;
      if (Number.isFinite(this.bestSeen)) { const d = justRan - this.bestSeen; this.splitText = `SPLIT ${d <= 0 ? "-" : "+"}${(Math.abs(d) / 1000).toFixed(3)}`; this.splitGood = d <= 0; }
      else { this.splitText = `LAP ${me.lap}  ${fmtTime(justRan)}`; this.splitGood = true; }
      this.splitT = 180;
      this.bestSeen = Math.min(this.bestSeen, justRan);
      this.lastLap = me.lap;
      if (me.lap === RACE.LAPS - 1) { this.lapFlashText = "FINAL LAP"; this.lapFlash = 150; }
    }

    // top-left: LAP / TIME / BEST in a brushed-metal frame with LCD readouts
    metalPanel(c, 8, 8, 226, 98, 14);
    text("LAP", 30, 36, 17, "#8fd0ff");
    text(`${Math.min(me.lap + 1, RACE.LAPS)}`, 92, 48, 42, gold(18, 50), "right");
    text(`/${RACE.LAPS}`, 96, 48, 22, "#fff6e0");
    lcd(c, 132, 18, 88, 30);
    seg7(c, String(Math.max(0, Math.min(99, Math.floor((r.t - RACE.COUNTDOWN_MS) / 1000)))).padStart(2, "0"), 216, 22, 22, "#ffb52e", 1);
    c.font = "bold 9px Arial, sans-serif"; c.fillStyle = "#c8a060"; c.textAlign = "left"; c.fillText("RACE", 138, 44);
    text("TIME", 28, 74, 13, "#8fd0ff"); lcd(c, 66, 58, 154, 22); seg7(c, fmtTime(me.finishedAt ?? lapNow), 214, 61, 16, "#fff2c0", 1);
    text("BEST", 28, 98, 13, "#7fe0a9"); lcd(c, 66, 82, 154, 20); seg7(c, Number.isFinite(me.best) ? fmtTime(me.best) : "-:--.---", 214, 85, 14, "#7fe0a9", 1);
    if (this.splitT > 0) { this.splitT--; c.globalAlpha = clamp(this.splitT / 30); text(this.splitText, 12, 132, 26, this.splitGood ? "#7fe0a9" : "#ff6a5a"); c.globalAlpha = 1; }

    // top-centre: the tachometer with a chrome bezel, gear, and a digital MPH read-out
    const cxT = VW / 2, cyT = 72, R = 54;
    const bez = c.createLinearGradient(cxT - R, cyT - R - 14, cxT + R, cyT + R + 14); bez.addColorStop(0, "#f4f6fa"); bez.addColorStop(0.3, "#8a90a0"); bez.addColorStop(0.55, "#e0e4ec"); bez.addColorStop(1, "#3a3e4c");
    c.beginPath(); c.arc(cxT, cyT, R + 16, 0, Math.PI * 2); c.fillStyle = "#06040c"; c.fill();
    c.beginPath(); c.arc(cxT, cyT, R + 14, 0, Math.PI * 2); c.fillStyle = bez; c.fill();
    const dg = c.createRadialGradient(cxT, cyT - 16, 8, cxT, cyT, R + 9); dg.addColorStop(0, "#2a1e4e"); dg.addColorStop(1, "#06040e");
    c.beginPath(); c.arc(cxT, cyT, R + 9, 0, Math.PI * 2); c.fillStyle = dg; c.fill();
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    const bounds = [0, 70, 130, 200, 270, 340];
    let gear = 1; for (let g = 1; g <= 5; g++) if (speed >= bounds[g - 1]) gear = g;
    const frac = clamp((speed - bounds[gear - 1]) / (bounds[gear] - bounds[gear - 1]));
    const target = speed < 4 ? 0.12 : 0.3 + 0.68 * frac ** 0.9 + (me.boost > 0 ? 0.05 : 0);
    this.rpm += (clamp(target) - this.rpm) * 0.3;
    c.lineWidth = 7; c.lineCap = "butt";
    c.strokeStyle = "#1f6fd0"; c.beginPath(); c.arc(cxT, cyT, R - 5, a0, a0 + sweep * 0.7); c.stroke();
    c.strokeStyle = "#ffd21f"; c.beginPath(); c.arc(cxT, cyT, R - 5, a0 + sweep * 0.7, a0 + sweep * 0.86); c.stroke();
    c.strokeStyle = "#ff3a2a"; c.beginPath(); c.arc(cxT, cyT, R - 5, a0 + sweep * 0.86, a0 + sweep); c.stroke();
    c.lineWidth = 4; c.strokeStyle = "rgba(255,255,255,0.85)"; c.beginPath(); c.arc(cxT, cyT, R - 13, a0, a0 + sweep * this.rpm); c.stroke();
    c.font = `bold 11px ${FONT}`; c.textAlign = "center"; c.textBaseline = "middle";
    for (let t = 0; t <= 16; t++) {
      const a = a0 + (sweep * t) / 16, major = t % 2 === 0;
      c.strokeStyle = "#fff6e0"; c.lineWidth = major ? 2 : 1; c.beginPath(); c.moveTo(cxT + Math.cos(a) * (R + (major ? -1 : 2)), cyT + Math.sin(a) * (R + (major ? -1 : 2))); c.lineTo(cxT + Math.cos(a) * (R + 6), cyT + Math.sin(a) * (R + 6)); c.stroke();
      if (major) { c.fillStyle = t >= 14 ? "#ff7a6a" : "#fff6e0"; c.fillText(String(t / 2), cxT + Math.cos(a) * (R - 21), cyT + Math.sin(a) * (R - 21)); }
    }
    c.font = "bold 7px Arial, sans-serif"; c.fillStyle = "#8fa0c8"; c.fillText("x1000 RPM", cxT, cyT + 30);
    const na = a0 + sweep * this.rpm;
    c.strokeStyle = "#ff3a2a"; c.lineWidth = 3; c.lineCap = "round"; c.beginPath(); c.moveTo(cxT - Math.cos(na) * 8, cyT - Math.sin(na) * 8); c.lineTo(cxT + Math.cos(na) * (R - 4), cyT + Math.sin(na) * (R - 4)); c.stroke(); c.lineCap = "butt";
    const hub = c.createRadialGradient(cxT - 2, cyT - 2, 0, cxT, cyT, 6); hub.addColorStop(0, "#ffffff"); hub.addColorStop(1, "#6a7080");
    c.fillStyle = hub; c.beginPath(); c.arc(cxT, cyT, 5.5, 0, Math.PI * 2); c.fill();
    const hot = this.rpm > 0.93 && Math.floor(tick / 4) % 2 === 0;
    text(String(gear), cxT, cyT + 8, 32, hot ? "#ff6a5a" : gold(cyT - 24, cyT + 8), "center", "#06040c", 5);
    text("GEAR", cxT, cyT + 21, 9, "#8fd0ff", "center", "#06040c", 3);
    const mph = Math.round(speed * 0.52);
    metalPanel(c, cxT - 58, cyT + R + 4, 116, 38, 0);
    lcd(c, cxT - 50, cyT + R + 10, 72, 26);
    seg7(c, String(mph).padStart(3, " "), cxT + 18, cyT + R + 13, 20, me.boost > 0 ? "#58e1ff" : "#fff2c0", 1);
    text("MPH", cxT + 26, cyT + R + 33, 14, "#8fd0ff", "left", "#06040c", 3);

    // top-right: position and the minimap
    metalPanel(c, VW - 234, 8, 226, 98, -14);
    text("POSITION", VW - 204, 34, 15, "#8fd0ff");
    text(`${pos}`, VW - 110, 86, 58, gold(40, 88), "right");
    text(`/${RACE.FIELD}`, VW - 104, 86, 26, "#fff6e0");
    text(ord(pos), VW - 34, 36, 22, "#ffd21f", "right");
    const mx = VW - 152, my = 112, mw = 144, mh = 122;
    metalPanel(c, mx, my, mw, mh, 0);
    c.fillStyle = "rgba(6,14,30,0.92)"; c.beginPath(); c.roundRect(mx + 6, my + 6, mw - 12, mh - 12, 6); c.fill();
    c.strokeStyle = "rgba(80,140,220,0.18)"; c.lineWidth = 1; for (let gx = mx + 14; gx < mx + mw - 6; gx += 12) { c.beginPath(); c.moveTo(gx, my + 6); c.lineTo(gx, my + mh - 6); c.stroke(); } for (let gy = my + 14; gy < my + mh - 6; gy += 12) { c.beginPath(); c.moveTo(mx + 6, gy); c.lineTo(mx + mw - 6, gy); c.stroke(); }
    const sc = Math.min((mw - 28) / (rd.maxX - rd.minX), (mh - 28) / (rd.maxY - rd.minY));
    const ox = mx + mw / 2 - ((rd.minX + rd.maxX) / 2) * sc, oy = my + mh / 2 - ((rd.minY + rd.maxY) / 2) * sc;
    const tr = track();
    const trace = () => { c.beginPath(); tr.pts.forEach((p, k) => (k ? c.lineTo(ox + p.x * sc, oy + p.y * sc) : c.moveTo(ox + p.x * sc, oy + p.y * sc))); c.closePath(); };
    c.lineJoin = "round"; c.lineCap = "round";
    c.strokeStyle = "#05030c"; c.lineWidth = 7; trace(); c.stroke();
    c.strokeStyle = "#6b7bb0"; c.lineWidth = 4; trace(); c.stroke();
    c.strokeStyle = "#b9c6f0"; c.lineWidth = 1.2; trace(); c.stroke();
    const s0 = tr.pts[0]; c.fillStyle = "#fff"; c.fillRect(ox + s0.x * sc - 1.5, oy + s0.y * sc - 5, 3, 10);
    for (const car of [...r.cars].reverse()) {
      if (car.human) continue;
      c.fillStyle = car.color; c.strokeStyle = "#05030c"; c.lineWidth = 1; c.beginPath(); c.arc(ox + car.x * sc, oy + car.y * sc, 2.6, 0, Math.PI * 2); c.fill(); c.stroke();
    }
    c.save(); c.translate(ox + me.x * sc, oy + me.y * sc); c.rotate(me.angle);
    c.fillStyle = `rgba(255,255,255,${0.35 + 0.25 * Math.sin(tick / 5)})`; c.beginPath(); c.arc(0, 0, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ffd21f"; c.strokeStyle = "#05030c"; c.lineWidth = 1.5; c.beginPath(); c.moveTo(6.5, 0); c.lineTo(-4.5, -4.5); c.lineTo(-2.5, 0); c.lineTo(-4.5, 4.5); c.closePath(); c.fill(); c.stroke();
    c.restore();

    // bottom-left: the turbo gauge as a segmented LED bar (out of the way of your car)
    const bx = 22, by = VH - 26;
    metalPanel(c, bx - 12, by - 26, 236, 46, 10);
    const ch = me.boost > 0 ? clamp(me.boost / 1000) : clamp(me.charge / 0.9);
    const segs = 20;
    for (let sgi = 0; sgi < segs; sgi++) {
      const on = sgi < Math.round(ch * segs);
      const hue = sgi / segs;
      const col = on ? (me.boost > 0 ? (Math.floor(tick / 3) % 2 ? "#ffffff" : "#9ef0ff") : hue < 0.7 ? "#2b9bff" : hue < 0.9 ? "#58e1ff" : "#d8ffff") : "#14203a";
      c.fillStyle = col; c.fillRect(bx + sgi * 10, by, 8, 12);
      if (on) { c.fillStyle = "rgba(255,255,255,0.35)"; c.fillRect(bx + sgi * 10, by, 8, 3); }
    }
    text(me.boost > 0 ? "TURBO!" : me.charge > 0.9 ? "RELEASE DRIFT!" : me.drifting ? "DRIFTING" : "TURBO", bx + 2, by - 6, 15, me.boost > 0 || me.charge > 0.9 ? "#58e1ff" : "#fff6e0", "left", "#06040c", 3.5);

    // start lights / GO / final lap
    const cd = RACE.COUNTDOWN_MS - r.t;
    if (cd > 0) {
      const litN = 3 - Math.ceil(cd / 1000) + 1;
      metalPanel(c, VW / 2 - 84, 228, 168, 64, 0);
      for (let k = 0; k < 3; k++) { const on = k < litN; const g = c.createRadialGradient(VW / 2 - 46 + k * 46 - 4, 256, 2, VW / 2 - 46 + k * 46, 260, 17); g.addColorStop(0, on ? "#fff" : "#3a3050"); g.addColorStop(0.4, on ? (litN >= 3 ? "#5dff9a" : "#ff4a4a") : "#241c38"); g.addColorStop(1, on ? (litN >= 3 ? "#0a8a3a" : "#8a0a14") : "#120c20"); c.fillStyle = "#06040c"; c.beginPath(); c.arc(VW / 2 - 46 + k * 46, 260, 18, 0, Math.PI * 2); c.fill(); c.fillStyle = g; c.beginPath(); c.arc(VW / 2 - 46 + k * 46, 260, 16, 0, Math.PI * 2); c.fill(); }
      text("GET READY", VW / 2, 322, 30, "#fff6e0", "center");
    } else if (r.t < RACE.COUNTDOWN_MS + 1000) {
      const k = (r.t - RACE.COUNTDOWN_MS) / 1000;
      c.save(); c.translate(VW / 2, 190); c.scale(1 + k * 0.4, 1 + k * 0.4); c.globalAlpha = 1 - k; text("GO!", 0, 0, 90, "#7fe0a9", "center", "#06301a", 8); c.restore();
    }
    if (this.lapFlash > 0) { this.lapFlash--; c.save(); c.globalAlpha = clamp(this.lapFlash / 30); text(this.lapFlashText, VW / 2, 215, 54, gold(185, 225), "center", "#4a0610", 7); c.restore(); }
    if (me.finishedAt !== null) text("FINISH!", VW / 2, 215, 64, gold(180, 224), "center", "#4a0610", 8);
  }
}

/** Nearest centreline sample to a point, searching around a hint index. */
function nearestIdx(x: number, y: number, hint: number, pts: { x: number; y: number }[]) {
  const n = pts.length;
  let best = hint, bd = Infinity;
  for (let k = -16; k <= 8; k++) { const i = (hint + k + n) % n, d = Math.hypot(pts[i].x - x, pts[i].y - y); if (d < bd) { bd = d; best = i; } }
  return best;
}

// ------------------------------------------------------------------ dashboard parts

/** A brushed-metal bezel with a dark glass centre and corner screws (skew > 0 leans right, < 0 leans left). */
function metalPanel(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, skew: number) {
  const path = (inset: number) => {
    c.beginPath();
    if (skew === 0) { c.roundRect(x + inset, y + inset, w - inset * 2, h - inset * 2, Math.max(2, 7 - inset)); return; }
    const s = skew;
    const pts = s > 0 ? [[x + s + inset, y + inset], [x + w - inset, y + inset], [x + w - s - inset, y + h - inset], [x + inset, y + h - inset]] : [[x + inset, y + inset], [x + w + s - inset, y + inset], [x + w - inset, y + h - inset], [x - s + inset, y + h - inset]];
    pts.forEach(([px, py], k) => (k ? c.lineTo(px, py) : c.moveTo(px, py))); c.closePath();
  };
  path(-1); c.fillStyle = "#06040c"; c.fill();
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#eef1f6"); g.addColorStop(0.18, "#a9afbd"); g.addColorStop(0.5, "#6c7282"); g.addColorStop(0.82, "#9aa0ae"); g.addColorStop(1, "#3e4250");
  path(0); c.fillStyle = g; c.fill();
  c.save(); path(0); c.clip(); c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = 1; for (let k = 0; k < h; k += 2) { c.beginPath(); c.moveTo(x - 20, y + k); c.lineTo(x + w + 20, y + k + 0.5); c.stroke(); } c.restore();
  path(4); const gl = c.createLinearGradient(0, y + 4, 0, y + h - 4); gl.addColorStop(0, "rgba(22,14,48,0.95)"); gl.addColorStop(1, "rgba(8,6,20,0.95)"); c.fillStyle = gl; c.fill();
  path(4); c.strokeStyle = "rgba(0,0,0,0.7)"; c.lineWidth = 1.5; c.stroke();
  path(5); c.strokeStyle = "rgba(255,255,255,0.08)"; c.lineWidth = 1; c.stroke();
  if (w > 60 && h > 30) for (const [sx, sy] of [[x + 6 + Math.max(0, skew), y + 6], [x + w - 6 - Math.max(0, -skew), y + 6], [x + 6 + Math.max(0, -skew), y + h - 6], [x + w - 6 - Math.max(0, skew), y + h - 6]]) {
    const sg = c.createRadialGradient(sx - 0.6, sy - 0.6, 0, sx, sy, 2.4); sg.addColorStop(0, "#ffffff"); sg.addColorStop(1, "#4a4e5c");
    c.fillStyle = sg; c.beginPath(); c.arc(sx, sy, 2.2, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#2a2c36"; c.lineWidth = 0.8; c.beginPath(); c.moveTo(sx - 1.4, sy); c.lineTo(sx + 1.4, sy); c.stroke();
  }
}

/** An inset LCD window. */
function lcd(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.fillStyle = "#040208"; c.beginPath(); c.roundRect(x, y, w, h, 3); c.fill();
  const g = c.createLinearGradient(0, y, 0, y + h); g.addColorStop(0, "#1a1206"); g.addColorStop(1, "#0a0703");
  c.fillStyle = g; c.beginPath(); c.roundRect(x + 1.5, y + 1.5, w - 3, h - 3, 2); c.fill();
  c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(x + 2, y + 2, w - 4, (h - 4) * 0.4);
}

// seven-segment digits: segments a b c d e f g
const SEG: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcfgd", "-": "g", " ": "" };
/** Draw an italic 7-segment string right-aligned at x (top y, height h), with dim "off" segments behind. */
function seg7(c: CanvasRenderingContext2D, s: string, x: number, y: number, h: number, col: string, align: 0 | 1 = 1) {
  const w = h * 0.52, t = Math.max(1.6, h * 0.13), gap = h * 0.18, sk = h * 0.12;
  const widthOf = (ch: string) => (ch === ":" || ch === "." ? w * 0.4 : w + gap);
  let total = 0; for (const ch of s) total += widthOf(ch);
  let cx = align ? x - total : x;
  const seg = (ox: number, name: string, on: boolean) => {
    c.fillStyle = on ? col : "rgba(255,180,80,0.07)";
    const X = (px: number, py: number) => ox + px + sk * (1 - py / h);
    const hs = (py: number, x0: number, x1: number) => { c.beginPath(); c.moveTo(X(x0 + t * 0.5, py), y + py); c.lineTo(X(x0 + t, py - t / 2), y + py - t / 2); c.lineTo(X(x1 - t, py - t / 2), y + py - t / 2); c.lineTo(X(x1 - t * 0.5, py), y + py); c.lineTo(X(x1 - t, py + t / 2), y + py + t / 2); c.lineTo(X(x0 + t, py + t / 2), y + py + t / 2); c.closePath(); c.fill(); };
    const vs = (px: number, y0: number, y1: number) => { c.beginPath(); c.moveTo(X(px, y0 + t * 0.5), y + y0 + t * 0.5); c.lineTo(X(px + t / 2, y0 + t), y + y0 + t); c.lineTo(X(px + t / 2, y1 - t), y + y1 - t); c.lineTo(X(px, y1 - t * 0.5), y + y1 - t * 0.5); c.lineTo(X(px - t / 2, y1 - t), y + y1 - t); c.lineTo(X(px - t / 2, y0 + t), y + y0 + t); c.closePath(); c.fill(); };
    if (name === "a") hs(t / 2, 0, w); else if (name === "g") hs(h / 2, 0, w); else if (name === "d") hs(h - t / 2, 0, w);
    else if (name === "f") vs(t / 2, 0, h / 2); else if (name === "b") vs(w - t / 2, 0, h / 2); else if (name === "e") vs(t / 2, h / 2, h); else if (name === "c") vs(w - t / 2, h / 2, h);
  };
  for (const ch of s) {
    if (ch === ":" || ch === ".") {
      c.fillStyle = col;
      if (ch === ":") { c.fillRect(cx + sk * 0.6, y + h * 0.28, t, t); c.fillRect(cx + sk * 0.2, y + h * 0.68, t, t); } else c.fillRect(cx, y + h - t, t, t);
      cx += widthOf(ch); continue;
    }
    const on = SEG[ch] ?? "";
    for (const sn of "abcdefg") seg(cx, sn, on.includes(sn));
    cx += widthOf(ch);
  }
}
