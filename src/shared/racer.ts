// Neon Drift GP: a top-down arcade circuit. The simulation is pure and deterministic (the CPU racers use
// a seeded rng), so it is easy to test; the browser runs it and draws it, and the server only checks that
// the reported times are physically possible before paying out Cafe Beans.

export const RACE = {
  LAPS: 3, COUNTDOWN_MS: 3200, ROAD: 96, // road width (px)
  ACC: 330, BRAKE: 420, MAX: 330, BOOST_MAX: 470, DRAG: 0.7, OFF_DRAG: 3.2, TURN: 2.5,
  GRIP: 0.9, DRIFT_GRIP: 0.992, BOOST_MS: 1100, OIL_MS: 900, CAR_R: 11,
} as const;

export type Vec = { x: number; y: number };
const CONTROL: Vec[] = [
  { x: 300, y: 220 }, { x: 700, y: 150 }, { x: 1100, y: 210 }, { x: 1450, y: 170 }, { x: 1680, y: 360 }, { x: 1620, y: 610 },
  { x: 1350, y: 740 }, { x: 1520, y: 920 }, { x: 1200, y: 1040 }, { x: 800, y: 960 }, { x: 560, y: 800 }, { x: 300, y: 900 },
  { x: 140, y: 660 }, { x: 260, y: 470 }, { x: 110, y: 330 },
];

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

export type Track = { pts: Vec[]; length: number; pads: Vec[]; oil: Vec[]; start: { x: number; y: number; angle: number }; minLapMs: number };

function build(): Track {
  const pts: Vec[] = [];
  const n = CONTROL.length;
  for (let i = 0; i < n; i++) for (let s = 0; s < 24; s++) pts.push(catmull(CONTROL[(i + n - 1) % n], CONTROL[i], CONTROL[(i + 1) % n], CONTROL[(i + 2) % n], s / 24));
  let length = 0;
  for (let i = 0; i < pts.length; i++) { const b = pts[(i + 1) % pts.length]; length += Math.hypot(b.x - pts[i].x, b.y - pts[i].y); }
  const at = (i: number, off = 0): Vec => {
    const a = pts[i % pts.length], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x - ((b.y - a.y) / d) * off, y: a.y + ((b.x - a.x) / d) * off };
  };
  const a = pts[0], b = pts[1];
  return {
    pts, length,
    pads: [40, 130, 225, 300].map((i) => at(i)),
    oil: [[85, 22], [175, -24], [262, 20], [330, -18]].map(([i, o]) => at(i, o)),
    start: { x: a.x, y: a.y, angle: Math.atan2(b.y - a.y, b.x - a.x) },
    minLapMs: Math.floor(((length / RACE.BOOST_MAX) * 1000) * 0.8), // nobody laps faster than flat-out boosting the whole way (minus slack)
  };
}
let cached: Track | null = null;
export const track = (): Track => (cached ??= build());

export type Car = {
  id: number; name: string; human: boolean; color: string;
  x: number; y: number; angle: number; vx: number; vy: number;
  idx: number; visited: number; lap: number; lapStart: number; best: number; finishedAt: number | null;
  boost: number; oil: number; charge: number; drifting: boolean; skill: number;
};
export type RaceInput = { left: boolean; right: boolean; up: boolean; down: boolean; drift: boolean };
export type RaceEvent = "boost" | "oil" | "lap" | "bump" | "go";
export type Race = { t: number; cars: Car[]; events: RaceEvent[]; done: boolean; seed: number };

const COLORS = ["#58e1ff", "#ff5fa8", "#f2c36b", "#7fe0a9"];
const NAMES = ["YOU", "Turbo T.", "Neon N.", "Drift D."];

