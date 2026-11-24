"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BTN, CHARACTERS, FIGHT, LADDER, type CharDef, type Fighter as Fgt, type FightEvent, type FightMatch } from "@/shared/fighter";
import type { FighterView } from "@/shared/protocol";
import { ArcadeFrame, type ArcadeProps } from "./ui";

const W = 320;
const H = 180;
const FLOOR = 152; // canvas y of the ground

const KEYS: Record<string, number> = {
  KeyA: BTN.LEFT, ArrowLeft: BTN.LEFT, KeyD: BTN.RIGHT, ArrowRight: BTN.RIGHT, KeyW: BTN.UP, ArrowUp: BTN.UP, KeyS: BTN.BLOCK, ArrowDown: BTN.BLOCK,
  KeyJ: BTN.LIGHT, KeyZ: BTN.LIGHT, KeyK: BTN.HEAVY, KeyX: BTN.HEAVY, KeyL: BTN.SPECIAL, KeyC: BTN.SPECIAL,
};

type Spark = { x: number; y: number; t: number; kind: "hit" | "heavy" | "block" | "ko" };

function drawFighter(c: CanvasRenderingContext2D, f: Fgt, def: CharDef, tick: number) {
  const { skin, suit, trim, hair } = def.colors;
  const x = Math.round(f.x);
  const feet = FLOOR - Math.round(f.y);
  const d = f.face;
  const R = (dx: number, y: number, w: number, h: number, col: string) => { c.fillStyle = col; c.fillRect(d === 1 ? x + dx : x - dx - w, feet - y - h, w, h); };
  c.fillStyle = "#00000055"; c.beginPath(); c.ellipse(x, FLOOR + 1, 13 - f.y / 8, 3, 0, 0, Math.PI * 2); c.fill();
  if (f.state === "ko") { // lying on the floor
    const lie = feet - 7;
    c.fillStyle = suit; c.fillRect(x - 17, lie, 22, 8);
    c.fillStyle = trim; c.fillRect(x - 17, lie + 5, 22, 2);
    const hx = d === 1 ? x + 5 : x - 15;
    c.fillStyle = skin; c.fillRect(hx, lie - 1, 10, 9);
    c.fillStyle = hair; c.fillRect(hx, lie - 1, 10, 3);
    return;
  }
  const walk = f.state === "walk" ? Math.sin(tick / 2.2) : 0;
  const air = f.y > 0;
  const hit = f.state === "hit";
  const lean = hit ? -3 : f.state === "heavy" && f.t > 6 ? 3 : 0;
  // legs
  if (air) { R(-7 + lean, 4, 6, 12, suit); R(1 + lean, 4, 6, 12, suit); R(-7 + lean, 2, 6, 3, "#1f140d"); R(1 + lean, 2, 6, 3, "#1f140d"); }
  else if (f.state === "heavy" && f.t >= 8) { R(-6, 0, 5, 16, suit); R(0, 18, 26, 6, suit); R(24, 17, 6, 7, "#1f140d"); } // high kick
  else { R(-7 + Math.round(walk * 3), 0, 6, 16, suit); R(1 - Math.round(walk * 3), 0, 6, 16, suit); R(-8 + Math.round(walk * 3), 0, 8, 3, "#1f140d"); R(1 - Math.round(walk * 3), 0, 8, 3, "#1f140d"); }
  // torso + belt
  R(-8 + lean, 16, 16, 18, suit);
  R(-8 + lean, 16, 16, 3, trim);
  R(-8 + lean, 25, 16, 2, trim);
  // head
  R(-5 + lean, 34, 10, 10, skin);
  R(-5 + lean, 41, 10, 4, hair);
  R(1 + lean, 38, 2, 2, "#1f140d");
  if (def.id === "ninja") { R(-5 + lean, 34, 10, 5, "#2a2140"); R(1 + lean, 38, 3, 2, "#fff6e0"); }
  if (def.id === "kickboxer") R(-6 + lean, 33, 12, 2, "#f2c36b");
  // arms by state
  if (f.state === "block") { R(2, 24, 8, 14, skin); R(2, 36, 9, 5, trim); }
  else if (f.state === "light") R(4, 28, 12 + Math.min(10, f.t * 3), 5, skin);
  else if (f.state === "heavy" && f.t < 8) R(-2, 28, 4, 10, skin);
  else if (f.state === "heavy") R(0, 26, 6, 5, skin);
  else if (f.state === "special") { R(4, 26, 12, 5, skin); R(4, 31, 12, 5, skin); }
  else if (f.state === "win") R(2, 36, 5, 14, skin);
  else { R(-9 + lean, 18, 4, 14, skin); R(5 + lean, 20 + (air ? 6 : 0), 4, 12, skin); }
  if (hit) { c.fillStyle = "#ff303055"; c.fillRect(x - 12, feet - 46, 24, 46); }
}

