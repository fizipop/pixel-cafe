// Shared low-resolution pixel-art toolkit for the arcade cabinets (Pixel Fighter II and Beat Battle).
//
// The games draw into a small native-resolution canvas (no anti-aliasing anywhere) that is then scaled up
// with nearest-neighbour filtering, so every pixel is a hard, deliberate pixel. Three pieces live here:
//   * colour ramps: 6-tone palettes with hue-shifted shadows and highlights, the way sprite artists build them
//   * PixelBuf: a tiny software canvas with crisp polygon / disc / line fills (used to bake static backdrops)
//   * Raster: a z-buffered sprite rasteriser. Body parts are lit capsules and spheres; every pixel gets a
//     normal, is lit from the scene's key light and quantised to the ramp with ordered dithering, then the
//     sprite receives a 1px selective outline and inner contour lines where parts overlap. The result is a
//     properly shaded, volumetric 16-bit style sprite that can be posed freely every frame.
// Plus a 5x7 bitmap font with row-gradient fills and outlines for the HUDs.

// ------------------------------------------------------------------ colour

export type RGB = [number, number, number];
/** 0 outline, 1 deep shadow, 2 shadow, 3 base, 4 light, 5 specular. Packed little-endian RGBA (ImageData order). */
export type Ramp = Uint32Array;

export const clamp = (n: number, a = 0, b = 1) => Math.min(b, Math.max(a, n));
export const hexRgb = (h: string): RGB => { const n = parseInt(h.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
export const pack = (r: number, g: number, b: number, a = 255) => ((a << 24) | (clamp(Math.round(b), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(r), 0, 255)) >>> 0;
export const unpackCss = (p: number) => `rgb(${p & 255},${(p >> 8) & 255},${(p >> 16) & 255})`;

function rgbToHsl([r, g, b]: RGB): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  const h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360; s = clamp(s); l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
/** Move a hue a little toward a target hue (shortest way round). */
const hueToward = (h: number, target: number, amt: number) => { const d = ((target - h + 540) % 360) - 180; return h + Math.sign(d) * Math.min(Math.abs(d), amt); };

/** Build a 6-tone sprite ramp from one base colour: shadows cool toward violet, highlights warm toward gold. */
export function ramp(hex: string, opts: { spread?: number; outline?: string } = {}): Ramp {
  const [h, s, l] = rgbToHsl(hexRgb(hex));
  const k = opts.spread ?? 1;
  const tone = (dl: number, dh: number, ds: number, warm: boolean) => {
    const hh = s < 0.06 ? h : hueToward(h, warm ? 50 : 255, Math.abs(dh));
    const ss = s < 0.06 ? (warm ? 0.12 : 0.18) * Math.min(1, Math.abs(dl) * 4) : s * ds;
    const base = s < 0.06 ? (warm ? 50 : 250) : hh;
    return pack(...hslToRgb(base, ss, l + dl * k));
  };
  const out = new Uint32Array(6);
  out[0] = opts.outline ? pack(...hexRgb(opts.outline)) : tone(-Math.min(0.5, l * 0.82 + 0.08), 28, 1.1, false);
  out[1] = tone(-0.27, 20, 1.08, false);
  out[2] = tone(-0.14, 10, 1.04, false);
  out[3] = pack(...hexRgb(hex));
  out[4] = tone(0.12, 8, 0.96, true);
  out[5] = tone(Math.min(0.3, (1 - l) * 0.75), 10, 0.75, true);
  return out;
}

// 4x4 Bayer matrix, normalised to [-0.5, 0.5)
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);
export const bayer = (x: number, y: number) => BAYER[((y & 3) << 2) | (x & 3)];

// ------------------------------------------------------------------ PixelBuf: a crisp software canvas for baking backdrops

export class PixelBuf {
  readonly data: Uint32Array;
  readonly img: ImageData;
  constructor(readonly w: number, readonly h: number) {
    this.img = new ImageData(w, h);
    this.data = new Uint32Array(this.img.data.buffer);
  }
  set(x: number, y: number, c: number) { x |= 0; y |= 0; if (x >= 0 && y >= 0 && x < this.w && y < this.h) this.data[y * this.w + x] = c; }
  get(x: number, y: number) { return x >= 0 && y >= 0 && x < this.w && y < this.h ? this.data[(y | 0) * this.w + (x | 0)] : 0; }
  /** Fill a rectangle; `col` may be a colour or a per-pixel function. */
  rect(x0: number, y0: number, w: number, h: number, col: number | ((x: number, y: number) => number)) {
    const xa = Math.max(0, Math.round(x0)), ya = Math.max(0, Math.round(y0)), xb = Math.min(this.w, Math.round(x0 + w)), yb = Math.min(this.h, Math.round(y0 + h));
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) { const c = typeof col === "number" ? col : col(x, y); if (c) this.data[y * this.w + x] = c; }
  }
  /** Scanline polygon fill (even-odd) with pixel-centre sampling: hard edges, no anti-aliasing. */
  poly(pts: number[], col: number | ((x: number, y: number) => number)) {
    const n = pts.length / 2;
    let ymin = Infinity, ymax = -Infinity;
    for (let i = 0; i < n; i++) { ymin = Math.min(ymin, pts[i * 2 + 1]); ymax = Math.max(ymax, pts[i * 2 + 1]); }
    const xs: number[] = [];
    for (let y = Math.max(0, Math.floor(ymin)); y <= Math.min(this.h - 1, Math.ceil(ymax)); y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = Math.max(0, Math.round(xs[k])), xb = Math.min(this.w, Math.round(xs[k + 1]));
        for (let x = xa; x < xb; x++) { const c = typeof col === "number" ? col : col(x, y); if (c) this.data[y * this.w + x] = c; }
      }
    }
  }
  disc(cx: number, cy: number, r: number, col: number | ((x: number, y: number) => number)) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= r * r) { const c = typeof col === "number" ? col : col(x, y); if (c) this.set(x, y, c); }
    }
  }
  line(x0: number, y0: number, x1: number, y1: number, col: number) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) { this.set(x0, y0, col); if (x0 === x1 && y0 === y1) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; x0 += sx; } if (e2 <= dx) { err += dx; y0 += sy; } }
  }
  toCanvas(): HTMLCanvasElement {
    const cv = document.createElement("canvas");
    cv.width = this.w; cv.height = this.h;
    cv.getContext("2d")!.putImageData(this.img, 0, 0);
    return cv;
  }
}

