// 8-Ball Pool: drawing only (the physics and rules live in src/shared/pool.ts).
//
// A premium arcade billiards table, rendered with real shading rather than flat fills:
//   * the table is baked once at full canvas resolution: mitred mahogany rails with procedural grain, a lacquer
//     sheen and rounded profile, nickel diamond sights, bevelled baize cushions, tournament-green cloth with a
//     fibre texture under an overhead lamp, cushion shadows, and leather-rimmed pockets with deep interiors
//   * every ball is shaded per pixel as a sphere: diffuse + sharp specular + broad lamp reflection + rim and
//     cloth bounce light, with proper solid / stripe designs and crisp numbers, and it really rolls (its
//     orientation is tracked from how far it moves, so numbers and stripes turn as it travels)
//   * the cue is a pre-rendered sprite: maple shaft with grain, steel joint, ebony points with pearl inlays,
//     Irish-linen wrap, rosewood butt and a chalked tip
// Plus the aim guide (first contact, ghost ball, object-ball line, cushion bounce) and the ball-in-hand /
// call-a-pocket highlights.
import { HEAD_SPOT, POCKETS, POOL, groupOf, type AimPreview } from "../shared/pool";

export const PAD = 30; // rail thickness around the cloth (table px)
export const PW = POOL.W + PAD * 2;
export const PH = POOL.H + PAD * 2;
export const PSCALE = 2; // the canvas is drawn at 2x so the balls and the cue stay sharp

const BALL_COLORS = ["#fbf6ea", "#f2c315", "#1e47b5", "#d8262b", "#6a2a9a", "#f2701c", "#1f8a4a", "#8a1f2a", "#14121a"];
export const ballColor = (id: number) => BALL_COLORS[id === 0 ? 0 : id === 8 ? 8 : ((id - 1) % 7) + 1];

export type SceneBall = { id: number; x: number; y: number; out: boolean };
export type PoolScene = {
  balls: SceneBall[];
  tick: number;
  aim: { angle: number; power: number; preview: AimPreview } | null; // set while it's your turn and the balls are still
  placing: { kitchen: boolean } | null; // ball in hand: the cue ball can be dragged
  call: number | null; // the pocket you called for the 8-ball
  needsCall: boolean; // the 8 is your only legal target, so a pocket must be called
  targets: number[]; // legal first contacts (drawn with a faint marker)
  myTurn: boolean;
  /** Pocket under the pointer while calling (for hover feedback). */
  hoverPocket: number | null;
};

const S = PSCALE;
const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
const hash2 = (x: number, y: number) => hash(x * 57.13 + y * 311.77);
const vnoise = (x: number, y: number) => {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
type RGB = [number, number, number];
const hexRgb = (h: string): RGB => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
/** Sample a multi-stop colour ramp at t in 0..1. */
const ramp = (stops: RGB[], t: number): RGB => { const x = clamp(t) * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(x)); return mix(stops[i], stops[i + 1], x - i); };

// light: an overhead lamp slightly up and to the left of the table centre
const LX = -0.36, LY = -0.46, LZ = 0.81;

// ------------------------------------------------------------------ the table (baked once)

let tableCv: HTMLCanvasElement | null = null;

const WOOD: RGB[] = ["#2a0e05", "#43170a", "#5e2410", "#7a3318", "#934322", "#ab5a30"].map(hexRgb);
const FELT: RGB[] = ["#0b3a1e", "#11502a", "#176636", "#1e7c42", "#279350", "#36aa60"].map(hexRgb);
const CUSH: RGB[] = ["#08301a", "#0e4424", "#155a30", "#1e723c", "#2c8c4c"].map(hexRgb);

