// Pixel Fighter II: a 16-bit, CPS-2 style presentation.
//
// Everything is drawn at a native 480x270 resolution into an offscreen canvas and scaled up 2x with
// nearest-neighbour filtering, so each pixel is a hard, deliberate pixel (no anti-aliasing, no filters).
//   * The fighters are posed skeletons rasterised every frame by the shared sprite rasteriser
//     (pixelKit.Raster): lit, z-buffered capsules and ellipsoids quantised to hue-shifted 6-tone ramps with
//     ordered dithering, inner contour lines and a 1px selective outline. Far limbs sit in shadow.
//   * The rooftop dojo is baked once into pixel layers: a dithered sky, drifting cumulus, a castle keep with
//     tiled roofs and stone walls, distant pagodas, a lacquered railing with banners and a plank floor.
//   * Hit sparks, projectiles, dust, motion smears and the HUD (gold-bevel health bars, portraits, KO
//     emblem, timer, super meters) are pixel art too, with a bitmap font.
// The game simulation runs in a 320x180 space; K maps it onto the 480x270 canvas.
import { CHARACTERS, FIGHT, METER_MAX, type CharDef, type Fighter, type FightMatch, type Shot } from "../shared/fighter";
import { PixelBuf, Raster, TXT, bayer, clamp, hexRgb, pack, pdisc, pdither, pellipse, pline, ppoly, ptext, ramp, textWidth, type Ramp } from "./pixelKit";

export const SCALE = 3; // the 320x180 simulation is shown on a 960x540 canvas
export const LW = 320;
export const LH = 180;
export const GROUND = 160; // logical y of the floor line the fighters stand on

export type Spark = { x: number; y: number; t: number; kind: "hit" | "heavy" | "block" | "ko" };
export type HudState = { ghost: [number, number]; names: [string, string]; chars: [number, number] };

const IW = 480, IH = 270, K = 1.5; // native pixel canvas and the sim -> pixel factor
const GY = GROUND * K; // 240: the floor line in pixels
const OUT = (LW * SCALE) / IW; // 2: the upscale
const BODY = 1.32; // sprite size relative to the simulation's hit boxes: arcade-sized fighters

// ------------------------------------------------------------------ canvases

type Ctx = { cv: HTMLCanvasElement; c: CanvasRenderingContext2D };
const mk = (w: number, h: number): Ctx => {
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const c = cv.getContext("2d")!; c.imageSmoothingEnabled = false;
  return { cv, c };
};
let lo: Ctx | null = null; // the native-resolution frame
let spriteLayer: Ctx | null = null; // the fighters' raster is put here, then composited (putImageData ignores alpha)
const raster = typeof ImageData === "undefined" ? null : new Raster(IW, IH);

// ------------------------------------------------------------------ the characters' looks

type Look = {
  skin: Ramp; head: Ramp; top: Ramp; sleeve: Ramp; fore: Ramp; hand: Ramp; legU: Ramp; legL: Ramp; foot: Ramp; hair: Ramp;
  trim: Ramp; belt: Ramp; dark: Ramp; vest?: Ramp; scale: number; thick: number;
};
const looks = new Map<string, Look>();
/** Mirror matches get the classic alternate palette for the second player. */
const ALT: Record<string, Partial<CharDef["colors"]>> = {
  karate: { suit: "#e9dcb8", trim: "#2f6fd8" }, kickboxer: { suit: "#d9304a", trim: "#f4f4f4" }, ninja: { suit: "#2a4a3a", trim: "#e8c040" }, brawler: { suit: "#3a7ad9", trim: "#e8d0a0" },
};
function lookOf(def: CharDef, alt: boolean): Look {
  const key = def.id + (alt ? "*" : "");
  const hit = looks.get(key);
  if (hit) return hit;
  const col = { ...def.colors, ...(alt ? ALT[def.id] : {}) };
  const skin = ramp(col.skin);
  const head = new Uint32Array(skin); // its own material id so face pixels only land on the head
  const suit = ramp(col.suit), trim = ramp(col.trim), hair = ramp(col.hair), dark = ramp("#24202e");
  let l: Look;
  switch (def.id) {
    case "karate": l = { skin, head, top: suit, sleeve: suit, fore: skin, hand: skin, legU: suit, legL: suit, foot: skin, hair, trim, belt: ramp("#1e1a24"), dark, scale: 1, thick: 1 }; break;
    case "kickboxer": l = { skin, head, top: skin, sleeve: skin, fore: skin, hand: ramp(alt ? "#3a5fd9" : "#d9304a"), legU: suit, legL: skin, foot: ramp("#f2d08b"), hair, trim, belt: trim, dark, scale: 1.02, thick: 1 }; break;
    case "ninja": l = { skin, head, top: suit, sleeve: suit, fore: suit, hand: ramp("#3a3448"), legU: suit, legL: suit, foot: ramp("#171127"), hair: suit, trim, belt: trim, dark, scale: 0.97, thick: 0.9 }; break;
    default: l = { skin, head, top: skin, sleeve: skin, fore: skin, hand: skin, legU: ramp("#4a3320"), legL: ramp("#4a3320"), foot: ramp("#2a1a10"), hair, trim, belt: ramp("#2a1a10"), dark, vest: suit, scale: 1.16, thick: 1.35 };
  }
  looks.set(key, l);
  return l;
}
const P_EYE = pack(250, 250, 255), P_INK = pack(28, 20, 40), P_MOUTH = pack(110, 24, 36), P_GOLD = pack(240, 200, 90);

// ------------------------------------------------------------------ poses

/** Angles are measured from straight down, positive = toward the opponent (facing-right space). */
type Pose = {
  lean: number; legF: [number, number]; legB: [number, number]; armF: [number, number]; armB: [number, number];
  head: number; rot: number; lift: number; face: "calm" | "shout" | "squint" | "ko" | "hurt";
};
const TH = 13.4, SH = 13.4, UA = 10.2, FA = 9.8, TORSO = 22.5;

function ease(t: number) { return t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); }

function poseOf(f: Fighter, def: CharDef, tick: number): Pose {
  const P = (lean: number, legF: [number, number], legB: [number, number], armF: [number, number], armB: [number, number], face: Pose["face"] = "calm", head = 0, rot = 0, lift = 0): Pose => ({ lean, legF, legB, armF, armB, face, head, rot, lift });
  const mv = f.state === "light" ? def.light : f.state === "heavy" ? def.heavy : null;
  // 0 -> 1 through the startup (wind-up), 1 while active, then back to 0 through the recovery
  const wind = mv ? clamp(f.t / mv.startup) : 0;
  const ext = mv ? (f.t < mv.startup ? 0 : f.t < mv.startup + mv.active ? 1 : clamp(1 - (f.t - mv.startup - mv.active) / mv.recover)) : 0;
  const breathe = Math.sin(tick / 11 + f.c * 1.7);
  const air = f.y > 0;
  switch (f.state) {
    case "walk": {
      const ph = f.x * 0.21 * f.face; // stride locked to ground speed so the feet don't skate
      const s = Math.sin(ph) * 0.62, cs = Math.cos(ph);
      return P(0.1, [0.25 + s, -0.15 - Math.max(0, cs) * 0.55], [0.15 - s, -0.15 - Math.max(0, -cs) * 0.55], [0.75 - s * 0.35, 2.55], [0.35 + s * 0.35, 2.3], "calm", 0, 0, Math.abs(cs) * 0.8);
    }
    case "jump": {
      const up = f.vy > 1.2, apex = Math.abs(f.vy) <= 1.2;
      if (up) return P(0.05, [0.7, -0.6], [0.2, -0.3], [1.1, 2.6], [0.2, 1.6]);
      if (apex) return P(0.18, [1.45, -1.25], [0.9, -1.45], [0.9, 2.5], [0.4, 2.2]); // full tuck
      return P(0.08, [0.95, -0.7], [0.45, -0.9], [0.9, 2.5], [0.3, 2.0]);
    }
    case "crouch": return P(0.32, [1.32, -1.22], [0.55, -1.38], [0.75, 2.75], [0.45, 2.6], "calm", 0.05);
    case "block": return P(-0.08, [0.6, -0.15], [-0.4, 0.15], [0.95, 3.05], [0.7, 2.95], "squint", 0.08);
    case "light": {
      // jab: fist cocks back slightly, snaps out straight, retracts
      const a = 1.0 - wind * 0.15 * (1 - ext) + ext * 0.52;
      return P(0.12 + ext * 0.22, [0.62, -0.18], [-0.62, 0.22], [a, a + 0.04 + (1 - ext) * 1.4], [0.45, 2.6], ext > 0.5 ? "shout" : "calm");
    }
    case "heavy": {
      // knee chambers up in the wind-up, the leg snaps out in the active frames, then retracts
      const ch = ease(wind) * (1 - ext);
      const thigh = ch * 1.35 + ext * 1.58, shin = ch * -0.55 + ext * 1.56;
      const k = air ? 0.9 : 1;
      return P(-0.08 - ext * 0.26, [-0.05 + thigh * k, -0.1 + shin * k + 0.1], [-0.12, 0.1], [-0.2 - ext * 0.45, 0.6], [0.8 + ext * 0.3, 2.2], ext > 0.4 ? "shout" : "squint");
    }
    case "special": {
      if (def.special.kind === "dash") return P(0.9, [1.58, 1.52], [0.25, -1.5], [-0.5, 0.45], [1.3, 2.6], "shout", 0, 0.3, 14);
      const charge = f.t < 9, k = clamp(f.t / 9);
      if (def.id === "brawler") return charge ? P(-0.15, [0.7, -0.4], [-0.6, 0.2], [2.9 * k + 0.3, 3.0], [2.7 * k + 0.2, 2.9], "shout") : P(0.45, [1.1, -0.9], [-0.3, -0.6], [1.05, 0.7], [0.9, 0.6], "shout");
      if (def.id === "ninja") return charge ? P(-0.12, [0.6, -0.2], [-0.6, 0.25], [2.8, 2.2 + k], [0.3, 1.8], "squint") : P(0.25, [0.9, -0.35], [-0.8, 0.4], [1.35, 1.25], [0.2, 1.5], "shout");
      return charge ? P(-0.12, [0.85, -0.45], [-0.85, 0.3], [-0.35, 1.25], [-0.15, 1.35], "squint") : P(0.25, [1.05, -0.45], [-0.95, 0.5], [1.52, 1.56], [1.42, 1.5], "shout");
    }
    case "hit": {
      const k = 1 - clamp(f.t / Math.max(8, f.stun));
      return P(-0.5 * k - 0.1, [0.45, -0.1], [-0.45, 0.2], [-0.9 * k, -0.6 * k + 0.6], [-0.5 * k, 0.2], "hurt", -0.4 * k);
    }
    case "win": {
      const pump = Math.sin(tick / 7) > 0 ? 1 : 0.86;
      return P(-0.06, [0.3, -0.08], [-0.3, 0.08], [3.05 * pump, 3.1], [0.5, 2.0], "shout");
    }
    case "ko": {
      const k = ease(clamp(f.t / 16));
      return P(-0.25, [0.35, 0.1], [0.05, 0.25], [-1.2, -1.0], [-0.7, -0.9], "ko", -0.35, -k * (Math.PI / 2 - 0.06), 0);
    }
    default: { // idle: a bouncing guard
      const b = breathe * 0.05;
      return P(0.12 + b, [0.58 + b, -0.16], [-0.52 - b, 0.2], [0.7, 2.68 + b * 2.5], [0.3, 2.5], "calm", 0, 0, breathe > 0.3 ? 1 : 0);
    }
  }
}