// ------------------------------------------------------------------ immediate-mode crisp drawing on a low-res 2D context

/** A filled pixel disc drawn row by row (no anti-aliasing). */
export function pdisc(c: CanvasRenderingContext2D, cx: number, cy: number, r: number, col: string) {
  c.fillStyle = col;
  const ri = Math.max(0.5, r);
  for (let y = Math.floor(cy - ri); y <= Math.ceil(cy + ri); y++) {
    const dy = y + 0.5 - cy;
    if (Math.abs(dy) > ri) continue;
    const hw = Math.sqrt(ri * ri - dy * dy);
    const xa = Math.round(cx - hw), xb = Math.round(cx + hw);
    if (xb > xa) c.fillRect(xa, y, xb - xa, 1);
  }
}
/** A pixel ellipse outline-free fill. */
export function pellipse(c: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, col: string) {
  c.fillStyle = col;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const hw = rx * Math.sqrt(1 - dy * dy);
    const xa = Math.round(cx - hw), xb = Math.round(cx + hw);
    if (xb > xa) c.fillRect(xa, y, xb - xa, 1);
  }
}
/** A 1px Bresenham line. */
export function pline(c: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, col: string, w = 1) {
  c.fillStyle = col;
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, guard = 0;
  for (;;) {
    c.fillRect(x0 - ((w - 1) >> 1), y0 - ((w - 1) >> 1), w, w);
    if ((x0 === x1 && y0 === y1) || guard++ > 2000) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}
/** Crisp polygon fill on a 2D context by scanlines (fillRect per span). */
export function ppoly(c: CanvasRenderingContext2D, pts: number[], col: string) {
  c.fillStyle = col;
  const n = pts.length / 2;
  let ymin = Infinity, ymax = -Infinity;
  for (let i = 0; i < n; i++) { ymin = Math.min(ymin, pts[i * 2 + 1]); ymax = Math.max(ymax, pts[i * 2 + 1]); }
  const xs: number[] = [];
  for (let y = Math.floor(ymin); y <= Math.ceil(ymax); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2], ay = pts[i * 2 + 1], bx = pts[((i + 1) % n) * 2], by = pts[((i + 1) % n) * 2 + 1];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) { const xa = Math.round(xs[k]), xb = Math.round(xs[k + 1]); if (xb > xa) c.fillRect(xa, y, xb - xa, 1); }
  }
}
/** Ordered-dither fill of a rect at a given coverage (0..1): the classic 16-bit transparency trick. */
export function pdither(c: CanvasRenderingContext2D, x0: number, y0: number, w: number, h: number, col: string, cover: number) {
  c.fillStyle = col;
  for (let y = Math.round(y0); y < Math.round(y0 + h); y++) for (let x = Math.round(x0); x < Math.round(x0 + w); x++) if (bayer(x, y) + 0.5 < cover) c.fillRect(x, y, 1, 1);
}