function buildTable(): HTMLCanvasElement {
  const W = PW * S, H = PH * S;
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(W, H), d = img.data;
  const pad = PAD * S, cw = POOL.W * S, ch = POOL.H * S;
  const CUSH_W = 10 * S; // the cushion strip just outside the cloth
  const outerR = 22 * S;
  const pockets = POCKETS.map((p) => ({ x: (p.x + PAD) * S, y: (p.y + PAD) * S, r: p.r * 0.95 * S }));
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      // rounded outer corners of the frame
      const ox = x < outerR ? outerR - x : x > W - outerR ? x - (W - outerR) : 0, oy = y < outerR ? outerR - y : y > H - outerR ? y - (H - outerR) : 0;
      const cornerD = Math.hypot(ox, oy);
      if (cornerD > outerR) { d[i + 3] = 0; continue; }
      const cx = x - pad, cy = y - pad; // cloth coordinates (canvas px)
      const inCloth = cx >= 0 && cy >= 0 && cx < cw && cy < ch;
      let col: RGB;
      // distance into the frame from the cloth edge
      const dx = cx < 0 ? -cx : cx >= cw ? cx - cw + 1 : 0, dy = cy < 0 ? -cy : cy >= ch ? cy - ch + 1 : 0;
      const railD = Math.max(dx, dy); // 0 inside the cloth
      if (inCloth) {
        // tournament baize: lamp hotspot, fibre noise, a faint nap, and shadows from the cushions (light from upper left)
        const u = cx / cw - 0.47, v = cy / ch - 0.44;
        let t = 0.72 - Math.hypot(u * 1.15, v * 1.6) * 0.62;
        t += (hash2(x, y) - 0.5) * 0.07 + (vnoise(x * 0.35, y * 0.35) - 0.5) * 0.06 + (vnoise(x * 0.02, y * 0.05) - 0.5) * 0.05;
        const edge = Math.min(cx, cy, cw - cx, ch - cy);
        const shadowL = Math.max(0, 1 - cx / (14 * S)) * 0.35, shadowT = Math.max(0, 1 - cy / (14 * S)) * 0.4;
        const shadowRB = Math.max(0, 1 - (cw - cx) / (7 * S)) * 0.18 + Math.max(0, 1 - (ch - cy) / (7 * S)) * 0.15;
        t -= Math.max(shadowL, shadowT) + shadowRB + Math.max(0, 1 - edge / (3 * S)) * 0.1;
        col = ramp(FELT, t);
      } else if (railD <= CUSH_W) {
        // cushion: a bevelled rubber nose covered in cloth, lit on the face that looks toward the lamp
        const k = railD / CUSH_W; // 0 at the nose, 1 where it meets the wood
        const top = cy < 0 && dx === 0, left = cx < 0 && dy === 0, right = cx >= cw && dy === 0;
        const facing = top ? 0.25 : left ? 0.3 : right ? -0.1 : -0.05; // bottom/right cushions face the light
        let t = 0.55 + facing - k * 0.25 + (k > 0.82 ? 0.3 : 0) + (hash2(x, y) - 0.5) * 0.06;
        if (k < 0.12) t -= 0.25; // dark crease at the nose
        col = ramp(CUSH, t);
      } else {
        // mahogany rail: grain runs along each rail, mitred at the corners; a rounded profile with a lacquer sheen
        const across = railD - CUSH_W, wide = pad - CUSH_W; // 0 at the inner edge, wide at the outside
        const horiz = dy > dx; // top / bottom rails
        const along = horiz ? x : y, depth = horiz ? y : x;
        const grain = Math.sin(along * 0.012 + vnoise(along * 0.004, depth * 0.06) * 7 + depth * 0.09) * 0.5 + 0.5;
        const fibre = (vnoise(along * 0.5, depth * 0.08) - 0.5) * 0.18 + (hash2(x, y) - 0.5) * 0.05;
        const k = clamp(across / wide);
        const profile = Math.sin(k * Math.PI) * 0.22 + (k < 0.08 ? -0.25 : 0) + (k > 0.92 ? -0.3 : 0); // rounded top, darker edges
        const lightSide = (cy < 0 ? 0.08 : cy >= ch ? -0.05 : 0) + (cx < 0 ? 0.05 : cx >= cw ? -0.06 : 0);
        let t = 0.42 + (grain - 0.5) * 0.32 + fibre + profile + lightSide;
        const sheen = Math.max(0, 1 - Math.abs(k - 0.38) / 0.07) * 0.28; // lacquer highlight line along the rail
        t += sheen;
        const cornerFade = cornerD > outerR - 2 ? -0.4 : 0;
        col = ramp(WOOD, t + cornerFade);
        if (sheen > 0.15) col = mix(col, [255, 210, 170], (sheen - 0.15) * 0.6);
      }
      // pockets: leather drop with a dark, deep interior (lit on the far lip, in shadow on the near one)
      for (const p of pockets) {
        const pd = Math.hypot(x - p.x, y - p.y);
        if (pd > p.r + 8 * S) continue;
        if (pd <= p.r) {
          const nx = (x - p.x) / p.r, ny = (y - p.y) / p.r;
          // looking down a leather-lined drop: the far inner wall (away from the lamp) is lit, the near one in shadow,
          // falling off to black at the bottom
          const q = pd / p.r;
          const lit = clamp(0.5 + (nx * -LX + ny * -LY) * 0.75);
          const wall = clamp((q - 0.38) / 0.62);
          const depthT = Math.pow(wall, 1.6) * (0.25 + lit * 0.95);
          col = mix([2, 1, 2], [128, 78, 46], clamp(depthT));
          const seam = Math.abs(q - 0.66) < 0.025 ? 0.5 : 0; // a stitched seam around the leather pocket liner
          col = mix(col, [8, 4, 2], seam);
          if (pd > p.r - 1.2 * S) col = mix(col, [20, 12, 8], 0.6);
        } else if (pd <= p.r + 7 * S) {
          // leather rim: rolled edge with a highlight toward the lamp
          const k = (pd - p.r) / (7 * S);
          const nx = (x - p.x) / pd, ny = (y - p.y) / pd;
          const hl = clamp(-(nx * LX + ny * LY)) * Math.sin(k * Math.PI);
          col = mix([28, 14, 8], [120, 72, 40], Math.sin(k * Math.PI) * 0.55 + hl * 0.45);
          if (k > 0.88) col = mix(col, [10, 5, 3], 0.6);
        }
      }
      d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
    }
  }
  c.putImageData(img, 0, 0);
  // the outer frame edge: a dark bevel all round
  c.lineWidth = 2 * S; c.strokeStyle = "rgba(10,3,1,0.85)"; c.beginPath(); c.roundRect(S, S, W - 2 * S, H - 2 * S, outerR - S); c.stroke();
  c.lineWidth = S; c.strokeStyle = "rgba(255,200,150,0.18)"; c.beginPath(); c.roundRect(3 * S, 3 * S, W - 6 * S, H - 6 * S, outerR - 3 * S); c.stroke();
  // nickel diamond sights inlaid in the rails
  const dia = (x: number, y: number) => {
    const g = c.createLinearGradient(x - 4 * S, y - 4 * S, x + 4 * S, y + 4 * S);
    g.addColorStop(0, "#ffffff"); g.addColorStop(0.45, "#d8dde4"); g.addColorStop(0.55, "#8a919c"); g.addColorStop(1, "#4a505a");
    c.fillStyle = "rgba(0,0,0,0.45)"; c.beginPath(); c.moveTo(x + S, y - 4.6 * S + S); c.lineTo(x + 3.6 * S + S, y + S); c.lineTo(x + S, y + 4.6 * S + S); c.lineTo(x - 3.6 * S + S, y + S); c.closePath(); c.fill();
    c.fillStyle = g; c.beginPath(); c.moveTo(x, y - 4.6 * S); c.lineTo(x + 3.6 * S, y); c.lineTo(x, y + 4.6 * S); c.lineTo(x - 3.6 * S, y); c.closePath(); c.fill();
    c.fillStyle = "rgba(255,255,255,0.9)"; c.fillRect(x - S, y - 2.5 * S, S, S);
  };
  const railMid = (PAD - 10) / 2 + 10; // centre of the wooden part of the rail, from the cloth edge
  for (let i = 1; i < 8; i++) { if (i === 4) continue; const x = (PAD + (POOL.W * i) / 8) * S; dia(x, (PAD - railMid) * S); dia(x, (PAD + POOL.H + railMid) * S); }
  for (let i = 1; i < 4; i++) { const y = (PAD + (POOL.H * i) / 4) * S; dia((PAD - railMid) * S, y); dia((PAD + POOL.W + railMid) * S, y); }
  // table markings: head string, head spot, centre and foot spots, a little worn into the cloth
  c.save(); c.translate(PAD * S, PAD * S);
  c.strokeStyle = "rgba(220,255,230,0.13)"; c.lineWidth = S; c.beginPath(); c.moveTo(HEAD_SPOT.x * S, 8 * S); c.lineTo(HEAD_SPOT.x * S, (POOL.H - 8) * S); c.stroke();
  for (const x of [HEAD_SPOT.x, POOL.W * 0.72, POOL.W / 2]) { c.fillStyle = "rgba(235,255,240,0.35)"; c.beginPath(); c.arc(x * S, (POOL.H / 2) * S, 2.2 * S, 0, Math.PI * 2); c.fill(); }
  c.restore();
  return cv;
}

