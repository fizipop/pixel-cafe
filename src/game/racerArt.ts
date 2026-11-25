// Neon Drift GP: a late-90s 32-bit arcade racer presentation. The simulation (src/shared/racer.ts) is flat top-down
// physics; this file turns it into a behind-the-car 3D view by projecting the real track centreline, road edges,
// barriers, hills, scenery and cars through a perspective camera, then draws a metal-framed arcade dashboard.
//   * cars are real 3D polygon models (flat-shaded with metallic sheen gradients, glass, lights, wheels, spoilers),
//     painter-sorted per face, so they have correct perspective and rotate properly as they yaw; three body styles
//     keep the player's car distinct from the CPU field
//   * the road is built strip by strip: asphalt grain and tyre wear, lane dashes, red/white curbs, grass run-off,
//     a steel barrier exactly where the physics barrier is, layered canyon walls, and sprite-scaled pines and rocks
//   * barrier contact throws sparks and shakes the camera
import { RACE, STRIPES, cliffAt, elevation, fmtTime, groundClearance, positions, roadFrame, track, type Car, type Race } from "../shared/racer";

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

/** clearL / clearR: how far (world units) the ground beside sample i, on that side, still belongs to sample i before it
 *  reaches ground nearer to some other part of the circuit (the inside of a hairpin, or another stretch of track that
 *  loops back alongside). Everything drawn beside the road is clamped to it, so no strip's grass, gravel, curbs, rails,
 *  cliffs or trees can ever lie across another strip's asphalt in world space. */
type Road = { n: number; tx: Float64Array; ty: Float64Array; rx: Float64Array; ry: Float64Array; z: Float64Array; turn: Float64Array; cliffL: Float64Array; cliffR: Float64Array; clearL: Float64Array; clearR: Float64Array; spacing: number; minX: number; minY: number; maxX: number; maxY: number; padAt: Map<number, number>; oilAt: Map<number, number> };
let road: Road | null = null;

