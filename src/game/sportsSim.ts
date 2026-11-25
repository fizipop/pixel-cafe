// A tiny, endless fictional football match for the sports lounge's big screen ("Pixel League"). Pure and seeded (no
// Phaser), so it is cheap to run and easy to test: 5-a-side, two made-up teams, a ball that is dribbled, passed and
// shot, keepers that sometimes save, a scoreboard and a match clock. It never connects to any real broadcast.
import { mulberry32 } from "../shared/arcade.ts";

export const PITCH = { w: 220, h: 110 }; // pitch units (the screen draws it scaled)
export const TEAMS = [
  { name: "BEANS", short: "BNS", kit: "#d9304a", trim: "#fff6e0" },
  { name: "LATTES", short: "LAT", kit: "#3a8bff", trim: "#f2c36b" },
] as const;

export type SportsPlayer = { team: 0 | 1; x: number; y: number; hx: number; hy: number; keeper: boolean };
export type SportsEvent = { kind: "goal" | "save" | "shot" | "kickoff" | "halftime" | "fulltime"; team: 0 | 1; at: number };
export type SportsState = {
  t: number; // match seconds (90 minutes = 5400)
  score: [number, number];
  ball: { x: number; y: number; vx: number; vy: number };
  owner: number; // index into players, -1 = loose
  players: SportsPlayer[];
  event: SportsEvent | null; // the latest event (banner on screen)
  pause: number; // seconds left of a stoppage (after a goal)
  seed: number;
  rng: () => number;
};

/** Each match minute takes this many real seconds on the screen. */
export const SECONDS_PER_MINUTE = 4;

function formation(team: 0 | 1): { hx: number; hy: number; keeper: boolean }[] {
  const side = team === 0 ? 1 : -1, cx = PITCH.w / 2;
  return [
    { hx: cx - side * 100, hy: 55, keeper: true },
    { hx: cx - side * 60, hy: 30, keeper: false },
    { hx: cx - side * 60, hy: 80, keeper: false },
    { hx: cx - side * 20, hy: 40, keeper: false },
    { hx: cx - side * 20, hy: 70, keeper: false },
  ];
}

export function newMatch(seed = 1): SportsState {
  const players: SportsPlayer[] = [];
  for (const team of [0, 1] as const) for (const f of formation(team)) players.push({ team, x: f.hx, y: f.hy, ...f });
  const s: SportsState = { t: 0, score: [0, 0], ball: { x: PITCH.w / 2, y: PITCH.h / 2, vx: 0, vy: 0 }, owner: -1, players, event: { kind: "kickoff", team: 0, at: 0 }, pause: 1.5, seed, rng: mulberry32(seed) };
  return s;
}

function resetKickoff(s: SportsState, team: 0 | 1) {
  s.ball = { x: PITCH.w / 2, y: PITCH.h / 2, vx: 0, vy: 0 };
  s.owner = -1;
  for (const p of s.players) { p.x = p.hx; p.y = p.hy; }
  s.pause = 2.5;
  s.event = { kind: "kickoff", team, at: s.t };
}

const goalX = (team: 0 | 1) => (team === 0 ? PITCH.w : 0); // the goal each team attacks

