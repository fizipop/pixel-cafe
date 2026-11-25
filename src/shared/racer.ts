// Neon Drift GP: an arcade circuit (the browser draws it from a 3D chase camera). The simulation is pure and deterministic (the CPU racers use
// a seeded rng), so it is easy to test; the browser runs it and draws it, and the server only checks that
// the reported times are physically possible before paying out Cafe Beans.

export const RACE = {
  LAPS: 4, FIELD: 8, PLAYER_SLOT: 5, COUNTDOWN_MS: 3200, ROAD: 96, // road width (px); FIELD cars on the grid (you + 7 CPU racers), you start 6th
  ACC: 330, BRAKE: 420, MAX: 330, BOOST_MAX: 470, DRAG: 0.7, OFF_DRAG: 3.2, TURN: 2.5,
  GRIP: 0.9, DRIFT_GRIP: 0.992, BOOST_MS: 1100, OIL_MS: 900, CAR_R: 11,
  // solid boundary: a barrier runs EDGE px either side of the centreline (past the curbs and a strip of grass run-off);
  // canyon walls stand behind it. Cars are CAR_HL long and CAR_HW wide (half extents, bumper to bumper and outer tyre
  // wall to outer tyre wall: the renderer's car model is built to exactly this box), used for the barrier clamp
  // (max lateral offset = EDGE - the body's sideways reach) and for car-to-car contact. CAR_GAP keeps a sliver of air
  // between two bodies in contact so they never draw interpenetrated. CAR_R is only the grid-spacing radius.
  EDGE: 70, CAR_HL: 13, CAR_HW: 7, CAR_GAP: 0.6, WALL_BOUNCE: 0.25, SCRAPE: 1.4,
  PAD_HL: 22, PAD_HW: 26, OIL_RX: 22, OIL_RY: 14, // boost pad (half length/width along the road) and oil slick (ellipse radii)
} as const;

export type Vec = { x: number; y: number };
const CONTROL: Vec[] = [
  { x: 300, y: 220 }, { x: 700, y: 150 }, { x: 1100, y: 210 }, { x: 1450, y: 170 }, { x: 1680, y: 360 }, { x: 1620, y: 610 },
  { x: 1350, y: 740 }, { x: 1520, y: 920 }, { x: 1200, y: 1040 }, { x: 800, y: 960 }, { x: 560, y: 800 }, { x: 300, y: 900 },
  { x: 140, y: 660 }, { x: 260, y: 470 }, { x: 110, y: 330 },
];

const START_AT = 36;

function catmull(p0: Vec, p1: Vec, p2: Vec, p3: Vec, t: number): Vec {
  const t2 = t * t, t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
}

/** Hill height (world units) at a (possibly fractional) centreline sample. Purely scenery: the physics stays flat. */
export const elevation = (i: number, n: number): number => {
  const s = (i / n) * Math.PI * 2;
  return 26 * Math.sin(s * 3 + 0.6) + 14 * Math.sin(s * 5 + 2.1) + 10;
};

/** Canyon wall height (world units) beside centreline sample `i`, on the left (side -1) or right (side 1). 0 = open ground. */
export function cliffAt(i: number, n: number, side: -1 | 1): number {
  const s = (i / n) * Math.PI * 2;
  const mask = Math.min(1, Math.max(0, Math.min(i, n - i) / 22)); // no cliffs around the start gantry
  const k = side < 0 ? Math.sin(s * 2 + 0.4) * 1.7 - 0.25 : Math.sin(s * 3 + 2.0) * 1.7 - 0.3;
  return Math.min(1, Math.max(0, k)) * (side < 0 ? 118 : 96) * mask;
}

export type Track = {
  pts: Vec[]; length: number; pads: Vec[]; oil: Vec[]; start: { x: number; y: number; angle: number }; minLapMs: number;
  /** Unit tangent and right-hand normal at each sample (central differences), shared by the physics and the renderer. */
  tx: Float64Array; ty: Float64Array; nx: Float64Array; ny: Float64Array;
  padIdx: number[]; oilIdx: number[];
};

