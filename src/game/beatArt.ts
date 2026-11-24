// Beat Battle: a late-90s / Y2K rhythm-arcade stage. Like Pixel Fighter II it renders at a native 360x240 into an
// offscreen canvas and is scaled up 2x with nearest-neighbour filtering, so everything is hard-edged pixel art:
//   * the performers (your vocalist and the rival DJ) are posed every frame with the shared sprite rasteriser
//     (pixelKit.Raster): lit, shaded, outlined volumes; they bob on the beat, point the mic toward the arrow you hit,
//     slump on a miss, and the DJ scratches and taunts
//   * the stage: a lighting truss with moving spotlight beams, neon tubes, speaker stacks that thump, an LED wall,
//     a perspective grid floor that scrolls on the beat, lit risers, and a crowd that jumps harder with the hype
//   * the rhythm interface: crisp pre-rendered arrow sprites (4-tone shading, outline, glow) on a dark lane panel,
//     receptors that light up, bursts and particles on hits, red flashes and debris on misses, a bitmap-font HUD
// The component owns the audio, the judging and the score; this file only draws what it is given.
import type { Judge, Level, Note } from "../shared/beat";
import { PixelBuf, Raster, TXT, bayer, clamp, hexRgb, pack, pdisc, pdither, pline, ptext, ramp, type Ramp } from "./pixelKit";

export const BW = 720;
export const BH = 480;
const IW = 360, IH = 240; // native pixel canvas
export const HIT_Y = 392; // in canvas (720x480) units; the receptors' centre line
export const FIELD_TOP = 62;
export const LANE_X = [270, 330, 390, 450];
export const LANE_COLORS = ["#ff5fa8", "#58e1ff", "#7fe0a9", "#f2c36b"];
const LX = LANE_X.map((x) => x / 2), HY = HIT_Y / 2, FT = FIELD_TOP / 2;
const PANEL_X0 = LX[0] - 19, PANEL_X1 = LX[3] + 19;

type Pop = { text: string; rows: string[]; t: number };
type Spark = { x: number; y: number; vx: number; vy: number; life: number; col: string };

export type BeatFrame = {
  t: number; // song time (ms); negative during the lead-in
  level: Level; chart: Note[]; letters: (Judge | null)[];
  flash: number[]; hype: number; score: number; combo: number; comboMult: number; sick: number; good: number; miss: number; maxCombo: number;
  total: number; // how many notes in the song
  names: [string, string];
};

// ------------------------------------------------------------------ canvases & baked art

type Ctx = { cv: HTMLCanvasElement; c: CanvasRenderingContext2D };
const mk = (w: number, h: number): Ctx => { const cv = document.createElement("canvas"); cv.width = w; cv.height = h; const c = cv.getContext("2d")!; c.imageSmoothingEnabled = false; return { cv, c }; };
const C = (h: string) => pack(...hexRgb(h));
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const pick = (pal: number[], t: number, x: number, y: number) => pal[clamp(Math.round(clamp(t) * (pal.length - 1) + bayer(x, y) * 0.9), 0, pal.length - 1)];

type Art = { back: HTMLCanvasElement; speaker: HTMLCanvasElement; cone: HTMLCanvasElement; deck: HTMLCanvasElement; arrows: HTMLCanvasElement[][]; receptor: HTMLCanvasElement[]; receptorLit: HTMLCanvasElement[] };
let art: Art | null = null;

/** The arrow shape (pointing right) as a polygon in a 24x24 box. */
const ARROW = [21, 12, 12, 3, 12, 8, 3, 8, 3, 16, 12, 16, 12, 21];
/** Rotate the arrow polygon to a lane: left, down, up, right. */
function arrowPts(lane: number, cx: number, cy: number, scale = 1) {
  const rot = [Math.PI, Math.PI / 2, -Math.PI / 2, 0][lane];
  const out: number[] = [];
  for (let i = 0; i < ARROW.length; i += 2) { const x = (ARROW[i] - 12) * scale, y = (ARROW[i + 1] - 12) * scale; out.push(cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)); }
  return out;
}

function buildArrow(lane: number, col: string, kind: "note" | "rec" | "recLit"): HTMLCanvasElement {
  const S = 30, b = new PixelBuf(S, S);
  const base = hexRgb(col);
  const tone = (k: number) => pack(base[0] * k, base[1] * k, base[2] * k);
  const lighten = (k: number) => pack(base[0] + (255 - base[0]) * k, base[1] + (255 - base[1]) * k, base[2] + (255 - base[2]) * k);
  const outer = arrowPts(lane, S / 2, S / 2, 1.12), inner = arrowPts(lane, S / 2, S / 2, 0.9), core = arrowPts(lane, S / 2, S / 2, 0.55);
  if (kind === "note") {
    // soft dithered glow around the note
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) { const d = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2); if (d < 14 && bayer(x, y) + 0.5 < (1 - d / 14) * 0.4) b.set(x, y, lighten(0.2)); }
    b.poly(outer, C("#140a26"));
    b.poly(inner, (x, y) => { const t = 0.75 - ((x - 4) + (y - 4)) / 44; return [tone(0.55), tone(0.78), pack(...base), lighten(0.35), lighten(0.6)][clamp(Math.round(t * 4 + bayer(x, y) * 0.8), 0, 4)]; });
    b.poly(core, (x, y) => (((x + y) & 1) === 0 ? lighten(0.75) : lighten(0.5)));
  } else {
    const lit = kind === "recLit";
    b.poly(outer, C("#0a0618"));
    b.poly(inner, (x, y) => { const t = 0.6 - ((x - 4) + (y - 4)) / 50; return lit ? [tone(0.6), pack(...base), lighten(0.4), lighten(0.75)][clamp(Math.round(t * 3 + bayer(x, y) * 0.8), 0, 3)] : [C("#2a2444"), C("#3a3458"), C("#4e4872"), C("#686290")][clamp(Math.round(t * 3 + bayer(x, y) * 0.8), 0, 3)]; });
    b.poly(core, lit ? lighten(0.9) : C("#120c24"));
  }
  return b.toCanvas();
}

