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

// ---- the Pixel Restaurant startup crew (Floor 1, table 6), Togi and the Arcade & Casino crowd (Floor 2) -----------
// Each look is original pixel art built on the shared body. A heavier build widens the torso into the spare columns.
const wide = (rows: number[], ch = "t"): Overlay[] => rows.map((r) => [r, 1, ch.repeat(12)]);

Object.assign(LOOKS, {
  // Faizan: styled-up black quiff, goatee with a moustache, maroon hoodie, dark jeans, white trainers
  faizan: {
    pal: { h: "#16100c", s: "#b07a52", e: "#1f140d", t: "#7a2d3a", T: "#5a1f2a", a: "#7a2d3a", p: "#2a3a5a", b: "#f4f4f4", B: "#16100c", w: "#e8d8c8" },
    overlays: [[0, 5, "hhhh"], [0, 3, "h"], [1, 2, "hhhhhhhhhh"], [3, 3, "h"], [3, 10, "h"], [5, 5, "BBBB"], [6, 5, "BBBB"], [7, 6, "ww"], [10, 6, "w"], [10, 7, "w"]],
  },
  // Puneet: saffron turban, full beard, heavier build, teal polo, khakis
  puneet: {
    pal: { h: "#16100c", s: "#a8714a", e: "#1f140d", t: "#2a8a8a", T: "#1f6a6a", a: "#2a8a8a", p: "#c4a46a", b: "#4a3222", C: "#e88a1a", K: "#ffb04a", B: "#1a1210" },
    overlays: [
      [0, 3, "CCCCCCCC"], [1, 2, "CKCCCCKCCC"], [2, 2, "CCCKCCCCCC"], [3, 3, "CCCCCCCC"],
      [4, 3, "B"], [4, 10, "B"], [5, 3, "BssssssB"], [6, 3, "BBBBBBBB"], [7, 4, "BBBBBB"],
      ...wide([8, 9, 10, 11, 12, 13]), [9, 0, "a"], [10, 0, "a"], [9, 13, "a"], [10, 13, "a"], [12, 1, "TTTTTTTTTTTT"],
    ],
  },
  // Cris: twin of Nick. Side-swept brown hair, small goatee, green flannel shirt
  cris: {
    pal: { h: "#6a4428", s: "#f1c8a0", e: "#1f140d", t: "#3a7a4a", T: "#2a5a3a", a: "#3a7a4a", p: "#3a4a6a", b: "#2a1a10", P: "#24502f", B: "#6a4428" },
    overlays: [[1, 2, "hhhhhhhhh"], [2, 2, "hh"], [3, 3, "hhh"], [6, 6, "BB"], [8, 2, "P..P..P..P"], [10, 2, "PPPPPPPPPP"], [12, 3, "P..P..P"]],
  },
  // Nick: twin of Cris. Same face and goatee, navy beanie, grey tee with a pixel logo
  nick: {
    pal: { h: "#6a4428", s: "#f1c8a0", e: "#1f140d", t: "#9a9aa8", T: "#7a7a88", a: "#9a9aa8", p: "#2a2a34", b: "#d9304a", C: "#2a3a6a", K: "#3a4a8a", B: "#6a4428", L: "#f2c36b" },
    overlays: [[0, 3, "CCCCCCCC"], [1, 2, "CKCKCKCKCC"], [2, 3, "CCCCCCCC"], [6, 6, "BB"], [9, 6, "LL"], [10, 5, "L..L"]],
  },
  // Togi: backwards red snapback (strap showing), black hoodie with the hood down and drawstrings, mint sneakers
  togi: {
    pal: { h: "#2a1a10", s: "#c68e5b", e: "#1f140d", t: "#26262e", T: "#18181e", a: "#26262e", p: "#1a1a20", b: "#7fe0a9", C: "#d9304a", K: "#ff6a7a", H: "#3a3a46", w: "#fff6e0", G: "#f2c36b" },
    overlays: [[0, 4, "CCCCCC"], [1, 3, "CCKKCCCC"], [2, 3, "CCC.CCCC"], [2, 11, "CC"], [7, 3, "HHHHHHHH"], [8, 2, "H"], [8, 11, "H"], [9, 6, "w"], [10, 6, "w"], [9, 8, "w"], [10, 8, "w"], [12, 5, "GGGG"]],
  },
  // the Degenerate: rumpled white shirt, loosened red tie, messy hair, five o'clock shadow
  vince: {
    pal: { h: "#3a2a1a", s: "#e8b890", e: "#1f140d", t: "#e8e4d8", T: "#c8c4b8", a: "#e8e4d8", p: "#3a3a46", b: "#2a1a10", R: "#c02030", B: "#9a7a60" },
    overlays: [[0, 3, "h.hh.hh"], [6, 4, "BBBBBB"], [7, 6, "RR"], [8, 6, "RR"], [9, 7, "R"], [10, 6, "RR"]],
  },
  // the First-Timer: pastel windbreaker, bright beanie, little backpack straps, sneakers
  pip: {
    pal: { h: "#e8c060", s: "#ffe0bd", e: "#1f140d", t: "#9fd8f0", T: "#7fb8d0", a: "#f28fad", p: "#f2d27a", b: "#ffffff", C: "#7fe0a9", S: "#3a3a46" },
    overlays: [[0, 4, "CCCCCC"], [1, 3, "CCCCCCCC"], [8, 3, "S"], [9, 3, "S"], [10, 3, "S"], [8, 10, "S"], [9, 10, "S"], [10, 10, "S"]],
  },
  // the Big Winner: gold lamé jacket over a black tee, shades, gold chain
  goldie: {
    pal: { h: "#1a1210", s: "#8a5a3a", e: "#05030c", t: "#d8a830", T: "#b08820", a: "#d8a830", p: "#1a1a20", b: "#f2c36b", G: "#05030c", N: "#05030c", Y: "#fff0a0" },
    overlays: [[4, 3, "sGGGGGGs"], [8, 5, "NNNN"], [9, 5, "NNNN"], [10, 5, "NNNN"], [9, 4, "Y"], [10, 5, "Y"], [10, 8, "Y"], [9, 9, "Y"]],
  },
  // the Heavy Bettor: charcoal three-piece suit, slicked silver hair, gold cufflinks
  sterling: {
    pal: { h: "#c4c4cc", s: "#e8c4a0", e: "#1f140d", t: "#2a2a34", T: "#1f1f28", a: "#2a2a34", p: "#2a2a34", b: "#05030c", W: "#f4f4f4", V: "#5a1a2a", G: "#f2c36b" },
    overlays: [[1, 3, "hhhhhhhh"], [2, 3, "hhhhhhhh"], [7, 6, "WW"], [8, 6, "VV"], [9, 6, "VV"], [11, 1, "G"], [11, 12, "G"]],
  },
  // the Arcade Regular: backwards-free gaming headset, purple cap, high-score tee
  rika: {
    pal: { h: "#2a1a3a", s: "#f1c27d", e: "#1f140d", t: "#3a1a50", T: "#2a1240", a: "#3a1a50", p: "#1a1a28", b: "#58e1ff", C: "#9b5de5", H: "#58e1ff", L: "#ff5fa8" },
    overlays: [[0, 4, "CCCCCC"], [1, 3, "CCCCCCCC"], [2, 10, "CC"], [3, 2, "H"], [4, 2, "H"], [3, 11, "H"], [4, 11, "H"], [5, 2, "H"], [9, 5, "LLLL"]],
  },
  // the Casual Visitor: denim jacket, curly hair, tote bag
  dee: {
    pal: { h: "#4a2a1a", s: "#7a4a2a", e: "#1f140d", t: "#4a6a9a", T: "#3a5a8a", a: "#4a6a9a", p: "#d8c8a8", b: "#8a5a3a", Q: "#f4e4c1" },
    overlays: [[0, 3, "hhhhhhhh"], [1, 2, "hhhhhhhhhh"], [3, 2, "h"], [3, 11, "h"], [4, 2, "h"], [4, 11, "h"], [11, 12, "Q"], [12, 12, "Q"], [13, 11, "QQ"]],
  },
  // sports fans on the lounge couches (we mostly see the backs of their heads and their team scarves)
  marco: {
    pal: { h: "#1a1210", s: "#e8b890", e: "#1f140d", t: "#d9304a", T: "#b02030", a: "#d9304a", p: "#2a3a5a", b: "#1a1a1a", W: "#fff6e0" },
    overlays: [[7, 3, "WWWWWWWW"], [8, 3, "W"]],
  },
  lena: {
    pal: { h: "#e8c060", s: "#f6d8b8", e: "#1f140d", t: "#3a8bff", T: "#2a6bdf", a: "#3a8bff", p: "#2a2a34", b: "#f4f4f4", Y: "#f2c36b" },
    overlays: [...[3, 4, 5, 6, 7, 8].flatMap((r): Overlay[] => [[r, 2, "h"], [r, 11, "h"]]), [7, 3, "YYYYYYYY"]],
  },
  // the dance fan by the Beat Battle floor: neon tracksuit
  jojo: {
    pal: { h: "#05030c", s: "#5a3a2a", e: "#f6f1e6", t: "#ff5fa8", T: "#d8408a", a: "#58e1ff", p: "#ff5fa8", b: "#fff6e0", S: "#58e1ff" },
    overlays: [[0, 4, "hhhhhh"], [0, 3, "h"], [0, 10, "h"], ...[14, 15, 16, 17, 18, 19, 20, 21].map((r): Overlay => [r, 3, "S"])],
  },
} satisfies Record<string, NpcLook>);