// ------------------------------------------------------------------ Raster: lit, z-buffered sprite rasteriser

const NONE = 0xffff, EDGE = 0xfffe;
// key light: from the upper left, slightly in front (x right, y down, z toward the viewer)
const LX = -0.52, LY = -0.62, LZ = 0.59;

export type PartOpts = {
  /** Darken the part: used for limbs on the far side of the body. 0..1 */
  far?: number;
  /** Shiny material (leather, hair, metal): adds specular pixels. */
  spec?: boolean;
  /** Recolour individual pixels: return a material id (from `mat()`) or -1 to keep the part's own. `u` is 0..1 along the
   *  axis, `v` is -1..1 across it (left to right on screen), `x`,`y` are raster pixels. */
  paint?: (u: number, v: number, x: number, y: number) => number;
  /** Extra brightness bias (-1..1). */
  lift?: number;
};

export class Raster {
  readonly data: Uint32Array;
  readonly img: ImageData;
  private z: Float32Array;
  private m: Uint16Array;
  private far: Uint8Array;
  private mats: Ramp[] = [];
  private bx0 = 0; private by0 = 0; private bx1 = 0; private by1 = 0;
  private cx0 = 0; private cy0 = 0; private cx1 = 0; private cy1 = 0; // area to clear on the next frame

  constructor(readonly w: number, readonly h: number) {
    this.img = new ImageData(w, h);
    this.data = new Uint32Array(this.img.data.buffer);
    this.z = new Float32Array(w * h).fill(-1e9);
    this.m = new Uint16Array(w * h).fill(NONE);
    this.far = new Uint8Array(w * h);
    this.bx0 = w; this.by0 = h;
  }

  /** Start a new frame: wipe what the last frame touched and forget its materials. */
  begin() {
    for (let y = this.cy0; y < this.cy1; y++) {
      const o = y * this.w;
      this.data.fill(0, o + this.cx0, o + this.cx1);
      this.z.fill(-1e9, o + this.cx0, o + this.cx1);
      this.m.fill(NONE, o + this.cx0, o + this.cx1);
    }
    this.mats.length = 0;
    this.bx0 = this.w; this.by0 = this.h; this.bx1 = 0; this.by1 = 0;
  }

  /** Register a ramp for this frame and get its material id. */
  mat(r: Ramp) { const i = this.mats.indexOf(r); if (i >= 0) return i; this.mats.push(r); return this.mats.length - 1; }