// ------------------------------------------------------------------ building a fighter sprite

type J = { x: number; y: number };
type Built = { hand: J; foot: J; feet: J; headTop: number };

/**
 * Pose the skeleton and rasterise it. (ox, oy) is the point between the feet on the ground in pixels.
 * zBase lifts the whole fighter in depth so the front fighter wins overlaps.
 */
function buildFighter(r: Raster, f: Fighter, def: CharDef, look: Look, p: Pose, ox: number, oy: number, zBase: number, flash: boolean, tick: number, sc0?: number): Built {
  const sc = sc0 ?? look.scale * BODY, th = look.thick, s = f.face;
  const reach = (l: [number, number]) => TH * Math.cos(l[0]) + SH * Math.cos(l[1]);
  const hipH = Math.max(reach(p.legF), reach(p.legB), 7);
  const cr = Math.cos(p.rot * s), sr = Math.sin(p.rot * s);
  const liftY = p.rot !== 0 ? -Math.min(1, Math.abs(p.rot) / 1.5) * 7 : 0;
  // local (facing right, y down, origin at the feet) -> raster
  const X = (lx: number, ly: number) => { const x = lx * s, y = ly - p.lift; return ox + (x * cr - y * sr) * sc; };
  const Y = (lx: number, ly: number) => { const x = lx * s, y = ly - p.lift; return oy + liftY + (x * sr + y * cr) * sc; };
  const at = (lx: number, ly: number): J => ({ x: X(lx, ly), y: Y(lx, ly) });
  const rad = (v: number) => v * sc;
  const o = (far = 0, spec = false) => ({ far, spec, lift: flash ? 0.95 : 0 });

  const hip = { x: 0, y: -hipH };
  const lean = p.lean;
  const tor = (d: number, side = 0) => ({ x: hip.x + Math.sin(lean) * d + Math.cos(lean) * side, y: hip.y - Math.cos(lean) * d + Math.sin(lean) * side });
  const sh = tor(TORSO), mid = tor(TORSO * 0.45);
  const headA = lean + p.head;
  const headC = { x: sh.x + Math.sin(headA) * 9.6 + 1.1, y: sh.y - Math.cos(headA) * 9.6 };
  const neckB = tor(TORSO + 1.5);

  const M = {
    skin: r.mat(look.skin), head: r.mat(look.head), top: r.mat(look.top), sleeve: r.mat(look.sleeve), fore: r.mat(look.fore), hand: r.mat(look.hand),
    legU: r.mat(look.legU), legL: r.mat(look.legL), foot: r.mat(look.foot), hair: r.mat(look.hair), trim: r.mat(look.trim), belt: r.mat(look.belt), dark: r.mat(look.dark),
    vest: look.vest ? r.mat(look.vest) : -1,
  };
  const Z = (z: number) => zBase + z;

  // ---- legs (far first; the z-buffer sorts it out)
  const leg = (l: [number, number], side: number, far: number) => {
    const hj = { x: hip.x + side * 1.7, y: hip.y };
    const kn = { x: hj.x + Math.sin(l[0]) * TH, y: hj.y + Math.cos(l[0]) * TH };
    const an = { x: kn.x + Math.sin(l[1]) * SH, y: kn.y + Math.cos(l[1]) * SH };
    const fa = -Math.max(-0.4, Math.min(1.35, l[1])) * 0.9;
    const toe = { x: an.x + Math.cos(fa) * 6, y: an.y + Math.sin(fa) * 6 + 0.6 };
    const zz = Z(side * 6.5);
    const A = at(hj.x, hj.y), B = at(kn.x, kn.y), C = at(an.x, an.y), D = at(toe.x, toe.y);
    const wide = def.id === "karate" ? 1.18 : 1;
    // shorts on the kickboxer: the lower half of the thigh is bare
    const thighPaint = def.id === "kickboxer" ? (u: number) => (u > 0.55 ? M.skin : u < 0.12 ? M.trim : -1) : undefined;
    r.capsule(A.x, A.y, zz, B.x, B.y, zz, rad(5.2 * th * wide), rad(4.3 * th * wide), M.legU, { ...o(far), paint: thighPaint });
    const shinPaint = def.id === "kickboxer" ? (u: number) => (u > 0.8 ? M.foot : -1) : def.id === "karate" ? (u: number) => (u > 0.9 ? M.skin : -1) : undefined;
    r.capsule(B.x, B.y, zz, C.x, C.y, zz, rad(4.3 * th * wide), rad(3.3 * th * (def.id === "karate" ? 1.25 : 1)), M.legL, { ...o(far), paint: shinPaint });
    r.capsule(C.x, C.y, zz + 0.5, D.x, D.y, zz + 0.5, rad(2.9 * th), rad(2.1 * th), M.foot, o(far, def.id === "brawler"));
    return D;
  };
  const footB = leg(p.legB, -1, 1);
  const footF = leg(p.legF, 1, 0);

  // ---- torso
  const P0 = at(hip.x, hip.y), P1 = at(mid.x, mid.y), P2 = at(sh.x, sh.y + 3);
  const tW = th * (def.id === "brawler" ? 1.08 : 1);
  const beltY = (u: number) => u < 0.24;
  const bellyPaint = (u: number, v: number) => {
    if (def.id === "karate") return u < 0.26 ? M.belt : -1;
    if (def.id === "ninja") return u < 0.22 ? M.trim : -1;
    if (def.id === "kickboxer") return u < 0.18 ? M.legU : u < 0.26 ? M.trim : -1;
    if (def.id === "brawler") return beltY(u) ? (Math.abs(v) < 0.18 ? r.mat(ramp("#e6c25a")) : M.belt) : Math.abs(v) > 0.55 && M.vest >= 0 ? M.vest : -1;
    return -1;
  };
  const chestPaint = (u: number, v: number) => {
    if (def.id === "karate") { const open = u > 0.45 && Math.abs(v) < (u - 0.45) * 1.5; return open ? M.skin : Math.abs(Math.abs(v) - (u - 0.45) * 1.5) < 0.12 && u > 0.45 ? M.dark : -1; }
    if (def.id === "ninja") return Math.abs(v - (u * 2 - 1) * 0.9) < 0.22 ? M.trim : -1;
    if (def.id === "brawler") return Math.abs(v) > 0.5 && M.vest >= 0 ? M.vest : u > 0.88 && Math.abs(v) > 0.3 && M.vest >= 0 ? M.vest : -1;
    return -1;
  };
  r.ellipsoid(P0.x, P0.y + rad(1), Z(0), rad(7 * tW), rad(5.6 * tW), def.id === "karate" ? M.top : M.legU, o());
  r.capsule(P0.x, P0.y - rad(1), Z(0), P1.x, P1.y, Z(0.5), rad(6.4 * tW), rad(7.1 * tW), M.top, { ...o(), paint: bellyPaint });
  r.capsule(P1.x, P1.y, Z(0.5), P2.x, P2.y, Z(0.5), rad(7.4 * tW), rad(8.6 * tW), M.top, { ...o(), paint: chestPaint });
  if (def.id === "kickboxer" || def.id === "brawler") { // muscle definition: pecs and abs pushed through the skin
    for (const sd of [-1, 1]) { const q = at(sh.x + Math.sin(lean) * -5 + sd * 0.4 + 2.4, sh.y + 5 + Math.cos(lean) * 0.5); r.ellipsoid(q.x + sd * rad(3.3), q.y, Z(4.2), rad(4.2 * tW), rad(3.4 * tW), M.top, o()); }
    if (def.id === "kickboxer") for (let k = 0; k < 3; k++) for (const sd of [-1, 1]) { const q = at(mid.x + 2.6 - k * 0.2, mid.y + 1.5 + k * 3.2 - 4); r.ellipsoid(q.x + sd * rad(1.9), q.y, Z(5.3), rad(1.9), rad(1.5), M.top, o()); }
  }
  // shoulders and neck
  const shN = tor(TORSO - 1.5, 1.6), shF = tor(TORSO - 1.5, -1.2);
  const NB = at(neckB.x, neckB.y), HC = at(headC.x, headC.y);
  r.capsule(NB.x, NB.y, Z(0), (NB.x + HC.x) / 2, (NB.y + HC.y) / 2, Z(0), rad(3.4 * th), rad(3.2 * th), def.id === "ninja" ? M.top : M.skin, o());

  // ---- arms (in the torso's frame)
  const arm = (a: [number, number], base: J, zz: number, far: number) => {
    const ax = (ang: number, d: number) => ({ x: Math.sin(ang + lean) * d, y: Math.cos(ang + lean) * d });
    const e1 = ax(a[0], UA), el = { x: base.x + e1.x, y: base.y + e1.y };
    const e2 = ax(a[1], FA), hd = { x: el.x + e2.x, y: el.y + e2.y };
    const A = at(base.x, base.y), B = at(el.x, el.y), C = at(hd.x, hd.y);
    const zA = Z(zz);
    r.sphere(A.x, A.y, zA, rad(4.6 * th), def.id === "karate" || def.id === "ninja" ? M.sleeve : M.skin, o(far));
    r.capsule(A.x, A.y, zA, B.x, B.y, zA, rad(3.7 * th), rad(3.1 * th), M.sleeve, o(far));
    const forePaint = def.id === "karate" ? (u: number) => (u < 0.18 ? M.sleeve : -1) : def.id === "brawler" ? (u: number) => (u > 0.82 ? M.trim : -1) : undefined;
    r.capsule(B.x, B.y, zA + 0.5, C.x, C.y, zA + 0.8, rad(3.2 * th), rad(2.7 * th), M.fore, { ...o(far), paint: forePaint });
    const gl = def.id === "kickboxer" ? 4.2 : 3.4;
    r.ellipsoid(C.x, C.y, zA + 1.2, rad(gl * Math.min(1.25, th)), rad((gl - 0.4) * Math.min(1.25, th)), M.hand, o(far, def.id === "kickboxer"));
    return C;
  };
  arm(p.armB, shF, -6.5, 1);
  const handF = arm(p.armF, shN, 7, 0);

  // ---- head
  const hx = HC.x, hy = HC.y;
  const hr = rad(6.2), hry = rad(7);
  const bandY0 = hy - hry * 0.8, bandY1 = hy - hry * 0.5;
  const headPaint = def.id === "ninja"
    ? (_u: number, _v: number, _x: number, y: number) => (y >= hy - hry * 0.4 && y <= hy + hry * 0.05 ? -1 : y < hy - hry * 0.4 && y > hy - hry * 0.62 ? M.trim : M.top)
    : def.id === "karate" ? (_u: number, _v: number, _x: number, y: number) => (y >= bandY0 && y <= bandY1 ? M.trim : -1)
      : def.id === "kickboxer" ? (_u: number, _v: number, _x: number, y: number) => (y >= bandY0 + 1 && y <= bandY1 - 0.5 ? M.trim : -1) : undefined;
  r.ellipsoid(hx, hy, Z(1), hr, hry, M.head, { ...o(), paint: headPaint });
  const fx = (d: number) => hx + s * rad(d);
  r.ellipsoid(fx(2.6), hy + rad(3.6), Z(2.5), rad(3.7), rad(3), M.head, { ...o(), paint: def.id === "ninja" ? () => M.top : undefined }); // jaw
  r.sphere(fx(5.9), hy + rad(0.6), Z(4), rad(1.45), def.id === "ninja" ? M.top : M.head, o()); // nose
  r.sphere(hx - s * rad(0.6), hy + rad(0.4), Z(5.2), rad(1.6), def.id === "ninja" ? M.top : M.skin, o()); // ear
  // hair
  const hairPaint = def.id === "karate" ? (_u: number, _v: number, _x: number, y: number) => (y >= bandY0 && y <= bandY1 ? M.trim : -1)
    : def.id === "kickboxer" ? (_u: number, _v: number, _x: number, y: number) => (y >= bandY0 + 1 && y <= bandY1 - 0.5 ? M.trim : -1) : undefined;
  if (def.id === "karate") {
    r.ellipsoid(hx - s * rad(1.2), hy - rad(2.6), Z(0.4), rad(6.5), rad(5.4), M.hair, { ...o(0, true), paint: hairPaint });
    for (const [ang, len] of [[-2.4, 7], [-1.9, 8], [-1.35, 6.6], [-2.85, 5.5]] as const) { const a2 = ang; r.capsule(hx - s * rad(1.5), hy - rad(4.2), Z(-0.5), hx - s * rad(1.5) + Math.cos(a2) * rad(len) * s * -1, hy - rad(4.2) + Math.sin(a2) * rad(len), Z(-0.5), rad(2.2), rad(0.6), M.hair, o(0, true)); }
  } else if (def.id === "kickboxer") {
    r.ellipsoid(hx - s * rad(0.9), hy - rad(2.9), Z(0.3), rad(6.4), rad(4.8), M.hair, { ...o(0, true), paint: hairPaint });
  } else if (def.id === "brawler") {
    r.ellipsoid(hx - s * rad(3.2), hy - rad(0.8), Z(-0.8), rad(3.6), rad(5.4), M.hair, o(0, true));
    for (let k = 0; k < 5; k++) { const a2 = -Math.PI * (0.18 + k * 0.16); r.sphere(hx - s * rad(0.5) + Math.cos(a2) * rad(6.6) * s, hy - rad(1) + Math.sin(a2) * rad(7.2), Z(0), rad(2.4 - Math.abs(k - 2) * 0.25), M.hair, o(0, true)); }
  } else { // ninja hood bulk at the back
    r.ellipsoid(hx - s * rad(1.6), hy - rad(0.5), Z(-1), rad(6.2), rad(6.8), M.top, o());
  }
  // headband / scarf tails streaming behind
  if (def.id === "karate" || def.id === "ninja") {
    const len = def.id === "ninja" ? 13 : 9;
    let px = hx - s * rad(5.4), py = def.id === "ninja" ? hy - rad(3.6) : (bandY0 + bandY1) / 2;
    for (let k = 1; k <= 4; k++) {
      const w = Math.sin(tick / 4 + k * 1.3) * rad(1.4) + (f.vx * -s) * 0.4;
      const nx = px - s * rad(len / 4), ny = py + rad(0.9) + w;
      r.capsule(px, py, Z(-2), nx, ny, Z(-2), rad(1.3 - k * 0.12), rad(1.1 - k * 0.12), M.trim, o(0.2));
      px = nx; py = ny;
    }
  }
  // face details, only where the head itself is visible
  const ex = fx(3.4), ey = hy - rad(0.9);
  if (p.face === "ko") { for (const d of [-1, 0, 1]) { r.decal(ex + d, ey + d, P_INK, M.head); r.decal(ex - d, ey + d, P_INK, M.head); } }
  else if (p.face === "squint" || p.face === "hurt") { for (let d = -1; d <= 1; d++) r.decal(ex + d * s, ey + (p.face === "hurt" ? (d === 0 ? -1 : 0) : 0), P_INK, M.head); }
  else { r.decal(ex, ey, P_EYE, M.head); r.decal(ex - s, ey, P_EYE, M.head); r.decal(ex + s, ey, P_INK, M.head); r.decal(ex, ey + 1, P_EYE, M.head); r.decal(ex + s, ey + 1, P_INK, M.head); }
  for (let d = -1; d <= 2; d++) r.decal(ex - s + d * s, ey - 2 - (d >= 1 ? 0 : 1) * 0 + (d === 2 ? 1 : 0), P_INK, M.head); // brow, angled down toward the nose
  if (def.id !== "ninja") {
    const mx = fx(3.6), my = hy + rad(3.4);
    if (p.face === "shout" || p.face === "hurt" || p.face === "ko") { r.decal(mx, my, P_MOUTH, M.head); r.decal(mx + s, my, P_MOUTH, M.head); r.decal(mx, my + 1, P_INK, M.head); r.decal(mx + s, my + 1, P_MOUTH, M.head); }
    else { r.decal(mx, my, P_INK, M.head); r.decal(mx + s, my, P_INK, M.head); }
  }
  if (def.id === "brawler") for (let d = 0; d < 4; d++) r.decal(fx(1.5 + d * 0.9), hy + rad(4.4) + (d & 1), r.tone(M.head, 1), M.head); // stubble
  void P_GOLD;
  return { hand: handF, foot: footF, feet: { x: (footF.x + footB.x) / 2, y: Math.max(footF.y, footB.y) }, headTop: hy - hry - 4 };
}

