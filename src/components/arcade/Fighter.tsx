"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { BTN, CHARACTERS, LADDER, type FightEvent, type FightMatch } from "@/shared/fighter";
import { LH, LW, SCALE, drawFight, type HudState, type Spark } from "@/game/fighterArt";
import type { FighterView } from "@/shared/protocol";
import { ArcadeFrame, type ArcadeProps } from "./ui";

// A/D (or the arrows) walk, W/Up jumps, S/Down crouches. The combat cluster sits next to them: J light, K heavy, L special, ; block.
// Holding back from the opponent blocks too (the shared sim handles that), so no key is needed for it.
const KEYS: Record<string, number> = {
  KeyA: BTN.LEFT, ArrowLeft: BTN.LEFT, KeyD: BTN.RIGHT, ArrowRight: BTN.RIGHT, KeyW: BTN.UP, ArrowUp: BTN.UP, KeyS: BTN.DOWN, ArrowDown: BTN.DOWN,
  KeyJ: BTN.LIGHT, KeyK: BTN.HEAVY, KeyL: BTN.SPECIAL, Semicolon: BTN.BLOCK,
};

const Cap = ({ children }: { children: string }) => <kbd className="mx-0.5 inline-block min-w-[1.4em] rounded border-b-2 border-bark bg-cream px-1 text-center font-bold text-espresso">{children}</kbd>;

/** Pixel Fighter II: a side-view 1v1. The server runs the fight (CPU ladder or another player); this window draws it and sends your buttons. */
export default function Fighter({ net, onClose, sfx, announce }: ArcadeProps) {
  const annRef = useRef(announce);
  useEffect(() => { annRef.current = announce; }, [announce]);
  const called = useRef<{ round: number; over: boolean }>({ round: 0, over: false });
  const view = useSyncExternalStore(net.subscribe, () => net.fighter, () => null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [char, setChar] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const sparks = useRef<Spark[]>([]);
  const shake = useRef(0);
  const flash = useRef(0);
  const ghost = useRef<[number, number]>([0, 0]);
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
    // the announcer calls each round in once, at the start of its intro
    if (m.phase === "intro" && called.current.round !== m.round) {
      called.current = { round: m.round, over: false };
      const last = m.wins[0] === m.wins[1] && m.wins[0] > 0; // one round each: the decider
      annRef.current(m.round === 1 ? "ROUND ONE! FIGHT!" : last ? "FINAL ROUND! FIGHT!" : "ROUND TWO! FIGHT!");
    }
    for (const e of m.ev as FightEvent[]) {
      if (e.k === "hit") { sparks.current.push({ x: e.x, y: e.y, t: 0, kind: e.heavy ? "heavy" : "hit" }); sfxRef.current(e.heavy ? "kick" : "punch"); if (e.heavy) { shake.current = 5; sfxRef.current("combo"); } }
      else if (e.k === "block") { sparks.current.push({ x: e.x, y: e.y, t: 0, kind: "block" }); sfxRef.current("block"); }
      else if (e.k === "ko") {
        sparks.current.push({ x: e.x, y: e.y, t: 0, kind: "ko" }); sfxRef.current("ko"); shake.current = 9; flash.current = 0.8;
        // a K.O., and PERFECT! if the winner of the round took no damage at all
        const loser = m.f[0].hp <= 0 ? 0 : 1, winner = 1 - loser;
        const perfect = m.f[winner].hp >= CHARACTERS[m.f[winner].c].hp;
        annRef.current(perfect ? "PERFECT!" : "K.O.!");
      }
      else if (e.k === "swing") sfxRef.current("emote");
    }
  }, [view]);

  // match over: YOU WIN! / YOU LOSE!
  useEffect(() => {
    if (view?.mode !== "over" || !view.match) { if (view?.mode !== "over") called.current.over = false; return; }
    if (called.current.over) return;
    called.current.over = true;
    const won = view.match.winner === view.me;
    window.setTimeout(() => annRef.current(won ? "YOU WIN!" : "YOU LOSE!"), 1400); // after the K.O. call has finished
    if (won) sfxRef.current("win");
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
        flash.current = Math.max(0, flash.current - 0.05);
        const m = v.match;
        // the red "recent damage" trail snaps to full at the start of each round and then drains slowly behind the real bar
        const maxes = [CHARACTERS[v.chars[0]].hp, CHARACTERS[v.chars[1]].hp];
        ghost.current = [0, 1].map((i) => (m.phase === "intro" ? m.f[i].hp : Math.max(m.f[i].hp, Math.min(maxes[i], ghost.current[i]) - 0.35))) as [number, number];
        const hud: HudState = { ghost: ghost.current, names: v.names, chars: v.chars };
        drawFight(c, m, hud, tick, sparks.current, shake.current, flash.current);
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
          <canvas ref={canvas} width={LW * SCALE} height={LH * SCALE} className="mx-auto block w-full max-w-3xl border-4 border-bark bg-espresso" style={{ aspectRatio: `${LW}/${LH}`, imageRendering: "pixelated" }} aria-label="The fight" />
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
          {fighting && <p className="mt-2 text-center text-latte"><Cap>A</Cap><Cap>D</Cap> move · <Cap>W</Cap> jump · <Cap>S</Cap> crouch · <Cap>J</Cap> light · <Cap>K</Cap> heavy · <Cap>L</Cap> special (super when the meter is full) · <Cap>;</Cap> block, or just hold back{view.ladder !== null ? ` · CPU ladder, stage ${view.ladder + 1} of ${LADDER.length}` : " · live 1v1"}</p>}
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
          <p className="mt-3 text-sm text-latte">Win matches for a few Cafe Beans (capped) and build a win streak for the leaderboard kiosk. Controls: A/D (or arrows) move, W jump, S crouch, then J light, K heavy, L special and ; block (holding back blocks too). Landing hits fills your super meter; a full meter powers up your next special.</p>
        </div>
      )}
      {err && <p className="mt-2 text-ember" role="alert">{err}</p>}
    </ArcadeFrame>
  );
}