function roadCache(): Road {
  if (road) return road;
  const tr = track();
  const n = tr.pts.length;
  const mk = () => new Float64Array(n);
  const r: Road = { n, tx: tr.tx, ty: tr.ty, rx: tr.nx, ry: tr.ny, z: mk(), turn: mk(), cliffL: mk(), cliffR: mk(), clearL: mk(), clearR: mk(), spacing: tr.length / n, minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity, padAt: new Map(), oilAt: new Map() };
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
  for (let i = 0; i < n; i++) { r.clearL[i] = groundClearance(tr.pts, r.rx, r.ry, i, -1); r.clearR[i] = groundClearance(tr.pts, r.rx, r.ry, i, 1); }
  // smooth out single-sample spikes so the clamped edges run as clean curves, never wider than either neighbour allows
  for (const a of [r.clearL, r.clearR]) { const b = Float64Array.from(a); for (let i = 0; i < n; i++) a[i] = Math.min(b[i], (b[(i + n - 1) % n] + b[i] + b[(i + 1) % n]) / 3 + 6); }
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

/** Distance of a car ahead of the camera for painter sorting: its centre pulled halfway toward the body corner closest
 *  to the lens, so a car turned across the view sorts by the part of it that can actually overlap its neighbours. */
function carDepth(car: Car) {
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  const f = (car.x - camX) * cosA + (car.y - camY) * sinA;
  const reach = Math.abs(ca * cosA + sa * sinA) * RACE.CAR_HL + Math.abs(-sa * cosA + ca * sinA) * RACE.CAR_HW;
  return f - reach * 0.5; // between the centre and the nearest corner: robust for both nose-to-tail and side-by-side
}

// ------------------------------------------------------------------ 3D car models

// 90s 32-bit arcade GT racers: sculpted bodies built from 8-point cross-sections (rocker, belt line, fender crest and
// decklid), with real wheel arches cut into the sides so the dark rubber shows underneath, fender haunches standing
// proud of the decklid, a glasshouse with C-pillars and a glinting rear screen, multi-cell taillights, a diffuser with
// twin exhausts, racing stripes, sponsor bands and race numbers. Every car is built to exactly the physics box
// (RACE.CAR_HL x RACE.CAR_HW: bumper to bumper, outer tyre wall to outer tyre wall) so what you see touching the
// barrier or another car is exactly what the simulation is touching.
type Role = "body" | "bodyD" | "glass" | "glint" | "tail" | "tailBox" | "head" | "tyre" | "side" | "rim" | "hub" | "stripe" | "band" | "wing" | "dark" | "grille" | "well" | "diff" | "chrome" | "pipe" | "plate";
type Label = "roofNum" | "plateNum" | "doorNum";
/** decal: painted on another face (its host, found automatically) and drawn straight after it, in the order added.
 *  bias: painter-sort nudge (negative = drawn later), for parts that always sit in front of what is under them. */
type Face = { v: number[]; role: Role; decal?: boolean; twoSided?: boolean; detail?: boolean; label?: Label; cell?: number; o?: number[]; bias?: number };
type LabelSpot = { kind: Label; at: number[]; x: number[]; y: number[] }; // a decal rectangle: corner + two edge vectors (model space)
type Model = { verts: number[][]; faces: Face[]; exhaust: [number, number, number][]; tail: [number, number, number][]; labels: LabelSpot[]; kids: number[][] };

function buildModel(style: 0 | 1 | 2): Model {
  const verts: number[][] = [], faces: Face[] = [], labels: LabelSpot[] = [];
  const V = (u: number, v: number, h: number) => { verts.push([u, v, h]); return verts.length - 1; };
  const L = RACE.CAR_HL, W = RACE.CAR_HW;
  const tail = -L + 0.4, nose = L - 0.1, WR = -8.4, WF = 8.3, R = 2.4, TI = W - 1.6;
  // 0: low wedge supercar (the player), 1: GT coupe, 2: touring hatch
  const k = style === 0 ? { deck: 4.1, sh: 4.4, roof: 7.1, haunch: 0.9, nose: 2.3 }
    : style === 1 ? { deck: 4.5, sh: 4.8, roof: 7.9, haunch: 0.75, nose: 2.8 }
      : { deck: 5.0, sh: 5.2, roof: 8.5, haunch: 0.55, nose: 3.1 };
  // stations: [u, bottom of the side, rocker half-width, belt height, crest half-width, crest height, deck half-width, deck height]
  const ST: number[][] = [];
  const st = (u: number, bot: number, rw: number, belt: number, sw: number, sh: number, dw: number, dh: number) => {
    belt = Math.max(belt, bot + 0.15); sh = Math.max(sh, belt + 0.2); ST.push([u, bot, rw, belt, sw, sh, dw, Math.min(dh, sh)]);
  };
  const arch = (uc: number, sh: number, dh: number) => {
    const prof: [number, number, number, number, number][] = [[-2.9, 1.1, 6.75, 6.1, 0.3], [-2.0, 4.0, 6.88, 6.3, 0.8], [0, 5.0, 6.95, 6.4, 1], [2.0, 4.0, 6.88, 6.3, 0.8], [2.9, 1.1, 6.75, 6.1, 0.3]];
    for (const [du, bot, rw, sw, hk] of prof) st(uc + du, bot, rw, 2.9, sw, Math.max(sh + k.haunch * hk, bot > 4.5 ? 5.4 : 0), 3.6, dh);
  };
  st(tail, 1.6, 5.6, 2.6, 5.3, k.deck + 0.2, 3.6, k.deck + 0.15); // tapered tail with a ducktail lip: the rear tyres show at the corners
  st(-11.8, 1.3, 6.4, 2.8, 5.9, k.sh, 3.6, k.deck);
  arch(WR, k.sh, k.deck);
  st(-3.0, 1.0, 6.45, 2.9, 5.9, k.sh - 0.1, 3.6, k.deck - 0.05); // coke-bottle waist between the haunches
  st(2.5, 1.0, 6.45, 2.9, 5.9, k.sh - 0.3, 3.6, k.deck - 0.3);
  arch(WF, k.sh - 0.5, k.deck - 0.6);
  st(nose, 1.2, 5.4, 2.0, 4.6, k.nose, 3.0, k.nose - 0.1);
  const rings = ST.map(([u, bot, rw, belt, sw, sh, dw, dh]) => [V(u, -rw, bot), V(u, -rw, belt), V(u, -sw, sh), V(u, -dw, dh), V(u, dw, dh), V(u, sw, sh), V(u, rw, belt), V(u, rw, bot)]);
  const ROLES: Role[] = ["bodyD", "body", "body", "body", "body", "body", "bodyD"];
  for (let s = 0; s < rings.length - 1; s++) for (let q = 0; q < 7; q++) faces.push({ v: [rings[s][q], rings[s + 1][q], rings[s + 1][q + 1], rings[s][q + 1]], role: ROLES[q] });
  faces.push({ v: [...rings[0]].reverse(), role: "body" }, { v: [...rings[rings.length - 1]], role: "body" });
  const dhAt = (u: number) => { for (let s = 0; s < ST.length - 1; s++) if (u <= ST[s + 1][0]) { const t = (u - ST[s][0]) / (ST[s + 1][0] - ST[s][0]); return ST[s][7] + (ST[s + 1][7] - ST[s][7]) * t; } return ST[ST.length - 1][7]; };

  // wheel wells (dark, behind the tyres so you never see through the arches), then the tyres with rims and hubs
  for (const uc of [WR, WF]) for (const s of [-1, 1]) {
    const wv = s * (TI - 0.1);
    faces.push({ v: [V(uc - 2.9, wv, 0.9), V(uc - 2.0, wv, 4.0), V(uc, wv, 5.0), V(uc + 2.0, wv, 4.0), V(uc + 2.9, wv, 0.9)], role: "well", twoSided: true });
    const n = 10, r0: number[] = [], r1: number[] = [], rim: number[] = [], hub: number[] = [];
    for (let q = 0; q < n; q++) {
      const a = ((q + 0.5) / n) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      r0.push(V(uc + ca * R, s * TI, R + sa * R)); r1.push(V(uc + ca * R, s * W, R + sa * R));
      rim.push(V(uc + ca * R * 0.62, s * (W + 0.02), R + sa * R * 0.62)); hub.push(V(uc + ca * R * 0.22, s * (W + 0.03), R + sa * R * 0.22));
    }
    const o = [uc, s * (TI + W) / 2, R];
    for (let q = 0; q < n; q++) faces.push({ v: [r0[q], r0[(q + 1) % n], r1[(q + 1) % n], r1[q]], role: "tyre", o });
    faces.push({ v: r1, role: "side", o: [uc, 0, R] }, { v: rim, role: "rim", decal: true, detail: true, o: [uc, 0, R] }, { v: hub, role: "hub", decal: true, detail: true, o: [uc, 0, R] });
  }

  // glasshouse: windscreen, rear screen with a specular glint, side glass behind body-coloured C-pillars, roof
  const cab = style === 0 ? { r0: -6.8, f0: 2.6, r1: -4.6, f1: 0.0, w0: 5.4, w1: 4.3 }
    : style === 1 ? { r0: -7.6, f0: 3.0, r1: -5.0, f1: 0.6, w0: 5.5, w1: 4.5 }
      : { r0: -9.8, f0: 3.2, r1: -9.0, f1: 0.8, w0: 5.6, w1: 4.8 };
  const hb = k.sh - 0.15, co = [(cab.r0 + cab.f0) / 2, 0, hb];
  const bl = V(cab.r0, -cab.w0, hb), br = V(cab.r0, cab.w0, hb), fl = V(cab.f0, -cab.w0, hb - 0.2), fr = V(cab.f0, cab.w0, hb - 0.2);
  const tbl = V(cab.r1, -cab.w1, k.roof), tbr = V(cab.r1, cab.w1, k.roof), tfl = V(cab.f1, -cab.w1, k.roof), tfr = V(cab.f1, cab.w1, k.roof);
  faces.push({ v: [fl, fr, tfr, tfl], role: "glass", o: co }, { v: [br, bl, tbl, tbr], role: "glass", o: co }, { v: [tbl, tfl, tfr, tbr], role: "body", o: co, label: "roofNum" });
  const pil = style === 2 ? 0.18 : 0.3;
  for (const s of [-1, 1]) {
    const b0 = s < 0 ? bl : br, f0 = s < 0 ? fl : fr, t0 = s < 0 ? tbl : tbr, t1 = s < 0 ? tfl : tfr;
    const lerp = (a: number, b: number, t: number) => verts[a].map((x, i) => x + (verts[b][i] - x) * t);
    const mb = V(...(lerp(b0, f0, pil) as [number, number, number])), mt = V(...(lerp(t0, t1, pil * 0.6) as [number, number, number]));
    faces.push({ v: [b0, mb, mt, t0], role: "body", o: co }, { v: [mb, f0, t1, mt], role: "glass", o: co });
  }
  // the glint: a bright diagonal streak across the rear screen
  const rw = (sv: number, t: number) => { const a = verts[bl], b = verts[br], c = verts[tbl], d = verts[tbr]; const lo = [a[0] + (b[0] - a[0]) * (sv + 1) / 2, a[1] + (b[1] - a[1]) * (sv + 1) / 2, a[2]], hi = [c[0] + (d[0] - c[0]) * (sv + 1) / 2, c[1] + (d[1] - c[1]) * (sv + 1) / 2, c[2]]; return V(lo[0] + (hi[0] - lo[0]) * t - 0.03, lo[1] + (hi[1] - lo[1]) * t, lo[2] + (hi[2] - lo[2]) * t); };
  faces.push({ v: [rw(-0.72, 0.08), rw(-0.42, 0.08), rw(0.28, 0.92), rw(-0.02, 0.92)], role: "glint", decal: true, detail: true, o: co });
  faces.push({ v: [rw(-0.2, 0.08), rw(-0.1, 0.08), rw(0.5, 0.92), rw(0.4, 0.92)], role: "glint", decal: true, detail: true, o: co });
  labels.push({ kind: "roofNum", at: [(cab.r1 + cab.f1) / 2 + 1.7, -1.7, k.roof + 0.02], x: [0, 3.4, 0], y: [-3.4, 0, 0] });

  // livery: twin racing stripes over the hood, roof and decklid that follow the body's contours
  const [s0, s1] = style === 0 ? [0.6, 2.1] : [0.5, 1.6];
  const stripe = (u0: number, u1: number, h0: number, h1: number) => { for (const s of [-1, 1]) faces.push({ v: [V(u0, s * s0, h0 + 0.04), V(u1, s * s0, h1 + 0.04), V(u1, s * s1, h1 + 0.04), V(u0, s * s1, h0 + 0.04)], role: "stripe", decal: true }); };
  const along = (ua: number, ub: number) => { const us = [ua, ...ST.map((x) => x[0]).filter((u) => u > ua && u < ub), ub]; for (let q = 0; q < us.length - 1; q++) stripe(us[q], us[q + 1], dhAt(us[q]), dhAt(us[q + 1])); };
  along(tail + 0.05, cab.r0); along(cab.f0, nose - 0.1);
  stripe(cab.r1, cab.f1, k.roof, k.roof);
  // sponsor band along the doors between the arches, with the race number on it
  const doorSt = ST.filter((x) => x[0] >= WR + 2.9 - 0.01 && x[0] <= WF - 2.9 + 0.01);
  const sidePt = (x: number[], s: number, f: number) => [x[0], s * (x[2] + (x[4] - x[2]) * f + 0.05), x[3] + (x[5] - x[3]) * f];
  for (const s of [-1, 1]) for (let q = 0; q < doorSt.length - 1; q++) {
    const a = doorSt[q], b = doorSt[q + 1];
    const p = [sidePt(a, s, 0.08), sidePt(b, s, 0.08), sidePt(b, s, 0.62), sidePt(a, s, 0.62)].map((x) => V(x[0], x[1], x[2]));
    faces.push({ v: p, role: "band", decal: true, detail: true, label: q === 0 ? "doorNum" : undefined });
  }
  for (const s of [-1, 1]) { const a = doorSt[0]; const p = sidePt(a, s, 0.08), p2 = sidePt(a, s, 0.62); labels.push({ kind: "doorNum", at: [a[0] + 0.6, s * (Math.max(p[1] * s, p2[1] * s) + 0.02), p2[2]], x: [2.6, 0, 0], y: [0, 0, -(p2[2] - p[2])] }); }

  // the rear: taillight housings with three lit cells a side, a number plate, the diffuser and twin exhausts
  const ru = tail - 0.04, ro = [0, 0, 3.6];
  const rq = (v0: number, v1: number, h0: number, h1: number, role: Role, extra: Partial<Face> = {}) => faces.push({ v: [V(ru, v1, h0), V(ru, v0, h0), V(ru, v0, h1), V(ru, v1, h1)], role, decal: true, twoSided: true, o: ro, ...extra });
  const tailTail: [number, number, number][] = [];
  for (const s of [-1, 1]) {
    rq(s * 1.3, s * 5.25, 2.85, 3.95, "tailBox");
    [[1.5, 2.6], [2.75, 3.85], [4.0, 5.05]].forEach(([a, b], q) => rq(s * a, s * b, 3.0, 3.8, "tail", { cell: q, detail: q !== 1 }));
    tailTail.push([tail, s * 3.3, 3.4]);
  }
  rq(-1.15, 1.15, 1.9, 2.8, "plate", { detail: true, label: "plateNum" });
  labels.push({ kind: "plateNum", at: [ru - 0.02, -1.15, 2.8], x: [0, 2.3, 0], y: [0, 0, -0.9] });
  faces.push({ v: [V(tail + 0.1, 4.9, 0.7), V(tail + 0.1, -4.9, 0.7), V(tail + 0.1, -5.4, 1.62), V(tail + 0.1, 5.4, 1.62)], role: "diff", twoSided: true, o: ro });
  for (const fv of [-3.9, -1.3, 1.3, 3.9]) faces.push({ v: [V(tail - 0.15, fv - 0.12, 0.6), V(tail - 0.15, fv + 0.12, 0.6), V(tail - 0.15, fv + 0.12, 1.6), V(tail - 0.15, fv - 0.12, 1.6)], role: "dark", twoSided: true, detail: true, o: ro });
  const exhaust: [number, number, number][] = [];
  for (const s of [-1, 1]) {
    const cv = s * 2.6, ch = 1.15, pr = 0.55, n = 8, a0: number[] = [], a1: number[] = [], inner: number[] = [];
    for (let q = 0; q < n; q++) { const a = (q / n) * Math.PI * 2; a0.push(V(tail + 0.05, cv + Math.cos(a) * pr, ch + Math.sin(a) * pr)); a1.push(V(-L, cv + Math.cos(a) * pr, ch + Math.sin(a) * pr)); inner.push(V(-L - 0.01, cv + Math.cos(a) * pr * 0.62, ch + Math.sin(a) * pr * 0.62)); }
    for (let q = 0; q < n; q++) faces.push({ v: [a0[q], a0[(q + 1) % n], a1[(q + 1) % n], a1[q]], role: "chrome", detail: true, o: [tail, cv, ch] });
    faces.push({ v: [...a1].reverse(), role: "chrome", o: [0, cv, ch] }, { v: [...inner].reverse(), role: "pipe", decal: true, o: [0, cv, ch] });
    exhaust.push([-L, cv, ch]);
  }
  // the front: grille and headlights on the nose
  const fu = nose + 0.04, fo = [0, 0, 2];
  const fq = (v0: number, v1: number, h0: number, h1: number, role: Role) => faces.push({ v: [V(fu, v0, h0), V(fu, v1, h0), V(fu, v1, h1), V(fu, v0, h1)], role, decal: true, twoSided: true, o: fo });
  fq(-1.5, 1.5, 1.05, 1.85, "grille");
  for (const s of [-1, 1]) fq(s * 1.7, s * 4.3, 1.35, 1.95, "head");

  // the wing: a high GT wing on posts with livery endplates (the hatch gets a roof spoiler), all inside the box
  if (style !== 2) {
    const wy = 6.5, wh = style === 0 ? 7.6 : 7.2, wo = [-11.8, 0, wh - 0.5];
    const a = V(-L + 0.05, -wy, wh - 0.2), b = V(-10.7, -wy, wh + 0.15), cc = V(-10.7, wy, wh + 0.15), d = V(-L + 0.05, wy, wh - 0.2);
    // the wing stands above the decklid, so it is always painted after it (a plain depth sort gets that wrong)
    faces.push({ v: [V(-12.2, -3.0, k.deck), V(-11.5, -3.0, k.deck), V(-11.6, -3.0, wh - 0.1), V(-12.3, -3.0, wh - 0.1)], role: "dark", twoSided: true, o: wo, bias: -2 });
    faces.push({ v: [V(-12.2, 3.0, k.deck), V(-11.5, 3.0, k.deck), V(-11.6, 3.0, wh - 0.1), V(-12.3, 3.0, wh - 0.1)], role: "dark", twoSided: true, o: wo, bias: -2 });
    faces.push({ v: [a, b, cc, d], role: "wing", twoSided: true, o: wo, bias: -3 });
    faces.push({ v: [V(-L + 0.05, -wy, wh - 0.75), a, d, V(-L + 0.05, wy, wh - 0.75)], role: "dark", twoSided: true, o: wo, bias: -3 }); // gurney / trailing edge
    for (const s of [-1, 1]) faces.push({ v: [V(-L + 0.02, s * (wy + 0.05), wh - 1.2), V(-10.4, s * (wy + 0.05), wh - 0.8), V(-10.4, s * (wy + 0.05), wh + 0.5), V(-L + 0.02, s * (wy + 0.05), wh + 0.3)], role: "band", twoSided: true, o: wo, bias: -3.5 });
  } else {
    faces.push({ v: [V(cab.r1 - 0.4, -cab.w1 - 0.1, k.roof - 0.1), V(cab.r1 + 1.2, -cab.w1 - 0.1, k.roof + 0.15), V(cab.r1 + 1.2, cab.w1 + 0.1, k.roof + 0.15), V(cab.r1 - 0.4, cab.w1 + 0.1, k.roof - 0.1)], role: "wing", twoSided: true, o: co });
  }
  // give every decal its host: the parallel, non-decal face whose plane it lies on and whose bounds contain it
  const kids: number[][] = faces.map(() => []);
  const nrm = (f: Face) => { const [a, b, c] = [verts[f.v[0]], verts[f.v[1]], verts[f.v[2]]]; const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const l = Math.hypot(n[0], n[1], n[2]) || 1; return n.map((x) => x / l); };
  const cen = (f: Face) => [0, 1, 2].map((ax) => f.v.reduce((s, i) => s + verts[i][ax], 0) / f.v.length);
  faces.forEach((d, di) => {
    if (!d.decal) return;
    const nd = nrm(d), cd = cen(d);
    let best = -1, bd = 0.35;
    faces.forEach((h, hi) => {
      if (h.decal) return;
      const nh = nrm(h);
      if (Math.abs(nh[0] * nd[0] + nh[1] * nd[1] + nh[2] * nd[2]) < 0.85) return;
      for (let ax = 0; ax < 3; ax++) { let lo = Infinity, hi2 = -Infinity; for (const i of h.v) { lo = Math.min(lo, verts[i][ax]); hi2 = Math.max(hi2, verts[i][ax]); } if (cd[ax] < lo - 0.3 || cd[ax] > hi2 + 0.3) return; }
      const a = verts[h.v[0]], dist = Math.abs(nh[0] * (cd[0] - a[0]) + nh[1] * (cd[1] - a[1]) + nh[2] * (cd[2] - a[2]));
      if (dist < bd) { bd = dist; best = hi; }
    });
    if (best >= 0) kids[best].push(di); else d.decal = false; // no host found: sort it like any other face
  });
  return { verts, faces, exhaust, tail: tailTail, labels, kids };
}
const MODELS: Model[] = [buildModel(0), buildModel(1), buildModel(2)];

// per-face precomputation: local normals, oriented away from the face's reference point (the model centre unless the
// part has its own, like a tyre's axle), so back-face culling works on wheels and exhausts as well as the body
const NORMALS = MODELS.map((m) => m.faces.map((f) => {
  const [a, b, c] = [m.verts[f.v[0]], m.verts[f.v[1]], m.verts[f.v[2]]];
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const l = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((x) => x / l);
  const cen = f.v.reduce((s, i) => [s[0] + m.verts[i][0], s[1] + m.verts[i][1], s[2] + m.verts[i][2]], [0, 0, 0]).map((x) => x / f.v.length);
  const o = f.o ?? [0, 0, 3.6];
  if (n[0] * (cen[0] - o[0]) + n[1] * (cen[1] - o[1]) + n[2] * (cen[2] - o[2]) < 0) n = n.map((x) => -x);
  return n;
}));

const MAXV = Math.max(...MODELS.map((m) => m.verts.length));
const SX = new Float64Array(MAXV), SY = new Float64Array(MAXV), SF = new Float64Array(MAXV), SOK = new Uint8Array(MAXV);
const WX = new Float64Array(MAXV), WY = new Float64Array(MAXV), WZ = new Float64Array(MAXV);
const RACE_NO = [1, 23, 11, 4, 88, 31, 16, 9, 52, 3, 27, 64, 19, 45, 8, 71, 12, 36, 5, 99];
const BANDS = ["#f6f1e6", "#101018", "#f2c36b", "#d9304a", "#58e1ff", "#7fe0a9"];
/** A livery colour that stands out against the body: the first band colour far enough from the paint. */
function bandColour(body: RGB, id: number): RGB {
  for (let q = 0; q < BANDS.length; q++) { const c = hexRgb(BANDS[(id + q) % BANDS.length]); if (Math.abs(c[0] - body[0]) + Math.abs(c[1] - body[1]) + Math.abs(c[2] - body[2]) > 220) return c; }
  return [245, 240, 230];
}

function drawCarModel(c: CanvasRenderingContext2D, car: Car, gz: number, fogT: number, tick: number, lod: boolean) {
  const style = car.human ? 0 : ((car.id % 2) + 1) as 1 | 2;
  const m = MODELS[style], N = NORMALS[style];
  const ca = Math.cos(car.angle), sa = Math.sin(car.angle);
  const body = hexRgb(car.color), stripe = hexRgb(STRIPES[car.id % STRIPES.length]), band = bandColour(body, car.id);
  const L = RACE.CAR_HL, W = RACE.CAR_HW;
  // world positions and projections of every vertex
  for (let i = 0; i < m.verts.length; i++) {
    const [u, v, h] = m.verts[i];
    const x = car.x + ca * u - sa * v, y = car.y + sa * u + ca * v, z = gz + h;
    WX[i] = x; WY[i] = y; WZ[i] = z;
    const dx = x - camX, dy = y - camY, f = dx * cosA + dy * sinA;
    SF[i] = f; SOK[i] = f > NEAR ? 1 : 0;
    if (SOK[i]) { const k = FOC / f; SX[i] = VW / 2 + (-dx * sinA + dy * cosA) * k; SY[i] = HOR + (camZ - z) * k; }
  }
  // grounded shadows: a soft one cast away from the sun, a dark core under the floor, and black contact patches under
  // each tyre so the car sits on the road instead of floating over it
  const groundQuad = (u0: number, u1: number, v0: number, v1: number, ox: number, oy: number, a: number) => {
    const P4 = [[u1, v0], [u1, v1], [u0, v1], [u0, v0]];
    for (let q = 0; q < 4; q++) { QX[q] = car.x + ca * P4[q][0] - sa * P4[q][1] + ox; QY[q] = car.y + sa * P4[q][0] + ca * P4[q][1] + oy; QZ[q] = gz + 0.05; }
    fillPoly(c, 4, `rgba(8,6,14,${a * (1 - fogT)})`);
  };
  groundQuad(-L - 1.4, L + 1.0, -W - 1.0, W + 1.0, -SUN[0] * 3.2, -SUN[1] * 3.2, 0.3);
  groundQuad(-L + 0.6, L - 0.6, -W + 1.2, W - 1.2, 0, 0, 0.42);
  if (!lod) for (const uc of [-8.4, 8.3]) for (const s of [-1, 1]) groundQuad(uc - 1.9, uc + 1.9, s < 0 ? -W - 0.25 : W - 1.8, s < 0 ? -W + 1.8 : W + 0.25, 0, 0, 0.7);
  // visible faces, far to near
  const order: { i: number; d: number }[] = [];
  const shown = new Set<Label>();
  for (let fi = 0; fi < m.faces.length; fi++) {
    const f = m.faces[fi];
    if (f.decal || (lod && f.detail)) continue; // decals are drawn with their host
    let ok = true, d = 0, cx = 0, cy = 0, cz = 0;
    for (const vi of f.v) { if (!SOK[vi]) { ok = false; break; } d += SF[vi]; cx += WX[vi]; cy += WY[vi]; cz += WZ[vi]; }
    if (!ok) continue;
    const n = f.v.length;
    cx /= n; cy /= n; cz /= n;
    const ln = N[fi], nx = ca * ln[0] - sa * ln[1], ny = sa * ln[0] + ca * ln[1], nz = ln[2];
    const facing = nx * (camX - cx) + ny * (camY - cy) + nz * (camZ - cz) > 0;
    if (!f.twoSided && !facing) continue; // back face
    if (f.label && facing) shown.add(f.label);
    for (const ki of m.kids[fi]) if (m.faces[ki].label && facing) shown.add(m.faces[ki].label!);
    order.push({ i: fi, d: d / n + (f.bias ?? 0) });
  }
  order.sort((a, b) => b.d - a.d);
  const draws: number[] = [];
  for (const { i } of order) { draws.push(i); for (const ki of m.kids[i]) if (!(lod && m.faces[ki].detail) && m.faces[ki].v.every((vi) => SOK[vi])) draws.push(ki); }
  for (const fi of draws) {
    const f = m.faces[fi], ln = N[fi];
    const nx = ca * ln[0] - sa * ln[1], ny = sa * ln[0] + ca * ln[1], nz = ln[2];
    const ndl = nx * SUN[0] + ny * SUN[1] + nz * SUN[2], dl = clamp(ndl);
    let col: RGB, alpha = 1, sheen = false;
    switch (f.role) {
      case "body": col = lit(body, 0.5 + 0.62 * dl); sheen = nz > 0.55; break;
      case "bodyD": col = lit(body, 0.32 + 0.4 * dl); break;
      case "stripe": col = lit(stripe, 0.55 + 0.55 * dl); sheen = nz > 0.55; break;
      case "band": col = lit(band, 0.5 + 0.55 * clamp(Math.abs(ndl))); break;
      case "grille": col = lit([40, 38, 52], 0.7 + 0.5 * dl); break;
      case "glass": col = nz > 0.2 ? [70, 120, 170] : lit([30, 46, 80], 0.8 + 0.6 * dl); sheen = true; break;
      case "glint": col = [236, 246, 255]; alpha = 0.55; break;
      case "tailBox": col = [34, 10, 16]; break;
      case "tail": col = car.braking ? (f.cell === 1 ? [255, 120, 96] : [255, 64, 52]) : f.cell === 1 ? [196, 34, 40] : [138, 16, 28]; break;
      case "head": col = [255, 246, 200]; break;
      case "tyre": col = lit([30, 29, 34], 0.6 + 0.5 * dl); break;
      case "side": col = lit([46, 44, 50], 0.65 + 0.5 * clamp(Math.abs(ndl))); break;
      case "rim": col = lit([196, 200, 214], 0.55 + 0.6 * clamp(Math.abs(ndl))); break;
      case "hub": col = [58, 60, 70]; break;
      case "well": col = [14, 12, 18]; break;
      case "diff": col = [26, 26, 32]; break;
      case "chrome": col = lit([214, 218, 230], 0.5 + 0.65 * clamp(Math.abs(ndl))); break;
      case "pipe": col = [10, 8, 12]; break;
      case "plate": col = [240, 236, 220]; break;
      case "wing": col = lit(stripe, 0.45 + 0.6 * clamp(Math.abs(ndl))); break;
      default: col = lit([28, 26, 36], 0.7 + 0.4 * dl);
    }
    // metallic paint / glass: a gradient across the face with a sky reflection and a bright streak
    let fill: string | CanvasGradient = alpha < 1 ? `rgba(${col[0]},${col[1]},${col[2]},${alpha * (1 - fogT)})` : fog(col, fogT);
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
    else if (!lod && f.role === "tail") { c.strokeStyle = "rgba(20,4,8,0.8)"; c.lineWidth = 0.7; c.stroke(); } // the cells read as separate lamps
  }
  // race numbers: roundels on the roof and doors, digits on the plate, mapped onto their panels (only when the panel
  // faces us and the car is close enough for them to read)
  if (!lod) for (const lb of m.labels) {
    if (!shown.has(lb.kind)) continue;
    const pt = (u: number, v: number, h: number) => project(car.x + ca * u - sa * v, car.y + sa * u + ca * v, gz + h) ? { x: P.x, y: P.y } : null;
    const [o, X, Y] = [lb.at, lb.x, lb.y];
    let p0 = pt(o[0], o[1], o[2]), px = pt(o[0] + X[0], o[1] + X[1], o[2] + X[2]), py = pt(o[0] + Y[0], o[1] + Y[1], o[2] + Y[2]);
    if (!p0 || !px || !py) continue;
    if ((px.x - p0.x) * (py.y - p0.y) - (px.y - p0.y) * (py.x - p0.x) < 0) { // seen mirrored: start from the far corner so the digits read left to right
      const p1 = px; px = p0; p0 = p1;
      py = pt(o[0] + X[0] + Y[0], o[1] + X[1] + Y[1], o[2] + X[2] + Y[2]);
      if (!py) continue;
    }
    const ax = px.x - p0.x, ay = px.y - p0.y;
    if (Math.hypot(ax, ay) < 9) continue;
    c.save();
    c.setTransform(ax / 100, ay / 100, (py.x - p0.x) / 100, (py.y - p0.y) / 100, p0.x, p0.y);
    const num = String(RACE_NO[car.id % RACE_NO.length]);
    if (lb.kind !== "plateNum") { c.fillStyle = fog([250, 248, 240], fogT); c.beginPath(); c.arc(50, 50, 48, 0, Math.PI * 2); c.fill(); c.strokeStyle = fog([16, 14, 22], fogT); c.lineWidth = 6; c.stroke(); }
    c.fillStyle = fog([16, 14, 22], fogT); c.textAlign = "center"; c.textBaseline = "middle";
    c.font = lb.kind === "plateNum" ? "bold 80px Impact, sans-serif" : `bold ${num.length > 1 ? 58 : 70}px Impact, sans-serif`;
    c.fillText(num, 50, 54);
    c.restore();
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

    // depth-sort the field every frame. Each visible car gets the road strip its rear bumper sits on (so it is painted
    // in with the road, scenery and hill crests), then the whole field is ordered strictly back to front by distance
    // ahead of the camera and the strip numbers are made monotonic along that order: a nearer car can never be painted
    // before a farther one, so nearer cars always cleanly occlude the cars behind them.
    const i0 = me.idx - 10;
    const buckets = new Map<number, Car[]>();
    const vis: { car: Car; k: number; depth: number }[] = [];
    for (const car of r.cars) {
      const along = (car.x - tr.pts[car.idx].x) * rd.tx[car.idx] + (car.y - tr.pts[car.idx].y) * rd.ty[car.idx] - RACE.CAR_HL;
      const seg = car.idx + Math.floor(along / rd.spacing);
      const k = (((seg - i0) % n) + n) % n;
      const kk = k > n - 8 ? k - n : k;
      if (kk < -8 || kk >= DRAW) continue;
      vis.push({ car, k: kk, depth: carDepth(car) });
    }
    vis.sort((a, b) => b.depth - a.depth || (a.car.human ? 1 : 0) - (b.car.human ? 1 : 0));
    let kMax = Infinity;
    for (const v of vis) { kMax = Math.min(kMax, v.k); const a = buckets.get(kMax) ?? []; a.push(v.car); buckets.set(kMax, a); }

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
      /** A small patch of this strip: lateral o0..o1, from fraction p0 to p1 along it, lifted h. The texel brush. */
      const patch = (fill: string, o0: number, o1: number, p0: number, p1: number, h = 0.02) => {
        const ax = cx0 + (cx1 - cx0) * p0, ay = cy0 + (cy1 - cy0) * p0, arx = rx0 + (rx1 - rx0) * p0, ary = ry0 + (ry1 - ry0) * p0, az = z0 + (z1 - z0) * p0 + h;
        const bx = cx0 + (cx1 - cx0) * p1, by = cy0 + (cy1 - cy0) * p1, brx = rx0 + (rx1 - rx0) * p1, bry = ry0 + (ry1 - ry0) * p1, bz = z0 + (z1 - z0) * p1 + h;
        quad(c, fill, ax + arx * o0, ay + ary * o0, az, ax + arx * o1, ay + ary * o1, az, bx + brx * o1, by + bry * o1, bz, bx + brx * o0, by + bry * o0, bz);
      };
      const texel = fDepth < 420; // close enough that per-texel speckle reads (and is worth the polygons)
      // terrain: mown stripes and patchy tones out to the horizon on both sides
      // how far this strip's own ground reaches on each side before it would lie over another part of the circuit
      const cL = Math.min(rd.clearL[i], rd.clearL[j]), cR = Math.min(rd.clearR[i], rd.clearR[j]);
      const cl = (s: number) => (s < 0 ? cL : cR);
      /** A band on side s from offset a out to b, clamped to the ground clearance separately at each end of the strip,
       *  so the clamped edge runs as a smooth line along the track instead of stepping strip by strip. */
      const BC = (fill: string, s: number, a: number, b: number) => {
        const bi = Math.min(b, s < 0 ? rd.clearL[i] : rd.clearR[i]), bj = Math.min(b, s < 0 ? rd.clearL[j] : rd.clearR[j]);
        if (bi <= a && bj <= a) return;
        const oi = Math.max(a, bi), oj = Math.max(a, bj);
        quad(c, fill, cx0 + rx0 * s * a, cy0 + ry0 * s * a, z0, cx0 + rx0 * s * oi, cy0 + ry0 * s * oi, z0, cx1 + rx1 * s * oj, cy1 + ry1 * s * oj, z1, cx1 + rx1 * s * a, cy1 + ry1 * s * a, z1);
      };
      const stripeTone = ((i / 3) | 0) & 1;
      for (const s of [-1, 1]) BC(fog(GRASS[stripeTone], fogT), s, EDGE, 280);
      if (near) for (const s of [-1, 1]) for (let p = 0; p < 3; p++) { // tonal patches so the grass isn't flat
        const o = EDGE + 18 + hash(i * 3 + p * 17 + s) * 150, w = 8 + hash(i * 7 + p) * 26;
        if (hash(i * 11 + p * 5 + s) < 0.5 && o + w <= cl(s)) B(fog(GRASS[2 + (p & 1)], fogT), s * o, s * (o + w));
      }
      // grass texture: dark clumps and pale blades scattered through the turf
      if (texel) for (const s of [-1, 1]) for (let q = 0; q < 7; q++) {
        const o = EDGE + 3 + hash(i * 59 + q * 11 + s) * 90, p = hash(i * 61 + q * 5 + s), w = 1 + hash(i * 67 + q) * 2.2;
        if (o + w <= cl(s)) patch(fog(q % 3 === 0 ? [124, 176, 84] : lit(GRASS[3], 0.8), fogT), s * o, s * (o + w), p, p + 0.08 + hash(q + i) * 0.1);
      }
      // gravel run-off between the curbs and the barrier: a pebbly verge in two tones with scattered stones
      const GRAV = stripeTone ? [158, 146, 124] as RGB : [148, 137, 116] as RGB;
      for (const s of [-1, 1]) BC(fog(GRAV, fogT), s, ROAD_HALF + 11, EDGE);
      if (texel) for (const s of [-1, 1]) for (let q = 0; q < 9; q++) {
        const o = ROAD_HALF + 11.5 + hash(i * 71 + q * 13 + s) * (EDGE - ROAD_HALF - 13), p = hash(i * 73 + q * 3 + s), w = 0.7 + hash(i * 79 + q) * 1.3;
        if (o + w <= cl(s)) patch(fog(q & 1 ? lit(GRAV, 1.25) : lit(GRAV, 0.62), fogT), s * o, s * (o + w), p, p + 0.05 + hash(q * 3 + i) * 0.06);
      }
      if (near) for (const s of [-1, 1]) if (cl(s) >= EDGE) B(fog(lit(GRAV, 0.7), fogT), s * (EDGE - 2.5), s * EDGE); // the dark line of churned gravel at the rail foot
      // canyon walls behind the barrier: leaning rock in strata with ledges and crevices
      for (const s of [-1, 1] as const) {
        const h0 = (s < 0 ? rd.cliffL[i] : rd.cliffR[i]) * (0.88 + hash(i * 3 + s) * 0.24), h1 = (s < 0 ? rd.cliffL[j] : rd.cliffR[j]) * (0.88 + hash(j * 3 + s) * 0.24);
        if (h0 < 5 && h1 < 5) continue;
        const o0 = EDGE + 14 + hash(i) * 14, o1 = EDGE + 14 + hash(j) * 14;
        // the wall (and its outward lean) must stay on this strip's own ground
        const room = cl(s) - Math.max(o0, o1);
        if (room < 4) continue;
        const lean = Math.min(0.3, room / Math.max(h0, h1, 1));
        const side = s < 0 ? 1.08 : 0.8; // the left walls face the sun
        // a point on the wall face: height fraction f (0 = foot, 1 = top) at fraction p along this strip
        const wallQ = (fill: string, fa: number, fb: number, pa: number, pb: number, pc = pb, pd = pa) => {
          const at = (f: number, p: number, q: number) => {
            const o = o0 + (o1 - o0) * p, hh = h0 + (h1 - h0) * p, rx = rx0 + (rx1 - rx0) * p, ry = ry0 + (ry1 - ry0) * p;
            QX[q] = cx0 + (cx1 - cx0) * p + rx * s * (o + hh * f * lean); QY[q] = cy0 + (cy1 - cy0) * p + ry * s * (o + hh * f * lean); QZ[q] = z0 + (z1 - z0) * p + hh * f;
          };
          at(fa, pa, 0); at(fa, pb, 1); at(fb, pc, 2); at(fb, pd, 3);
          fillPoly(c, 4, fill);
        };
        // stratified rock: thick and thin beds of alternating tone, each with a shadowed ledge under a sunlit lip
        const bands = near ? 9 : 4;
        let f0 = 0;
        for (let b = 0; b < bands; b++) {
          const f1 = b === bands - 1 ? 1 : Math.min(1, f0 + (0.6 + hash(b * 13 + 7) * 0.8) / bands); // bed thickness is the same all along the wall, so beds line up strip to strip
          const rockT = clamp(0.25 + (f0 + f1) * 0.3 + (hash(b * 31 + 5) - 0.5) * 0.45 + (hash(i * 7 + b) - 0.5) * 0.12);
          const tone = lit(ROCK[Math.round(rockT * (ROCK.length - 1))], side * (0.92 + hash(i * 5 + b * 3) * 0.12));
          wallQ(fog(tone, fogT), f0, f1, 0, 1);
          if (near && b < bands - 1) {
            wallQ(fog(lit(tone, 0.55), fogT), f1 - 0.018, f1, 0, 1); // ledge shadow
            wallQ(fog(lit(tone, 1.22), fogT), f1, f1 + 0.008, 0, 1); // sunlit lip of the bed above
          }
          f0 = f1;
        }
        if (near) {
          // vertical joints and crevices: tapered dark cracks running down through several beds
          for (let q = 0; q < 2; q++) if (hash(i * 19 + q * 7 + s) < 0.42) {
            const p = 0.15 + hash(i * 23 + q) * 0.6, fa = 0.08 + hash(i * 29 + q) * 0.3, fb = Math.min(0.97, fa + 0.3 + hash(i * 37 + q) * 0.45), w = 0.06 + hash(i + q) * 0.07;
            wallQ(fog([46, 22, 14], fogT), fa, fb, p, p + w * 0.4, p + w, p + w * 0.6);
            wallQ(fog(lit(ROCK[4], side * 1.1), fogT), fa, fb, p + w, p + w * 1.25, p + w * 1.3, p + w * 1.05); // the lit edge beside it
          }
          // pitting: small dark pocks and pale chips scattered over the face
          for (let q = 0; q < 5; q++) { const p = hash(i * 41 + q * 3 + s), f = hash(i * 43 + q * 5 + s) * 0.9; wallQ(fog(q & 1 ? lit(ROCK[3], side * 1.15) : [70, 34, 20], fogT), f, f + 0.03, p, p + 0.08); }
        }
        // lit cap along the top edge
        quad(c, fog(lit(ROCK[4], side * 1.05), fogT), cx0 + rx0 * s * (o0 + h0 * lean), cy0 + ry0 * s * (o0 + h0 * lean), z0 + h0, cx1 + rx1 * s * (o1 + h1 * lean), cy1 + ry1 * s * (o1 + h1 * lean), z1 + h1, cx1 + rx1 * s * (o1 + h1 * lean + 6), cy1 + ry1 * s * (o1 + h1 * lean + 6), z1 + h1 + 1, cx0 + rx0 * s * (o0 + h0 * lean + 6), cy0 + ry0 * s * (o0 + h0 * lean + 6), z0 + h0 + 1);
        // a shadow where the wall meets the ground, with fallen rubble (talus) at its foot
        B(`rgba(30,14,8,${0.35 * (1 - fogT)})`, s * (o0 - 8), s * o0);
        if (near) for (let q = 0; q < 4; q++) { const o = o0 - 1 - hash(i * 47 + q + s) * 7, p = hash(i * 53 + q * 7 + s); patch(fog(lit(ROCK[1 + (q % 3)], side), fogT), s * o, s * (o + 1.2 + hash(i + q * 3) * 1.6), p, p + 0.1, 0.5); }
      }
      // red-and-white rumble curbs with a shaded lip
      const curbCol = (i >> 1) & 1 ? RED : WHITE;
      // (clamped like the ground: on the inside of a hairpin the curb stops where the neighbouring stretch's asphalt starts)
      for (const s of [-1, 1] as const) {
        BC(fog(curbCol, fogT), s, ROAD_HALF, ROAD_HALF + 8);
        BC(fog(lit(curbCol, 0.72), fogT), s, ROAD_HALF + 8, ROAD_HALF + 11);
      }
      // asphalt: alternating bands, grain flecks, dark tyre-worn racing lines, the odd patch and skid mark
      const as = ASPH[(i >> 1) & 1];
      { // the asphalt itself, clamped per end too (only ever bites on the inside of a hairpin, where the next stretch's road takes over)
        const li = Math.min(ROAD_HALF, rd.clearL[i]), lj = Math.min(ROAD_HALF, rd.clearL[j]), ri = Math.min(ROAD_HALF, rd.clearR[i]), rj = Math.min(ROAD_HALF, rd.clearR[j]);
        quad(c, fog(as, fogT), cx0 - rx0 * li, cy0 - ry0 * li, z0, cx0 + rx0 * ri, cy0 + ry0 * ri, z0, cx1 + rx1 * rj, cy1 + ry1 * rj, z1, cx1 - rx1 * lj, cy1 - ry1 * lj, z1);
      }
      for (const s of [-1, 1]) if (cl(s) >= ROAD_HALF) B(fog(lit(as, 0.8), fogT), s * (ROAD_HALF - 3), s * ROAD_HALF); // shaded road edges
      if (fDepth < 900) {
        const wear = fog(lit(as, 0.82), fogT), grain = fog(lit(as, 1.22), fogT), dark = fog(lit(as, 0.68), fogT);
        for (const o of [-28, -17, 17, 28]) B(wear, o - 4, o + 4);
        for (let gk = 0; gk < 6; gk++) { const o = (hash(i * 5 + gk) - 0.5) * 88; B(gk & 1 ? grain : dark, o, o + 1.2); }
        // speckled aggregate: pale stones and dark pits in the tarmac, so the road never reads as a flat polygon
        if (texel) for (let q = 0; q < 22; q++) {
          const o = (hash(i * 89 + q * 7) - 0.5) * (RACE.ROAD - 6), p = hash(i * 97 + q * 13), w = 0.6 + hash(i * 101 + q) * 1.1;
          patch(q % 3 === 0 ? dark : q % 3 === 1 ? grain : fog(lit(as, 1.4), fogT), o, o + w, p, p + 0.04 + hash(i + q * 5) * 0.05);
        }
        // tar-sealed cracks: thin dark seams crossing the lane now and then
        if (texel && hash(i * 107) < 0.18) { const o = (hash(i * 109) - 0.5) * 70, l = 6 + hash(i * 113) * 14; patch(fog(lit(as, 0.55), fogT), o, o + l, 0.4, 0.46); }
        if (hash(i * 13) < 0.08) { const o = (hash(i * 17) - 0.5) * 50; B(fog(lit(as, 1.12), fogT), o - 9, o + 9); } // tar patch
        // tyre rubber: paired skid marks that sweep across the road through the bends, and darker braking streaks in
        // the zone just before each one (where the marks start straight and then bend into the turn)
        const turnAhead = rd.turn[(i + 7) % n];
        if (near && (Math.abs(rd.turn[i]) > 0.18 || Math.abs(turnAhead) > 0.25)) {
          const braking = Math.abs(rd.turn[i]) <= 0.18, s = (braking ? turnAhead : rd.turn[i]) > 0 ? 1 : -1;
          for (let q = 0; q < 2; q++) {
            const sweep = Math.sin(i * 0.33 + q * 2.1) * 9, oA = s * (10 + q * 16) + sweep, oB = s * (10 + q * 16) + Math.sin((i + 1) * 0.33 + q * 2.1) * 9;
            const a = braking ? 0.5 : 0.38;
            for (const gap of [0, 6.4]) {
              QX[0] = cx0 + rx0 * (oA + gap); QY[0] = cy0 + ry0 * (oA + gap); QZ[0] = z0 + 0.02; QX[1] = cx0 + rx0 * (oA + gap + 1.9); QY[1] = cy0 + ry0 * (oA + gap + 1.9); QZ[1] = z0 + 0.02;
              QX[2] = cx1 + rx1 * (oB + gap + 1.9); QY[2] = cy1 + ry1 * (oB + gap + 1.9); QZ[2] = z1 + 0.02; QX[3] = cx1 + rx1 * (oB + gap); QY[3] = cy1 + ry1 * (oB + gap); QZ[3] = z1 + 0.02;
              if (hash(i * 83 + q * 7 + gap) < 0.85) fillPoly(c, 4, `rgba(18,16,22,${a * (1 - fogT)})`);
            }
          }
        }
      }
      const line = fog([240, 238, 228], fogT);
      for (const s of [-1, 1] as const) if (cl(s) >= ROAD_HALF - 3) B(line, s * (ROAD_HALF - 6), s * (ROAD_HALF - 3.5));
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
        if (cl(s) < EDGE) continue; // the rail would stand on another stretch's road (inside a hairpin): the road there is the edge
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
      if (here) for (const car of here) this.drawCar(c, car, me, rd, tick, fogT); // already far-to-near
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
    const clear = (s: number) => (s < 0 ? rd.clearL[i] : rd.clearR[i]);
    const sprite = (img: HTMLCanvasElement, o: number, worldH: number) => {
      // a tree or rock (its whole width) must stand on this stretch's own ground, never out on another stretch's road
      if (Math.abs(o) + (worldH * img.width) / img.height / 2 > clear(Math.sign(o))) return;
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
      if (wall < 4 && clear(s) >= RACE.EDGE + 14 && project(px + rx * s * (RACE.EDGE + 6), py + ry * s * (RACE.EDGE + 6), z)) {
        const k = P.k, w = 14 * k;
        if (w > 4) {
          const bx = P.x, by = P.y;
          // a crisp turn board: twin steel legs, black frame, white reflective border, yellow face with a solid black chevron
          const r1 = Math.round, x0 = r1(bx - w / 2), y0 = r1(by - w * 1.9), bw = r1(w), bh = r1(w * 0.95);
          c.fillStyle = fog([60, 62, 74], fogT); c.fillRect(r1(bx - w * 0.36), r1(by - w * 1.2), Math.max(1, r1(w * 0.07)), r1(w * 1.2)); c.fillRect(r1(bx + w * 0.29), r1(by - w * 1.2), Math.max(1, r1(w * 0.07)), r1(w * 1.2));
          c.fillStyle = fog([16, 12, 20], fogT); c.fillRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
          c.fillStyle = fog([250, 248, 240], fogT); c.fillRect(x0, y0, bw, bh);
          const bd = Math.max(1, r1(w * 0.07));
          c.fillStyle = fog([255, 206, 38], fogT); c.fillRect(x0 + bd, y0 + bd, bw - bd * 2, bh - bd * 2);
          c.fillStyle = fog([200, 150, 20], fogT); c.fillRect(x0 + bd, y0 + bh - bd * 2, bw - bd * 2, bd);
          const d = turn > 0 ? 1 : -1, cy = y0 + bh / 2, cx = x0 + bw / 2, a = bw * 0.2, t = bw * 0.13;
          c.fillStyle = fog([16, 12, 20], fogT);
          c.beginPath(); c.moveTo(cx - d * a, cy - bh * 0.34); c.lineTo(cx - d * a + d * t, cy - bh * 0.34); c.lineTo(cx + d * a + d * t * 0.5, cy); c.lineTo(cx - d * a + d * t, cy + bh * 0.34); c.lineTo(cx - d * a, cy + bh * 0.34); c.lineTo(cx + d * a - d * t * 0.5, cy); c.closePath(); c.fill();
        }
      }
    }
    // billboards
    if (i % 36 === 12) {
      const s = i % 72 === 12 ? 1 : -1, wall = s < 0 ? rd.cliffL[i] : rd.cliffR[i];
      if (wall < 4 && clear(s) >= 122 && project(px + rx * s * 96, py + ry * s * 96, z)) {
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
    if (i % 90 === 0 && clear(-1) >= RACE.EDGE + 8 && clear(1) >= RACE.EDGE + 8) {
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