  private grow(x0: number, y0: number, x1: number, y1: number) {
    this.bx0 = Math.min(this.bx0, x0); this.by0 = Math.min(this.by0, y0); this.bx1 = Math.max(this.bx1, x1); this.by1 = Math.max(this.by1, y1);
  }

  private shadePixel(i: number, x: number, y: number, nx: number, ny: number, nz: number, zc: number, matId: number, o: PartOpts) {
    if (zc <= this.z[i]) return;
    let lum = nx * LX + ny * LY + nz * LZ + (o.lift ?? 0) - (o.far ?? 0) * 0.42;
    // a touch of bounce light from the floor keeps the undersides from going flat black
    if (ny > 0.55) lum += (ny - 0.55) * 0.35;
    lum += bayer(x, y) * 0.2;
    const r = this.mats[matId];
    let tone = lum > 0.62 ? 4 : lum > 0.2 ? 3 : lum > -0.22 ? 2 : 1;
    if (o.spec && lum > 0.86) tone = 5;
    if (nz < 0.22 && tone > 2) tone--; // terminator darkening at the silhouette
    this.data[i] = r[tone];
    this.z[i] = zc; this.m[i] = matId; this.far[i] = o.far ? 1 : 0;
  }

  /** A tapered capsule from A to B (raster px; z toward the viewer). */
  capsule(ax: number, ay: number, az: number, bx: number, by: number, bz: number, ra: number, rb: number, matId: number, o: PartOpts = {}) {
    const rmax = Math.max(ra, rb);
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - rmax)), x1 = Math.min(this.w, Math.ceil(Math.max(ax, bx) + rmax) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - rmax)), y1 = Math.min(this.h, Math.ceil(Math.max(ay, by) + rmax) + 1);
    if (x1 <= x0 || y1 <= y0) return;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1e-6, len = Math.sqrt(len2);
    const px = -dy / len, py = dx / len; // across the axis
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const sx = x + 0.5, sy = y + 0.5;
        const t = clamp(((sx - ax) * dx + (sy - ay) * dy) / len2);
        const cx = ax + dx * t, cy = ay + dy * t, r = ra + (rb - ra) * t;
        const ex = sx - cx, ey = sy - cy, d2 = ex * ex + ey * ey;
        if (d2 > r * r) continue;
        const nz = Math.sqrt(1 - d2 / (r * r));
        const zc = az + (bz - az) * t + nz * r;
        const i = y * this.w + x;
        if (zc <= this.z[i]) continue;
        let id = matId;
        if (o.paint) { const v = (ex * px + ey * py) / r; const p = o.paint(t, py < 0 ? -v : v, x, y); if (p >= 0) id = p; }
        this.shadePixel(i, x, y, ex / r, ey / r, nz, zc, id, o);
      }
    }
    this.grow(x0, y0, x1, y1);
  }

  sphere(x: number, y: number, z: number, r: number, matId: number, o: PartOpts = {}) { this.capsule(x, y, z, x, y + 0.001, z, r, r, matId, o); }

  /** An ellipsoid (axis-aligned radii rx, ry), for heads, fists and feet. */
  ellipsoid(cx: number, cy: number, cz: number, rx: number, ry: number, matId: number, o: PartOpts = {}) {
    const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(this.w, Math.ceil(cx + rx) + 1);
    const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(this.h, Math.ceil(cy + ry) + 1);
    const rz = Math.min(rx, ry);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const ux = (x + 0.5 - cx) / rx, uy = (y + 0.5 - cy) / ry, d2 = ux * ux + uy * uy;
      if (d2 > 1) continue;
      const nz = Math.sqrt(1 - d2);
      const i = y * this.w + x;
      const zc = cz + nz * rz;
      if (zc <= this.z[i]) continue;
      let id = matId;
      if (o.paint) { const p = o.paint((uy + 1) / 2, ux, x, y); if (p >= 0) id = p; }
      // normal of an ellipsoid: gradient of (x/rx)^2 + ...
      let nx = ux / rx, ny = uy / ry, nzz = nz / rz; const nl = Math.hypot(nx, ny, nzz) || 1; nx /= nl; ny /= nl; nzz /= nl;
      this.shadePixel(i, x, y, nx, ny, nzz, zc, id, o);
    }
    this.grow(x0, y0, x1, y1);
  }

  /** Paint a flat pixel on top of a given material only (eyes, mouths, seams): keeps details off overlapping limbs. */
  decal(x: number, y: number, col: number, onlyMat = -1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.m[i] === NONE || (onlyMat >= 0 && this.m[i] !== onlyMat)) return;
    this.data[i] = col;
  }
  /** Tone of a material at an index (for decals that should follow the ramp). */
  tone(matId: number, t: number) { return this.mats[matId][t]; }

  /** Finish the sprite: inner contour lines where a nearer part overlaps a farther one, then a 1px selective outline. */
  finish(innerGap = 3.2) {
    const { w, h, data, z, m } = this;
    const x0 = Math.max(0, this.bx0 - 1), y0 = Math.max(0, this.by0 - 1), x1 = Math.min(w, this.bx1 + 1), y1 = Math.min(h, this.by1 + 1);
    // inner contours: the farther pixel at a depth step takes its material's deepest tone
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x, mi = m[i];
      if (mi >= EDGE) continue;
      const zi = z[i];
      const nb = (j: number) => m[j] < EDGE && z[j] - zi > innerGap && m[j] !== mi;
      if ((x + 1 < w && nb(i + 1)) || (x > 0 && nb(i - 1)) || (y + 1 < h && nb(i + w)) || (y > 0 && nb(i - w))) data[i] = this.mats[mi][this.far[i] ? 0 : 1];
    }
    // outer outline in each neighbour's own darkest tone (selective outlining, not flat black)
    const edges: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (m[i] !== NONE) continue;
      let src = -1;
      if (x > 0 && m[i - 1] < EDGE) src = i - 1;
      else if (x + 1 < w && m[i + 1] < EDGE) src = i + 1;
      else if (y > 0 && m[i - w] < EDGE) src = i - w;
      else if (y + 1 < h && m[i + w] < EDGE) src = i + w;
      if (src >= 0) edges.push(i, src);
    }
    for (let k = 0; k < edges.length; k += 2) { const i = edges[k], s = edges[k + 1]; data[i] = this.mats[m[s]][0]; m[i] = EDGE; z[i] = z[s]; }
    this.cx0 = x0; this.cy0 = y0; this.cx1 = x1; this.cy1 = y1;
  }

  /** Copy the finished sprite onto a (cleared) layer canvas. */
  put(c: CanvasRenderingContext2D) {
    c.clearRect(0, 0, this.w, this.h);
    if (this.cx1 > this.cx0 && this.cy1 > this.cy0) c.putImageData(this.img, 0, 0, this.cx0, this.cy0, this.cx1 - this.cx0, this.cy1 - this.cy0);
  }
}