/** Advance the match by `dt` real seconds. */
export function stepMatch(s: SportsState, dt: number) {
  const rng = s.rng;
  s.t += (dt * 60) / SECONDS_PER_MINUTE;
  if (s.t >= 5400) { // full time: a new match starts after a short break
    if (s.event?.kind !== "fulltime") { s.event = { kind: "fulltime", team: s.score[0] >= s.score[1] ? 0 : 1, at: s.t }; s.pause = 6; }
    s.pause -= dt;
    if (s.pause <= 0) { const n = newMatch(Math.floor(rng() * 1e9)); Object.assign(s, { ...n, rng: s.rng }); }
    return;
  }
  if (s.t >= 2700 && s.t - (dt * 60) / SECONDS_PER_MINUTE < 2700) { s.event = { kind: "halftime", team: 0, at: s.t }; resetKickoff(s, 1); s.event = { kind: "halftime", team: 0, at: s.t }; s.pause = 3; }
  if (s.pause > 0) { s.pause -= dt; return; }
  const b = s.ball;
  // players: move toward a target (the ball for the nearest two of each team, home position + drift for the rest)
  const dist = (p: SportsPlayer) => Math.hypot(p.x - b.x, p.y - b.y);
  for (const team of [0, 1] as const) {
    const mates = s.players.map((p, i) => ({ p, i })).filter((q) => q.p.team === team && !q.p.keeper).sort((a, c) => dist(a.p) - dist(c.p));
    mates.forEach(({ p }, k) => {
      const chase = k < 2;
      const attack = (b.x - PITCH.w / 2) * (team === 0 ? 1 : -1) * 0.25;
      const tx = chase ? b.x : p.hx + attack * (team === 0 ? 1 : -1) + (b.x - PITCH.w / 2) * 0.35;
      const ty = chase ? b.y : p.hy + (b.y - PITCH.h / 2) * 0.3;
      const d = Math.hypot(tx - p.x, ty - p.y) || 1, sp = (chase ? 34 : 22) * dt;
      p.x += ((tx - p.x) / d) * Math.min(sp, d); p.y += ((ty - p.y) / d) * Math.min(sp, d);
    });
  }
  for (const p of s.players.filter((q) => q.keeper)) { // keepers track the ball along their line
    const ty = Math.max(38, Math.min(72, b.y));
    p.y += Math.sign(ty - p.y) * Math.min(Math.abs(ty - p.y), 26 * dt);
  }
  // possession
  if (s.owner >= 0) {
    const o = s.players[s.owner];
    const gx = goalX(o.team);
    const toGoal = Math.abs(gx - o.x);
    // dribble toward goal
    const dx = gx - o.x, dy = PITCH.h / 2 - o.y, d = Math.hypot(dx, dy) || 1;
    o.x += (dx / d) * 30 * dt; o.y += (dy / d) * 12 * dt + (rng() - 0.5) * 10 * dt;
    b.x = o.x + (o.team === 0 ? 3 : -3); b.y = o.y + 1; b.vx = 0; b.vy = 0;
    const r = rng();
    if (toGoal < 60 && r < 1.4 * dt) { // shoot
      const aimY = PITCH.h / 2 + (rng() - 0.5) * 26;
      const sp = 150;
      const ex = gx - b.x, ey = aimY - b.y, el = Math.hypot(ex, ey) || 1;
      b.vx = (ex / el) * sp; b.vy = (ey / el) * sp;
      s.owner = -1;
      s.event = { kind: "shot", team: o.team, at: s.t };
    } else if (r < (toGoal < 60 ? 2.2 : 1.1) * dt) { // pass to a team-mate ahead
      const mates = s.players.map((p, i) => ({ p, i })).filter((q) => q.p.team === o.team && q.i !== s.owner && !q.p.keeper);
      const t = mates[Math.floor(rng() * mates.length)];
      const ex = t.p.x - b.x, ey = t.p.y - b.y, el = Math.hypot(ex, ey) || 1;
      b.vx = (ex / el) * 95; b.vy = (ey / el) * 95;
      s.owner = -1;
    }
  } else {
    b.x += b.vx * dt; b.y += b.vy * dt;
    const f = Math.pow(0.35, dt); b.vx *= f; b.vy *= f;
    if (b.y < 2 || b.y > PITCH.h - 2) { b.vy = -b.vy; b.y = Math.max(2, Math.min(PITCH.h - 2, b.y)); }
    // into a goal mouth?
    for (const team of [0, 1] as const) {
      const gx = goalX(team);
      if ((team === 0 ? b.x >= PITCH.w - 1 : b.x <= 1)) {
        if (Math.abs(b.y - PITCH.h / 2) < 14) {
          const keeper = s.players.find((p) => p.keeper && p.team !== team)!;
          if (Math.abs(keeper.y - b.y) < 7 && rng() < 0.55) { // a save
            s.event = { kind: "save", team: keeper.team, at: s.t };
            b.vx = -b.vx * 0.5; b.x = gx + (team === 0 ? -4 : 4);
          } else {
            s.score[team]++;
            s.event = { kind: "goal", team, at: s.t };
            resetKickoff(s, team === 0 ? 1 : 0);
            s.event = { kind: "goal", team, at: s.t };
          }
        } else { b.vx = -b.vx * 0.6; b.x = team === 0 ? PITCH.w - 2 : 2; }
      }
    }
    // the nearest player within reach takes it
    let best = -1, bd = 4;
    s.players.forEach((p, i) => { const d = Math.hypot(p.x - b.x, p.y - b.y); if (d < bd && Math.hypot(b.vx, b.vy) < 120) { bd = d; best = i; } });
    if (best >= 0) s.owner = best;
  }
  // nobody (and no ball) ever leaves the pitch
  for (const p of s.players) { p.x = Math.max(2, Math.min(PITCH.w - 2, p.x)); p.y = Math.max(2, Math.min(PITCH.h - 2, p.y)); }
  b.x = Math.max(0, Math.min(PITCH.w, b.x)); b.y = Math.max(1, Math.min(PITCH.h - 1, b.y));
}

