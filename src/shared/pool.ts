// 8-Ball Pool: a small deterministic physics engine plus the rules. Pure (no randomness, no DOM), so the
// server runs the real shot, the browser replays the very same shot to animate it, and both land on
// exactly the same final positions. Table units are pixels, y points down.
//
// Simplified rules: break; the table is open until someone pockets a ball (that decides solids/stripes);
// pocket one of your own to keep shooting; a foul (scratch, wrong ball first, nothing pocketed and no
// rail hit) gives the other player the turn with the cue ball back on the head spot; the 8 wins only
// after your group is cleared, and loses if pocketed early.

export const POOL = {
  W: 800, H: 400, R: 10,
  CORNER_R: 24, SIDE_R: 20, // how close a ball centre must get to a pocket to drop
  VMAX: 1300, // cue ball speed at full power (px/s)
  DECEL: 280, // table friction (px/s^2)
  RAIL: 0.85, // energy kept on a cushion bounce
  BALL: 0.96, // energy kept in a ball-ball collision
  DT: 1 / 240,
  MAX_STEPS: 9000, // ~37 s of table time: far more than any shot needs
  STOP: 6, // below this speed (px/s) a ball stops
} as const;

export type PoolBall = { id: number; x: number; y: number; vx: number; vy: number; out: boolean };
export type PoolGroup = "solid" | "stripe";
export const groupOf = (id: number): PoolGroup | null => (id >= 1 && id <= 7 ? "solid" : id >= 9 && id <= 15 ? "stripe" : null);

export const POCKETS: { x: number; y: number; r: number }[] = [
  { x: 0, y: 0, r: POOL.CORNER_R }, { x: POOL.W / 2, y: 0, r: POOL.SIDE_R }, { x: POOL.W, y: 0, r: POOL.CORNER_R },
  { x: 0, y: POOL.H, r: POOL.CORNER_R }, { x: POOL.W / 2, y: POOL.H, r: POOL.SIDE_R }, { x: POOL.W, y: POOL.H, r: POOL.CORNER_R },
];
export const HEAD_SPOT = { x: POOL.W * 0.25, y: POOL.H / 2 };
export const FOOT_SPOT = { x: POOL.W * 0.72, y: POOL.H / 2 };

const RACK: number[][] = [[1], [9, 2], [3, 8, 10], [11, 4, 12, 5], [6, 13, 7, 14, 15]];

export function rackBalls(): PoolBall[] {
  const balls: PoolBall[] = [{ id: 0, x: HEAD_SPOT.x, y: HEAD_SPOT.y, vx: 0, vy: 0, out: false }];
  const dx = POOL.R * 2 * Math.cos(Math.PI / 6) + 0.2;
  RACK.forEach((row, r) => row.forEach((id, i) => {
    balls.push({ id, x: FOOT_SPOT.x + r * dx, y: FOOT_SPOT.y + (i - (row.length - 1) / 2) * (POOL.R * 2 + 0.2), vx: 0, vy: 0, out: false });
  }));
  return balls;
}

export type ShotEvents = { firstHit: number | null; pocketed: number[]; railAfterContact: boolean };

/** One shot in progress. `step()` advances a fixed 1/240 s; keep calling until `done`. */
export class PoolSim {
  balls: PoolBall[];
  events: ShotEvents = { firstHit: null, pocketed: [], railAfterContact: false };
  steps = 0;

  constructor(balls: PoolBall[], angle: number, power: number) {
    this.balls = balls.map((b) => ({ ...b, vx: 0, vy: 0 }));
    const cue = this.balls[0];
    const p = Math.min(1, Math.max(0.03, power));
    cue.vx = Math.cos(angle) * POOL.VMAX * p;
    cue.vy = Math.sin(angle) * POOL.VMAX * p;
  }

  get done() {
    return this.steps >= POOL.MAX_STEPS || this.balls.every((b) => b.out || (b.vx === 0 && b.vy === 0));
  }