// ------------------------------------------------------------------ balls

type Orient = { m: Float64Array; x: number; y: number; cv: HTMLCanvasElement | null; dirty: boolean };
const orient = new Map<number, Orient>();
const BR = POOL.R * S; // ball radius in canvas px
const BCV = Math.ceil(BR * 2 + 4);
const numberTex = new Map<number, Uint8ClampedArray>();
const NT = 64;

function numberTexture(id: number): Uint8ClampedArray {
  let t = numberTex.get(id);
  if (t) return t;
  const cv = document.createElement("canvas"); cv.width = NT; cv.height = NT;
  const c = cv.getContext("2d")!;
  c.fillStyle = "#000"; c.font = `bold ${id > 9 ? 30 : 38}px Arial, Helvetica, sans-serif`; c.textAlign = "center"; c.textBaseline = "middle";
  c.fillText(String(id), NT / 2, NT / 2 + 2);
  if (id === 6 || id === 9) c.fillRect(NT / 2 - 8, NT / 2 + 17, 16, 3); // underline so a 6 and a 9 can be told apart
  t = c.getImageData(0, 0, NT, NT).data;
  numberTex.set(id, t);
  return t;
}

/** Rotate a ball's orientation by a roll of (dx, dy) table px: rolling without slipping. */
function roll(o: Orient, dx: number, dy: number) {
  const dist = Math.hypot(dx, dy);
  if (dist < 1e-4) return;
  const ang = dist / POOL.R, ax = -dy / dist, ay = dx / dist; // axis = up x motion
  const c = Math.cos(ang), s = Math.sin(ang), t = 1 - c;
  // rotation about (ax, ay, 0)
  const r = [t * ax * ax + c, t * ax * ay, s * ay, t * ax * ay, t * ay * ay + c, -s * ax, -s * ay, s * ax, c];
  const m = o.m, n = new Float64Array(9);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) n[i * 3 + j] = r[i * 3] * m[j] + r[i * 3 + 1] * m[3 + j] + r[i * 3 + 2] * m[6 + j];
  // re-orthonormalise now and then so the matrix never drifts
  o.m = n; o.dirty = true;
}