// ------------------------------------------------------------------ the rooftop dojo (baked once)

type Stage = { sky: HTMLCanvasElement; clouds: HTMLCanvasElement; far: HTMLCanvasElement; castle: HTMLCanvasElement; rail: HTMLCanvasElement; floor: HTMLCanvasElement; lantern: HTMLCanvasElement };
let stage: Stage | null = null;

const C = (h: string) => pack(...hexRgb(h));
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const noise1 = (x: number) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash(i) * (1 - u) + hash(i + 1) * u; };

/** Pick from a palette with ordered dithering at the band boundaries. */
const ditherPick = (pal: number[], t: number, x: number, y: number) => { const v = clamp(t) * (pal.length - 1) + bayer(x, y) * 0.9; return pal[clamp(Math.round(v), 0, pal.length - 1)]; };

function buildStage(): Stage {
  // --- sky: a dithered daytime gradient with a sun glow in the upper left (the key light)
  const sky = new PixelBuf(IW, 200);
  const SKY = ["#1f5cc8", "#2a6fd8", "#3d86e6", "#58a0ee", "#78b8f2", "#9acdf5", "#bfe0f7", "#dcefF8"].map(C);
  sky.rect(0, 0, IW, 200, (x, y) => {
    const sun = Math.hypot((x - 70) * 0.8, y - 34);
    const t = y / 185 + clamp(1 - sun / 120) * 0.35;
    return ditherPick(SKY, t, x, y);
  });
  sky.disc(70, 34, 9, C("#fffbe8")); sky.disc(70, 34, 7, C("#ffffff"));

  // --- clouds: metaball cumulus, lit from above-left, two copies wide so they can drift and wrap
  const CW = IW * 2;
  const cl = new PixelBuf(CW, 150);
  const blobs: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) {
    const cx = (i + 0.3 + hash(i * 3) * 0.4) * (CW / 9), cy = 34 + hash(i * 7) * 70, s = 0.7 + hash(i * 11) * 0.8;
    for (let k = 0; k < 7; k++) blobs.push([cx + (k - 3) * 11 * s + (hash(i * 13 + k) - 0.5) * 8, cy - Math.sin((k / 6) * Math.PI) * 9 * s + (hash(k + i) - 0.5) * 4, (7 + Math.sin((k / 6) * Math.PI) * 9) * s]);
  }
  const field = (x: number, y: number) => { let f = 0; for (const [bx, by, br] of blobs) { let dx = x - bx; if (dx > CW / 2) dx -= CW; if (dx < -CW / 2) dx += CW; const d2 = dx * dx + (y - by) * (y - by) * 1.6; if (d2 < br * br * 9) f += (br * br) / (d2 + 1); } return f; };
  const CL = ["#8ea9cf", "#aec4e2", "#d2e1f2", "#eef5fc", "#ffffff"].map(C);
  cl.rect(0, 0, CW, 150, (x, y) => {
    const f = field(x, y);
    if (f < 1) return 0;
    const lightness = clamp((field(x + 2, y + 3) - field(x - 2, y - 3)) * -0.25 + 0.55 + (f - 1) * 0.05);
    return ditherPick(CL, lightness, x, y);
  });

  // --- far layer: hazy mountains, a distant pagoda each side and the town's rooftops
  const far = new PixelBuf(IW, 200);
  const MTN = ["#8fa6cc", "#9db3d6", "#adc1de"].map(C);
  for (let x = 0; x < IW; x++) {
    const h = 138 - (noise1(x / 46) * 30 + noise1(x / 13 + 7) * 8) - Math.max(0, 20 - Math.abs(x - 360) * 0.25);
    for (let y = Math.floor(h); y < 200; y++) far.set(x, y, ditherPick(MTN, (y - h) / 50, x, y));
    const h2 = 160 - (noise1(x / 30 + 3) * 18 + noise1(x / 9) * 4);
    for (let y = Math.floor(h2); y < 200; y++) far.set(x, y, ditherPick(["#7d95bf", "#8aa1c8"].map(C), (y - h2) / 30, x, y));
  }
  const pagoda = (cx: number, base: number, scale: number, col: number, dark: number) => {
    for (let k = 0; k < 5; k++) {
      const y = base - k * 9 * scale, w = (16 - k * 2.2) * scale;
      far.poly([cx - w - 3 * scale, y, cx + w + 3 * scale, y, cx + w * 0.6, y - 3.5 * scale, cx - w * 0.6, y - 3.5 * scale], dark);
      far.rect(cx - w * 0.55, y - 9 * scale + 3.5 * scale, w * 1.1, 5.5 * scale, col);
    }
    far.rect(cx - 0.5, base - 52 * scale, 1.5, 9 * scale, dark);
  };
  pagoda(48, 168, 0.9, C("#7088b4"), C("#5f76a2"));
  pagoda(438, 172, 0.75, C("#7a92bc"), C("#6880ac"));
  for (let i = 0; i < 26; i++) { // town roofs
    const x = i * 19 + hash(i) * 10, w = 14 + hash(i * 3) * 10, y = 176 + hash(i * 5) * 8;
    far.poly([x - 3, y, x + w + 3, y, x + w - 2, y - 5, x + 2, y - 5], C("#6378a0"));
    far.rect(x, y, w, 30, C("#8c9cbd"));
    if (hash(i * 9) > 0.5) far.rect(x + 3, y + 3, 2, 3, C("#4f5f86"));
  }

  // --- the castle keep behind the arena
  const cs = new PixelBuf(IW, 230);
  const ROOF = ["#2c3a52", "#3a4a66", "#4a5d7c", "#5f7494", "#7f95b2"].map(C);
  const PLAST = ["#b8b2a6", "#d4cec0", "#ece6d8", "#f8f4ea"].map(C);
  const WOOD = C("#3a2a22"), WOODL = C("#5a4232"), WIN = C("#1a1622"), GOLD = C("#e8c048"), GOLDD = C("#a87a20");
  const STONE = ["#6a6670", "#7d7882", "#918c94", "#a8a2a8"].map(C);
  const KX = 240;
  // stone base (ishigaki): sloped, coursed blocks
  const sb = { top: 150, bot: 230, wTop: 92, wBot: 132 };
  cs.poly([KX - sb.wTop, sb.top, KX + sb.wTop, sb.top, KX + sb.wBot, sb.bot, KX - sb.wBot, sb.bot], (x, y) => {
    const row = Math.floor((y - sb.top) / 6), off = (row & 1) * 7, bx = Math.floor((x + off) / 14);
    const inX = (x + off) % 14, inY = (y - sb.top) % 6;
    if (inX === 0 || inY === 0) return C("#4e4a54");
    const lightSide = (x - KX) / sb.wBot; // the right flank turns away from the sun
    return ditherPick(STONE, 0.65 - lightSide * 0.35 + (hash(bx * 31 + row) - 0.5) * 0.5 - (inY === 5 ? 0.25 : 0), x, y);
  });
  // tiers of plaster walls and flared tiled roofs
  const tier = (yTop: number, yBot: number, wall: number, roofW: number, roofH: number, windows: number, gable: boolean) => {
    // wall
    cs.rect(KX - wall, yTop, wall * 2, yBot - yTop, (x, y) => ditherPick(PLAST, 0.85 - clamp((x - KX) / wall) * 0.55 - clamp((y - yTop) / 4) * 0 + (y - yTop < 3 ? -0.5 : 0), x, y));
    cs.rect(KX - wall, yBot - 4, wall * 2, 4, WOOD); cs.rect(KX - wall, yBot - 4, wall * 2, 1, WOODL);
    cs.rect(KX - wall, yTop + 3, wall * 2, 2, WOOD);
    for (let k = 0; k < windows; k++) {
      const wx = KX - wall + ((k + 0.5) * wall * 2) / windows - 4, wy = yTop + 8;
      cs.rect(wx - 1, wy - 1, 10, yBot - yTop - 15, WOODL);
      cs.rect(wx, wy, 8, yBot - yTop - 17, WIN);
      for (let b = 1; b < 4; b++) cs.rect(wx + b * 2, wy, 1, yBot - yTop - 17, WOOD);
    }
    // roof: an eave that sweeps up at the corners, tiled in rows of half-round tiles
    const y0 = yTop - roofH, y1 = yTop + 2;
    const pts: number[] = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16, x = KX - roofW + t * roofW * 2, curl = Math.pow(Math.abs(t - 0.5) * 2, 3) * 6; pts.push(x, y1 - curl); }
    pts.push(KX + roofW * 0.55, y0, KX - roofW * 0.55, y0);
    cs.poly(pts, (x, y) => {
      const col = Math.floor((x - KX + 400) / 3) % 2, shade = (x - KX) / roofW;
      const v = 0.62 - shade * 0.3 + (col ? 0.12 : -0.08) - (y - y0) / roofH * 0.25;
      return ditherPick(ROOF, v, x, y);
    });
    // eave line: a row of round tile ends, then a shadow
    for (let x = KX - roofW + 2; x < KX + roofW - 2; x += 3) { const t = (x - KX + roofW) / (roofW * 2), curl = Math.pow(Math.abs(t - 0.5) * 2, 3) * 6; cs.disc(x + 1, y1 - curl - 0.5, 1.4, ROOF[4]); cs.set(x + 1, y1 - curl + 1, ROOF[0]); }
    cs.rect(KX - wall, y1 + 1, wall * 2, 2, C("#6a6058"));
    // ridge
    cs.rect(KX - roofW * 0.55, y0 - 2, roofW * 1.1, 3, ROOF[1]); cs.rect(KX - roofW * 0.55, y0 - 2, roofW * 1.1, 1, ROOF[3]);
    if (gable) { // a curved karahafu gable on the front
      const gw = roofW * 0.32;
      cs.poly([KX - gw, y1 - 1, KX - gw * 0.6, y0 + roofH * 0.35, KX, y0 + roofH * 0.1, KX + gw * 0.6, y0 + roofH * 0.35, KX + gw, y1 - 1], (x, y) => ditherPick(ROOF, 0.75 - (x - KX) / gw * 0.2 - (y - y0) / roofH * 0.2, x, y));
      cs.poly([KX - gw * 0.55, y1 - 2, KX, y0 + roofH * 0.3, KX + gw * 0.55, y1 - 2], (x, y) => ditherPick(PLAST, 0.8 - (x - KX) / gw * 0.4, x, y));
      cs.rect(KX - 1, y0 + roofH * 0.45, 3, 4, GOLD);
    }
  };
  tier(118, 150, 76, 104, 16, 7, true);
  tier(88, 118, 58, 82, 15, 5, false);
  tier(60, 88, 42, 62, 14, 3, true);
  tier(36, 60, 28, 44, 13, 2, false);
  // golden shachihoko on the top ridge
  for (const sx of [-1, 1]) { const x = KX + sx * 22; cs.poly([x, 21, x + sx * 3, 14, x + sx * 6, 12, x + sx * 4, 18, x + sx * 2, 22], GOLD); cs.set(x + sx * 4, 15, GOLDD); cs.set(x + sx * 2, 20, GOLDD); }
  // flanking turrets (yagura) and pines
  for (const sx of [-1, 1]) {
    const tx = KX + sx * 172;
    cs.rect(tx - 26, 168, 52, 62, (x, y) => ditherPick(STONE, 0.6 - sx * 0.2 + (hash(Math.floor(x / 9) + Math.floor(y / 5) * 7) - 0.5) * 0.4, x, y));
    cs.rect(tx - 20, 146, 40, 22, (x, y) => ditherPick(PLAST, 0.8 - ((x - tx) / 20) * 0.3, x, y));
    cs.rect(tx - 12, 152, 6, 10, WIN); cs.rect(tx + 6, 152, 6, 10, WIN);
    const pts: number[] = []; for (let i = 0; i <= 10; i++) { const t = i / 10, x = tx - 32 + t * 64; pts.push(x, 148 - Math.pow(Math.abs(t - 0.5) * 2, 3) * 4); }
    pts.push(tx + 18, 134, tx - 18, 134);
    cs.poly(pts, (x, y) => ditherPick(ROOF, 0.6 - ((x - tx) / 32) * 0.3 + ((Math.floor(x / 3) & 1) ? 0.1 : -0.06), x, y));
    // pine: layered foliage pads
    const px = tx - sx * 46;
    cs.rect(px - 1, 178, 3, 52, C("#4a3020"));
    for (let k = 0; k < 4; k++) {
      const y = 182 - k * 11, w = 22 - k * 4;
      cs.poly([px - w, y + 4, px - w * 0.7, y - 3, px + w * 0.7, y - 4, px + w, y + 3, px + w * 0.6, y + 6, px - w * 0.6, y + 6], (x, yy) => ditherPick(["#1e4a2e", "#2a5e38", "#3a7444", "#4f8a52"].map(C), 0.75 - (yy - y + 4) / 10 - (x - px) / (w * 3), x, yy));
    }
  }

  // --- the rooftop railing, banners and the roof falling away behind it (nearer, warmer)
  const rl = new PixelBuf(IW, 270);
  const TILE = ["#2a2f40", "#384056", "#4c5672", "#66708e"].map(C);
  for (let y = 198; y < 226; y++) for (let x = 0; x < IW; x++) { // the lower roof sloping away: overlapping rows of tiles
    const row = Math.floor((y - 198) / 5), iy = (y - 198) % 5, off = (row & 1) * 2;
    const ix = (x + off) % 4;
    const v = 0.55 + (iy === 0 ? 0.35 : iy === 4 ? -0.4 : 0) + (ix === 0 ? -0.25 : ix === 1 ? 0.12 : 0) + (row / 6) * 0.15;
    rl.set(x, y, ditherPick(TILE, v, x, y));
  }
  const LAC = ["#4a1610", "#6e2418", "#8e3420", "#b04a2a"].map(C);
  rl.rect(0, 196, IW, 3, LAC[0]);
  // posts with bronze giboshi caps, two rails
  for (let x = 6; x < IW; x += 47) {
    rl.rect(x, 178, 7, 48, (xx, yy) => ditherPick(LAC, 0.95 - (xx - x) / 7 * 0.8, xx, yy));
    rl.disc(x + 3.5, 174, 4, C("#b88a3a")); rl.disc(x + 2.5, 173, 2, C("#e8c878")); rl.set(x + 3, 168, C("#b88a3a")); rl.set(x + 3, 169, C("#b88a3a")); rl.rect(x + 1, 177, 6, 2, C("#7a5a20"));
  }
  for (const [y, h] of [[184, 4], [206, 3]] as const) { rl.rect(0, y, IW, h, (xx, yy) => ditherPick(LAC, 0.9 - (yy - y) / h * 0.7, xx, yy)); rl.rect(0, y + h, IW, 1, LAC[0]); }
  // nobori banners on poles at each side, with a crest
  for (const bx of [22, 444]) {
    rl.rect(bx, 60, 2, 140, C("#3a2a1c"));
    rl.rect(bx + 2, 66, 20, 92, (xx, yy) => ditherPick(["#b02828", "#cc3a30", "#e05040"].map(C), 0.75 - Math.sin((yy - 66) / 14 + xx * 0.1) * 0.3 - (xx - bx) / 40, xx, yy));
    rl.rect(bx + 2, 64, 22, 3, C("#2a1c12"));
    rl.disc(bx + 12, 90, 7, C("#f4eee0")); rl.disc(bx + 12, 90, 4.5, C("#b02828")); rl.disc(bx + 12, 90, 2, C("#f4eee0"));
    for (let k = 0; k < 4; k++) rl.rect(bx + 6 + (k & 1) * 6, 108 + k * 10, 6, 3, C("#f4eee0"));
  }

  // --- the plank floor: boards across the stage in perspective, darker at the back
  const fl = new PixelBuf(IW, IH - 214);
  const WD = ["#4a2a16", "#5e3a1e", "#744a26", "#8a5c30", "#a07038", "#b88848"].map(C);
  const top = 214, VX = IW / 2;
  const rowY: number[] = [];
  for (let k = 0; k <= 9; k++) rowY.push(Math.round(Math.pow(k / 9, 1.45) * (IH - top - 8)));
  for (let y = 0; y < IH - top; y++) {
    let k = 0; while (k < 8 && y >= rowY[k + 1]) k++;
    const y0 = rowY[k], y1 = rowY[k + 1] ?? IH - top, depth = y / (IH - top);
    const scaleX = 0.55 + depth * 0.9;
    for (let x = 0; x < IW; x++) {
      const wx = (x - VX) / scaleX; // world x across the board, so grain and joints converge toward the back
      const seg = Math.floor((wx + 1000 + k * 37) / 70);
      const joint = Math.abs(((wx + 1000 + k * 37) % 70)) < 1.2 / scaleX;
      const grain = Math.sin(wx * 0.09 + noise1(wx / 23 + k * 5) * 6 + k) * 0.5 + 0.5;
      let v = 0.42 + depth * 0.32 + (grain - 0.5) * 0.28 + (hash(seg * 13 + k) - 0.5) * 0.25;
      if (y === y0) v -= 0.6; // seam shadow
      else if (y === y0 + 1) v += 0.18; // the board's lit edge
      if (joint) v -= 0.5;
      const sheen = Math.max(0, 1 - Math.abs(x - 150 - y * 0.6) / 70) * 0.18 * (1 - depth * 0.5); // window light raking across
      fl.set(x, y, ditherPick(WD, v + sheen, x, y));
      if (y === y1 - 2 && (wx + 1000 + k * 37) % 70 > 66 && (wx + 1000 + k * 37) % 70 < 67) fl.set(x, y, WD[0]); // nail heads
    }
  }
  fl.rect(0, 0, IW, 2, C("#2a160a")); fl.rect(0, 2, IW, 1, C("#c89858"));
  fl.rect(0, IH - top - 4, IW, 4, (x, y) => ditherPick(WD, 0.25 - (y - (IH - top - 4)) * 0.08, x, y));

  // --- a paper lantern sprite (red with ribs, lit from inside)
  const ln = new PixelBuf(11, 16);
  ln.rect(3, 0, 5, 2, C("#2a1a10"));
  for (let y = 2; y < 14; y++) {
    const t = (y - 7.5) / 6.5, hw = 5 * Math.sqrt(Math.max(0, 1 - t * t * 0.85));
    for (let x = Math.round(5.5 - hw); x < Math.round(5.5 + hw); x++) {
      const nx = (x + 0.5 - 5.5) / 5;
      const v = 0.75 - nx * 0.45 - Math.abs(t) * 0.35 + (y % 3 === 0 ? -0.35 : 0);
      ln.set(x, y, ditherPick(["#7a1414", "#a82018", "#d8401c", "#f07a2a", "#ffc060"].map(C), v, x, y));
    }
  }
  ln.rect(3, 14, 5, 2, C("#2a1a10")); ln.set(5, 6, C("#ffe8a0")); ln.set(5, 7, C("#ffe8a0"));

  return { sky: sky.toCanvas(), clouds: cl.toCanvas(), far: far.toCanvas(), castle: cs.toCanvas(), rail: rl.toCanvas(), floor: fl.toCanvas(), lantern: ln.toCanvas() };
}