  step() {
    this.steps++;
    const { DT, R, W, H } = POOL;
    const live = this.balls.filter((b) => !b.out);
    for (const b of live) {
      b.x += b.vx * DT;
      b.y += b.vy * DT;
    }
    // pockets first, so a ball rolling into a corner drops instead of bouncing off the cushions
    for (const b of live) {
      if (POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < p.r)) {
        b.out = true; b.vx = 0; b.vy = 0;
        this.events.pocketed.push(b.id);
      }
    }
    const rail = (b: PoolBall) => { if (this.events.firstHit !== null) this.events.railAfterContact = true; void b; };
    for (const b of live) {
      if (b.out) continue;
      if (b.x < R) { b.x = R; b.vx = Math.abs(b.vx) * POOL.RAIL; rail(b); }
      else if (b.x > W - R) { b.x = W - R; b.vx = -Math.abs(b.vx) * POOL.RAIL; rail(b); }
      if (b.y < R) { b.y = R; b.vy = Math.abs(b.vy) * POOL.RAIL; rail(b); }
      else if (b.y > H - R) { b.y = H - R; b.vy = -Math.abs(b.vy) * POOL.RAIL; rail(b); }
    }
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.out || b.out) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= 4 * R * R || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const nx = dx / d, ny = dy / d;
        const push = (2 * R - d) / 2;
        a.x -= nx * push; a.y -= ny * push; b.x += nx * push; b.y += ny * push;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) { // moving together: swap the normal components (equal masses)
          const j2 = (-(1 + POOL.BALL) * rv) / 2;
          a.vx -= j2 * nx; a.vy -= j2 * ny; b.vx += j2 * nx; b.vy += j2 * ny;
          if (this.events.firstHit === null && (a.id === 0 || b.id === 0)) this.events.firstHit = a.id === 0 ? b.id : a.id;
        }
      }
    }
    for (const b of live) {
      if (b.out) continue;
      const v = Math.hypot(b.vx, b.vy);
      if (v === 0) continue;
      const nv = v - POOL.DECEL * DT;
      if (nv <= POOL.STOP) { b.vx = 0; b.vy = 0; } else { b.vx *= nv / v; b.vy *= nv / v; }
    }
  }

  run() {
    while (!this.done) this.step();
    return this;
  }
}

// ------------------------------------------------------------------ rules

export type PoolGame = {
  balls: PoolBall[];
  turn: 0 | 1;
  groups: [PoolGroup | null, PoolGroup | null];
  breaking: boolean;
};
export const newPoolGame = (turn: 0 | 1 = 0): PoolGame => ({ balls: rackBalls(), turn, groups: [null, null], breaking: true });

export type ShotOutcome = {
  game: PoolGame; // the table after the shot
  foul: string | null;
  pocketed: number[];
  winner: 0 | 1 | null;
  reason: string;
};

/** Balls of `group` still on the table. */
export const remaining = (balls: PoolBall[], group: PoolGroup) => balls.filter((b) => !b.out && groupOf(b.id) === group);

/** Which balls the shooter may hit first right now (ids), given the table before the shot. */
export function legalTargets(g: PoolGame): number[] {
  const mine = g.groups[g.turn];
  const onTable = g.balls.filter((b) => !b.out && b.id !== 0);
  if (!mine) return onTable.filter((b) => b.id !== 8).map((b) => b.id);
  if (remaining(g.balls, mine).length === 0) return onTable.some((b) => b.id === 8) ? [8] : [];
  return onTable.filter((b) => groupOf(b.id) === mine).map((b) => b.id);
}

/** Free spot near the head spot for the cue ball after a scratch or foul. */
export function respotCue(balls: PoolBall[]): { x: number; y: number } {
  const free = (x: number, y: number) => balls.every((b) => b.out || b.id === 0 || Math.hypot(b.x - x, b.y - y) >= POOL.R * 2 + 1);
  for (let k = 0; k < 40; k++) {
    for (const s of k === 0 ? [0] : [1, -1]) {
      const y = HEAD_SPOT.y + s * k * (POOL.R * 2 + 2);
      if (y > POOL.R && y < POOL.H - POOL.R && free(HEAD_SPOT.x, y)) return { x: HEAD_SPOT.x, y };
    }
  }
  return { ...HEAD_SPOT };
}