function renderBall(id: number, o: Orient): HTMLCanvasElement {
  const cv = o.cv ?? document.createElement("canvas");
  cv.width = BCV; cv.height = BCV;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(BCV, BCV), d = img.data;
  const base = hexRgb(ballColor(id)), white: RGB = [246, 241, 228];
  const stripe = groupOf(id) === "stripe";
  const tex = id > 0 ? numberTexture(id) : null;
  const m = o.m, cc = BCV / 2;
  const SS = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let py = 0; py < BCV; py++) for (let px = 0; px < BCV; px++) {
    let r = 0, g = 0, b = 0, cover = 0;
    // 2x2 supersampling only near the silhouette
    const ex = px + 0.5 - cc, ey = py + 0.5 - cc, dd = Math.hypot(ex, ey);
    if (dd > BR + 1) continue;
    const samples = dd > BR - 1.2 ? SS : [[0.5, 0.5]];
    for (const [sx, sy] of samples) {
      const nx = (px + sx - cc) / BR, ny = (py + sy - cc) / BR, q = nx * nx + ny * ny;
      if (q > 1) continue;
      const nz = Math.sqrt(1 - q);
      // into the ball's own frame
      const lx = m[0] * nx + m[3] * ny + m[6] * nz, ly = m[1] * nx + m[4] * ny + m[7] * nz, lz = m[2] * nx + m[5] * ny + m[8] * nz;
      let col: RGB;
      if (id === 0) col = lz > 0.975 ? [200, 40, 40] : white; // the cue ball's red spot
      else {
        col = stripe ? (Math.abs(lx) < 0.66 ? base : white) : base;
        const az = Math.abs(lz);
        if (az > 0.83) { // a white number circle on both poles (inside the stripe band), the number filling it
          col = white;
          if (tex) {
            const sgn = lz > 0 ? 1 : -1;
            // bilinear sample of the glyph so the number stays crisp at any angle
            const fu = (lx * sgn * 0.5 / 0.5 + 0.5) * NT - 0.5, fv = (ly * 0.5 / 0.5 + 0.5) * NT - 0.5;
            const u0 = Math.floor(fu), v0 = Math.floor(fv), tu = fu - u0, tv = fv - v0;
            const A = (u: number, v: number) => (u >= 0 && v >= 0 && u < NT && v < NT ? tex[(v * NT + u) * 4 + 3] / 255 : 0);
            const a = (A(u0, v0) * (1 - tu) + A(u0 + 1, v0) * tu) * (1 - tv) + (A(u0, v0 + 1) * (1 - tu) + A(u0 + 1, v0 + 1) * tu) * tv;
            col = mix(col, [16, 14, 20], clamp(a * 1.25));
          }
        }
      }
      // lighting: diffuse with a little wrap, sharp specular, broad lamp reflection, rim darkening, green bounce from the cloth
      const ndl = nx * LX + ny * LY + nz * LZ;
      const diff = clamp(ndl * 0.8 + 0.28);
      const rz = 2 * ndl * nz - LZ; // reflection of the light about the normal, z part (viewer looks down -z)
      const spec = Math.pow(clamp(rz), 90) * 1.1 + Math.pow(clamp(rz), 9) * 0.12;
      const rim = Math.pow(1 - nz, 3) * 0.35;
      const bounce = clamp(ny) * (1 - nz) * 0.35;
      let rr = col[0] * diff + 30 * bounce * 0.3, gg = col[1] * diff + 90 * bounce, bb = col[2] * diff + 40 * bounce * 0.4;
      rr = rr * (1 - rim) + 255 * spec; gg = gg * (1 - rim) + 255 * spec; bb = bb * (1 - rim) + 250 * spec;
      r += rr; g += gg; b += bb; cover++;
    }
    if (!cover) continue;
    const i = (py * BCV + px) * 4;
    d[i] = clamp(r / cover, 0, 255); d[i + 1] = clamp(g / cover, 0, 255); d[i + 2] = clamp(b / cover, 0, 255); d[i + 3] = (cover / samples.length) * 255;
  }
  c.putImageData(img, 0, 0);
  o.cv = cv; o.dirty = false;
  return cv;
}