function buildArt(): Art {
  // --- the back of the stage: dark wall, LED wall panel, neon tube frame and the side walls
  const bk = new PixelBuf(IW, IH);
  const WALL = ["#07031a", "#0c0626", "#140a36", "#1c0e46", "#26125a"].map(C);
  bk.rect(0, 0, IW, IH, (x, y) => pick(WALL, 0.15 + (y / 170) * 0.7 - Math.abs(x - IW / 2) / 600, x, y));
  // LED video wall behind the lanes (its pixels are animated at runtime; this is the bezel)
  bk.rect(84, 34, 192, 104, C("#05020e")); bk.rect(85, 35, 190, 102, C("#0a0618"));
  // side wall panels with vertical light strips
  for (const sx of [0, 300]) for (let k = 0; k < 4; k++) { const x = sx + 6 + k * 15; bk.rect(x, 30, 9, 120, (xx, yy) => pick(["#120a2c", "#1a0f3c", "#24154e"].map(C), 0.6 - (xx - x) / 12 + (yy % 12 === 0 ? -0.5 : 0), xx, yy)); }
  // the lighting truss across the top
  const TR = C("#4a4e66"), TRL = C("#9aa0bc"), TRD = C("#24263a");
  bk.rect(0, 6, IW, 2, TRL); bk.rect(0, 8, IW, 1, TR); bk.rect(0, 17, IW, 2, TR); bk.rect(0, 19, IW, 1, TRD);
  for (let x = 0; x < IW; x += 10) { bk.line(x, 8, x + 5, 17, TR); bk.line(x + 5, 17, x + 10, 8, TR); bk.set(x, 8, TRL); }
  // floor: a dark stage deck the grid is painted over at runtime
  bk.rect(0, 166, IW, IH - 166, (x, y) => pick(["#0a0420", "#120830", "#1a0c40"].map(C), 0.2 + (y - 166) / 160, x, y));

  // --- a speaker stack cabinet (two woofers drawn separately so they can thump)
  const sp = new PixelBuf(46, 74);
  sp.rect(0, 0, 46, 74, (x, y) => pick(["#0c0a14", "#16121e", "#201a2a", "#2c2438"].map(C), 0.55 - x / 120 + (x < 2 ? 0.3 : 0) - (y > 71 ? 0.4 : 0), x, y));
  sp.rect(0, 36, 46, 2, C("#05040a"));
  for (const [x, y] of [[4, 3], [4, 39]]) { sp.rect(x, y, 38, 32, C("#08060e")); for (let k = 0; k < 6; k++) sp.set(x + 2 + k * 7, y + 1, C("#3a3446")); }
  const cone = new PixelBuf(28, 28);
  cone.disc(14, 14, 13, C("#1a1622")); cone.disc(14, 14, 12, (x, y) => pick(["#20202c", "#2c2a3a", "#3a3850", "#4c4a66"].map(C), 0.6 - ((x - 14) + (y - 14)) / 34, x, y));
  cone.disc(14, 14, 8, (x, y) => pick(["#14121c", "#1c1a26", "#262434"].map(C), 0.3 + ((x - 14) + (y - 14)) / 30, x, y));
  cone.disc(14, 14, 4, (x, y) => pick(["#3a3850", "#5a5878", "#8a88a8"].map(C), 0.7 - ((x - 14) + (y - 14)) / 10, x, y));

  // --- the DJ's deck: a table with two turntables and a mixer, chrome trim, a lit front panel
  const dk = new PixelBuf(96, 44);
  dk.rect(0, 10, 96, 34, (x, y) => pick(["#0c0a16", "#16122a", "#221a3e", "#2e2452"].map(C), 0.8 - (y - 10) / 40 - x / 400, x, y));
  dk.rect(0, 8, 96, 3, C("#b8bcd0")); dk.rect(0, 8, 96, 1, C("#ffffff")); dk.rect(0, 10, 96, 1, C("#5a5e74"));
  for (const tx of [6, 56]) { dk.rect(tx, 1, 34, 8, C("#2a2a36")); dk.rect(tx, 1, 34, 1, C("#5a5a6c")); }
  dk.rect(42, 0, 12, 9, C("#1a1a24")); for (let k = 0; k < 4; k++) dk.rect(44 + (k & 1) * 5, 2 + (k >> 1) * 3, 3, 2, k === 1 ? C("#ff5fa8") : C("#58e1ff"));
  for (let x = 4; x < 92; x += 8) dk.rect(x, 22, 4, 2, C("#ff5fa8"));
  dk.rect(30, 28, 36, 8, C("#06040c"));

  const arrows = LANE_COLORS.map((col, lane) => [buildArrow(lane, col, "note")]);
  return { back: bk.toCanvas(), speaker: sp.toCanvas(), cone: cone.toCanvas(), deck: dk.toCanvas(), arrows, receptor: LANE_COLORS.map((col, l) => buildArrow(l, col, "rec")), receptorLit: LANE_COLORS.map((col, l) => buildArrow(l, col, "recLit")) };
}

// ------------------------------------------------------------------ the performers

type PoseKind = "idle" | "sing" | "miss" | "taunt" | "scratch";
type Pose = { kind: PoseKind; lane: number; beat: number; sweat: boolean; grin: boolean; flash: boolean };

type Look = { skin: Ramp; head: Ramp; hair: Ramp; top: Ramp; jacket: Ramp; pants: Ramp; shoe: Ramp; acc: Ramp; acc2: Ramp; metal: Ramp };
const looks = {
  player: null as Look | null,
  rival: null as Look | null,
};
function lookOf(who: "player" | "rival"): Look {
  const hit = looks[who];
  if (hit) return hit;
  const skin = ramp(who === "player" ? "#f2c08a" : "#c88a5e");
  const l: Look = who === "player"
    ? { skin, head: new Uint32Array(skin), hair: ramp("#ff7a1f"), top: ramp("#f0eef8"), jacket: ramp("#2f7fe0"), pants: ramp("#2a2440"), shoe: ramp("#f4f4f8"), acc: ramp("#ffffff"), acc2: ramp("#f2c36b"), metal: ramp("#a8acc0") }
    : { skin, head: new Uint32Array(skin), hair: ramp("#5ae890"), top: ramp("#ff5fa8"), jacket: ramp("#3a2a5e"), pants: ramp("#1c1a2a"), shoe: ramp("#2a2840"), acc: ramp("#2a2a3a"), acc2: ramp("#58e1ff"), metal: ramp("#a8acc0") };
  looks[who] = l;
  return l;
}
const EYE = pack(250, 250, 255), INK = pack(26, 18, 40), MOUTH = pack(110, 24, 40), SHADE = pack(20, 16, 34), SHADE_HI = pack(255, 140, 200);