// ------------------------------------------------------------------ 5x7 bitmap font

const GLYPHS: Record<string, string> = {
  "0": ".###. #...# #..## #.#.# ##..# #...# .###.", "1": "..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.", "2": ".###. #...# ....# ...#. ..#.. .#... #####",
  "3": "##### ...#. ..#.. ...#. ....# #...# .###.", "4": "...#. ..##. .#.#. #..#. ##### ...#. ...#.", "5": "##### #.... ####. ....# ....# #...# .###.",
  "6": "..##. .#... #.... ####. #...# #...# .###.", "7": "##### ....# ...#. ..#.. .#... .#... .#...", "8": ".###. #...# #...# .###. #...# #...# .###.",
  "9": ".###. #...# #...# .#### ....# ...#. .##..", A: ".###. #...# #...# ##### #...# #...# #...#", B: "####. #...# #...# ####. #...# #...# ####.",
  C: ".###. #...# #.... #.... #.... #...# .###.", D: "####. #...# #...# #...# #...# #...# ####.", E: "##### #.... #.... ####. #.... #.... #####",
  F: "##### #.... #.... ####. #.... #.... #....", G: ".###. #...# #.... #.### #...# #...# .####", H: "#...# #...# #...# ##### #...# #...# #...#",
  I: ".###. ..#.. ..#.. ..#.. ..#.. ..#.. .###.", J: "..### ...#. ...#. ...#. ...#. #..#. .##..", K: "#...# #..#. #.#.. ##... #.#.. #..#. #...#",
  L: "#.... #.... #.... #.... #.... #.... #####", M: "#...# ##.## #.#.# #.#.# #...# #...# #...#", N: "#...# #...# ##..# #.#.# #..## #...# #...#",
  O: ".###. #...# #...# #...# #...# #...# .###.", P: "####. #...# #...# ####. #.... #.... #....", Q: ".###. #...# #...# #...# #.#.# #..#. .##.#",
  R: "####. #...# #...# ####. #.#.. #..#. #...#", S: ".#### #.... #.... .###. ....# ....# ####.", T: "##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..",
  U: "#...# #...# #...# #...# #...# #...# .###.", V: "#...# #...# #...# #...# #...# .#.#. ..#..", W: "#...# #...# #...# #.#.# #.#.# #.#.# .#.#.",
  X: "#...# #...# .#.#. ..#.. .#.#. #...# #...#", Y: "#...# #...# .#.#. ..#.. ..#.. ..#.. ..#..", Z: "##### ....# ...#. ..#.. .#... #.... #####",
  "!": "..#.. ..#.. ..#.. ..#.. ..#.. ..... ..#..", ".": "..... ..... ..... ..... ..... ..... ..#..", ":": "..... ..#.. ..#.. ..... ..#.. ..#.. .....",
  "/": "....# ....# ...#. ..#.. .#... #.... #....", "-": "..... ..... ..... ##### ..... ..... .....", "+": "..... ..#.. ..#.. ##### ..#.. ..#.. .....",
  "%": "##..# ##..# ...#. ..#.. .#... #..## #..##", x: "..... ..... #...# .#.#. ..#.. .#.#. #...#", "'": "..#.. ..#.. .#... ..... ..... ..... .....",
  "?": ".###. #...# ....# ...#. ..#.. ..... ..#..", ",": "..... ..... ..... ..... ..... ..#.. .#...", ";": "..... ..#.. ..#.. ..... ..#.. ..#.. .#...",
  "(": "...#. ..#.. .#... .#... .#... ..#.. ...#.", ")": ".#... ..#.. ...#. ...#. ...#. ..#.. .#...", "#": ".#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.",
  "*": "..... #.#.# .###. ##### .###. #.#.# .....", "[": ".###. .#... .#... .#... .#... .#... .###.", "]": ".###. ...#. ...#. ...#. ...#. ...#. .###.",
  "<": "...#. ..#.. .#... #.... .#... ..#.. ...#.", ">": ".#... ..#.. ...#. ....# ...#. ..#.. .#...", "=": "..... ..... ##### ..... ##### ..... .....",
  " ": "..... ..... ..... ..... ..... ..... .....",
};

