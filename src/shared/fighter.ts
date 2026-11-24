// Pixel Fighter II: the whole fight as plain data plus a pure `stepMatch`. The server runs it at 60
// steps a second (for the CPU ladder and live 1v1) and streams snapshots; the browser only draws them.
// No DOM, no wall clock, no hidden randomness (the CPU's choices use the rng you pass in).

export const FIGHT = {
  W: 320, GROUND: 0, MIN_X: 18, MAX_X: 302, GRAVITY: 0.46, TOUCH: 20, // fighters closer than this push apart
  ROUND_FRAMES: 60 * 60, INTRO: 100, KO_PAUSE: 130, ROUNDS_TO_WIN: 2,
} as const;

export const BTN = { LEFT: 1, RIGHT: 2, UP: 4, BLOCK: 8, LIGHT: 16, HEAVY: 32, SPECIAL: 64 } as const;
export type Buttons = number;

type Move = { dmg: number; startup: number; active: number; recover: number; reach: number; stun: number; knock: number };
export type CharDef = {
  id: string; name: string; blurb: string; hp: number; speed: number; jump: number;
  light: Move; heavy: Move;
  special: { kind: "projectile" | "dash"; dmg: number; cooldown: number; speed: number; name: string };
  colors: { skin: string; suit: string; trim: string; hair: string };
};

export const CHARACTERS: CharDef[] = [
  {
    id: "karate", name: "Ryo", blurb: "Karate Fighter: balanced, throws a fireball.", hp: 100, speed: 1.7, jump: 7.6,
    light: { dmg: 5, startup: 4, active: 3, recover: 8, reach: 28, stun: 12, knock: 1.5 },
    heavy: { dmg: 12, startup: 9, active: 4, recover: 17, reach: 34, stun: 20, knock: 4 },
    special: { kind: "projectile", dmg: 9, cooldown: 110, speed: 4.2, name: "Fireball" },
    colors: { skin: "#f1c27d", suit: "#f4f4f4", trim: "#d9304a", hair: "#2a1a10" },
  },
  {
    id: "kickboxer", name: "Kaito", blurb: "Kickboxer: fast feet, rushes in with a flying kick.", hp: 95, speed: 2.1, jump: 7.8,
    light: { dmg: 4, startup: 3, active: 3, recover: 7, reach: 30, stun: 11, knock: 1.2 },
    heavy: { dmg: 11, startup: 8, active: 4, recover: 15, reach: 38, stun: 18, knock: 4 },
    special: { kind: "dash", dmg: 10, cooldown: 130, speed: 5.2, name: "Flying Kick" },
    colors: { skin: "#8a6446", suit: "#3a5fd9", trim: "#f2c36b", hair: "#1a1a1a" },
  },
  {
    id: "ninja", name: "Shade", blurb: "Shadow Ninja: quick and tricky, throws shuriken.", hp: 90, speed: 2.2, jump: 8.4,
    light: { dmg: 4, startup: 3, active: 3, recover: 7, reach: 26, stun: 11, knock: 1.2 },
    heavy: { dmg: 10, startup: 8, active: 4, recover: 14, reach: 32, stun: 17, knock: 3.5 },
    special: { kind: "projectile", dmg: 7, cooldown: 70, speed: 6.4, name: "Shuriken" },
    colors: { skin: "#d9b48a", suit: "#2a2140", trim: "#9b5de5", hair: "#05030c" },
  },
  {
    id: "brawler", name: "Brick", blurb: "Heavy Brawler: slow but hits like a truck.", hp: 125, speed: 1.2, jump: 6.6,
    light: { dmg: 7, startup: 6, active: 3, recover: 11, reach: 30, stun: 14, knock: 2.5 },
    heavy: { dmg: 17, startup: 12, active: 5, recover: 22, reach: 36, stun: 24, knock: 6 },
    special: { kind: "projectile", dmg: 12, cooldown: 150, speed: 2.8, name: "Shockwave" },
    colors: { skin: "#e0a27a", suit: "#d9622b", trim: "#3a2a1c", hair: "#7a4a26" },
  },
];