function drawStage(c: CanvasRenderingContext2D, st: Stage, tick: number) {
  c.drawImage(st.sky, 0, 0);
  const cw = st.clouds.width, off = Math.floor(tick * 0.06) % cw;
  c.drawImage(st.clouds, -off, 6); c.drawImage(st.clouds, cw - off, 6);
  c.drawImage(st.far, 0, 26);
  c.drawImage(st.castle, 0, 0);
  // festival lanterns strung on a rope between the banner poles
  c.fillStyle = "#2a1a10";
  const x0 = 26, x1 = 452, sag = 26, ropeY = 70;
  let prevY = ropeY;
  for (let x = x0; x <= x1; x++) { const t = (x - x0) / (x1 - x0), y = Math.round(ropeY + sag * 4 * t * (1 - t)); c.fillRect(x, Math.min(prevY, y), 1, Math.abs(y - prevY) + 1); prevY = y; }
  for (let k = 1; k < 9; k++) {
    const t = k / 9, x = x0 + t * (x1 - x0), y = ropeY + sag * 4 * t * (1 - t);
    const sway = Math.round(Math.sin(tick / 34 + k * 1.9) * 1.6);
    c.fillRect(Math.round(x), Math.round(y), 1, 4);
    c.drawImage(st.lantern, Math.round(x - 5 + sway), Math.round(y + 3));
  }
  c.drawImage(st.rail, 0, 0);
  c.drawImage(st.floor, 0, 214);
  // drifting cherry petals: two-pixel flecks
  for (let i = 0; i < 18; i++) {
    const t = tick * 0.4 + i * 97;
    const x = Math.round(((i * 53 + t * 0.8) % (IW + 30)) - 15), y = Math.round(((i * 41 + t * 0.45) % 230));
    c.fillStyle = i % 3 ? "#ffc4d6" : "#ff8fb4"; c.fillRect(x, y, (Math.floor(t / 8 + i) & 1) + 1, 1);
  }
}