export const clockText = (t: number) => `${String(Math.min(90, Math.floor(t / 60))).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Draw the broadcast into a canvas of size w x h (pitch, players, ball, scoreboard bug, clock and event banner). */
export function drawMatch(c: CanvasRenderingContext2D, s: SportsState, w: number, h: number, frame: number) {
  const top = 14, pw = w - 8, ph = h - top - 4, kx = pw / PITCH.w, ky = ph / PITCH.h, ox = 4, oy = top;
  for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? "#2f8a3a" : "#348f40"; c.fillRect(ox + (i * pw) / 10, oy, pw / 10 + 1, ph); }
  c.strokeStyle = "rgba(255,255,255,0.75)"; c.lineWidth = 1;
  c.strokeRect(ox + 0.5, oy + 0.5, pw - 1, ph - 1);
  c.beginPath(); c.moveTo(ox + pw / 2, oy); c.lineTo(ox + pw / 2, oy + ph); c.stroke();
  c.beginPath(); c.arc(ox + pw / 2, oy + ph / 2, 10, 0, Math.PI * 2); c.stroke();
  c.strokeRect(ox + 0.5, oy + ph / 2 - 18, 18, 36); c.strokeRect(ox + pw - 18.5, oy + ph / 2 - 18, 18, 36);
  c.fillStyle = "#fff6e0"; c.fillRect(ox - 2, oy + ph / 2 - 9, 2, 18); c.fillRect(ox + pw, oy + ph / 2 - 9, 2, 18);
  for (const p of s.players) {
    const x = Math.round(ox + p.x * kx), y = Math.round(oy + p.y * ky);
    c.fillStyle = "rgba(0,0,0,0.3)"; c.fillRect(x - 2, y + 2, 5, 2);
    c.fillStyle = p.keeper ? "#f2c36b" : TEAMS[p.team].kit; c.fillRect(x - 2, y - 4, 5, 5);
    c.fillStyle = TEAMS[p.team].trim; c.fillRect(x - 2, y - 4, 5, 1);
    c.fillStyle = "#f1c27d"; c.fillRect(x - 1, y - 6, 3, 2);
    c.fillStyle = "#1f140d"; c.fillRect(x - 2, y + 1, 2, 2); c.fillRect(x + 1, y + 1, 2, 2);
  }
  const bx = Math.round(ox + s.ball.x * kx), by = Math.round(oy + s.ball.y * ky);
  c.fillStyle = "#ffffff"; c.fillRect(bx - 1, by - 1, 3, 3); c.fillStyle = "#1f140d"; c.fillRect(bx, by, 1, 1);
  // scoreboard bug + clock
  c.fillStyle = "#05030c"; c.fillRect(0, 0, w, top);
  c.font = "bold 10px monospace"; c.textBaseline = "middle"; c.textAlign = "left";
  c.fillStyle = TEAMS[0].kit; c.fillRect(4, 3, 4, 8); c.fillStyle = "#fff6e0"; c.fillText(`${TEAMS[0].short} ${s.score[0]}`, 11, 7);
  c.fillStyle = TEAMS[1].kit; c.fillRect(62, 3, 4, 8); c.fillStyle = "#fff6e0"; c.fillText(`${s.score[1]} ${TEAMS[1].short}`, 69, 7);
  c.textAlign = "right"; c.fillStyle = "#f2c36b"; c.fillText(clockText(s.t), w - 30, 7);
  if (frame % 40 < 28) { c.fillStyle = "#ff3b3b"; c.fillRect(w - 24, 4, 5, 5); c.fillStyle = "#fff6e0"; c.textAlign = "left"; c.fillText("LIVE", w - 17, 7); }
  // event banner
  const e = s.event;
  if (e && s.t - e.at < 240 && e.kind !== "shot") {
    const text = e.kind === "goal" ? `GOAL! ${TEAMS[e.team].name}` : e.kind === "save" ? "WHAT A SAVE!" : e.kind === "halftime" ? `HALF TIME ${s.score[0]}-${s.score[1]}` : e.kind === "fulltime" ? `FULL TIME ${s.score[0]}-${s.score[1]}` : "KICK OFF";
    c.fillStyle = "rgba(5,3,12,0.75)"; c.fillRect(w / 2 - 70, h / 2 - 10, 140, 20);
    c.fillStyle = e.kind === "goal" && frame % 10 < 5 ? "#ffe080" : "#fff6e0"; c.textAlign = "center"; c.font = "bold 12px monospace"; c.fillText(text, w / 2, h / 2);
  }
}