function ballOrient(b: SceneBall): Orient {
  let o = orient.get(b.id);
  if (!o) {
    // a random-looking but stable starting orientation, numbers mostly facing up
    const a = (hash(b.id * 3.7) - 0.5) * 1.1, tilt = 0.12 + hash(b.id * 5.1) * 0.3;
    const ca = Math.cos(a), sa = Math.sin(a), ct = Math.cos(tilt), st = Math.sin(tilt);
    o = { m: new Float64Array([ca, -sa * ct, sa * st, sa, ca * ct, -ca * st, 0, st, ct]), x: b.x, y: b.y, cv: null, dirty: true };
    orient.set(b.id, o);
  }
  const dx = b.x - o.x, dy = b.y - o.y;
  if (Math.abs(dx) + Math.abs(dy) > 0.01) {
    if (Math.hypot(dx, dy) < POOL.R * 6) roll(o, dx, dy); // (a jump this big is a re-rack or a re-spot, not a roll)
    o.x = b.x; o.y = b.y;
  }
  return o;
}

function drawBallShadow(c: CanvasRenderingContext2D, x: number, y: number) {
  const R = POOL.R;
  // soft shadow cast away from the lamp, plus a tight contact shadow
  const sx = x - LX * R * 0.55, sy = y - LY * R * 0.55;
  const g = c.createRadialGradient(sx, sy, R * 0.2, sx, sy, R * 1.35); g.addColorStop(0, "rgba(0,12,4,0.5)"); g.addColorStop(0.6, "rgba(0,12,4,0.22)"); g.addColorStop(1, "rgba(0,12,4,0)");
  c.fillStyle = g; c.beginPath(); c.ellipse(sx, sy, R * 1.35, R * 1.2, Math.atan2(-LY, -LX), 0, Math.PI * 2); c.fill();
  const g2 = c.createRadialGradient(x, y + 1, 0, x, y + 1, R * 0.95); g2.addColorStop(0, "rgba(0,0,0,0.45)"); g2.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g2; c.beginPath(); c.arc(x, y + 1, R * 0.95, 0, Math.PI * 2); c.fill();
}