// ------------------------------------------------------------------ effects

type Dust = { x: number; y: number; vx: number; vy: number; r: number; life: number };
type Ember = { x: number; y: number; vy: number; life: number; col: string };
const fx = {
  dust: [] as Dust[], embers: [] as Ember[],
  trail: [[], []] as J[][],
  prev: [null, null] as ({ state: string; y: number; t: number; vx: number } | null)[],
};

function puff(x: number, y: number, n: number, spread = 1) {
  for (let i = 0; i < n; i++) fx.dust.push({ x: x + (Math.random() - 0.5) * 10 * spread, y, vx: (Math.random() - 0.5) * 1.6 * spread, vy: -Math.random() * 0.7, r: 1.5 + Math.random() * 2.5, life: 1 });
}

function trackEffects(m: FightMatch) {
  for (const i of [0, 1] as const) {
    const f = m.f[i], p = fx.prev[i];
    const x = f.x * K;
    if (p) {
      if (p.y > 0 && f.y <= 0 && f.state !== "ko") puff(x, GY, 6);
      if (f.state === "ko" && f.t === 15) puff(x - f.face * 18, GY, 12, 2);
      if (f.state === "hit" && Math.abs(f.vx) > 2.2 && f.y <= 0 && f.t % 3 === 0) puff(x, GY, 2);
      if (f.state === "special" && CHARACTERS[f.c].special.kind === "dash" && f.t === 4) puff(x, GY, 8, 1.4);
      if (f.state === "special" && f.c === 3 && f.t === 9) puff(x + f.face * 14, GY, 14, 2.2);
    }
    fx.prev[i] = { state: f.state, y: f.y, t: f.t, vx: f.vx };
    if (f.meter >= METER_MAX && f.state !== "ko" && Math.random() < 0.5) fx.embers.push({ x: x + (Math.random() - 0.5) * 26, y: GY - f.y * K - Math.random() * 10, vy: -0.6 - Math.random() * 0.8, life: 1, col: Math.random() < 0.5 ? "#ffe36a" : "#ff9a2a" });
  }
}