/**
 * Rasterise a performer. (ox, oy) is between the feet, s = facing (+1 right, -1 left). Angles are from straight down,
 * positive toward the facing direction. The rig is three-quarter view: the far limbs sit behind and in shadow.
 */
function buildPerformer(r: Raster, who: "player" | "rival", p: Pose, ox: number, oy: number, s: 1 | -1, t: number) {
  const L = lookOf(who);
  const M = { skin: r.mat(L.skin), head: r.mat(L.head), hair: r.mat(L.hair), top: r.mat(L.top), jacket: r.mat(L.jacket), pants: r.mat(L.pants), shoe: r.mat(L.shoe), acc: r.mat(L.acc), acc2: r.mat(L.acc2), metal: r.mat(L.metal) };
  const o = (far = 0, spec = false) => ({ far, spec, lift: p.flash ? 0.7 : 0 });
  const bob = p.kind === "miss" ? 0 : Math.round(Math.max(0, Math.sin(p.beat * Math.PI * 2)) * 2); // dip on the beat
  const X = (lx: number) => ox + lx * s, Y = (ly: number) => oy + ly;
  // pose angles
  let lean = 0.04, head = 0, armN: [number, number] = [0.3, 0.5], armF: [number, number] = [-0.25, -0.1], crouch = bob;
  if (p.kind === "idle") { armN = [0.45 + bob * 0.08, 1.9]; armF = [-0.2, 0.2]; head = (bob ? 0.12 : 0); }
  if (p.kind === "sing") { // the mic hand follows the arrow
    const dirs: [number, number][] = [[1.3, 1.6], [0.6, 1.9], [2.4, 2.9], [1.55, 1.65]];
    armN = dirs[p.lane]; armF = p.lane === 2 ? [2.6, 3.0] : [-0.35, 0.1]; lean = p.lane === 1 ? 0.25 : p.lane === 2 ? -0.1 : 0.12; head = p.lane === 2 ? -0.25 : p.lane === 1 ? 0.25 : 0;
  }
  if (p.kind === "miss") { lean = 0.42; head = 0.5; armN = [0.15, 0.25]; armF = [0.05, 0.1]; crouch = 3; }
  if (p.kind === "taunt") { armN = [1.55, 1.6]; armF = [2.8, 3.1]; lean = -0.08; head = -0.1; }
  if (p.kind === "scratch") { armN = [0.9, 2.0 + Math.sin(t / 60) * 0.35]; armF = [0.7, 1.9 - Math.sin(t / 60) * 0.3]; lean = 0.18; head = bob ? 0.18 : 0.05; }

  const TH = 14, SH = 14, UA = 11, FA = 10.5, TORSO = 25;
  const hip = { x: 0, y: -(TH + SH) + crouch * 1.2 };
  // legs (three-quarter: the near leg slightly forward)
  for (const [side, far] of [[-1, 1], [1, 0]] as const) {
    const hx = hip.x + side * 4.2;
    // the knees splay a little and bend further on the beat dip
    const a = (side > 0 ? 0.08 : -0.12) + crouch * 0.05 * side;
    const kx = hx + side * 1.5, ky = hip.y + Math.cos(a) * TH - crouch * 0.6;
    const ax = kx + side * 0.8, ay = ky + SH;
    const z = far ? -5 : 5;
    r.capsule(X(hx), Y(hip.y), z, X(kx), Y(ky), z, 5.6, 4.6, M.pants, o(far));
    r.capsule(X(kx), Y(ky), z, X(ax), Y(ay - 2), z, 4.6, 3.8, M.pants, o(far));
    r.capsule(X(ax), Y(ay - 2.5), z + 1, X(ax + 5.5), Y(ay - 1.5), z + 1, 3.4, 3, M.shoe, o(far, true));
  }
  // torso
  const tor = (d: number) => ({ x: hip.x + Math.sin(lean) * d, y: hip.y - Math.cos(lean) * d });
  const mid = tor(TORSO * 0.45), sh = tor(TORSO), neck = tor(TORSO + 2);
  r.ellipsoid(X(hip.x), Y(hip.y), 0, 8.5, 6, M.pants, o());
  const jacketPaint = who === "player" ? (_u: number, v: number) => (Math.abs(v) > 0.42 ? M.jacket : -1) : (u: number) => (u < 0.18 ? M.acc2 : -1);
  r.capsule(X(hip.x), Y(hip.y - 2), 0, X(mid.x), Y(mid.y), 0.5, 7.6, 8.4, M.top, { ...o(), paint: jacketPaint });
  r.capsule(X(mid.x), Y(mid.y), 0.5, X(sh.x), Y(sh.y + 3), 0.5, 8.6, 9.8, M.top, { ...o(), paint: who === "player" ? (_u: number, v: number) => (Math.abs(v) > 0.4 ? M.jacket : -1) : undefined });
  // arms
  const arm = (a: [number, number], side: number, far: number, mic: boolean) => {
    const bx = sh.x + side * 7.5, by = sh.y + 2.5;
    const ex = bx + Math.sin(a[0] + lean) * UA, ey = by + Math.cos(a[0] + lean) * UA;
    const hx2 = ex + Math.sin(a[1] + lean) * FA, hy2 = ey + Math.cos(a[1] + lean) * FA;
    const z = far ? -6 : 7;
    const sleeve = who === "player" ? M.jacket : M.top;
    r.sphere(X(bx), Y(by), z, 5.2, sleeve, o(far));
    r.capsule(X(bx), Y(by), z, X(ex), Y(ey), z, 4.2, 3.6, sleeve, o(far));
    r.capsule(X(ex), Y(ey), z + 0.5, X(hx2), Y(hy2), z + 1, 3.5, 3, who === "player" ? M.jacket : M.skin, { ...o(far), paint: who === "player" ? (u: number) => (u > 0.72 ? M.skin : -1) : undefined });
    r.ellipsoid(X(hx2), Y(hy2), z + 1.5, 3.4, 3.2, M.skin, o(far));
    if (mic) { // a handheld mic: grille ball and black handle
      const mx = hx2 + Math.sin(a[1] + lean) * 4.5, my = hy2 + Math.cos(a[1] + lean) * 4.5;
      r.capsule(X(hx2), Y(hy2), z + 3, X(mx), Y(my), z + 3, 1.7, 1.5, M.acc === M.top ? M.pants : r.mat(ramp("#1a1824")), o(far, true));
      r.sphere(X(mx), Y(my), z + 4, 2.8, M.metal, o(far, true));
    }
  };
  arm(armF, -1, 1, false);
  arm(armN, 1, 0, who === "player");
  // head
  const ha = lean + head;
  const hc = { x: sh.x + Math.sin(ha) * 10.5 + 0.8, y: sh.y - Math.cos(ha) * 10.5 };
  r.capsule(X(neck.x), Y(neck.y), 0, X((neck.x + hc.x) / 2), Y((neck.y + hc.y) / 2), 0, 3.6, 3.4, M.skin, o());
  const hx = X(hc.x), hy = Y(hc.y);
  r.ellipsoid(hx, hy, 2, 7.4, 8.2, M.head, o());
  r.ellipsoid(hx + s * 2.6, hy + 4.2, 3, 4.6, 3.6, M.head, o()); // jaw
  r.sphere(hx + s * 6.8, hy + 0.8, 5, 1.7, M.head, o()); // nose
  r.sphere(hx - s * 1, hy + 0.5, 6.5, 1.9, M.skin, o()); // ear
  if (who === "player") {
    // spiky orange hair with a white headband
    r.ellipsoid(hx - s * 1.2, hy - 3.4, 1, 7.6, 6, M.hair, { ...o(0, true), paint: (_u, _v, _x, y) => (y > hy - 3.6 && y < hy - 1.6 ? M.acc : -1) });
    for (const [ang, len] of [[-2.5, 9], [-2.0, 10], [-1.5, 9], [-1.05, 7.5], [-2.9, 7]] as const) r.capsule(hx - s * 1.5, hy - 5, 0, hx - s * 1.5 + Math.cos(ang) * len * -s, hy - 5 + Math.sin(ang) * len, 0, 2.8, 0.7, M.hair, o(0, true));
  } else {
    // green mohawk, headphones with a band over the top
    r.ellipsoid(hx - s * 2.5, hy - 1.5, -0.5, 4.8, 6.5, M.hair, o(0, true));
    for (let k = 0; k < 6; k++) { const a = -Math.PI * (0.22 + k * 0.12); r.sphere(hx - s * 0.6 + Math.cos(a) * 7.8 * s, hy - 1 + Math.sin(a) * 8.8, 0, 2.6 - Math.abs(k - 2.5) * 0.2, M.hair, o(0, true)); }
    r.capsule(hx - s * 3.5, hy - 2, 6, hx - s * 1, hy - 9.5, 4, 1.4, 1.4, M.acc, o(0, true));
    r.ellipsoid(hx - s * 1.2, hy + 1, 8, 3.6, 4.4, M.acc, o(0, true));
    r.ellipsoid(hx - s * 1.2, hy + 1, 10.5, 2, 2.6, M.acc2, o(0, true));
  }
  r.finish();
  // face
  const ex = hx + s * 3.6, ey = hy - 0.6;
  if (who === "rival") { // shades
    for (let d = -2; d <= 3; d++) for (let q = 0; q < 2; q++) r.decal(ex + d * s, ey + q, d === 2 && q === 0 ? SHADE_HI : SHADE, M.head);
    r.decal(ex - 3 * s, ey, SHADE, M.head);
  } else if (p.kind === "miss") { for (let d = -1; d <= 1; d++) r.decal(ex + d * s, ey + 1, INK, M.head); }
  else { r.decal(ex, ey, EYE, M.head); r.decal(ex - s, ey, EYE, M.head); r.decal(ex + s, ey, INK, M.head); r.decal(ex, ey + 1, EYE, M.head); r.decal(ex + s, ey + 1, INK, M.head); r.decal(ex - s, ey - 2, INK, M.head); r.decal(ex, ey - 2, INK, M.head); r.decal(ex + s, ey - 2, INK, M.head); }
  const mx = hx + s * 4, my = hy + 4.2;
  const open = p.kind === "sing" || p.kind === "taunt" || p.grin;
  if (open) { for (let d = 0; d < 3; d++) r.decal(mx + d * s - s, my, MOUTH, M.head); r.decal(mx, my + 1, MOUTH, M.head); if (p.grin) { r.decal(mx - s, my, EYE, M.head); r.decal(mx, my, EYE, M.head); } }
  else if (p.kind === "miss") { r.decal(mx, my + 1, INK, M.head); r.decal(mx + s, my, INK, M.head); r.decal(mx - s, my, INK, M.head); }
  else { r.decal(mx, my, INK, M.head); r.decal(mx + s, my, INK, M.head); }
  return { headX: hx, headY: hy };
}