export type FState = "idle" | "walk" | "jump" | "block" | "light" | "heavy" | "special" | "hit" | "ko" | "win";
export type Fighter = {
  c: number; // index into CHARACTERS
  x: number; y: number; vx: number; vy: number; // y is height above the ground
  face: 1 | -1;
  hp: number;
  state: FState; t: number; hitDone: boolean; stun: number; cd: number;
  prev: Buttons;
};
export type Shot = { x: number; y: number; vx: number; owner: 0 | 1; dmg: number; kind: string };
export type FightEvent = { k: "hit" | "block" | "ko" | "fire" | "swing" | "round"; x: number; y: number; heavy?: boolean; who?: 0 | 1 };
export type FightPhase = "intro" | "fight" | "ko" | "over";
export type FightMatch = {
  f: [Fighter, Fighter];
  shots: Shot[];
  frames: number; // left in the round
  round: number;
  wins: [number, number];
  phase: FightPhase;
  pt: number; // frames in this phase
  winner: 0 | 1 | null; // set when phase is "over"
  roundWinner: 0 | 1 | -1 | null;
  ev: FightEvent[]; // events since the last snapshot was sent
};

const fresh = (c: number, x: number, face: 1 | -1): Fighter => ({
  c, x, y: 0, vx: 0, vy: 0, face, hp: CHARACTERS[c].hp, state: "idle", t: 0, hitDone: false, stun: 0, cd: 0, prev: 0,
});

export function newMatch(c0: number, c1: number): FightMatch {
  return {
    f: [fresh(c0, 90, 1), fresh(c1, 230, -1)], shots: [], frames: FIGHT.ROUND_FRAMES, round: 1, wins: [0, 0],
    phase: "intro", pt: 0, winner: null, roundWinner: null, ev: [],
  };
}

const grounded = (f: Fighter) => f.y <= 0;
const busy = (f: Fighter) => f.state === "light" || f.state === "heavy" || f.state === "special" || f.state === "hit" || f.state === "ko" || f.state === "win";
const moveOf = (f: Fighter, s: "light" | "heavy") => CHARACTERS[f.c][s];

function hurt(m: FightMatch, victim: 0 | 1, attacker: 0 | 1 | null, dmg: number, stun: number, knock: number, heavy: boolean, from: number) {
  const v = m.f[victim];
  const blocking = v.state === "block" && grounded(v) && Math.sign(from - v.x) === v.face;
  const dir = Math.sign(v.x - from) || -v.face;
  if (blocking) {
    v.hp -= Math.max(1, Math.round(dmg * 0.12));
    v.vx = dir * knock * 0.5;
    m.ev.push({ k: "block", x: v.x, y: v.y + 22, heavy });
  } else {
    v.hp -= dmg;
    v.state = "hit"; v.t = 0; v.stun = stun; v.vx = dir * knock; v.hitDone = false;
    m.ev.push({ k: "hit", x: v.x, y: v.y + 24, heavy });
  }
  if (v.hp <= 0) {
    v.hp = 0; v.state = "ko"; v.t = 0; v.vx = dir * 3; v.vy = 4;
    m.ev.push({ k: "ko", x: v.x, y: v.y + 20, who: victim });
  }
  void attacker;
}

function control(m: FightMatch, i: 0 | 1, b: Buttons) {
  const f = m.f[i];
  const ch = CHARACTERS[f.c];
  const press = b & ~f.prev; // buttons that went down this frame
  f.prev = b;
  if (busy(f)) return;
  const air = !grounded(f);
  if (!air && b & BTN.BLOCK) { f.state = "block"; f.vx = 0; return; }
  if (press & BTN.SPECIAL && f.cd <= 0) {
    f.state = "special"; f.t = 0; f.hitDone = false; f.cd = ch.special.cooldown;
    m.ev.push({ k: "swing", x: f.x, y: f.y + 24, who: i });
    return;
  }
  if (press & BTN.HEAVY) { f.state = "heavy"; f.t = 0; f.hitDone = false; if (!air) f.vx = 0; m.ev.push({ k: "swing", x: f.x, y: f.y + 24, heavy: true, who: i }); return; }
  if (press & BTN.LIGHT) { f.state = "light"; f.t = 0; f.hitDone = false; if (!air) f.vx = 0; m.ev.push({ k: "swing", x: f.x, y: f.y + 24, who: i }); return; }
  const dir = (b & BTN.RIGHT ? 1 : 0) - (b & BTN.LEFT ? 1 : 0);
  if (!air) {
    f.vx = dir * ch.speed;
    f.state = dir ? "walk" : "idle";
    if (b & BTN.UP) { f.vy = ch.jump; f.state = "jump"; f.vx = dir * ch.speed * 1.1; }
  } else f.state = "jump";
}