function drawDust(c: CanvasRenderingContext2D) {
  fx.dust = fx.dust.filter((d) => (d.life -= 0.035) > 0);
  for (const d of fx.dust) {
    d.x += d.vx; d.y += d.vy; d.vx *= 0.96; d.r += 0.16;
    const cols = ["#e8d8b8", "#c8b090", "#a08868"];
    pdisc(c, d.x + 1, d.y + 1, d.r, cols[2]);
    if (d.life > 0.35) pdisc(c, d.x, d.y, d.r * 0.9, cols[1]);
    if (d.life > 0.6) pdisc(c, d.x - 0.5, d.y - 0.5, d.r * 0.55, cols[0]);
  }
}

function drawEmbers(c: CanvasRenderingContext2D) {
  fx.embers = fx.embers.filter((e) => (e.life -= 0.03) > 0);
  for (const e of fx.embers) { e.y += e.vy; c.fillStyle = e.col; c.fillRect(Math.round(e.x + Math.sin(e.y / 4)), Math.round(e.y), 1, e.life > 0.5 ? 2 : 1); }
}

/** A motion smear behind a striking fist or foot. */
function drawTrail(c: CanvasRenderingContext2D, pts: J[], heavy: boolean) {
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k], w = Math.max(1, Math.round((k / pts.length) * (heavy ? 5 : 3)));
    pline(c, a.x, a.y, b.x, b.y, k === pts.length - 1 ? "#ffffff" : heavy ? "#ffd27a" : "#e0f0ff", w);
  }
}

function drawShot(c: CanvasRenderingContext2D, s: Shot, tick: number) {
  const x = Math.round(s.x * K), y = Math.round(GY - s.y * K), dir = Math.sign(s.vx) || 1;
  const big = !!s.big;
  if (s.kind === "ninja") {
    const r = big ? 12 : 8.5;
    for (let k = 1; k <= 4; k++) pdither(c, x - dir * (k * 6 + 4) - 3, y - 1, 6, 3, "#c9a0e8", 0.8 - k * 0.17);
    const a0 = (Math.floor(tick / 2) % 4) * (Math.PI / 8) * dir;
    for (let b = 0; b < 4; b++) {
      const a = a0 + (b * Math.PI) / 2, tip = [x + Math.cos(a) * r, y + Math.sin(a) * r];
      const l = [x + Math.cos(a + Math.PI / 4) * r * 0.32, y + Math.sin(a + Math.PI / 4) * r * 0.32], rr = [x + Math.cos(a - Math.PI / 4) * r * 0.32, y + Math.sin(a - Math.PI / 4) * r * 0.32];
      ppoly(c, [x, y, tip[0], tip[1], l[0], l[1]], "#eef0ff");
      ppoly(c, [x, y, tip[0], tip[1], rr[0], rr[1]], "#7c7ca8");
    }
    pdisc(c, x, y, 1.5, "#1c1830");
  } else if (s.kind === "brawler") {
    const h = big ? 30 : 20;
    for (let k = 0; k < 14; k++) {
      const cx = x - dir * k * 1.6, ch = Math.round(h * Math.sin(((14 - k) / 14) * Math.PI * 0.55) * (0.85 + Math.sin(tick + k) * 0.15));
      const cols = ["#7a3a10", "#c4531f", "#f2a93b", "#ffe08a", "#ffffff"];
      for (let q = 0; q < ch; q++) { c.fillStyle = cols[Math.min(4, Math.floor((q / ch) * 4.6))]; c.fillRect(Math.round(cx), GY - q, 2, 1); }
    }
    for (let k = 0; k < 5; k++) { const rx = x - dir * (6 + k * 5) + Math.sin(tick * 0.7 + k) * 2, ry = GY - 4 - ((tick * 1.5 + k * 9) % 18); c.fillStyle = k & 1 ? "#6a5a48" : "#8a7a64"; c.fillRect(Math.round(rx), Math.round(ry), 2, 2); }
  } else {
    const r = big ? 11 : 7;
    const flick = tick & 1;
    for (let k = 5; k >= 1; k--) { const tr = r * (1 - k * 0.15), tx = x - dir * k * (r * 0.62), ty = y + Math.round(Math.sin(tick * 0.9 + k) * 1.4); pdisc(c, tx, ty, tr, k > 3 ? "#a8200c" : k > 1 ? "#e8501c" : "#ff8a2a"); }
    pdisc(c, x, y, r + flick, "#e8401c");
    pdisc(c, x + dir, y, r * 0.8, "#ff8a2a");
    pdisc(c, x + dir * 1.5, y - 0.5, r * 0.58, "#ffd84a");
    pdisc(c, x + dir * 2, y - 1, r * 0.34, "#ffffff");
    for (let k = 0; k < 4; k++) { const a = tick * 0.5 + k * 1.6; c.fillStyle = "#fff3a6"; c.fillRect(Math.round(x + Math.cos(a) * (r + 3)), Math.round(y + Math.sin(a) * (r + 2)), 1, 1); }
  }
}