function build(): Track {
  let pts: Vec[] = [];
  const n = CONTROL.length;
  for (let i = 0; i < n; i++) for (let s = 0; s < 24; s++) pts.push(catmull(CONTROL[(i + n - 1) % n], CONTROL[i], CONTROL[(i + 1) % n], CONTROL[(i + 2) % n], s / 24));
  pts = [...pts.slice(START_AT), ...pts.slice(0, START_AT)]; // the start/finish line sits on a long straight so the whole grid fits
  let length = 0;
  for (let i = 0; i < pts.length; i++) { const b = pts[(i + 1) % pts.length]; length += Math.hypot(b.x - pts[i].x, b.y - pts[i].y); }
  const at = (i: number, off = 0): Vec => {
    const a = pts[i % pts.length], b = pts[(i + 1) % pts.length];
    const d = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    return { x: a.x - ((b.y - a.y) / d) * off, y: a.y + ((b.x - a.x) / d) * off };
  };
  const a = pts[0], b = pts[1];
  const tx = new Float64Array(pts.length), ty = new Float64Array(pts.length), nx = new Float64Array(pts.length), ny = new Float64Array(pts.length);
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[(i + pts.length - 1) % pts.length], p1 = pts[(i + 1) % pts.length], l = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
    tx[i] = (p1.x - p0.x) / l; ty[i] = (p1.y - p0.y) / l; nx[i] = -ty[i]; ny[i] = tx[i];
  }
  const padIdx = [40, 130, 225, 300], oilAt: [number, number][] = [[85, 22], [175, -24], [262, 20], [330, -18]];
  return {
    pts, length, tx, ty, nx, ny, padIdx, oilIdx: oilAt.map(([i]) => i),
    pads: padIdx.map((i) => at(i)),
    oil: oilAt.map(([i, o]) => at(i, o)),
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
  lane: number; crossed: boolean; braking: boolean; // CPU line offset (px), has crossed the line once, brake lights
  pad: number; slick: number; // the boost pad / oil slick the car is over right now (-1 = none): each one fires once per pass
  scrape: number; scrapeSide: number; // ms of barrier contact left to show (sparks), and which side (-1 left, 1 right)
};
export type RaceInput = { left: boolean; right: boolean; up: boolean; down: boolean; drift: boolean };
export type RaceEvent = "boost" | "oil" | "lap" | "bump" | "go" | "scrape";
export type Race = { t: number; cars: Car[]; events: RaceEvent[]; done: boolean; seed: number };

export const COLORS = ["#58e1ff", "#ff5fa8", "#f2c36b", "#7fe0a9", "#ff7a3a", "#9b5de5", "#e8e8f0", "#d9304a", "#3a8bff", "#c6f24a"];
export const STRIPES = ["#fff6e0", "#05030c", "#d9304a", "#f2c36b", "#58e1ff"];
const NAMES = ["YOU", "Turbo T.", "Neon N.", "Drift D.", "Apex A.", "Slick S.", "Nitro N.", "Rocket R.", "Blaze B.", "Viper V.", "Comet C.", "Dash D.", "Ember E.", "Flux F.", "Gizmo G.", "Hawk H.", "Ion I.", "Jet J.", "Kilo K.", "Lynx L."];