/** Advance one frame (1/60 s). */
export function stepMatch(m: FightMatch, in0: Buttons, in1: Buttons) {
  m.pt++;
  const [a, b] = m.f;
  if (m.phase === "intro") {
    if (m.pt >= FIGHT.INTRO) { m.phase = "fight"; m.pt = 0; m.ev.push({ k: "round", x: FIGHT.W / 2, y: 60 }); }
    a.prev = in0; b.prev = in1; // so a held button doesn't fire the moment the bell rings
    return;
  }
  if (m.phase === "over") return;
  const live = m.phase === "fight";
  if (live) { control(m, 0, in0); control(m, 1, in1); m.frames--; }

  // movement, gravity, attacks
  for (const i of [0, 1] as const) {
    const f = m.f[i];
    const o = m.f[i === 0 ? 1 : 0];
    const ch = CHARACTERS[f.c];
    f.t++;
    if (f.cd > 0) f.cd--;
    if (f.state === "hit") { f.vx *= 0.88; if (f.t >= f.stun && grounded(f)) { f.state = "idle"; f.vx = 0; } }
    if (f.state === "light" || f.state === "heavy") {
      const mv = moveOf(f, f.state);
      if (!f.hitDone && f.t >= mv.startup && f.t < mv.startup + mv.active) {
        const reach = f.face === 1 ? o.x - f.x : f.x - o.x;
        if (reach > -6 && reach <= mv.reach && Math.abs(o.y - f.y) < 26 && o.state !== "ko") {
          f.hitDone = true;
          hurt(m, i === 0 ? 1 : 0, i, mv.dmg, mv.stun, mv.knock, f.state === "heavy", f.x);
        }
      }
      if (f.t >= mv.startup + mv.active + mv.recover) { f.state = grounded(f) ? "idle" : "jump"; f.vx = 0; }
    }
    if (f.state === "special") {
      const sp = ch.special;
      if (sp.kind === "projectile") {
        if (f.t === 9) m.shots.push({ x: f.x + f.face * 18, y: f.y + 24, vx: f.face * sp.speed, owner: i, dmg: sp.dmg, kind: ch.id });
        if (f.t >= 26) { f.state = "idle"; f.vx = 0; }
      } else {
        if (f.t >= 4 && f.t < 22) f.vx = f.face * sp.speed;
        const reach = f.face === 1 ? o.x - f.x : f.x - o.x;
        if (!f.hitDone && f.t >= 4 && f.t < 22 && reach > -6 && reach <= 26 && Math.abs(o.y - f.y) < 40 && o.state !== "ko") {
          f.hitDone = true;
          hurt(m, i === 0 ? 1 : 0, i, sp.dmg, 22, 5, true, f.x);
        }
        if (f.t >= 34) { f.state = "idle"; f.vx = 0; }
      }
    }
    f.x += f.vx;
    if (!grounded(f) || f.vy > 0) {
      f.y += f.vy;
      f.vy -= FIGHT.GRAVITY;
      if (f.y <= 0) {
        f.y = 0; f.vy = 0;
        if (f.state === "jump") { f.state = "idle"; f.vx = 0; }
        if (f.state === "ko") f.vx = 0;
      }
    }
    if (f.state === "ko") f.vx *= 0.9;
    f.x = Math.min(FIGHT.MAX_X, Math.max(FIGHT.MIN_X, f.x));
  }
  // push apart (no standing inside each other)
  const gap = b.x - a.x;
  if (Math.abs(gap) < FIGHT.TOUCH && grounded(a) && grounded(b)) {
    const push = (FIGHT.TOUCH - Math.abs(gap)) / 2;
    const s = gap >= 0 ? 1 : -1;
    a.x = Math.min(FIGHT.MAX_X, Math.max(FIGHT.MIN_X, a.x - s * push));
    b.x = Math.min(FIGHT.MAX_X, Math.max(FIGHT.MIN_X, b.x + s * push));
  }
  // face each other when free to
  for (const i of [0, 1] as const) {
    const f = m.f[i], o = m.f[i === 0 ? 1 : 0];
    if (!busy(f) && grounded(f) && f.x !== o.x) f.face = o.x > f.x ? 1 : -1;
  }
  // projectiles
  m.shots = m.shots.filter((s) => {
    s.x += s.vx;
    const victim = m.f[s.owner === 0 ? 1 : 0];
    if (Math.abs(s.x - victim.x) < 14 && Math.abs(s.y - (victim.y + 24)) < 20 && victim.state !== "ko") {
      hurt(m, s.owner === 0 ? 1 : 0, s.owner, s.dmg, 16, 3, false, s.x - Math.sign(s.vx) * 8);
      return false;
    }
    return s.x > -20 && s.x < FIGHT.W + 20;
  });

  if (live) {
    const dead = a.state === "ko" || b.state === "ko";
    if (dead || m.frames <= 0) endRound(m);
  } else if (m.phase === "ko" && m.pt >= FIGHT.KO_PAUSE) nextRound(m);
}