function drawSpark(c: CanvasRenderingContext2D, s: Spark) {
  const x = Math.round(s.x * K), y = Math.round(GY - s.y * K), t = s.t;
  if (s.kind === "block") {
    const n = 6, len = 3 + t * 1.2;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + 0.3, r0 = 2 + t * 1.4;
      if (t < 10) pline(c, x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * (r0 + len), y + Math.sin(a) * (r0 + len), t < 4 ? "#ffffff" : "#8fd0ff");
    }
    if (t < 3) { pdisc(c, x, y, 5 - t, "#c8ecff"); pdisc(c, x, y, 3 - t, "#ffffff"); }
    return;
  }
  const heavy = s.kind === "heavy", ko = s.kind === "ko";
  const n = ko ? 16 : heavy ? 12 : 8, maxLen = ko ? 30 : heavy ? 18 : 11;
  if (t < 2) { pdisc(c, x, y, (ko ? 14 : heavy ? 9 : 6) - t * 2, heavy || ko ? "#ffb03a" : "#fff3a6"); pdisc(c, x, y, (ko ? 9 : heavy ? 6 : 4) - t, "#ffffff"); }
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k & 1) * 0.2, long = k & 1 ? 0.6 : 1;
    const r0 = t < 3 ? 2 : (t - 2) * (maxLen / 9), r1 = Math.min(maxLen * long, r0 + (t < 4 ? maxLen * long * 0.6 : 4));
    if (t < 12) pline(c, x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a) * r1, y + Math.sin(a) * r1, t < 3 ? "#ffffff" : t < 7 ? (heavy || ko ? "#ff9a2a" : "#ffe36a") : "#d8401c");
  }
  if (t >= 2 && t < 9) { // ring of dithered pixels
    const R = 4 + t * (ko ? 2.6 : heavy ? 1.8 : 1.2);
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; if ((k + t) % 2 === 0) { c.fillStyle = heavy || ko ? "#ffd27a" : "#ffffff"; c.fillRect(Math.round(x + Math.cos(a) * R), Math.round(y + Math.sin(a) * R * 0.8), 1, 1); } }
  }
}

// ------------------------------------------------------------------ HUD

const PORTRAIT = 34;
const portraits = new Map<string, HTMLCanvasElement>();
function portraitOf(def: CharDef, side: 0 | 1, alt: boolean): HTMLCanvasElement {
  const key = `${def.id}${side}${alt ? "*" : ""}`;
  let cv = portraits.get(key);
  if (cv) return cv;
  const N = PORTRAIT;
  const r = new Raster(N, N);
  r.begin();
  const fake = { face: side === 0 ? 1 : -1, vx: 0, c: CHARACTERS.indexOf(def) } as unknown as Fighter;
  const pose: Pose = { lean: 0.05, legF: [0, 0], legB: [0, 0], armF: [0.25, 0.4], armB: [0.1, 0.3], head: 0, rot: 0, lift: 0, face: "calm" };
  const sc = 1.85;
  // feet far below the frame so only the head and shoulders land in it
  buildFighter(r, fake, def, lookOf(def, alt), pose, N / 2 - fake.face * 4, N + (TH * 2 + TORSO + 2.5) * sc - 2, 0, false, 0, sc);
  r.finish(2.5);
  const out = document.createElement("canvas"); out.width = N; out.height = N;
  const g = out.getContext("2d")!;
  // backdrop: a dithered team-colour panel with diagonal speed stripes
  const a = side === 0 ? ["#0c2a6a", "#1a4aa8", "#3a78e0"] : ["#5a0a16", "#a01c2a", "#e0404a"];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const v = 1 - y / N + ((x + y) % 9 < 2 ? 0.35 : 0) + bayer(x, y) * 0.5; g.fillStyle = a[clamp(Math.round(v * 2), 0, 2)]; g.fillRect(x, y, 1, 1); }
  const tmp = document.createElement("canvas"); tmp.width = N; tmp.height = N;
  tmp.getContext("2d")!.putImageData(r.img, 0, 0);
  g.drawImage(tmp, 0, 0);
  portraits.set(key, out);
  return (cv = out);
}

/** A bevelled gold frame (the 90s arcade look): dark rim, bright upper-left, dark lower-right. */
function goldFrame(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  c.fillStyle = "#140a1e"; c.fillRect(x - 3, y - 3, w + 6, h + 6);
  c.fillStyle = "#fff0a0"; c.fillRect(x - 2, y - 2, w + 4, 1); c.fillRect(x - 2, y - 2, 1, h + 4);
  c.fillStyle = "#e8b838"; c.fillRect(x - 1, y - 1, w + 2, 1); c.fillRect(x - 1, y - 1, 1, h + 2);
  c.fillStyle = "#a8701a"; c.fillRect(x - 2, y + h + 1, w + 4, 1); c.fillRect(x + w + 1, y - 2, 1, h + 4);
  c.fillStyle = "#d09028"; c.fillRect(x - 1, y + h, w + 2, 1); c.fillRect(x + w, y - 1, 1, h + 2);
  c.fillStyle = "#140a1e"; c.fillRect(x, y, w, h);
}

const BAR_ROWS = ["#fffbd0", "#fff070", "#ffd820", "#ffc010", "#f8a008", "#e88000", "#c86000", "#a04800"];
const LOW_ROWS = ["#ffd8d0", "#ff9a8a", "#ff5a4a", "#f0302a", "#d81c1c", "#b81010", "#901008", "#700808"];
const DMG_ROWS = ["#ff8a7a", "#f05040", "#e03a30", "#c82828", "#b01c20", "#98141a", "#801014", "#680c10"];
function healthBar(c: CanvasRenderingContext2D, x: number, y: number, w: number, hp: number, ghost: number, max: number, flip: boolean, tick: number) {
  const h = 8, pct = clamp(hp / max), gp = clamp(ghost / max);
  goldFrame(c, x, y, w, h);
  for (let r = 0; r < h; r++) for (let q = 0; q < w; q++) if ((q + r * 2) % 6 < 2) { c.fillStyle = "#3a0a14"; c.fillRect(x + q, y + r, 1, 1); }
  const fill = (p: number, rows: string[]) => { const pw = Math.round(w * p); if (pw <= 0) return; const px = flip ? x + w - pw : x; rows.forEach((col, r) => { c.fillStyle = col; c.fillRect(px, y + r, pw, 1); }); };
  fill(gp, DMG_ROWS);
  const low = pct < 0.3;
  fill(pct, low && Math.floor(tick / 6) % 2 ? LOW_ROWS.map((cc, i) => (i < 2 ? "#ffffff" : cc)) : low ? LOW_ROWS : BAR_ROWS);
  c.fillStyle = "rgba(20,10,30,0.35)"; for (let i = 1; i < 10; i++) c.fillRect(x + Math.round((w * i) / 10), y + 1, 1, h - 2);
}

function superMeter(c: CanvasRenderingContext2D, x: number, y: number, w: number, v: number, flip: boolean, tick: number) {
  const h = 5, p = clamp(v / METER_MAX), full = p >= 1;
  goldFrame(c, x, y, w, h);
  const rows = full ? (Math.floor(tick / 4) % 2 ? ["#ffffff", "#fff7b0", "#ffe14a", "#ffb020", "#e07010"] : ["#fff7b0", "#ffe14a", "#ffc21f", "#ff9a1f", "#c8500a"]) : ["#d0f4ff", "#7ad8ff", "#2f9bff", "#1a64d0", "#0e3a94"];
  const pw = Math.round(w * p), px = flip ? x + w - pw : x;
  rows.forEach((col, r) => { c.fillStyle = col; c.fillRect(px, y + r, pw, 1); });
  c.fillStyle = "#140a1e"; for (let i = 1; i < 4; i++) c.fillRect(x + Math.round((w * i) / 4), y, 1, h);
  const label = full ? "MAX" : "SUPER";
  ptext(c, label, flip ? x + w : x, y - 10, { rows: full ? [...TXT.hot] : [...TXT.cyan], outline: "#140a1e" }, flip ? 1 : 0);
  if (full) ptext(c, "L", flip ? x - 6 : x + w + 6, y - 2, { rows: [...TXT.white], outline: "#140a1e" }, flip ? 1 : 0);
}

function keycap(c: CanvasRenderingContext2D, x: number, y: number, key: string, tint: [string, string, string]) {
  c.fillStyle = "#140a1e"; c.fillRect(x - 1, y - 1, 13, 14);
  c.fillStyle = tint[2]; c.fillRect(x, y + 1, 11, 11);
  c.fillStyle = tint[1]; c.fillRect(x, y, 11, 10);
  c.fillStyle = tint[0]; c.fillRect(x + 1, y, 9, 1); c.fillRect(x, y + 1, 1, 8);
  ptext(c, key, x + 6, y + 2, { rows: ["#2a1a3a"], outline: null }, 0.5);
}