export function applyShot(pre: PoolGame, sim: PoolSim): ShotOutcome {
  const ev = sim.events;
  const me = pre.turn;
  const opp: 0 | 1 = me === 0 ? 1 : 0;
  const targets = legalTargets(pre);
  const balls = sim.balls.map((b) => ({ ...b }));
  const groups: PoolGame["groups"] = [pre.groups[0], pre.groups[1]];
  const scratch = ev.pocketed.includes(0);
  const eight = ev.pocketed.includes(8);

  let foul: string | null = null;
  if (scratch) foul = "Scratch! The cue ball dropped.";
  else if (ev.firstHit === null) foul = "Foul: the cue ball hit nothing.";
  else if (!targets.includes(ev.firstHit)) foul = ev.firstHit === 8 ? "Foul: you hit the 8-ball too early." : "Foul: you hit the wrong ball first.";
  else if (ev.pocketed.filter((id) => id !== 0).length === 0 && !ev.railAfterContact) foul = "Foul: no ball reached a rail.";

  const dropped = ev.pocketed.filter((id) => id !== 0 && id !== 8);
  // a pocketed 8: win only if it was the legal last ball
  let winner: 0 | 1 | null = null;
  let reason = "";
  if (eight) {
    if (pre.breaking) {
      const b8 = balls.find((b) => b.id === 8)!;
      b8.out = false; b8.x = FOOT_SPOT.x + 2 * (POOL.R * 2 * Math.cos(Math.PI / 6) + 0.2); b8.y = FOOT_SPOT.y; // spotted again
    } else if (!foul && targets.length === 1 && targets[0] === 8) { winner = me; reason = "Sank the 8-ball to win!"; }
    else { winner = opp; reason = scratch ? "Pocketed the 8-ball with a scratch." : "Pocketed the 8-ball too early."; }
  }
  // the table is open until a ball drops on a legal shot
  if (!groups[me] && !foul && dropped.length) {
    const g = groupOf(dropped[0])!;
    groups[me] = g;
    groups[opp] = g === "solid" ? "stripe" : "solid";
  }
  const mineNow = groups[me];
  const keepsTurn = !foul && !winner && dropped.some((id) => (mineNow ? groupOf(id) === mineNow : true));
  const cue = balls[0];
  if (scratch || foul) { cue.out = false; Object.assign(cue, respotCue(balls), { vx: 0, vy: 0 }); }

  const next: PoolGame = { balls, turn: keepsTurn ? me : opp, groups, breaking: false };
  return { game: next, foul, pocketed: ev.pocketed, winner, reason };
}

/** Run a whole shot and apply the rules (what the server does). */
export function playShot(pre: PoolGame, angle: number, power: number): ShotOutcome {
  return applyShot(pre, new PoolSim(pre.balls, angle, power).run());
}

// ------------------------------------------------------------------ the computer opponent

const norm = (n: number) => Math.atan2(Math.sin(n), Math.cos(n));

/** Pick a shot by trying aimed candidates through the real physics. `skill` 0..1 shrinks the random wobble. */
export function chooseShot(g: PoolGame, rng: () => number, skill = 0.7): { angle: number; power: number } {
  const cue = g.balls[0];
  const targets = legalTargets(g);
  type Cand = { angle: number; power: number; score: number };
  const cands: { angle: number; power: number }[] = [];
  for (const id of targets) {
    const t = g.balls.find((b) => b.id === id)!;
    for (const p of POCKETS) {
      const dx = p.x - t.x, dy = p.y - t.y, d = Math.hypot(dx, dy);
      const gx = t.x - (dx / d) * POOL.R * 2, gy = t.y - (dy / d) * POOL.R * 2; // where the cue ball must be to send t at the pocket
      const angle = Math.atan2(gy - cue.y, gx - cue.x);
      const cut = Math.abs(norm(angle - Math.atan2(t.y - cue.y, t.x - cue.x)));
      if (cut > 1.2) continue;
      const dist = Math.hypot(gx - cue.x, gy - cue.y) + d;
      for (const power of [Math.min(1, 0.3 + dist / 1400), Math.min(1, 0.5 + dist / 1100), 0.9]) cands.push({ angle, power });
    }
    cands.push({ angle: Math.atan2(t.y - cue.y, t.x - cue.x), power: 0.45 }); // just hit it
  }
  if (cands.length === 0) cands.push({ angle: rng() * Math.PI * 2, power: 0.5 });
  let best: Cand | null = null;
  for (const c of cands.slice(0, 48)) {
    const o = playShot(g, c.angle, c.power);
    const mine = g.groups[g.turn];
    const own = o.pocketed.filter((id) => id !== 0 && id !== 8 && (!mine || groupOf(id) === mine)).length;
    const score = o.winner === g.turn ? 1000 : o.winner !== null ? -1000 : o.foul ? (o.pocketed.includes(0) ? -200 : -80) : 20 + own * 100 + (o.game.turn === g.turn ? 30 : 0);
    if (!best || score > best.score) best = { ...c, score };
  }
  const wobble = (1 - Math.min(1, Math.max(0, skill))) * 0.05 + 0.004; // radians
  const pick = best as Cand;
  return { angle: pick.angle + (rng() - 0.5) * 2 * wobble, power: Math.min(1, Math.max(0.1, pick.power + (rng() - 0.5) * 0.08)) };
}