function endRound(m: FightMatch) {
  const [a, b] = m.f;
  const pa = a.hp / CHARACTERS[a.c].hp, pb = b.hp / CHARACTERS[b.c].hp;
  m.roundWinner = pa === pb ? -1 : pa > pb ? 0 : 1;
  if (m.roundWinner === -1) { m.wins[0]++; m.wins[1]++; } else m.wins[m.roundWinner]++;
  m.phase = "ko"; m.pt = 0;
  for (const i of [0, 1] as const) if (m.roundWinner === i && m.f[i].state !== "ko") { m.f[i].state = "win"; m.f[i].vx = 0; }
  if (m.wins[0] >= FIGHT.ROUNDS_TO_WIN || m.wins[1] >= FIGHT.ROUNDS_TO_WIN) {
    m.winner = m.wins[0] === m.wins[1] ? (pa >= pb ? 0 : 1) : m.wins[0] > m.wins[1] ? 0 : 1;
  }
}

function nextRound(m: FightMatch) {
  if (m.winner !== null) { m.phase = "over"; m.pt = 0; return; }
  m.round++;
  m.f = [fresh(m.f[0].c, 90, 1), fresh(m.f[1].c, 230, -1)];
  m.shots = []; m.frames = FIGHT.ROUND_FRAMES; m.phase = "intro"; m.pt = 0; m.roundWinner = null;
}

// ------------------------------------------------------------------ CPU opponent

export type Brain = { until: number; bits: Buttons };
export const newBrain = (): Brain => ({ until: 0, bits: 0 });

/** The CPU's buttons for this frame. It re-decides every few frames; `level` (0..1) is how sharp it is. */
export function cpuButtons(m: FightMatch, me: 0 | 1, brain: Brain, level: number, rng: () => number): Buttons {
  const f = m.f[me], o = m.f[me === 0 ? 1 : 0];
  if (m.phase !== "fight") return 0;
  if (m.pt < brain.until && !(brain.bits & (BTN.LIGHT | BTN.HEAVY | BTN.SPECIAL))) return brain.bits;
  const dist = Math.abs(o.x - f.x);
  const toward = o.x > f.x ? BTN.RIGHT : BTN.LEFT;
  const away = toward === BTN.RIGHT ? BTN.LEFT : BTN.RIGHT;
  const reach = CHARACTERS[f.c].heavy.reach;
  let bits: Buttons = 0;
  const react = rng() < 0.35 + level * 0.6;
  const threat = (o.state === "light" || o.state === "heavy") && dist < 60 || m.shots.some((s) => s.owner !== me && Math.abs(s.x - f.x) < 70);
  if (threat && react) bits = rng() < 0.7 ? BTN.BLOCK : BTN.UP | away;
  else if (dist > reach + 4) {
    bits = toward;
    if (dist > 120 && f.cd <= 0 && rng() < 0.12 + level * 0.1) bits = BTN.SPECIAL;
    else if (rng() < 0.04) bits |= BTN.UP;
  } else if (!busy(o) || o.state === "hit") bits = rng() < 0.55 ? BTN.LIGHT : rng() < 0.6 ? BTN.HEAVY : toward;
  else bits = rng() < 0.4 ? away : BTN.BLOCK;
  brain.bits = bits;
  brain.until = m.pt + 5 + Math.floor(rng() * (14 - level * 8));
  return bits;
}

/** The CPU ladder: stage 0..N-1, each a different fighter and a bit sharper. */
export const LADDER = [
  { char: 1, level: 0.2 }, { char: 2, level: 0.4 }, { char: 3, level: 0.6 }, { char: 0, level: 0.8 }, { char: 2, level: 0.95 },
];
export const ladderBeans = (stage: number) => 6 + stage * 4; // for beating that stage