function drawBall(c: CanvasRenderingContext2D, b: SceneBall) {
  const o = ballOrient(b);
  const cv = o.dirty || !o.cv ? renderBall(b.id, o) : o.cv;
  c.drawImage(cv, b.x - BCV / (2 * S), b.y - BCV / (2 * S), BCV / S, BCV / S);
}

// ------------------------------------------------------------------ the cue

const CUE_LEN = 330;
let cueCv: HTMLCanvasElement | null = null;
const CUE_W = 22; // sprite height in canvas px (2x)

function buildCue(): HTMLCanvasElement {
  const L = CUE_LEN * S, Hh = CUE_W;
  const cv = document.createElement("canvas"); cv.width = L; cv.height = Hh;
  const c = cv.getContext("2d")!;
  const img = c.createImageData(L, Hh), d = img.data;
  const half = (t: number) => (1.75 + t * 2.75) * S; // tapered radius from tip (t=0) to butt (t=1)
  const MAPLE: RGB[] = ["#a9773c", "#cf9e5c", "#e8c486", "#f6dcaa"].map(hexRgb);
  const EBONY: RGB[] = ["#0c0806", "#1c1410", "#2e241c", "#4a3c30"].map(hexRgb);
  const ROSE: RGB[] = ["#2a0c06", "#4a1a0c", "#6a2a16", "#8a3e22"].map(hexRgb);
  const LINEN: RGB[] = ["#0c0c10", "#1a1a20", "#2a2a32", "#3e3e48"].map(hexRgb);
  for (let px = 0; px < L; px++) {
    const t = px / L, hw = half(t);
    for (let py = 0; py < Hh; py++) {
      const v = (py + 0.5 - Hh / 2) / hw;
      if (Math.abs(v) > 1) continue;
      const nz = Math.sqrt(1 - v * v);
      // cylinder shading: light from above the stick, highlight a little toward the top edge
      const lum = clamp(0.55 + (-v * 0.45 + nz * 0.6) * 0.55);
      const spec = Math.pow(clamp(1 - Math.abs(v + 0.35) * 2.2), 6) * 0.55;
      let col: RGB;
      const along = px / S; // table px from the tip
      if (t < 0.012) col = mix([30, 70, 160], [80, 130, 220], lum); // chalked leather tip
      else if (t < 0.04) col = mix([200, 196, 180], [255, 252, 240], lum); // ivory ferrule
      else if (t < 0.6) { // maple shaft with fine straight grain
        const g = (Math.sin(py * 1.7 + Math.sin(along * 0.05) * 2) * 0.5 + 0.5) * 0.12 + (vnoise(along * 0.3, py * 0.6) - 0.5) * 0.1;
        col = ramp(MAPLE, lum * 0.9 + g);
      } else if (t < 0.626) { // steel joint collar with black rings
        const ring = (t - 0.6) / 0.026;
        col = ring < 0.15 || ring > 0.85 ? ramp(EBONY, lum) : mix([90, 96, 108], [235, 240, 248], lum);
      } else if (t < 0.79) { // forearm: maple with four ebony points converging toward the tip, pearl dots in them
        const k = (t - 0.626) / (0.79 - 0.626); // 0 at the joint end, 1 at the wrap
        const pointHalf = k * 0.85; // a point widens toward the wrap
        const inPoint = Math.abs(Math.abs(v) - 0.5) < pointHalf * 0.5 || Math.abs(v) < pointHalf * 0.35;
        col = inPoint ? ramp(EBONY, lum) : ramp(MAPLE, lum * 0.85 + (vnoise(along * 0.25, py) - 0.5) * 0.1);
        if (inPoint && Math.abs(k - 0.62) < 0.035 && Math.abs(v) < 0.18) col = mix([200, 220, 230], [255, 255, 255], lum); // pearl diamond
      } else if (t < 0.8) col = mix([180, 140, 40], [255, 225, 120], lum); // brass ring
      else if (t < 0.93) { // Irish linen wrap: a fine cross-hatch
        const hatch = ((px + py) % 4 < 2 ? 0.08 : -0.06) + ((px - py + 400) % 6 < 2 ? 0.05 : 0);
        col = ramp(LINEN, lum * 0.8 + hatch);
      } else if (t < 0.99) { // rosewood butt sleeve with pearl rings
        const ringK = (t - 0.93) / 0.06;
        col = Math.abs(ringK - 0.2) < 0.04 || Math.abs(ringK - 0.75) < 0.04 ? mix([190, 200, 210], [255, 255, 255], lum) : ramp(ROSE, lum + (vnoise(along * 0.2, py * 0.5) - 0.5) * 0.15);
      } else col = mix([8, 8, 10], [50, 50, 56], lum); // rubber bumper
      const i = (py * L + px) * 4;
      d[i] = clamp(col[0] + 255 * spec, 0, 255); d[i + 1] = clamp(col[1] + 240 * spec, 0, 255); d[i + 2] = clamp(col[2] + 220 * spec, 0, 255);
      d[i + 3] = Math.abs(v) > 0.86 ? 255 * clamp((1 - Math.abs(v)) / 0.14) : 255;
    }
  }
  c.putImageData(img, 0, 0);
  return cv;
}

