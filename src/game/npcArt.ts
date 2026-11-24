// Pixel art for the NPCs, defined as plain data (no Phaser) so it is easy to tweak and test.
// Every NPC shares one 14x24 body and gets its own palette plus a few overlay pixels
// (hat, glasses, apron, headphones...). Output is a 32x32 grid like the player's characters.

export const NPC_W = 14;
export const NPC_H = 24;
const SIZE = 32;

const BASE = [
  "....hhhhhh....", // 0  hair
  "...hhhhhhhh...",
  "...hhhhhhhh...",
  "...hssssssh...",
  "...ssessess...", // 4  eyes
  "...ssssssss...",
  "....ssssss....",
  "...tttttttt...", // 7  shoulders
  "..tttttttttt..",
  ".atttttttttta.",
  ".atttttttttta.",
  ".ssttttttttss.", // 11 hands
  "..ssTTTTTTss..",
  "...tttttttt...",
  "...pppppppp...", // 14 hips
  "...pppppppp...",
  "...pppppppp...",
  "...ppp..ppp...",
  "...ppp..ppp...",
  "...ppp..ppp...",
  "...ppp..ppp...",
  "...ppp..ppp...",
  "..bbbb..bbbb..",
  "..bbbb..bbbb..",
];

type Overlay = [row: number, col: number, pattern: string];
export type NpcLook = { pal: Record<string, string>; overlays: Overlay[] };

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

export const LOOKS: Record<string, NpcLook> = {
  // Barista: green shirt, cream apron, rust beret
  mina: {
    pal: { h: "#4a2f1d", s: "#f1c27d", e: "#1f140d", t: "#3b8a4a", T: "#2e6b3a", a: "#3b8a4a", p: "#4a3a5a", b: "#1f140d", C: "#8a3f22", A: "#f4e4c1" },
    overlays: [
      [0, 4, "CCCCCC"], [1, 3, "CCCCCCCC"], [2, 3, "CCCCCCCC"],
      ...range(8, 15).map((r): Overlay => [r, 4, "AAAAAA"]),
    ],
  },
  // Reader: orange sweater, mustard beanie, round glasses, mint scarf
  theo: {
    pal: { h: "#2a1a11", s: "#c68e5b", e: "#1f140d", t: "#d9622b", T: "#b84f1e", a: "#d9622b", p: "#2a4d8f", b: "#4a3222", C: "#f2a93b", G: "#1f140d", S: "#7fc8a9" },
    overlays: [
      [0, 4, "CCCCCC"], [1, 3, "CCCCCCCC"], [2, 3, "CCCCCCCC"],
      [4, 3, "sGeGGeGs"],
      [7, 3, "SSSSSSSS"],
    ],
  },
  // Remote worker: grey hoodie, orange headphones
  kai: {
    pal: { h: "#1f140d", s: "#ffe0bd", e: "#1f140d", t: "#6a6a78", T: "#55555f", a: "#6a6a78", p: "#1f1f26", b: "#f4e4c1", H: "#d9622b" },
    overlays: [
      [0, 4, "HHHHHH"], [1, 3, "H"], [1, 10, "H"],
      [3, 2, "H"], [4, 2, "H"], [5, 2, "H"], [3, 11, "H"], [4, 11, "H"], [5, 11, "H"],
    ],
  },
  // Sofa regular: long purple hair, big pink sweater
  juno: {
    pal: { h: "#9b5de5", s: "#8a6446", e: "#1f140d", t: "#f28fad", T: "#d9708f", a: "#f28fad", p: "#5a5a66", b: "#f4e4c1" },
    overlays: [
      ...range(3, 11).flatMap((r): Overlay[] => [[r, 2, "h"], [r, 11, "h"]]),
      [8, 1, "a"], [9, 0, "a"], [8, 12, "a"], [9, 13, "a"],
    ],
  },
  // Wanderer: tan trench coat, grey hair, brown fedora
  ollie: {
    pal: { h: "#c4c4cc", s: "#f1c27d", e: "#1f140d", t: "#c68e5b", T: "#a87444", a: "#c68e5b", p: "#3a2a22", b: "#1f140d", C: "#4a3222" },
    overlays: [
      [0, 4, "CCCCCC"], [1, 1, "CCCCCCCCCCCC"], [2, 3, "CCCCCCCC"],
      ...range(14, 17).map((r): Overlay => [r, 3, "tttttttt"]),
      [17, 6, "TT"],
    ],
  },
};

/** 32x32 grid of "#rrggbb" or "" (transparent), feet on the bottom row. */
export function renderNpcPixels(look: NpcLook): string[] {
  const grid: string[][] = BASE.map((row) => row.split(""));
  for (const [r, c, pattern] of look.overlays) {
    pattern.split("").forEach((ch, i) => {
      if (ch !== "." && grid[r] && c + i >= 0 && c + i < NPC_W) grid[r][c + i] = ch;
    });
  }
  const out: string[] = Array(SIZE * SIZE).fill("");
  const ox = Math.floor((SIZE - NPC_W) / 2);
  const oy = SIZE - NPC_H;
  grid.forEach((row, r) =>
    row.forEach((ch, c) => {
      const color = ch === "." ? "" : look.pal[ch] ?? "";
      out[(oy + r) * SIZE + ox + c] = color;
    }),
  );
  return out;
}

export { SIZE as NPC_TEXTURE_SIZE };