// ------------------------------------------------------------------ the view

export class BeatView {
  private frame = 0;
  private pops: Pop[] = [];
  private sparks: Spark[] = [];
  private bursts: { lane: number; t: number; sick: boolean }[] = [];
  private missLane: number[] = [0, 0, 0, 0];
  private singLane = 0;
  private singT = 999;
  private missT = 999;
  private tauntT = 999;
  private hitFlashT = 999;
  private shake = 0;
  private lo: Ctx | null = null;
  private layer: Ctx | null = null;
  private raster: Raster | null = null;
  private icons = new Map<string, HTMLCanvasElement>();

  onHit(lane: number, j: Judge) {
    this.singLane = lane; this.singT = 0; this.hitFlashT = 0;
    this.pops.push({ text: j === "S" ? "SICK!!" : "GOOD", rows: j === "S" ? [...TXT.cyan] : [...TXT.green], t: 0 });
    if (this.pops.length > 3) this.pops.shift();
    const n = j === "S" ? 16 : 9;
    for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, sp = 0.8 + Math.random() * 2.4; this.sparks.push({ x: LX[lane], y: HY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 0.8, life: 1, col: j === "S" ? (i & 1 ? "#ffffff" : LANE_COLORS[lane]) : LANE_COLORS[lane] }); }
    this.bursts.push({ lane, t: 0, sick: j === "S" });
  }
  onMiss() {
    this.missT = 0; this.tauntT = 0; this.shake = 4;
    this.pops.push({ text: "MISS", rows: [...TXT.red], t: 0 });
    if (this.pops.length > 3) this.pops.shift();
    const lane = this.singLane;
    this.missLane[lane] = 1;
    for (let i = 0; i < 8; i++) this.sparks.push({ x: LX[lane] + (Math.random() - 0.5) * 16, y: HY + (Math.random() - 0.5) * 8, vx: (Math.random() - 0.5) * 1.6, vy: 0.4 + Math.random() * 1.4, life: 1, col: i & 1 ? "#ff5a4a" : "#6a1a2a" });
  }

  draw(c: CanvasRenderingContext2D, f: BeatFrame) {
    this.lo ??= mk(IW, IH);
    this.layer ??= mk(IW, IH);
    this.raster ??= new Raster(IW, IH);
    art ??= buildArt();
    this.frame++;
    this.singT++; this.missT++; this.tauntT++; this.hitFlashT++;
    const g = this.lo.c;
    const t = f.t, beatMs = 60000 / f.level.bpm;
    const beatPhase = ((t / beatMs) % 1 + 1) % 1;
    const pulse = t > 0 ? Math.max(0, 1 - beatPhase * 3) : 0;
    const beatN = Math.floor(t / beatMs);
    const sx = this.shake > 0.5 ? Math.round((Math.random() - 0.5) * this.shake) : 0, sy = this.shake > 0.5 ? Math.round((Math.random() - 0.5) * this.shake) : 0;
    this.shake *= 0.82;
    g.save(); g.translate(sx, sy);
    this.stage(g, t, beatPhase, pulse, beatN, f.hype);

    // performers
    const bar = Math.floor(t / (beatMs * 4));
    const rivalSings = t > 0 && bar % 2 === 1 && bar >= 3;
    let rivalLane = 0;
    if (rivalSings) { const nearest = f.chart.find((n) => n.t > t - 260 && n.t < t + 400); rivalLane = nearest ? nearest.lane : beatN % 4; }
    const rivalPose: Pose = this.tauntT < 34 ? { kind: "taunt", lane: 0, beat: beatPhase, sweat: false, grin: true, flash: false }
      : rivalSings ? { kind: "scratch", lane: rivalLane, beat: beatPhase, sweat: f.hype > 78, grin: false, flash: false }
        : { kind: "idle", lane: 0, beat: beatPhase, sweat: f.hype > 78, grin: f.hype < 32, flash: false };
    const youPose: Pose = this.missT < 34 ? { kind: "miss", lane: 0, beat: beatPhase, sweat: true, grin: false, flash: false }
      : this.singT < 16 ? { kind: "sing", lane: this.singLane, beat: beatPhase, sweat: false, grin: false, flash: this.hitFlashT < 2 }
        : { kind: "idle", lane: 0, beat: beatPhase, sweat: f.hype < 22, grin: false, flash: false };
    const r = this.raster;
    r.begin();
    const rv = buildPerformer(r, "rival", rivalPose, 52, 178, 1, t);
    this.layer.c.clearRect(0, 0, IW, IH);
    r.put(this.layer.c); g.drawImage(this.layer.cv, 0, 0);
    // the DJ deck in front of the rival, with spinning platters
    g.drawImage(art.deck, 4, 150);
    for (const [px, ph] of [[23, 0], [73, 1]] as const) { const a = t / 120 + ph; g.fillStyle = "#0a0a12"; g.fillRect(px - 15, 152, 30, 6); g.fillStyle = "#d8dce8"; g.fillRect(Math.round(px + Math.cos(a) * 11) - 1, 153, 2, 3); g.fillStyle = "#ff5fa8"; g.fillRect(px - 1, 154, 3, 2); }
    r.begin();
    const yv = buildPerformer(r, "player", youPose, 306, 190, -1, t);
    r.put(this.layer.c); g.drawImage(this.layer.cv, 0, 0);
    // sweat drops when struggling
    for (const [pose, h] of [[rivalPose, rv], [youPose, yv]] as const) if (pose.sweat && (this.frame >> 3) & 1) { g.fillStyle = "#9cf0ff"; g.fillRect(Math.round(h.headX + 8), Math.round(h.headY - 6 + ((this.frame >> 2) & 3)), 2, 3); g.fillStyle = "#ffffff"; g.fillRect(Math.round(h.headX + 8), Math.round(h.headY - 6 + ((this.frame >> 2) & 3)), 1, 1); }
    if (this.missT < 8) pdither(g, 0, 0, IW, IH, "#ff2030", 0.22 * (1 - this.missT / 8));

    this.field(g, f, pulse, beatPhase);
    g.restore();
    this.hud(g, f, pulse);

    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.imageSmoothingEnabled = false;
    c.drawImage(this.lo.cv, 0, 0, BW, BH);
    c.restore();
  }

  private stage(g: CanvasRenderingContext2D, t: number, beatPhase: number, pulse: number, beatN: number, hype: number) {
    const A = art!;
    g.drawImage(A.back, 0, 0);
    // LED wall: an animated spectrum with scanline gaps, brighter on the beat
    for (let col = 0; col < 24; col++) {
      const h = Math.round((0.25 + 0.75 * Math.abs(Math.sin(t / 380 + col * 0.55) * Math.sin(t / 700 + col * 0.21))) * (46 + pulse * 40) + 8);
      for (let y = 0; y < h; y += 3) {
        const k = y / 100;
        g.fillStyle = k > 0.75 ? "#ff5fa8" : k > 0.45 ? "#b06af0" : "#38b8f0";
        g.fillRect(86 + col * 8, 135 - y, 6, 2);
      }
    }
    // neon signs on the side walls: a lightning bolt over the DJ, a music note over the stage; they flare on the beat
    const neon = (pts: number[], core: string, halo: string) => {
      for (let k = 0; k + 3 < pts.length; k += 2) pline(g, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], halo, pulse > 0.3 ? 3 : 2);
      for (let k = 0; k + 3 < pts.length; k += 2) pline(g, pts[k], pts[k + 1], pts[k + 2], pts[k + 3], pulse > 0.3 ? "#ffffff" : core, 1);
    };
    neon([102, 58, 90, 80, 99, 80, 89, 104, 111, 74, 102, 74, 111, 58, 102, 58], "#ffd0ea", "#ff5fa8");
    neon([258, 98, 258, 64, 272, 60, 272, 90], "#d8fbff", "#58e1ff");
    for (const [cx, cy] of [[254, 98], [268, 90]]) { pdisc(g, cx, cy, 5, "#58e1ff"); pdisc(g, cx, cy, 3.5, pulse > 0.3 ? "#ffffff" : "#d8fbff"); }
    void hash;
    // neon tubes framing the wall: pink and cyan, chasing
    for (let x = 84; x < 276; x += 2) { g.fillStyle = ((x >> 3) + beatN) % 4 === 0 ? "#ffffff" : "#58e1ff"; g.fillRect(x, 31, 2, 1); g.fillStyle = ((x >> 3) + beatN) % 4 === 2 ? "#ffffff" : "#ff5fa8"; g.fillRect(x, 140, 2, 1); }
    // speaker stacks: the woofers kick out on every beat
    for (const sx2 of [20, 294]) {
      g.drawImage(A.speaker, sx2, 92);
      const push = pulse > 0.5 ? 1 : 0;
      for (const yy of [97, 133]) g.drawImage(A.cone, sx2 + 9 - push, yy - push, 28 + push * 2, 28 + push * 2);
    }
    // the grid floor, scrolling toward you on the beat, tiles lighting in a checker on the downbeat
    const HZ = 166;
    g.fillStyle = "#ff5fa8";
    for (let k = 0; k < 9; k++) {
      const u = (k + ((t / (60000 / 120)) % 1)) / 9, y = Math.round(HZ + Math.pow(u, 2) * (IH - HZ));
      g.fillStyle = k === 0 ? "#5a1a5a" : pulse > 0.4 ? "#ff8ac8" : "#a8307a"; g.fillRect(0, y, IW, 1);
    }
    for (let i = -14; i <= 14; i++) { g.fillStyle = pulse > 0.4 ? "#ff8ac8" : "#8a2a6a"; pline(g, IW / 2 + i * 7, HZ, IW / 2 + i * 34, IH, g.fillStyle as string); }
    if (pulse > 0.2) for (let k = 0; k < 6; k++) { const tx = IW / 2 + ((beatN * 3 + k * 5) % 13 - 6) * 26, ty = 200 + (k % 3) * 12; pdither(g, tx - 10, ty, 20, 8, "#ff5fa8", 0.3 * pulse); }
    // risers: the DJ's booth and your stage, with chaser lights along their lit edges
    g.fillStyle = "#14102a"; g.fillRect(0, 192, 108, 12); g.fillRect(256, 196, 104, 10);
    for (let x = 0; x < 108; x += 4) { g.fillStyle = ((x >> 2) + beatN) % 3 === 0 ? "#ffffff" : "#58e1ff"; g.fillRect(x, 192, 2, 1); }
    for (let x = 256; x < 360; x += 4) { g.fillStyle = ((x >> 2) + beatN) % 3 === 0 ? "#ffffff" : "#ff5fa8"; g.fillRect(x, 196, 2, 1); }
    // spotlights from the truss, sweeping; additive beams drawn with dithering
    const cans: [number, string, number][] = [[40, "#ff5fa8", 0], [130, "#58e1ff", 1.7], [230, "#7fe0a9", 3.2], [320, "#f2c36b", 4.6]];
    for (const [cx, col, ph] of cans) {
      const sway = Math.sin(t / 900 + ph) * 60;
      const ex2 = cx + sway, w0 = 2, w1 = 26;
      for (let y = 20; y < 190; y += 1) {
        const k = (y - 20) / 170, xc = cx + (ex2 - cx) * k, hw = w0 + (w1 - w0) * k;
        const cover = (0.32 - k * 0.24) * (0.7 + pulse * 0.5);
        g.fillStyle = col;
        for (let x = Math.round(xc - hw); x < Math.round(xc + hw); x++) if (bayer(x, y) + 0.5 < cover) g.fillRect(x, y, 1, 1);
      }
      g.fillStyle = "#3a3e56"; g.fillRect(cx - 4, 18, 8, 5); g.fillStyle = "#fffbe8"; g.fillRect(cx - 2, 22, 4, 2);
    }
    // the crowd along the front: silhouettes with stage rim light, jumping harder the hotter the hype
    for (let i = 0; i < 24; i++) {
      const x = i * 16 + 4, jump = Math.round(Math.abs(Math.sin(t / 300 + i * 1.3)) * 4 * (0.4 + hype / 100) + (pulse > 0.6 && i % 2 ? 2 : 0));
      const y = IH - 10 - jump;
      pdisc(g, x, y, 7, "#06030e"); g.fillStyle = "#06030e"; g.fillRect(x - 8, y + 2, 16, 14);
      g.fillStyle = i % 3 === 0 ? "#ff5fa8" : "#58e1ff"; g.fillRect(x - 4, y - 7, 6, 1);
      if (i % 3 === 0) { const ax = x + 6 + Math.round(Math.sin(t / 200 + i) * 2); pline(g, x + 4, y + 2, ax, y - 16, "#06030e", 3); }
    }
    void beatPhase;
  }

  private field(g: CanvasRenderingContext2D, f: BeatFrame, pulse: number, beatPhase: number) {
    const A = art!;
    // the lane panel: dark glass with a lit frame
    g.fillStyle = "rgba(5,2,16,0.8)"; g.fillRect(PANEL_X0, FT, PANEL_X1 - PANEL_X0, IH - FT);
    g.fillStyle = pulse > 0.4 ? "#ffffff" : "#8a7ac8"; g.fillRect(PANEL_X0 - 1, FT, 1, IH - FT); g.fillRect(PANEL_X1, FT, 1, IH - FT);
    for (let i = 1; i < 4; i++) { g.fillStyle = "#2a2050"; g.fillRect(Math.round((LX[i - 1] + LX[i]) / 2), FT, 1, IH - FT); }
    // beat lines scrolling with the chart (one per beat)
    const speed = (HY - FT + 20) / f.level.lookahead, beatMs = 60000 / f.level.bpm;
    for (let b = Math.ceil(f.t / beatMs); ; b++) {
      const y = Math.round(HY - (b * beatMs - f.t) * speed);
      if (y < FT) break;
      g.fillStyle = b % 4 === 0 ? "#4a3a8a" : "#241a4a"; g.fillRect(PANEL_X0, y, PANEL_X1 - PANEL_X0, 1);
    }
    // lane flashes when pressed, red when a note was missed
    for (let i = 0; i < 4; i++) {
      if (f.flash[i] > 0) { // a beam rising from the receptor, fading upward
        g.fillStyle = LANE_COLORS[i];
        for (let y = HY - 72; y < HY + 14; y++) { const cover = f.flash[i] * 0.5 * clamp(1 - (HY + 14 - y) / 86); for (let x = LX[i] - 13; x < LX[i] + 13; x++) if (bayer(x, y) + 0.5 < cover) g.fillRect(x, y, 1, 1); }
      }
      if (this.missLane[i] > 0) { pdither(g, LX[i] - 14, HY - 40, 28, 54, "#ff2a3a", this.missLane[i] * 0.5); this.missLane[i] = Math.max(0, this.missLane[i] - 0.06); }
    }
    // receptors (light up when pressed and pulse on the beat)
    for (let i = 0; i < 4; i++) {
      const lit = f.flash[i] > 0.15;
      const img = lit ? A.receptorLit[i] : A.receptor[i];
      const grow = pulse > 0.6 && !lit ? 1 : 0;
      g.drawImage(img, Math.round(LX[i] - 15 - grow), Math.round(HY - 15 - grow), 30 + grow * 2, 30 + grow * 2);
    }
    // notes
    for (let i = 0; i < f.chart.length; i++) {
      const n = f.chart[i];
      const y = HY - (n.t - f.t) * speed;
      if (y < FT - 30) break;
      if (f.letters[i] !== null || y > IH + 15) continue;
      const x = LX[n.lane];
      // a short speed trail behind the arrow
      pdither(g, x - 2, Math.round(y) - 22, 4, 10, LANE_COLORS[n.lane], 0.25);
      if (y < FT + 12) { g.globalAlpha = clamp((y - FT + 30) / 42); }
      g.drawImage(A.arrows[n.lane][0], Math.round(x - 15), Math.round(y - 15));
      g.globalAlpha = 1;
    }
    // hit bursts: a ring of pixels and a flash on the receptor
    this.bursts = this.bursts.filter((b) => (b.t += 1) < 14);
    for (const b of this.bursts) {
      const R = 9 + b.t * (b.sick ? 1.6 : 1.1), col = b.t < 4 ? "#ffffff" : LANE_COLORS[b.lane];
      for (let k = 0; k < 20; k++) { const a = (k / 20) * Math.PI * 2; if ((k + b.t) % 2 === 0) { g.fillStyle = col; g.fillRect(Math.round(LX[b.lane] + Math.cos(a) * R), Math.round(HY + Math.sin(a) * R), 1 + (b.t < 6 ? 1 : 0), 1 + (b.t < 6 ? 1 : 0)); } }
      if (b.t < 3) pdisc(g, LX[b.lane], HY, 13 - b.t * 3, b.sick ? "#ffffff" : LANE_COLORS[b.lane]);
    }
    this.sparks = this.sparks.filter((s) => (s.life -= 0.04) > 0);
    for (const s of this.sparks) { s.x += s.vx; s.y += s.vy; s.vy += 0.09; g.fillStyle = s.col; g.fillRect(Math.round(s.x), Math.round(s.y), s.life > 0.5 ? 2 : 1, s.life > 0.5 ? 2 : 1); }
    // judgement pops over the lanes
    this.pops = this.pops.filter((p) => (p.t += 1) < 40);
    const last = this.pops[this.pops.length - 1];
    if (last) {
      const sc = last.t < 3 ? 4 : 3;
      const y = HY - 64 - Math.min(10, last.t * 0.4);
      if (last.t < 30 || (last.t >> 1) & 1) ptext(g, last.text, IW / 2, y - (7 * sc) / 2, { rows: last.rows, outline: "#0a0418", shadow: "#0a0418", scale: sc, gap: 1 }, 0.5);
    }
    void beatPhase;
  }

  private icon(who: "player" | "rival", mood: number) {
    const key = `${who}${mood < -0.3 ? "m" : mood > 0.4 ? "h" : "n"}`;
    let cv = this.icons.get(key);
    if (cv) return cv;
    const N = 26, r = new Raster(N, N);
    r.begin();
    const pose: Pose = { kind: mood < -0.3 ? "miss" : mood > 0.4 && who === "rival" ? "taunt" : "idle", lane: 0, beat: 0.5, sweat: false, grin: mood > 0.4 && who === "rival", flash: false };
    // stand the performer far below the frame so only the head fits
    buildPerformer(r, who, pose, N / 2 + (who === "player" ? 3 : -3), N + 52, who === "player" ? -1 : 1, 0);
    cv = document.createElement("canvas"); cv.width = N; cv.height = N;
    const g = cv.getContext("2d")!;
    const bg = who === "player" ? ["#0a3a6a", "#1a6aa8", "#3aa8e0"] : ["#5a0a3a", "#a01c6a", "#e04aa0"];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const d = Math.hypot(x - N / 2 + 0.5, y - N / 2 + 0.5); if (d > N / 2) continue; g.fillStyle = d > N / 2 - 1.5 ? "#0a0418" : bg[clamp(Math.round((1 - y / N) * 2 + bayer(x, y) * 0.8), 0, 2)]; g.fillRect(x, y, 1, 1); }
    const tmp = document.createElement("canvas"); tmp.width = N; tmp.height = N; tmp.getContext("2d")!.putImageData(r.img, 0, 0);
    g.save(); g.beginPath(); g.arc(N / 2, N / 2, N / 2 - 1.5, 0, Math.PI * 2); g.clip(); g.drawImage(tmp, 0, 0); g.restore();
    this.icons.set(key, cv);
    return cv;
  }

  private hud(g: CanvasRenderingContext2D, f: BeatFrame, pulse: number) {
    // song progress along the very top
    const total = f.chart.length ? f.chart[f.chart.length - 1].t + 1200 : 1;
    g.fillStyle = "#1a1030"; g.fillRect(0, 0, IW, 3);
    const pw = Math.round(IW * clamp(f.t / total));
    g.fillStyle = "#58e1ff"; g.fillRect(0, 0, pw, 2); g.fillStyle = "#d8fbff"; g.fillRect(0, 0, pw, 1);
    // tug-of-war hype bar: you pull to the right, the rival to the left
    const bx = 84, by = 9, bw = 192, bh = 9;
    g.fillStyle = "#0a0418"; g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
    g.fillStyle = pulse > 0.4 ? "#ffffff" : "#b0a0e0"; g.fillRect(bx - 1, by - 1, bw + 2, 1); g.fillRect(bx - 1, by + bh, bw + 2, 1);
    const split = Math.round(bx + bw * (1 - clamp(f.hype / 100)));
    const PINK = ["#ffd0ea", "#ff9ac8", "#ff6aae", "#e83a8a", "#c4206e", "#a01458", "#7a0c44", "#5a0832", "#40061e"];
    const BLUE = ["#e0fbff", "#a8f0ff", "#6ad8ff", "#2ab8f0", "#1690d0", "#0e70b0", "#0a5490", "#083c70", "#062a50"];
    for (let r = 0; r < bh; r++) { g.fillStyle = PINK[r]; g.fillRect(bx, by + r, split - bx, 1); g.fillStyle = BLUE[r]; g.fillRect(split, by + r, bx + bw - split, 1); }
    for (let i = 1; i < 10; i++) { g.fillStyle = "rgba(10,4,24,0.35)"; g.fillRect(bx + Math.round((bw * i) / 10), by + 1, 1, bh - 2); }
    g.fillStyle = "#ffffff"; g.fillRect(split - 1, by - 2, 2, bh + 4);
    const mood = (f.hype - 50) / 50;
    const sp = clamp(split, bx + 8, bx + bw - 8);
    g.drawImage(this.icon("rival", -mood), Math.round(sp - 30), by - 8);
    g.drawImage(this.icon("player", mood), Math.round(sp + 4), by - 8);
    ptext(g, f.names[1].slice(0, 12).toUpperCase(), bx, by + bh + 4, { rows: [...TXT.pink], outline: "#0a0418" });
    ptext(g, f.names[0].slice(0, 12).toUpperCase(), bx + bw, by + bh + 4, { rows: [...TXT.cyan], outline: "#0a0418" }, 1);
    // score (right), accuracy and level (left)
    ptext(g, String(f.score).padStart(7, "0"), IW - 6, 30, { rows: [...TXT.gold], outline: "#0a0418", shadow: "#0a0418", scale: 2 }, 1);
    ptext(g, "SCORE", IW - 6, 48, { rows: [...TXT.cyan], outline: "#0a0418" }, 1);
    const done = f.letters.filter((l) => l !== null).length;
    const acc = done ? Math.round(((f.sick + f.good * 0.6) / done) * 100) : 100;
    ptext(g, `${acc}%`, 6, 30, { rows: [...TXT.white], outline: "#0a0418", shadow: "#0a0418", scale: 2 });
    ptext(g, "ACCURACY", 6, 48, { rows: [...TXT.cyan], outline: "#0a0418" });
    const chipCol = { easy: TXT.green, normal: TXT.cyan, hard: TXT.gold, insane: TXT.pink }[f.level.id];
    const chip = f.level.label.toUpperCase();
    g.fillStyle = "#0a0418"; g.fillRect(5, 58, chip.length * 6 + 9, 13);
    g.fillStyle = chipCol[3]; g.fillRect(6, 59, chip.length * 6 + 7, 1); g.fillRect(6, 69, chip.length * 6 + 7, 1); g.fillRect(6, 59, 1, 11); g.fillRect(chip.length * 6 + 12, 59, 1, 11);
    ptext(g, chip, 10, 62, { rows: [...chipCol], outline: null });
    ptext(g, `${f.level.bpm} BPM`, 6, 75, { rows: ["#8a7ac8"], outline: null });
    // judgement tally
    ptext(g, `SICK ${f.sick}`, IW - 6, 58, { rows: [...TXT.cyan], outline: "#0a0418" }, 1);
    ptext(g, `GOOD ${f.good}`, IW - 6, 67, { rows: [...TXT.green], outline: "#0a0418" }, 1);
    ptext(g, `MISS ${f.miss}`, IW - 6, 76, { rows: [...TXT.red], outline: "#0a0418" }, 1);
    // combo beside the lanes
    if (f.combo > 1) {
      const sc = pulse > 0.6 ? 4 : 3;
      ptext(g, String(f.combo), PANEL_X1 + 6, 126 - (sc - 3) * 3, { rows: [...TXT.white], outline: "#0a0418", shadow: "#0a0418", scale: sc });
      ptext(g, `COMBO x${f.comboMult}`, PANEL_X1 + 6, 150, { rows: [...TXT.gold], outline: "#0a0418" });
      // a little meter toward the next multiplier
      const into = f.comboMult >= 4 ? 1 : (f.combo % 10) / 10;
      g.fillStyle = "#0a0418"; g.fillRect(PANEL_X1 + 6, 160, 52, 5); g.fillStyle = "#ffc21f"; g.fillRect(PANEL_X1 + 7, 161, Math.round(50 * into), 3);
    }
    if (f.t < 0) {
      const s = Math.ceil(-f.t / 500);
      const word = s > 2 ? "GET READY" : s > 1 ? "3" : "GO!";
      const sc = word.length > 3 ? 3 : 5;
      ptext(g, word, IW / 2, 110 - (7 * sc) / 2, { rows: word === "GO!" ? [...TXT.green] : [...TXT.gold], outline: "#0a0418", shadow: "#0a0418", scale: sc }, 0.5);
    }
    if (f.t > 0 && f.t < 1800) ptext(g, "D F J K  OR  ARROW KEYS", IW / 2, 222, { rows: [...TXT.white], outline: "#0a0418" }, 0.5);
    void hash;
  }
}
