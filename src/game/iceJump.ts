// Cat Ice Jump: the simulation, with no canvas or DOM so it can be tested. The cat hops up rows of
// drifting ice floes over chilly water; some floes crack under its paws, and the water keeps
// rising. World y points UP; row r sits at y = r * ROW. A run is scored by how high you got.

export const ICE = {
  W: 240, // playfield width
  H: 360, // playfield height (what the camera shows)
  ROW: 56, // vertical gap between floe rows
  G: 1100, // gravity (px/s^2)
  JUMP: 520, // jump speed (px/s): reaches ~2 rows
  MOVE: 115, // steering speed (px/s)
  CRACK_MS: 900, // a cracking floe holds this long
  CAT_HALF: 6, // half the cat's width
  EDGE: 3, // forgiveness at the floe edge
  FOLLOW: 150, // the camera keeps the cat this far above the bottom
  CREEP0: 7, // rising water (px/s) at the start...
  CREEP_MAX: 42, // ...and at its fastest
  POINTS_PER_ROW: 10,
} as const;

export type Floe = { id: number; row: number; x: number; w: number; vx: number; cracky: boolean; crackedFor: number; gone: boolean };
export type Cat = { x: number; y: number; vy: number; onFloe: number | null; face: 1 | -1 };
export type IceState = {
  t: number; // ms played
  cat: Cat;
  floes: Floe[];
  camY: number; // world y at the bottom of the screen
  rows: number; // highest row reached
  score: number;
  over: null | "water" | "crushed";
  nextId: number;
  rowsMade: number;
  rng: () => number;
  events: ("jump" | "land" | "crack" | "splash")[]; // drained by the renderer for sound effects
};
export type IceInput = { left: boolean; right: boolean; jump: boolean };

/** Small deterministic generator, so a seed always gives the same river. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRow(s: IceState, row: number) {
  const r = s.rng;
  const dir = row % 2 === 0 ? 1 : -1;
  const speed = Math.min(52, 14 + row * 1.6) * (0.7 + r() * 0.6);
  const w = Math.max(38, Math.round(86 - row * 1.3 + r() * 14));
  const count = row > 4 && r() < 0.35 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const slot = ICE.W / count;
    const x = Math.round(slot * i + r() * Math.max(1, slot - w));
    s.floes.push({
      id: s.nextId++, row, x: Math.min(x, ICE.W - w), w, vx: dir * speed * (i ? -1 : 1),
      cracky: row > 2 && r() < Math.min(0.5, 0.06 + row * 0.018), crackedFor: 0, gone: false,
    });
  }
  s.rowsMade = row;
}

export function newGame(seed = Date.now()): IceState {
  const s: IceState = {
    t: 0, floes: [], camY: -70, rows: 0, score: 0, over: null, nextId: 1, rowsMade: 0, rng: mulberry32(seed), events: [],
    cat: { x: ICE.W / 2, y: 0, vy: 0, onFloe: 1, face: 1 },
  };
  s.floes.push({ id: s.nextId++, row: 0, x: ICE.W / 2 - 60, w: 120, vx: 0, cracky: false, crackedFor: 0, gone: false }); // safe start
  for (let r = 1; r <= 8; r++) makeRow(s, r);
  return s;
}

const floeY = (f: Floe) => f.row * ICE.ROW;

/** Advance the game by dt seconds. `input.jump` is consumed (set false) when it is used. */
export function step(s: IceState, dtIn: number, input: IceInput) {
  if (s.over) return;
  const dt = Math.min(dtIn, 0.05);
  s.t += dt * 1000;
  const cat = s.cat;

  // floes drift, bounce off the banks, and the cracked ones crumble
  for (const f of s.floes) {
    if (f.gone) continue;
    f.x += f.vx * dt;
    if (f.x < 0) { f.x = 0; f.vx = Math.abs(f.vx); }
    if (f.x + f.w > ICE.W) { f.x = ICE.W - f.w; f.vx = -Math.abs(f.vx); }
    if (f.crackedFor > 0) {
      f.crackedFor += dt * 1000;
      if (f.crackedFor >= ICE.CRACK_MS) f.gone = true;
    }
  }

  const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  if (dir) cat.face = dir > 0 ? 1 : -1;
  const prevY = cat.y;

  const under = cat.onFloe === null ? null : s.floes.find((f) => f.id === cat.onFloe && !f.gone) ?? null;
  if (cat.onFloe !== null && !under) cat.onFloe = null; // the ice broke under us: fall

  if (under) {
    cat.x += (under.vx + dir * ICE.MOVE) * dt;
    cat.y = floeY(under);
    if (input.jump) {
      cat.vy = ICE.JUMP;
      cat.onFloe = null;
      s.events.push("jump");
    } else if (cat.x < under.x - ICE.EDGE || cat.x > under.x + under.w + ICE.EDGE) {
      cat.onFloe = null; // walked off the edge
      cat.vy = 0;
    }
  } else {
    cat.x += dir * ICE.MOVE * dt;
    cat.vy -= ICE.G * dt;
    cat.y += cat.vy * dt;
    if (cat.vy <= 0) {
      // landing: we crossed a floe's surface on the way down
      for (const f of s.floes) {
        if (f.gone) continue;
        const fy = floeY(f);
        if (prevY >= fy - 0.5 && cat.y <= fy && cat.x >= f.x - ICE.EDGE && cat.x <= f.x + f.w + ICE.EDGE) {
          cat.y = fy;
          cat.vy = 0;
          cat.onFloe = f.id;
          s.events.push("land");
          if (f.cracky && f.crackedFor === 0) { f.crackedFor = 1; s.events.push("crack"); }
          break;
        }
      }
    }
  }
  input.jump = false;
  // the cat wraps around the sides of the river
  if (cat.x < 0) cat.x += ICE.W;
  if (cat.x > ICE.W) cat.x -= ICE.W;

  // score and camera: follow the cat upward, and the water creeps up behind it
  if (cat.onFloe !== null) s.rows = Math.max(s.rows, Math.round(cat.y / ICE.ROW)); // only rows you land on count
  s.score = s.rows * ICE.POINTS_PER_ROW;
  const creep = Math.min(ICE.CREEP_MAX, ICE.CREEP0 + s.rows * 0.9);
  s.camY = Math.max(s.camY + creep * dt, cat.y - ICE.FOLLOW);
  while (s.rowsMade < s.rows + 8) makeRow(s, s.rowsMade + 1);
  s.floes = s.floes.filter((f) => !f.gone || floeY(f) > s.camY - ICE.ROW * 2);

  if (cat.onFloe === null && cat.y < s.camY - 4) {
    s.over = "water";
    s.events.push("splash");
  } else if (cat.onFloe !== null && cat.y < s.camY - 4) {
    s.over = "water"; // the rising water caught us on a floe
    s.events.push("splash");
  }
}

/** Screen y (0 = top) for a world y. */
export const screenY = (s: IceState, y: number) => ICE.H - (y - s.camY);