export function newRace(seed = 1): Race {
  const tr = track();
  const cars: Car[] = [0, 1, 2, 3].map((i) => {
    const back = 30 + i * 36;
    const side = i % 2 === 0 ? -20 : 20;
    const nx = -Math.sin(tr.start.angle), ny = Math.cos(tr.start.angle);
    return {
      id: i, name: NAMES[i], human: i === 0, color: COLORS[i],
      x: tr.start.x - Math.cos(tr.start.angle) * back + nx * side, y: tr.start.y - Math.sin(tr.start.angle) * back + ny * side,
      angle: tr.start.angle, vx: 0, vy: 0, idx: 0, visited: 0, lap: 0, lapStart: 0, best: Infinity, finishedAt: null,
      boost: 0, oil: 0, charge: 0, drifting: false, skill: [1, 0.88, 0.93, 0.98][i],
    };
  });
  return { t: 0, cars, events: [], done: false, seed };
}

/** Nearest centreline sample near the previous one, so we never jump across the loop. */
function nearest(c: Car, tr: Track): { idx: number; dist: number } {
  const n = tr.pts.length;
  let best = c.idx, bd = Infinity;
  for (let k = -8; k <= 14; k++) {
    const i = (c.idx + k + n) % n;
    const d = Math.hypot(tr.pts[i].x - c.x, tr.pts[i].y - c.y);
    if (d < bd) { bd = d; best = i; }
  }
  return { idx: best, dist: bd };
}