function drawHud(c: CanvasRenderingContext2D, m: FightMatch, hud: HudState, tick: number) {
  const d0 = CHARACTERS[hud.chars[0]], d1 = CHARACTERS[hud.chars[1]];
  const mirror = hud.chars[0] === hud.chars[1];
  // portraits in gold frames
  for (const side of [0, 1] as const) {
    const def = side === 0 ? d0 : d1, px = side === 0 ? 6 : IW - 6 - PORTRAIT;
    goldFrame(c, px, 6, PORTRAIT, PORTRAIT);
    c.drawImage(portraitOf(def, side, side === 1 && mirror), px, 6);
    const f = m.f[side];
    if (f.state === "hit" || f.state === "ko") pdither(c, px, 6, PORTRAIT, PORTRAIT, "#ff2020", 0.35); // the portrait winces
  }
  const bw = 170;
  healthBar(c, 48, 10, bw, m.f[0].hp, hud.ghost[0], d0.hp, false, tick);
  healthBar(c, IW - 48 - bw, 10, bw, m.f[1].hp, hud.ghost[1], d1.hp, true, tick);
  // names under the bars
  const nameSt = { rows: [...TXT.white], outline: "#140a1e" };
  ptext(c, hud.names[0].slice(0, 14).toUpperCase(), 48, 24, nameSt);
  ptext(c, hud.names[1].slice(0, 14).toUpperCase(), IW - 48, 24, nameSt, 1);
  ptext(c, d0.name.toUpperCase(), 48, 33, { rows: [...TXT.cyan], outline: "#140a1e" });
  ptext(c, d1.name.toUpperCase(), IW - 48, 33, { rows: [...TXT.pink], outline: "#140a1e" }, 1);
  // round-win medals at the inner ends of the bars
  for (let i = 0; i < FIGHT.ROUNDS_TO_WIN; i++) for (const side of [0, 1] as const) {
    const cx = side === 0 ? 48 + bw - 6 - i * 11 : IW - 48 - bw + 6 + i * 11, cy = 28;
    const won = m.wins[side] > i;
    pdisc(c, cx, cy, 4.5, "#140a1e");
    pdisc(c, cx, cy, 3.6, won ? "#c8820a" : "#3a2a4a");
    pdisc(c, cx - 0.6, cy - 0.6, 2.6, won ? "#ffd84a" : "#4a3a5e");
    if (won) { c.fillStyle = "#fff8c0"; c.fillRect(cx - 2, cy - 2, 1, 1); ptext(c, "V", cx + 0.5, cy - 3, { rows: ["#8a4a00"], outline: null }, 0.5); }
  }
  // centre: the KO emblem and the round clock
  const cx = IW / 2;
  const danger = m.f.some((f, i) => f.hp / CHARACTERS[hud.chars[i]].hp < 0.25) && m.phase === "fight";
  const flashOn = danger && Math.floor(tick / 8) % 2 === 0;
  c.fillStyle = "#140a1e"; ppoly(c, [cx - 21, 6, cx + 21, 6, cx + 24, 13, cx + 21, 21, cx - 21, 21, cx - 24, 13], "#140a1e");
  ppoly(c, [cx - 20, 7, cx + 20, 7, cx + 22, 13, cx + 20, 20, cx - 20, 20, cx - 22, 13], "#e8b838");
  ppoly(c, [cx - 18, 9, cx + 18, 9, cx + 19, 13, cx + 18, 18, cx - 18, 18, cx - 19, 13], flashOn ? "#ff3020" : "#a8101c");
  c.fillStyle = flashOn ? "#ff8a6a" : "#d8303a"; c.fillRect(cx - 17, 9, 34, 2);
  ptext(c, "KO", cx + 1, 9, { rows: [...TXT.gold], outline: "#3a0408", scale: 1, gap: 2 }, 0.5);
  const secs = Math.max(0, Math.ceil(m.frames / 60));
  goldFrame(c, cx - 15, 27, 30, 18);
  ptext(c, String(secs).padStart(2, "0"), cx + 1, 29, { rows: secs <= 10 && Math.floor(tick / 10) % 2 ? [...TXT.red] : [...TXT.gold], outline: "#140a1e", scale: 2, gap: 1 }, 0.5);
  // bottom: super meters and the key legend
  superMeter(c, 8, 260, 104, m.f[0].meter, false, tick);
  superMeter(c, IW - 8 - 104, 260, 104, m.f[1].meter, true, tick);
  const keys: [string, string, number][] = [["A", "", 0], ["D", "MOVE", 0], ["W", "JUMP", 0], ["S", "DUCK", 0], ["J", "LITE", 1], ["K", "HEVY", 1], ["L", "SPCL", 1], [";", "BLCK", 2]];
  const tints: [string, string, string][] = [["#ffffff", "#c8d8ff", "#7088c8"], ["#ffffff", "#fff0b8", "#c8a050"], ["#ffffff", "#ffc8c0", "#c86a60"]];
  const pitch = 27, kx0 = cx - (keys.length * pitch) / 2 + 3;
  keys.forEach(([k, lab, tt], i) => {
    const kx = Math.round(kx0 + i * pitch);
    keycap(c, kx, 243, k, tints[tt]);
    if (lab) ptext(c, lab, lab === "MOVE" ? kx - pitch / 2 + 6 : kx + 6, 259, { rows: [...TXT.white], outline: "#140a1e" }, 0.5);
  });
}

function banner(c: CanvasRenderingContext2D, t: string, hot: boolean, frame: number) {
  const zoom = frame < 4 ? 9 - frame : frame < 6 ? 5 + (frame & 1) : 5; // slam in, settle with a bounce
  const sc = Math.min(zoom, Math.floor((IW - 20) / Math.max(1, textWidth(t, 1, 1))));
  const y = 110 - (7 * sc) / 2;
  ptext(c, t, IW / 2, y, { rows: hot ? [...TXT.hot] : [...TXT.gold], outline: hot ? "#3a0408" : "#2a1404", shadow: "#140a1e", scale: sc, gap: 1 }, 0.5);
}

// ------------------------------------------------------------------ the frame

/** Draw the whole frame (call with the 960x540 canvas context). */
export function drawFight(c: CanvasRenderingContext2D, m: FightMatch, hud: HudState, tick: number, sparks: Spark[], shake: number, flash: number) {
  if (!raster) return;
  lo ??= mk(IW, IH);
  spriteLayer ??= mk(IW, IH);
  stage ??= buildStage();
  const g = lo.c;
  trackEffects(m);

  // world layers shake together by whole pixels
  const sx = shake ? Math.round((Math.random() - 0.5) * shake) : 0, sy = shake ? Math.round((Math.random() - 0.5) * shake * 0.6) : 0;
  g.save();
  g.translate(sx, sy);
  drawStage(g, stage, tick);

  // grounded drop shadows (the sun is upper left, so they fall a little to the right)
  for (const f of m.f) {
    const k = clamp(1 - f.y / 70), sc = lookOf(CHARACTERS[f.c], false).scale * BODY;
    const lying = f.state === "ko" && f.t > 10;
    pellipse(g, f.x * K + 3 - (lying ? f.face * 14 : 0), GY + 1, (lying ? 26 : 14) * sc * (0.55 + k * 0.45), 2.6, `rgba(30,12,8,${0.45 * k + 0.1})`);
  }
  drawEmbers(g);

  // the fighters: one raster, the active one in front
  raster.begin();
  const front = m.f[1].state === "light" || m.f[1].state === "heavy" || m.f[1].state === "special" ? 1 : 0;
  const order = front === 1 ? [0, 1] : [1, 0];
  for (const i of order) {
    const f = m.f[i], def = CHARACTERS[f.c];
    const look = lookOf(def, i === 1 && m.f[0].c === m.f[1].c);
    const p = poseOf(f, def, tick);
    const flashHit = f.state === "hit" && f.t < 4;
    const b = buildFighter(raster, f, def, look, p, Math.round(f.x * K), Math.round(GY - f.y * K), i === front ? 60 : 0, flashHit, tick);
    // motion smears for strikes in their active frames
    const mv = f.state === "light" ? def.light : f.state === "heavy" ? def.heavy : null;
    const striking = (mv && f.t >= mv.startup - 1 && f.t < mv.startup + mv.active + 2) || (f.state === "special" && def.special.kind === "dash" && f.t >= 4 && f.t < 22);
    const tr = fx.trail[i];
    if (striking) { tr.push(f.state === "light" ? b.hand : b.foot); if (tr.length > 5) tr.shift(); }
    else tr.length = 0;
  }
  raster.finish();
  for (const i of [0, 1] as const) if (fx.trail[i].length > 1) drawTrail(g, fx.trail[i], m.f[i].state !== "light");
  raster.put(spriteLayer.c);
  g.drawImage(spriteLayer.cv, 0, 0);

  for (const s of m.shots) drawShot(g, s, tick);
  drawDust(g);
  for (const s of sparks) drawSpark(g, s);
  g.restore();

  if (flash > 0) { g.fillStyle = `rgba(255,255,255,${clamp(flash)})`; g.fillRect(0, 0, IW, IH); }
  drawHud(g, m, hud, tick);
  if (m.phase === "intro") banner(g, m.pt < 60 ? `ROUND ${m.round}` : "FIGHT!", m.pt >= 60, m.pt % 60);
  else if (m.phase === "ko" || m.phase === "over") banner(g, m.roundWinner === -1 ? "DRAW" : m.f.some((f) => f.state === "ko") ? "K.O." : "TIME UP", true, m.pt);

  // nearest-neighbour upscale onto the 960x540 canvas
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.imageSmoothingEnabled = false;
  c.drawImage(lo.cv, 0, 0, IW * OUT, IH * OUT);
  c.restore();
}