export function newRace(seed = 1): Race {
  const tr = track();
  const n = tr.pts.length;
  const cars: Car[] = [];
  let cpu = 0;
  for (let slot = 0; slot < RACE.FIELD; slot++) {
    // a 2-wide grid laid along the real centreline behind the start line, so every car sits on the road
    const row = Math.floor(slot / 2), side = slot % 2 === 0 ? -1 : 1;
    const idx = (n - 3 - row * 2 + n) % n;
    const a = tr.pts[idx], b = tr.pts[(idx + 1) % n];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const id = slot === RACE.PLAYER_SLOT ? 0 : ++cpu;
    cars[id] = {
      id, name: NAMES[id], human: id === 0, color: COLORS[id % COLORS.length],
      x: a.x - Math.sin(ang) * side * 17, y: a.y + Math.cos(ang) * side * 17,
      angle: ang, vx: 0, vy: 0, idx, visited: 0, lap: 0, lapStart: 0, best: Infinity, finishedAt: null,
      boost: 0, oil: 0, charge: 0, drifting: false, skill: id === 0 ? 1 : 0.95 - slot * 0.009,
      lane: id === 0 ? 0 : ((id * 37) % 9 - 4) * 6, crossed: false, braking: false,
      pad: -1, slick: -1, scrape: 0, scrapeSide: 0,
    };
  }
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

/** Where a point sits relative to the road near sample `idx`: signed lateral offset (right = +), distance along the
 *  centreline from the sample, and the interpolated tangent / normal there. Uses the actual segment the point
 *  projects onto, so curved sections are handled smoothly. */
export function roadFrame(tr: Track, x: number, y: number, idx: number) {
  const n = tr.pts.length;
  const p = tr.pts[idx];
  const ahead = (x - p.x) * tr.tx[idx] + (y - p.y) * tr.ty[idx] >= 0;
  const i0 = ahead ? idx : (idx + n - 1) % n, i1 = (i0 + 1) % n;
  const a = tr.pts[i0], b = tr.pts[i1];
  const sx = b.x - a.x, sy = b.y - a.y, sl2 = sx * sx + sy * sy || 1;
  const u = Math.min(1, Math.max(0, ((x - a.x) * sx + (y - a.y) * sy) / sl2));
  let nx = tr.nx[i0] + (tr.nx[i1] - tr.nx[i0]) * u, ny = tr.ny[i0] + (tr.ny[i1] - tr.ny[i0]) * u;
  const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  const cx = a.x + sx * u, cy = a.y + sy * u;
  return { lat: (x - cx) * nx + (y - cy) * ny, along: (x - p.x) * tr.tx[idx] + (y - p.y) * tr.ty[idx], nx, ny, tx: ny, ty: -nx };
}

/** How far the car's body reaches sideways from its centre, given its heading relative to the road. */
const sideReach = (angle: number, tx: number, ty: number) => {
  const rel = angle - Math.atan2(ty, tx);
  return Math.abs(Math.sin(rel)) * RACE.CAR_HL + Math.abs(Math.cos(rel)) * RACE.CAR_HW;
};

/**
 * Keep a car inside the barriers. The test is positional (the body is clamped back inside every step), so no speed
 * can tunnel through: at boost speed a car moves under 8 px a frame and the road samples are ~13 px apart. On contact
 * the car loses its outward speed (with a small bounce), scrapes off speed along the wall, and is turned to slide
 * along it, which also means it can never be left pinned nose-first against a barrier.
 */
export function confine(c: Car, tr: Track, dt: number, ev: RaceEvent[] | null) {
  const { idx } = nearest(c, tr);
  const f = roadFrame(tr, c.x, c.y, idx);
  if (Math.abs(f.lat) <= RACE.EDGE - sideReach(c.angle, f.tx, f.ty)) return false;
  const side = f.lat > 0 ? 1 : -1;
  const vn = (c.vx * f.nx + c.vy * f.ny) * side; // speed into the barrier
  let impact = 0;
  if (vn > 0) {
    impact = vn;
    const k = vn * (1 + RACE.WALL_BOUNCE);
    c.vx -= f.nx * side * k; c.vy -= f.ny * side * k;
  }
  // scraping: friction on the speed along the wall, harder for a harder hit
  const loss = Math.min(0.6, RACE.SCRAPE * dt + impact / 900);
  c.vx *= 1 - loss; c.vy *= 1 - loss;
  // turn the car to slide along the barrier in the race direction. A car really driving the wrong way at speed keeps
  // going that way; a slow one facing backwards is swung round, nose away from the wall, so it can never sit pinned.
  const vt = c.vx * f.tx + c.vy * f.ty;
  const fwd = Math.cos(c.angle) * f.tx + Math.sin(c.angle) * f.ty;
  const tAng = Math.atan2(f.ty, f.tx);
  let target = tAng, rate = 1.6 + impact / 110;
  if (vt < -90) target = tAng + Math.PI;
  else if (fwd < 0) { target = Math.atan2(-side * f.ny, -side * f.nx); rate = 2.6; } // first point back out toward the road
  const diff = Math.atan2(Math.sin(target - c.angle), Math.cos(target - c.angle));
  c.angle += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
  // then clamp the body (with its new heading) back inside the barrier
  const over = Math.abs(f.lat) - (RACE.EDGE - sideReach(c.angle, f.tx, f.ty));
  if (over > 0) { c.x -= f.nx * side * over; c.y -= f.ny * side * over; }
  c.scrape = 240; c.scrapeSide = side;
  if (ev && impact > 45) ev.push("scrape");
  return true;
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
  c.braking = inp.down && speed > 20;
  if (inp.down) { const f = Math.max(0, Math.hypot(c.vx, c.vy) - RACE.BRAKE * dt) / (Math.hypot(c.vx, c.vy) || 1); c.vx *= f; c.vy *= f; }
  // sideways grip: tyres kill the sliding part of the velocity (much less while drifting)
  const fwd = c.vx * fx + c.vy * fy;
  const lat = -c.vx * fy + c.vy * fx;
  const keep = Math.pow(spinning ? 0.99 : drifting ? RACE.DRIFT_GRIP : RACE.GRIP, dt * 60);
  const grip = 1 - keep;
  const nl = lat * (1 - Math.min(1, grip * 6)) * (drifting ? 1 : 1);
  c.vx = fx * fwd - fy * nl;
  c.vy = fy * fwd + fx * nl;
  const off = Math.abs(roadFrame(tr, c.x, c.y, nearest(c, tr).idx).lat) > RACE.ROAD / 2;
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
  c.scrape = Math.max(0, c.scrape - dt * 1000);
  c.x += c.vx * dt; c.y += c.vy * dt;
  confine(c, tr, dt, c.human ? ev : null);
  touchHazards(c, tr, c.human ? ev : null);
}

/** Is the car's body over a boost pad? Tested in the road's own frame at the pad. */
function overPad(c: Car, tr: Track, k: number) {
  const i = tr.padIdx[k], p = tr.pads[k];
  const dx = c.x - p.x, dy = c.y - p.y;
  const along = dx * tr.tx[i] + dy * tr.ty[i], lat = dx * tr.nx[i] + dy * tr.ny[i];
  return Math.abs(along) <= RACE.PAD_HL + RACE.CAR_HL * 0.5 && Math.abs(lat) <= RACE.PAD_HW + RACE.CAR_HW * 0.5;
}
/** Is the car's body over an oil slick (an ellipse along the road)? */
function overOil(c: Car, tr: Track, k: number) {
  const i = tr.oilIdx[k], p = tr.oil[k];
  const dx = c.x - p.x, dy = c.y - p.y;
  const along = (dx * tr.tx[i] + dy * tr.ty[i]) / (RACE.OIL_RX + RACE.CAR_HL * 0.4), lat = (dx * tr.nx[i] + dy * tr.ny[i]) / (RACE.OIL_RY + RACE.CAR_HW * 0.6);
  return along * along + lat * lat <= 1;
}

/** Boost pads and oil fire once when a car rolls onto them (not again until it has left), and only on real overlap.
 *  The oil keeps its cooldown: a car still spinning from one slick is not caught by another. */
export function touchHazards(c: Car, tr: Track, ev: RaceEvent[] | null) {
  let pad = -1;
  for (let k = 0; k < tr.pads.length; k++) if (overPad(c, tr, k)) { pad = k; break; }
  if (pad >= 0 && pad !== c.pad) { c.boost = RACE.BOOST_MS; ev?.push("boost"); }
  c.pad = pad;
  let slick = -1;
  for (let k = 0; k < tr.oil.length; k++) if (overOil(c, tr, k)) { slick = k; break; }
  if (slick >= 0 && slick !== c.slick && c.oil <= 0) { c.oil = RACE.OIL_MS; c.vx *= 0.75; c.vy *= 0.75; ev?.push("oil"); }
  c.slick = slick;
}

function cpuInput(c: Car, tr: Track, rng: () => number, t: number, cars: Car[]): RaceInput {
  const n = tr.pts.length;
  const ti = (c.idx + 7) % n, nx = tr.pts[(ti + 1) % n], tp = tr.pts[ti];
  const tl = Math.hypot(nx.x - tp.x, nx.y - tp.y) || 1;
  // each CPU holds its own lane, but swings out to pass a car that is in its way instead of shunting it into a pile
  let lane = c.lane, lift = false;
  const hx = Math.cos(c.angle), hy = Math.sin(c.angle);
  const bend = Math.abs(Math.atan2(tr.tx[c.idx] * tr.ty[ti] - tr.ty[c.idx] * tr.tx[ti], tr.tx[c.idx] * tr.tx[ti] + tr.ty[c.idx] * tr.ty[ti]));
  for (const o of cars) {
    if (o === c) continue;
    const dx = o.x - c.x, dy = o.y - c.y, ahead = dx * hx + dy * hy;
    if (ahead <= 0 || ahead > RACE.CAR_HL * 2 + 22) continue;
    const side = -dx * hy + dy * hx; // > 0: the other car is to our right
    if (Math.abs(side) > RACE.CAR_HW * 2 + 3) continue;
    const closing = (c.vx - o.vx) * hx + (c.vy - o.vy) * hy;
    if (closing < 8 && ahead > RACE.CAR_HL * 2 + 4) continue;
    // pass on the straights; in a hairpin just back off and queue rather than dive down the inside
    if (bend < 0.45) lane += (side > 0 || (side === 0 && c.lane > 0) ? -1 : 1) * (RACE.CAR_HW * 2 + 4);
    lift = ahead < RACE.CAR_HL * 2 + 4 && closing > 40;
    break;
  }
  const room = RACE.ROAD / 2 - RACE.CAR_HW - 8;
  lane = Math.max(-room, Math.min(room, lane));
  const target = { x: tp.x - ((nx.y - tp.y) / tl) * lane, y: tp.y + ((nx.x - tp.x) / tl) * lane };
  let diff = Math.atan2(target.y - c.y, target.x - c.x) - c.angle;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  const wobble = Math.sin(t / 700 + c.id * 2) * 0.05;
  const sharp = Math.abs(diff) > 0.45;
  const speed = Math.hypot(c.vx, c.vy);
  const maxSpeed = RACE.MAX * c.skill;
  void rng;
  return { left: diff + wobble < -0.04, right: diff + wobble > 0.04, up: !lift && speed < maxSpeed * (sharp ? 0.7 : 1), down: sharp && speed > maxSpeed * 0.85, drift: false };
}

export function stepRace(r: Race, input: RaceInput, dtMs: number, rng: () => number) {
  const tr = track();
  const dt = dtMs / 1000;
  r.t += dtMs;
  if (r.done) return;
  const racing = r.t >= RACE.COUNTDOWN_MS;
  if (racing && r.t - dtMs < RACE.COUNTDOWN_MS) r.events.push("go");
  for (const c of r.cars) {
    if (c.finishedAt !== null) { c.vx *= 0.97; c.vy *= 0.97; c.x += c.vx * dt; c.y += c.vy * dt; confine(c, tr, dt, null); c.idx = nearest(c, tr).idx; continue; }
    if (racing) drive(c, c.human ? input : cpuInput(c, tr, rng, r.t, r.cars), dt, tr, c.human ? r.events : []);
    const { idx } = nearest(c, tr);
    const n = tr.pts.length;
    // lap = a full circuit of checkpoints followed by crossing the line
    if (idx > c.idx && idx - c.idx < 12) c.visited += idx - c.idx;
    if (!c.crossed && c.idx > n * 0.85 && idx < n * 0.15) { c.crossed = true; c.visited = 0; c.lapStart = r.t - RACE.COUNTDOWN_MS; } // rolling start: lap 1 begins at the line
    else if (c.crossed && c.idx > n * 0.85 && idx < n * 0.15 && c.visited > n * 0.8) {
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
  // cars bump each other as real boxes: separate them along the axis of least overlap, then a real impulse along that
  // normal (equal masses, a little restitution) so a rear-ender passes speed on through the bumpers and a side swipe
  // deflects both cars door to door. Two passes settle a three-car squeeze without leaving anyone stacked in another.
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < r.cars.length; i++) for (let j = i + 1; j < r.cars.length; j++) {
    const a = r.cars[i], b = r.cars[j];
    const hit = carContact(a, b);
    if (!hit) continue;
    const { nx, ny, depth } = hit, push = depth / 2;
    a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
    const vn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    const jn = (vn < 0 ? (-(1 + 0.3) * vn) / 2 : 0) + (pass === 0 ? 12 : 0);
    a.vx -= nx * jn; a.vy -= ny * jn; b.vx += nx * jn; b.vy += ny * jn;
    if (pass === 0 && (a.human || b.human) && vn < -15) r.events.push("bump");
    // a shove must never push either car through a barrier
    confine(a, tr, 0, null); confine(b, tr, 0, null);
  }
  if (r.cars.every((c) => c.finishedAt !== null) || r.cars[0].finishedAt !== null && r.t - RACE.COUNTDOWN_MS > r.cars[0].finishedAt + 4000) r.done = true;
}

/**
 * Oriented-box contact between two cars (separating-axis test on both cars' forward and sideways axes), with CAR_GAP of
 * clearance. Returns the unit normal from a to b and how far they must separate, or null when the boxes are apart.
 */
export function carContact(a: Car, b: Car): { nx: number; ny: number; depth: number } | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  const HL = RACE.CAR_HL + RACE.CAR_GAP / 2, HW = RACE.CAR_HW + RACE.CAR_GAP / 2;
  const reach = 2 * Math.hypot(HL, HW);
  if (dx * dx + dy * dy >= reach * reach) return null;
  const fa = [Math.cos(a.angle), Math.sin(a.angle)], fb = [Math.cos(b.angle), Math.sin(b.angle)];
  const axes = [fa, [-fa[1], fa[0]], fb, [-fb[1], fb[0]]];
  const ext = (f: number[], lx: number, ly: number) => HL * Math.abs(f[0] * lx + f[1] * ly) + HW * Math.abs(-f[1] * lx + f[0] * ly);
  let best = Infinity, nx = 0, ny = 0;
  for (const [lx, ly] of axes) {
    const d = dx * lx + dy * ly;
    const over = ext(fa, lx, ly) + ext(fb, lx, ly) - Math.abs(d);
    if (over <= 0) return null; // a separating axis: no contact
    if (over < best) { best = over; const sg = d < 0 ? -1 : 1; nx = lx * sg; ny = ly * sg; }
  }
  if (dx === 0 && dy === 0) { nx = -fa[1]; ny = fa[0]; } // dead-centre overlap: split them sideways
  return { nx, ny, depth: best };
}

// ------------------------------------------------------------------ scenery geometry (used by the renderer)

export const CLEAR_MAX = 300;
/**
 * Walk outward from centreline sample i along its normal (side -1 left, 1 right) and return the last offset whose ground
 * is still closest to sample i: the medial axis between this stretch of road and every other one. Pure geometry, so it is
 * computed once and exported for the tests.
 */
export function groundClearance(pts: { x: number; y: number }[], nx: ArrayLike<number>, ny: ArrayLike<number>, i: number, side: -1 | 1): number {
  const n = pts.length, px = pts[i].x, py = pts[i].y;
  let ok = 0; // the last offset that was checked and still belongs to sample i
  for (let o = 4; o <= CLEAR_MAX; o += 3) {
    const x = px + nx[i] * side * o, y = py + ny[i] * side * o;
    const lim = (o * 0.96 - 2) ** 2;
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const dx = pts[j].x - x, dy = pts[j].y - y;
      if (dx * dx + dy * dy < lim) return ok;
    }
    ok = o;
  }
  return ok;
}

/** 1-based race position of each car right now (finished cars by finish time, the rest by distance covered). */
export function positions(r: Race): number[] {
  const n = track().pts.length;
  const score = (c: Car) => (c.finishedAt !== null ? 1e9 - c.finishedAt : c.lap * n + (!c.crossed && c.idx > n / 2 ? c.idx - n : c.idx)); // cars still behind the line count as negative progress
  const order = [...r.cars].sort((a, b) => score(b) - score(a));
  return r.cars.map((c) => order.indexOf(c) + 1);
}

export const PODIUM_BEANS = [30, 18, 8, 0];
export const raceBeans = (position: number) => PODIUM_BEANS[position - 1] ?? 0;
export const fmtTime = (ms: number) => (Number.isFinite(ms) ? `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(Math.floor(ms % 1000)).padStart(3, "0")}` : "--:--.---");