const glyphBits = new Map<string, Uint8Array>();
function bits(ch: string) {
  let b = glyphBits.get(ch);
  if (!b) {
    const s = (GLYPHS[ch] ?? GLYPHS[ch.toUpperCase()] ?? GLYPHS["?"]).replace(/ /g, "");
    b = new Uint8Array(35);
    for (let i = 0; i < 35; i++) b[i] = s[i] === "#" ? 1 : 0;
    glyphBits.set(ch, b);
  }
  return b;
}

export type TextStyle = {
  /** Row colours top to bottom (cycled/stretched across the 7 rows): an arcade gradient. */
  rows: string[];
  /** Outline colour (1px all round), or null. */
  outline?: string | null;
  /** Drop shadow colour (1px down-right beyond the outline), or null. */
  shadow?: string | null;
  scale?: number;
  /** Pixels between letters. */
  gap?: number;
};

const textCache = new Map<string, HTMLCanvasElement>();
export function textWidth(s: string, scale = 1, gap = 1) { return s.length ? (s.length * (5 + gap) - gap) * scale : 0; }

/** Render a string (cached) and draw it. Align: 0 left, 0.5 centre, 1 right. `y` is the top of the glyphs. */
export function ptext(c: CanvasRenderingContext2D, s: string, x: number, y: number, st: TextStyle, align = 0) {
  const sc = st.scale ?? 1, gap = st.gap ?? 1;
  const key = `${s}|${st.rows.join(",")}|${st.outline ?? ""}|${st.shadow ?? ""}|${sc}|${gap}`;
  let cv = textCache.get(key);
  if (!cv) {
    if (textCache.size > 400) textCache.clear();
    const pad = (st.outline ? 1 : 0) + (st.shadow ? 1 : 0);
    const W = textWidth(s, sc, gap) + pad * 2 * sc + 2, H = 7 * sc + pad * 2 * sc + 2;
    cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const g = cv.getContext("2d")!;
    const ox = (st.outline ? 1 : 0) * sc, oy = ox;
    const stamp = (dx: number, dy: number, col: string | null) => {
      for (let ci = 0; ci < s.length; ci++) {
        const b = bits(s[ci]);
        for (let r = 0; r < 7; r++) {
          g.fillStyle = col ?? st.rows[Math.min(st.rows.length - 1, Math.floor((r / 7) * st.rows.length))];
          for (let q = 0; q < 5; q++) if (b[r * 5 + q]) g.fillRect(ox + dx + (ci * (5 + gap) + q) * sc, oy + dy + r * sc, sc, sc);
        }
      }
    };
    if (st.shadow) for (const [dx, dy] of [[1, 1], [2, 2], [1, 2], [2, 1]]) stamp(dx * sc, dy * sc, st.shadow);
    if (st.outline) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) stamp(dx * sc, dy * sc, st.outline);
    stamp(0, 0, null);
    textCache.set(key, cv);
  }
  const pad = ((st.outline ? 1 : 0)) * sc;
  c.drawImage(cv, Math.round(x - align * textWidth(s, sc, gap) - pad), Math.round(y - pad));
}

