// The patterns you can pick out through the rooftop telescope. Points are in a 0..1 square (x right, y down);
// `lines` join point indexes. Just data, so the sky window and the tests share it.

export type Constellation = {
  id: string;
  name: string;
  blurb: string;
  points: [number, number][];
  lines: [number, number][];
};

export const CONSTELLATIONS: Constellation[] = [
  {
    id: "orion", name: "Orion", blurb: "The Hunter. Three bright stars in a row make his belt.",
    points: [[0.08, 0.1], [0.24, 0.08], [0.12, 0.26], [0.16, 0.28], [0.2, 0.3], [0.07, 0.46], [0.25, 0.45]],
    lines: [[0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6], [0, 1]],
  },
  {
    id: "cassiopeia", name: "Cassiopeia", blurb: "The Queen, a lopsided W that is easy to spot on autumn nights.",
    points: [[0.4, 0.14], [0.46, 0.3], [0.54, 0.16], [0.62, 0.3], [0.7, 0.12]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    id: "dipper", name: "The Big Dipper", blurb: "Seven stars shaped like a ladle. Its two end stars point to the North Star.",
    points: [[0.5, 0.62], [0.58, 0.66], [0.66, 0.7], [0.72, 0.78], [0.84, 0.76], [0.86, 0.9], [0.74, 0.92]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    id: "lyra", name: "Lyra", blurb: "A little harp, with Vega, one of the brightest stars of summer, at its tip.",
    points: [[0.82, 0.1], [0.78, 0.22], [0.88, 0.24], [0.8, 0.36], [0.9, 0.38]],
    lines: [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4], [3, 4]],
  },
  {
    id: "cygnus", name: "Cygnus", blurb: "The Swan, flying down the Milky Way. Also called the Northern Cross.",
    points: [[0.4, 0.52], [0.4, 0.68], [0.4, 0.86], [0.3, 0.68], [0.5, 0.68]],
    lines: [[0, 1], [1, 2], [3, 1], [1, 4]],
  },
  {
    id: "biscuit", name: "Biscuit the Cat", blurb: "Not in any old atlas: the cafe's own constellation, napping with its ears up.",
    points: [[0.05, 0.7], [0.08, 0.6], [0.12, 0.68], [0.16, 0.68], [0.2, 0.6], [0.23, 0.7], [0.2, 0.82], [0.08, 0.82]],
    lines: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 0]],
  },
];

/** The constellation whose bounding box (with a little padding) contains the point, if any. */
export function constellationAt(nx: number, ny: number, pad = 0.04): Constellation | null {
  let best: { c: Constellation; d: number } | null = null;
  for (const c of CONSTELLATIONS) {
    const xs = c.points.map((p) => p[0]);
    const ys = c.points.map((p) => p[1]);
    const x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad, y0 = Math.min(...ys) - pad, y1 = Math.max(...ys) + pad;
    if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
    const d = Math.hypot(nx - (x0 + x1) / 2, ny - (y0 + y1) / 2);
    if (!best || d < best.d) best = { c, d };
  }
  return best ? best.c : null;
}