function draw(c: CanvasRenderingContext2D, v: FighterView, tick: number, sparks: Spark[], shake: number) {
  const m = v.match!;
  c.save();
  c.translate(shake ? Math.round((Math.random() - 0.5) * shake) : 0, 0);
  // stage: night street with a neon sign, shuttered shops and a dojo floor
  c.fillStyle = "#1a1038"; c.fillRect(0, 0, W, FLOOR);
  c.fillStyle = "#2a1a58"; c.fillRect(0, 60, W, 60);
  for (let i = 0; i < 9; i++) { c.fillStyle = i % 2 ? "#120a28" : "#1a1038"; c.fillRect(i * 38 - 6, 44 + ((i * 17) % 22), 34, FLOOR - 44); for (let k = 0; k < 6; k++) { c.fillStyle = (i + k) % 3 ? "#f2c36b66" : "#58e1ff55"; c.fillRect(i * 38 + 4 + (k % 3) * 9, 60 + Math.floor(k / 3) * 14, 5, 6); } }
  c.fillStyle = "#ff5fa8"; c.fillRect(120, 20, 80, 8); c.fillStyle = "#fff6e0"; c.fillRect(126, 22, 20, 4); c.fillRect(152, 22, 8, 4); c.fillRect(166, 22, 24, 4);
  c.fillStyle = "#3a2a1c"; c.fillRect(0, FLOOR, W, H - FLOOR);
  for (let x = 0; x < W; x += 20) { c.fillStyle = (x / 20) % 2 ? "#4a3624" : "#3a2a1c"; c.fillRect(x, FLOOR + 3, 20, H - FLOOR); }
  c.fillStyle = "#5a4430"; c.fillRect(0, FLOOR, W, 3);
  // fighters (the one lower on screen is drawn on top)
  const order = m.f[0].y <= m.f[1].y ? [1, 0] : [0, 1];
  for (const i of order) drawFighter(c, m.f[i], CHARACTERS[v.chars[i]], tick);
  for (const s of m.shots) {
    c.fillStyle = s.kind === "ninja" ? "#c9a0e8" : s.kind === "brawler" ? "#f2a93b" : "#ff8a3a";
    const sz = s.kind === "ninja" ? 4 : 9;
    c.beginPath(); c.arc(s.x, FLOOR - s.y, sz, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#fff3a6"; c.beginPath(); c.arc(s.x, FLOOR - s.y, sz / 2, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#ff8a3a66"; c.fillRect(s.vx > 0 ? s.x - 16 : s.x + 2, FLOOR - s.y - 2, 14, 4);
  }
  for (const s of sparks) { // hit sparks: a burst of lines that grows and fades
    const k = s.t / 14;
    const col = s.kind === "block" ? "#58a6e0" : s.kind === "ko" ? "#ffffff" : s.kind === "heavy" ? "#ff5f3a" : "#fff3a6";
    c.strokeStyle = col; c.lineWidth = s.kind === "heavy" || s.kind === "ko" ? 2 : 1;
    const n = s.kind === "ko" ? 12 : 8;
    for (let a = 0; a < n; a++) { const ang = (a / n) * Math.PI * 2 + 0.3; c.beginPath(); c.moveTo(s.x + Math.cos(ang) * (3 + k * 4), FLOOR - s.y + Math.sin(ang) * (3 + k * 4)); c.lineTo(s.x + Math.cos(ang) * (7 + k * 14), FLOOR - s.y + Math.sin(ang) * (7 + k * 14)); c.stroke(); }
  }
  c.restore();

  // HUD: health bars, timer, round pips
  const bar = (x: number, hp: number, max: number, flip: boolean, col: string) => {
    c.fillStyle = "#05030c"; c.fillRect(x - 1, 7, 122, 10);
    c.fillStyle = "#5a1a24"; c.fillRect(x, 8, 120, 8);
    const w = Math.round((120 * Math.max(0, hp)) / max);
    c.fillStyle = col; c.fillRect(flip ? x + 120 - w : x, 8, w, 8);
    c.fillStyle = "#ffffff44"; c.fillRect(flip ? x + 120 - w : x, 8, w, 2);
  };
  bar(8, m.f[0].hp, CHARACTERS[v.chars[0]].hp, false, "#f2c36b");
  bar(W - 128, m.f[1].hp, CHARACTERS[v.chars[1]].hp, true, "#f2c36b");
  c.font = "10px VT323, monospace"; c.textBaseline = "alphabetic";
  c.textAlign = "left"; c.fillStyle = "#fff6e0"; c.fillText(v.names[0].slice(0, 16), 8, 28);
  c.textAlign = "right"; c.fillText(v.names[1].slice(0, 16), W - 8, 28);
  c.textAlign = "center"; c.font = "16px VT323, monospace";
  c.fillStyle = "#05030c"; c.fillRect(W / 2 - 14, 5, 28, 16);
  c.fillStyle = m.frames < 600 ? "#ff5f3a" : "#fff6e0"; c.fillText(String(Math.max(0, Math.ceil(m.frames / 60))), W / 2, 19);
  for (let i = 0; i < FIGHT.ROUNDS_TO_WIN; i++) { c.fillStyle = m.wins[0] > i ? "#f2c36b" : "#4a3a5a"; c.fillRect(8 + i * 8, 31, 6, 6); c.fillStyle = m.wins[1] > i ? "#f2c36b" : "#4a3a5a"; c.fillRect(W - 14 - i * 8, 31, 6, 6); }
  // banners
  c.font = "30px VT323, monospace"; c.textAlign = "center";
  const say = (t: string, col = "#fff6e0") => { c.fillStyle = "#05030c"; c.fillText(t, W / 2 + 1, 85); c.fillStyle = col; c.fillText(t, W / 2, 84); };
  if (m.phase === "intro") say(m.pt < 60 ? `ROUND ${m.round}` : "FIGHT!", m.pt < 60 ? "#fff6e0" : "#ff5f3a");
  else if (m.phase === "ko" || m.phase === "over") say(m.roundWinner === -1 ? "DRAW" : m.f.some((f) => f.state === "ko") ? "K.O.!" : "TIME UP", "#f2c36b");
}

/** Pixel Fighter II: a side-view 1v1. The server runs the fight (CPU ladder or another player); this window draws it and sends your buttons. */
export default function Fighter({ net, onClose, sfx }: ArcadeProps) {
  const view = useSyncExternalStore(net.subscribe, () => net.fighter, () => null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [char, setChar] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sparks = useRef<Spark[]>([]);
  const shake = useRef(0);
  const bits = useRef(0);
  const viewRef = useRef<FighterView | null>(null);
  const sfxRef = useRef(sfx);
  const lastMatch = useRef<FightMatch | null>(null);
  useEffect(() => { sfxRef.current = sfx; }, [sfx]);
  useEffect(() => { viewRef.current = view; }, [view]);

  // sparks and sounds from the events in each snapshot
  useEffect(() => {
    const m = view?.match;
    if (!m || m === lastMatch.current) return;
    lastMatch.current = m;
    for (const e of m.ev as FightEvent[]) {
      if (e.k === "hit") { sparks.current.push({ x: e.x, y: e.y, t: 0, kind: e.heavy ? "heavy" : "hit" }); sfxRef.current("punch"); if (e.heavy) shake.current = 5; }
      else if (e.k === "block") { sparks.current.push({ x: e.x, y: e.y, t: 0, kind: "block" }); sfxRef.current("block"); }
      else if (e.k === "ko") { sparks.current.push({ x: e.x, y: e.y, t: 0, kind: "ko" }); sfxRef.current("ko"); shake.current = 9; }
      else if (e.k === "swing") sfxRef.current("emote");
    }
  }, [view]);

  // draw loop
  useEffect(() => {
    let raf = 0;
    let tick = 0;
    const loop = () => {
      const c = canvas.current?.getContext("2d");
      const v = viewRef.current;
      if (c && v?.match) {
        tick++;
        sparks.current = sparks.current.filter((s) => (s.t += 1) < 14);
        shake.current = Math.max(0, shake.current - 0.6);
        c.imageSmoothingEnabled = false;
        draw(c, v, tick, sparks.current, shake.current);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const fighting = view?.mode === "fight";
  // keyboard -> buttons (sent only when they change, plus a heartbeat in case a packet is lost)
  useEffect(() => {
    if (!fighting) { bits.current = 0; return; }
    const set = (e: KeyboardEvent, down: boolean) => {
      const b = KEYS[e.code];
      if (!b) return;
      e.preventDefault();
      const next = down ? bits.current | b : bits.current & ~b;
      if (next !== bits.current) { bits.current = next; net.sendFightInput(next); }
    };
    const kd = (e: KeyboardEvent) => set(e, true);
    const ku = (e: KeyboardEvent) => set(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    const beat = window.setInterval(() => net.sendFightInput(bits.current), 400);
    return () => { window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku); window.clearInterval(beat); net.sendFightInput(0); };
  }, [fighting, net]);

  // leaving the window leaves the match (a live 1v1 counts as a forfeit)
  useEffect(() => () => { void net.call("fg:cancel"); }, [net]);

  const join = async (ladder: boolean) => {
    if (busy) return;
    setBusy(true); setErr("");
    const r = await net.call<{ view: FighterView }>("fg:join", { char, ladder });
    setBusy(false);
    if (!r.ok) setErr(r.reason); else sfx("place");
  };

  const over = view?.mode === "over" ? view : null;
  const def = CHARACTERS[char];
  return (
    <ArcadeFrame title="Pixel Fighter II" net={net} onClose={onClose} width="max-w-4xl" accent="text-[#ff7a8a]">
      {view?.match ? (
        <>
          <canvas ref={canvas} width={W} height={H} className="mx-auto block w-full max-w-3xl border-4 border-bark bg-espresso" style={{ imageRendering: "pixelated", aspectRatio: `${W}/${H}` }} aria-label="The fight" />
          {over?.result && (
            <div className="mt-3 text-center" role="status">
              <p className={`text-2xl ${over.result.won ? "text-mint" : "text-ember"}`}>
                {over.result.won ? "YOU WIN!" : "YOU LOSE"}{over.result.beans ? ` · +${over.result.beans} beans` : ""}
                {over.result.won && over.streak > 1 ? ` · ${over.streak} win streak` : ""}
              </p>
              {over.result.ladderDone && <p className="text-amber">You beat the whole ladder! It starts over.</p>}
              <div className="mt-2 flex justify-center gap-3">
                <button className="px-btn" disabled={busy} onClick={() => void join(over.ladder !== null)}>{over.ladder !== null ? (over.result.won ? "Next opponent" : "Try again") : "Rematch"}</button>
                <button className="px-btn secondary" onClick={() => void net.call("fg:cancel")}>Fighter select</button>
              </div>
            </div>
          )}
          {fighting && <p className="mt-2 text-center text-latte">A/D move · W jump · S block · J light · K heavy · L special{view.ladder !== null ? ` · CPU ladder, stage ${view.ladder + 1} of ${LADDER.length}` : " · live 1v1"}</p>}
        </>
      ) : view?.mode === "queue" ? (
        <div className="py-10 text-center">
          <p className="text-2xl text-amber">Waiting for a challenger…</p>
          <p className="my-3 text-latte">Anyone who picks a fighter and hits &ldquo;Find a 1v1&rdquo; at this cabinet will be matched with you.</p>
          <button className="px-btn secondary" onClick={() => void net.call("fg:cancel")}>Cancel</button>
        </div>
      ) : (
        <div>
          <p className="mb-2 text-xl text-cream">Choose your fighter</p>
          <div className="grid gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Fighter">
            {CHARACTERS.map((ch, i) => (
              <button key={ch.id} role="radio" aria-checked={char === i} className={`px-btn !text-left ${char === i ? "active" : "secondary"}`} onClick={() => setChar(i)}>
                <b>{ch.name}</b>
                <span className="mt-1 block text-sm opacity-80">{ch.blurb}</span>
                <span className="mt-1 flex gap-1" aria-hidden>{[ch.colors.skin, ch.colors.suit, ch.colors.trim].map((col) => <i key={col} className="h-3 w-3 border border-espresso" style={{ background: col }} />)}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-latte">{def.name}: special move <b className="text-cream">{def.special.name}</b>. Best of 3 rounds, 60 seconds each.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            <button className="px-btn !py-3" disabled={busy} onClick={() => void join(true)}>CPU arcade ladder</button>
            <button className="px-btn secondary !py-3" disabled={busy} onClick={() => void join(false)}>Find a 1v1 (live)</button>
          </div>
          {view && view.streak > 0 && <p className="mt-2 text-mint">Current win streak: {view.streak}</p>}
          <p className="mt-3 text-sm text-latte">Win matches for a few Cafe Beans (capped) and build a win streak for the leaderboard kiosk. Controls: A/D (or arrows) move, W jump, S block, J light, K heavy, L special.</p>
        </div>
      )}
      {err && <p className="mt-2 text-ember" role="alert">{err}</p>}
    </ArcadeFrame>
  );
}