/** The arcade gold / steel / hot text ramps shared by the HUDs. */
export const TXT = {
  gold: ["#ffffff", "#fff7b0", "#ffe14a", "#ffc21f", "#ff9a1f", "#f2760f", "#c8500a"],
  white: ["#ffffff", "#ffffff", "#eef2ff", "#dfe6ff", "#c8d2f0", "#b0bce0", "#98a6d0"],
  cyan: ["#ffffff", "#d8fbff", "#9cf0ff", "#58e1ff", "#2ab8f0", "#1690d0", "#0d68a8"],
  pink: ["#ffffff", "#ffe0f0", "#ffb0d6", "#ff7ab8", "#ff4f9a", "#e02a7a", "#a8145a"],
  hot: ["#ffffff", "#fff0a0", "#ffd040", "#ff9a20", "#ff6018", "#e02a10", "#a01008"],
  red: ["#ffd0c8", "#ff9a8a", "#ff5a4a", "#f0302a", "#d01818", "#a81010", "#780808"],
  green: ["#ffffff", "#d8ffe8", "#a0f8c0", "#5ae890", "#2ac868", "#18a050", "#0c7838"],
  violet: ["#ffffff", "#efe0ff", "#d4b8ff", "#b48cff", "#9466f0", "#7448d0", "#5230a8"],
} as const;