function drive(c: Car, inp: RaceInput, dt: number, tr: Track, ev: RaceEvent[]) {
  const spinning = c.oil > 0;
  const steer = spinning ? 1.6 : (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const speed = Math.hypot(c.vx, c.vy);
  const drifting = inp.drift && speed > 120 && steer !== 0 && !spinning;
  c.drifting = drifting;
  c.angle += steer * RACE.TURN * (drifting ? 1.35 : 1) * Math.min(1, speed / 110) * dt;
  const fx = Math.cos(c.angle), fy = Math.sin(c.angle);
  const boosting = c.boost > 0;
  if (inp.up && !spinning) { c.vx += fx * (boosting ? 700 : RACE.ACC) * dt; c.vy += fy * (boosting ? 700 : RACE.ACC) * dt; }
  if (inp.down) { const f = Math.max(0, Math.hypot(c.vx, c.vy) - RACE.BRAKE * dt) / (Math.hypot(c.vx, c.vy) || 1); c.vx *= f; c.vy *= f; }
  // sideways grip: tyres kill the sliding part of the velocity (much less while drifting)
  const fwd = c.vx * fx + c.vy * fy;
  const lat = -c.vx * fy + c.vy * fx;
  const keep = Math.pow(spinning ? 0.99 : drifting ? RACE.DRIFT_GRIP : RACE.GRIP, dt * 60);
  const grip = 1 - keep;
  const nl = lat * (1 - Math.min(1, grip * 6)) * (drifting ? 1 : 1);
  c.vx = fx * fwd - fy * nl;
  c.vy = fy * fwd + fx * nl;
  const { dist } = nearest(c, tr);
  const off = dist > RACE.ROAD / 2;
  const drag = (off ? RACE.OFF_DRAG : RACE.DRAG) * dt;
  c.vx *= 1 - drag; c.vy *= 1 - drag;
  const cap = boosting ? RACE.BOOST_MAX : off ? RACE.MAX * 0.55 : RACE.MAX;
  const v = Math.hypot(c.vx, c.vy);
  if (v > cap) { const k = cap / v; c.vx *= 1 - (1 - k) * Math.min(1, dt * 8); c.vy *= 1 - (1 - k) * Math.min(1, dt * 8); }
  // drifting charges a little turbo, released when you straighten out
  if (drifting) c.charge += dt;
  else { if (c.charge > 0.9) { c.boost = Math.max(c.boost, 700); ev.push("boost"); } c.charge = 0; }
  c.boost = Math.max(0, c.boost - dt * 1000);
  c.oil = Math.max(0, c.oil - dt * 1000);
  c.x += c.vx * dt; c.y += c.vy * dt;
  for (const p of tr.pads) if (c.boost < RACE.BOOST_MS - 100 && Math.hypot(c.x - p.x, c.y - p.y) < 26) { c.boost = RACE.BOOST_MS; if (c.human) ev.push("boost"); }
  if (c.oil <= 0) for (const o of tr.oil) if (Math.hypot(c.x - o.x, c.y - o.y) < 20) { c.oil = RACE.OIL_MS; c.vx *= 0.75; c.vy *= 0.75; if (c.human) ev.push("oil"); }
}

function cpuInput(c: Car, tr: Track, rng: () => number, t: number): RaceInput {
  const n = tr.pts.length;
  const target = tr.pts[(c.idx + 7) % n];
  let diff = Math.atan2(target.y - c.y, target.x - c.x) - c.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const wobble = Math.sin(t / 700 + c.id * 2) * 0.05;
  const sharp = Math.abs(diff) > 0.45;
  const speed = Math.hypot(c.vx, c.vy);
  const maxSpeed = RACE.MAX * c.skill;
  void rng;
  return { left: diff + wobble < -0.04, right: diff + wobble > 0.04, up: speed < maxSpeed * (sharp ? 0.7 : 1), down: sharp && speed > maxSpeed * 0.85, drift: false };
}

export function stepRace(r: Race, input: RaceInput, dtMs: number, rng: () => number) {
  const tr = track();
  const dt = dtMs / 1000;
  r.t += dtMs;
  if (r.done) return;
  const racing = r.t >= RACE.COUNTDOWN_MS;
  if (racing && r.t - dtMs < RACE.COUNTDOWN_MS) r.events.push("go");
  for (const c of r.cars) {
    if (c.finishedAt !== null) { c.vx *= 0.97; c.vy *= 0.97; c.x += c.vx * dt; c.y += c.vy * dt; continue; }
    if (racing) drive(c, c.human ? input : cpuInput(c, tr, rng, r.t), dt, tr, c.human ? r.events : []);
    const { idx } = nearest(c, tr);
    const n = tr.pts.length;
    // lap = a full circuit of checkpoints followed by crossing the line
    if (idx > c.idx && idx - c.idx < 12) c.visited += idx - c.idx;
    if (c.idx > n * 0.85 && idx < n * 0.15 && c.visited > n * 0.8) {
      const lapMs = r.t - RACE.COUNTDOWN_MS - c.lapStart;
      c.best = Math.min(c.best, lapMs);
      c.lapStart = r.t - RACE.COUNTDOWN_MS;
      c.lap++;
      c.visited = 0;
      if (c.human) r.events.push("lap");
      if (c.lap >= RACE.LAPS) c.finishedAt = r.t - RACE.COUNTDOWN_MS;
    }
    c.idx = idx;
  }
  // cars bump each other
  for (let i = 0; i < r.cars.length; i++) for (let j = i + 1; j < r.cars.length; j++) {
    const a = r.cars[i], b = r.cars[j];
    const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
    if (d > 0 && d < RACE.CAR_R * 2) {
      const push = (RACE.CAR_R * 2 - d) / 2, nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
      a.vx -= nx * 20; a.vy -= ny * 20; b.vx += nx * 20; b.vy += ny * 20;
      if (a.human || b.human) r.events.push("bump");
    }
  }
  if (r.cars.every((c) => c.finishedAt !== null) || r.cars[0].finishedAt !== null && r.t - RACE.COUNTDOWN_MS > r.cars[0].finishedAt + 4000) r.done = true;
}

/** 1-based race position of each car right now (finished cars by finish time, the rest by distance covered). */
export function positions(r: Race): number[] {
  const n = track().pts.length;
  const score = (c: Car) => (c.finishedAt !== null ? 1e9 - c.finishedAt : c.lap * n + c.idx);
  const order = [...r.cars].sort((a, b) => score(b) - score(a));
  return r.cars.map((c) => order.indexOf(c) + 1);
}

export const PODIUM_BEANS = [30, 18, 8, 0];
export const raceBeans = (position: number) => PODIUM_BEANS[position - 1] ?? 0;
export const fmtTime = (ms: number) => (Number.isFinite(ms) ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}` : "--:--.---");