// ---- more cafe regulars (Floor 1) and the rooftop crowd (Floor 3)
Object.assign(LOOKS, {
  // Ava, the student: long dark hair, round glasses, mustard cardigan
  ava: { pal: { h: "#2a1810", s: "#e8b890", e: "#1f140d", t: "#d8a030", T: "#b08020", a: "#d8a030", p: "#4a3a5a", b: "#f4f4f4", G: "#1f140d" }, overlays: [...[3, 4, 5, 6, 7, 8, 9].flatMap((r): Overlay[] => [[r, 2, "h"], [r, 11, "h"]]), [4, 3, "sGeGGeGs"]] },
  // Ben: short ginger hair, striped navy tee
  ben: { pal: { h: "#c8602a", s: "#f1c8a0", e: "#1f140d", t: "#2a3a6a", T: "#1f2a50", a: "#2a3a6a", p: "#6a5a4a", b: "#3a2a1a", W: "#f4f4f4" }, overlays: [[9, 3, "WWWWWWWW"], [11, 3, "WWWWWWWW"]] },
  // Chloe: black bob with a red clip, green dress
  chloe: { pal: { h: "#16100c", s: "#8a5a3a", e: "#1f140d", t: "#3a8a5a", T: "#2a6a42", a: "#3a8a5a", p: "#3a8a5a", b: "#d9304a", R: "#d9304a" }, overlays: [[3, 2, "h"], [4, 2, "h"], [5, 2, "h"], [3, 11, "h"], [4, 11, "h"], [5, 11, "h"], [1, 9, "R"]] },
  // Hana, the artist: beret, paint-flecked smock
  hana: { pal: { h: "#4a2a1a", s: "#f1c27d", e: "#1f140d", t: "#e8e0d0", T: "#c8c0b0", a: "#e8e0d0", p: "#2a2a34", b: "#4a3222", C: "#9a2a3a", P: "#3a8bff", Q: "#f2c36b" }, overlays: [[0, 3, "CCCCCCC"], [1, 2, "CCCCCCCCC"], [9, 4, "P"], [10, 8, "Q"], [12, 5, "P"]] },
  // Rosa, the rumour fan: grey curls, purple shawl
  rosa: { pal: { h: "#b8b8c4", s: "#e8c4a0", e: "#1f140d", t: "#7a3a8a", T: "#5a2a6a", a: "#7a3a8a", p: "#3a2a4a", b: "#2a1a10" }, overlays: [[0, 3, "hhhhhhhh"], [1, 2, "hhhhhhhhhh"], [3, 2, "h"], [3, 11, "h"]] },
  // Stella, the stargazer: star-print navy jacket, silver hair clip
  stella: { pal: { h: "#e8d0a0", s: "#f6d8b8", e: "#1f140d", t: "#1f2a5a", T: "#141e44", a: "#1f2a5a", p: "#2a2a34", b: "#9fb8d8", Y: "#fff0a0" }, overlays: [...[3, 4, 5, 6].flatMap((r): Overlay[] => [[r, 2, "h"], [r, 11, "h"]]), [9, 4, "Y"], [11, 8, "Y"], [10, 6, "Y"]] },
  // Jules, the guitarist: flannel, beanie, a guitar slung across
  jules: { pal: { h: "#3a2a1a", s: "#c68e5b", e: "#1f140d", t: "#8a2a2a", T: "#6a1f1f", a: "#8a2a2a", p: "#2a3a5a", b: "#3a2a1a", C: "#3a5a3a", G: "#c88a3a", N: "#5a3a1a" }, overlays: [[0, 4, "CCCCCC"], [1, 3, "CCCCCCCC"], [10, 4, "GGG"], [11, 3, "GGGGG"], [9, 7, "NNN"], [8, 9, "NN"]] },
  // Noor: hijab in teal, cream coat
  noor: { pal: { h: "#2a8a8a", s: "#c68e5b", e: "#1f140d", t: "#e8dcc8", T: "#c8bca8", a: "#e8dcc8", p: "#3a3a46", b: "#2a1a10" }, overlays: [[3, 2, "hh"], [4, 2, "hh"], [5, 2, "hh"], [3, 10, "hh"], [4, 10, "hh"], [5, 10, "hh"], [6, 3, "hh"], [6, 9, "hh"], [7, 3, "hhhhhhhh"]] },
  // Sam: curly hair, mustard scarf, grey coat
  sam: { pal: { h: "#2a1a10", s: "#7a4a2a", e: "#1f140d", t: "#6a6a78", T: "#55555f", a: "#6a6a78", p: "#2a2a34", b: "#1a1a1a", Y: "#d8a030" }, overlays: [[0, 3, "h.hh.hh."], [1, 2, "hhhhhhhhhh"], [7, 3, "YYYYYYYY"], [8, 3, "Y"]] },
  // Kaz, the photographer: bucket hat, camera on a strap
  kaz: { pal: { h: "#16100c", s: "#f1c27d", e: "#1f140d", t: "#4a5a3a", T: "#3a4a2a", a: "#4a5a3a", p: "#c8b896", b: "#3a2a1a", C: "#c8b896", K: "#1f1f26", L: "#9fd8f0" }, overlays: [[0, 3, "CCCCCCCC"], [1, 1, "CCCCCCCCCCCC"], [8, 4, "K....."], [9, 5, "KKKK"], [10, 5, "KLLK"], [11, 5, "KKKK"]] },
} satisfies Record<string, NpcLook>);

/** The same NPC seen from behind (watching the big screen): the face becomes the back of the head. */
export function renderNpcBackPixels(look: NpcLook): string[] {
  const back: NpcLook = {
    pal: look.pal,
    overlays: [...look.overlays.filter(([r]) => r > 7 || r < 3 || look.pal.C !== undefined), [3, 3, "hhhhhhhh"], [4, 3, "hhhhhhhh"], [5, 3, "hhhhhhhh"], [6, 4, "ssssss"]],
  };
  // hats and turbans stay (they are seen from behind too); everything on the face is replaced by hair
  return renderNpcPixels(back);
}

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