function drawCue(c: CanvasRenderingContext2D, cx: number, cy: number, angle: number, power: number) {
  cueCv ??= buildCue();
  const R = POOL.R, dx = Math.cos(angle), dy = Math.sin(angle);
  const gap = 5 + power * 92; // the cue slides back as you pull
  const tipX = cx - dx * (R + gap), tipY = cy - dy * (R + gap);
  // its shadow falls on the cloth away from the lamp, further from the stick toward the (raised) butt
  c.save();
  c.translate(tipX, tipY); c.rotate(angle + Math.PI);
  c.fillStyle = "rgba(0,10,4,0.28)";
  c.beginPath(); c.moveTo(4, 5); c.lineTo(CUE_LEN, 13); c.lineTo(CUE_LEN, 22); c.lineTo(4, 8); c.closePath(); c.fill();
  c.restore();
  c.save();
  c.translate(tipX, tipY); c.rotate(angle + Math.PI);
  c.drawImage(cueCv, 0, -CUE_W / (2 * S), CUE_LEN, CUE_W / S);
  c.restore();
}

// ------------------------------------------------------------------ overlays

function drawPocketHighlights(c: CanvasRenderingContext2D, scene: PoolScene) {
  POCKETS.forEach((p, i) => {
    const r = p.r * 0.95;
    const called = scene.call === i, hover = scene.needsCall && scene.hoverPocket === i && scene.myTurn;
    if (!(called || (scene.needsCall && scene.myTurn))) return;
    // calling the 8: open pockets pulse, the chosen one glows gold
    const pulse = 0.5 + 0.5 * Math.sin(scene.tick / 7 + i);
    c.strokeStyle = called ? "#ffe36a" : `rgba(255,227,106,${hover ? 0.95 : 0.25 + 0.35 * pulse})`; c.lineWidth = called ? 4 : 2.5;
    c.beginPath(); c.arc(p.x, p.y, r + 9 + (called ? pulse * 3 : 0), 0, Math.PI * 2); c.stroke();
    if (called) { c.fillStyle = "#ffe36a"; c.font = "bold 12px Impact, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText("8", p.x, p.y + 1); }
  });
}

function drawAim(c: CanvasRenderingContext2D, scene: PoolScene) {
  const a = scene.aim!;
  const pv = a.preview, R = POOL.R;
  if (pv.path.length < 2) return;
  c.save();
  c.lineCap = "round"; c.lineJoin = "round";
  // the cue ball's path (solid to the first contact, dashed after a cushion bounce), with a faint dark under-stroke so it reads on the cloth
  for (let i = 1; i < pv.path.length; i++) {
    const p0 = pv.path[i - 1], p1 = pv.path[i];
    const dx = p1.x - p0.x, dy = p1.y - p0.y, l = Math.hypot(dx, dy) || 1;
    const sx = p0.x + (dx / l) * (i === 1 ? R : 0), sy = p0.y + (dy / l) * (i === 1 ? R : 0);
    c.setLineDash(i === 1 ? [] : [5, 5]);
    c.strokeStyle = "rgba(0,20,8,0.35)"; c.lineWidth = i === 1 ? 3 : 2.4; c.beginPath(); c.moveTo(sx, sy + 0.6); c.lineTo(p1.x, p1.y + 0.6); c.stroke();
    c.strokeStyle = i === 1 ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.55)"; c.lineWidth = i === 1 ? 1.5 : 1.3;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(p1.x, p1.y); c.stroke();
  }
  c.setLineDash([]);
  if (pv.hit) {
    const g = pv.hit.ghost;
    c.fillStyle = "rgba(255,255,255,0.12)"; c.beginPath(); c.arc(g.x, g.y, R, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(255,255,255,0.9)"; c.lineWidth = 1.4; c.beginPath(); c.arc(g.x, g.y, R, 0, Math.PI * 2); c.stroke(); // ghost cue ball at contact
    const o = pv.hit.objDir;
    c.strokeStyle = "rgba(60,40,0,0.4)"; c.lineWidth = 4; c.beginPath(); c.moveTo(g.x + o.x * (R * 2), g.y + o.y * (R * 2) + 0.6); c.lineTo(g.x + o.x * (R * 2 + 62), g.y + o.y * (R * 2 + 62) + 0.6); c.stroke();
    c.strokeStyle = "#ffe36a"; c.lineWidth = 2.2; c.beginPath(); c.moveTo(g.x + o.x * (R * 2), g.y + o.y * (R * 2)); c.lineTo(g.x + o.x * (R * 2 + 62), g.y + o.y * (R * 2 + 62)); c.stroke(); // where the object ball will go
    if (pv.hit.cueDir) { const dd = pv.hit.cueDir; c.strokeStyle = "rgba(255,255,255,0.65)"; c.lineWidth = 1.4; c.setLineDash([3, 4]); c.beginPath(); c.moveTo(g.x + dd.x * R, g.y + dd.y * R); c.lineTo(g.x + dd.x * (R + 40), g.y + dd.y * (R + 40)); c.stroke(); c.setLineDash([]); }
  } else {
    const end = pv.path[pv.path.length - 1];
    c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 1.3; c.beginPath(); c.arc(end.x, end.y, 3.4, 0, Math.PI * 2); c.stroke();
  }
  c.restore();
}

export function drawPool(c: CanvasRenderingContext2D, scene: PoolScene) {
  tableCv ??= buildTable();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, PW * S, PH * S);
  c.drawImage(tableCv, 0, 0);
  c.setTransform(PSCALE, 0, 0, PSCALE, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high";
  c.save();
  c.translate(PAD, PAD);
  if (scene.placing?.kitchen) { c.fillStyle = "rgba(0,0,20,0.28)"; c.fillRect(HEAD_SPOT.x, 0, POOL.W - HEAD_SPOT.x, POOL.H); c.strokeStyle = "rgba(255,227,106,0.8)"; c.lineWidth = 1.5; c.setLineDash([6, 5]); c.beginPath(); c.moveTo(HEAD_SPOT.x, 0); c.lineTo(HEAD_SPOT.x, POOL.H); c.stroke(); c.setLineDash([]); }
  drawPocketHighlights(c, scene);
  // legal targets get a faint pulsing halo while you're lining up
  if (scene.myTurn && scene.aim && !scene.needsCall) {
    for (const b of scene.balls) if (!b.out && scene.targets.includes(b.id)) { c.strokeStyle = `rgba(255,255,255,${0.14 + 0.08 * Math.sin(scene.tick / 12 + b.id)})`; c.lineWidth = 1.5; c.beginPath(); c.arc(b.x, b.y, POOL.R + 3.5, 0, Math.PI * 2); c.stroke(); }
  }
  const cue = scene.balls.find((b) => b.id === 0 && !b.out);
  if (scene.aim && cue) drawAim(c, scene);
  const live = scene.balls.filter((b) => !b.out);
  for (const b of live) drawBallShadow(c, b.x, b.y);
  for (const b of live) if (b.id !== 0) drawBall(c, b);
  if (cue) {
    if (scene.placing && scene.myTurn) { const p = 0.5 + 0.5 * Math.sin(scene.tick / 8); c.strokeStyle = `rgba(255,227,106,${0.5 + 0.4 * p})`; c.lineWidth = 2.4; c.beginPath(); c.arc(cue.x, cue.y, POOL.R + 5 + p * 3, 0, Math.PI * 2); c.stroke(); }
    drawBall(c, cue);
  }
  // pocketed balls forget their spin so a re-spotted ball starts fresh
  for (const b of scene.balls) if (b.out) orient.delete(b.id);
  if (scene.aim && cue) drawCue(c, cue.x, cue.y, scene.aim.angle, scene.aim.power);
  c.restore();
}
