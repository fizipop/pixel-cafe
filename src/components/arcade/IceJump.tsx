"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ICE, newGame, screenY, step, type IceInput, type IceState } from "@/game/iceJump";
import { ICE_MAX_BEANS } from "@/shared/arcade";
import type { IceFinish, IceStart } from "@/shared/protocol";
import { ArcadeFrame, sprite, type ArcadeProps } from "./ui";

const CAT = sprite([
  ".o........o.",
  ".oo......oo.",
  ".oooooooooo.",
  ".oKooooooKo.",
  ".ooooPPoooo.",
  "..oooooooo..",
  ".oooOOOOooo.",
  ".ooooooooooT",
  ".oooooooooTT",
  "..oo....oo..",
], { o: "#e0884a", O: "#f4e4c1", K: "#1f140d", P: "#f28fad", T: "#b8602a" });

function draw(g: CanvasRenderingContext2D, s: IceState, now: number) {
  const { W, H } = ICE;
  const water = g.createLinearGradient(0, 0, 0, H);
  water.addColorStop(0, "#1c4a72");
  water.addColorStop(1, "#0a2540");
  g.fillStyle = water;
  g.fillRect(0, 0, W, H);
  // drifting ripples
  g.fillStyle = "#ffffff18";
  for (let i = 0; i < 14; i++) {
    const y = ((i * 41 + s.camY * 0.5) % (H + 20) + H + 20) % (H + 20);
    const x = (i * 67 + Math.sin(now / 900 + i) * 12 + W) % W;
    g.fillRect(Math.round(x), Math.round(H - y), 22, 1);
  }
  // floes
  for (const f of s.floes) {
    const y = Math.round(screenY(s, f.row * ICE.ROW));
    if (y < -20 || y > H + 20) continue;
    const x = Math.round(f.x);
    const cracking = f.crackedFor > 0;
    const shake = cracking ? Math.round(Math.sin(now / 35) * Math.min(2, f.crackedFor / 400)) : 0;
    g.fillStyle = "#4d8fb0"; g.fillRect(x + shake, y + 6, f.w, 7); // underwater bulk
    g.fillStyle = cracking ? "#cfe3ee" : "#9ad4ea"; g.fillRect(x + shake, y + 2, f.w, 6); // side
    g.fillStyle = cracking ? "#ecf6fb" : "#f2fcff"; g.fillRect(x + shake, y - 3, f.w, 6); // top
    g.fillStyle = cracking ? "#d6e9f2" : "#ffffff"; g.fillRect(x + 2 + shake, y - 3, f.w - 4, 2);
    if (f.cracky && !cracking) { g.fillStyle = "#7fb8d6"; g.fillRect(x + (f.w >> 1), y - 3, 1, 4); g.fillRect(x + (f.w >> 1) + 1, y - 1, 3, 1); } // a hint: hairline crack
    if (cracking) {
      g.fillStyle = "#355f78";
      g.fillRect(x + (f.w >> 1) + shake, y - 3, 1, 8);
      g.fillRect(x + (f.w >> 1) - 5 + shake, y - 1, 11, 1);
      g.fillRect(x + (f.w >> 1) + 4 + shake, y + 2, 1, 4);
      g.fillRect(x + (f.w >> 1) - 7 + shake, y + 2, 1, 4);
    }
  }
  // the cat (feet at the floe surface)
  const cy = Math.round(screenY(s, s.cat.y));
  const cx = Math.round(s.cat.x);
  const px = 2;
  const w = CAT.cols * px;
  const air = s.cat.onFloe === null;
  for (let i = 0; i < CAT.pixels.length; i++) {
    const col = CAT.pixels[i];
    if (!col) continue;
    const ix = i % CAT.cols;
    const iy = Math.floor(i / CAT.cols);
    const dx = s.cat.face === 1 ? ix : CAT.cols - 1 - ix;
    g.fillStyle = col;
    g.fillRect(cx - (w >> 1) + dx * px, cy - 22 + iy * px - (air ? 2 : 0), px, px);
  }
  if (s.over) { g.fillStyle = "#08203a99"; g.fillRect(0, 0, W, H); }
}

/** Cat Ice Jump: a playable arcade game. Keyboard (arrows/A-D + Space/W) or tap: the cat jumps toward where you tap. */
export default function IceJump({ net, onClose, sfx }: ArcadeProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const game = useRef<IceState>(newGame());
  const input = useRef<IceInput>({ left: false, right: false, jump: false });
  const phaseRef = useRef<"ready" | "playing" | "over">("ready");
  const tokenRef = useRef<Promise<{ ok: true } & IceStart | { ok: false; reason: string }> | null>(null);
  const [phase, setPhase] = useState<"ready" | "playing" | "over">("ready");
  const [score, setScore] = useState(0);
  const [result, setResult] = useState<{ ok: true; fin: IceFinish } | { ok: false; reason: string } | null>(null);
  const [best, setBest] = useState<number | null>(null);

  const begin = useCallback(() => {
    game.current = newGame();
    input.current.jump = false;
    phaseRef.current = "playing";
    tokenRef.current = net.call<IceStart>("ice:start");
    setPhase("playing");
    setResult(null);
    setScore(0);
  }, [net]);

  // personal best for the header
  useEffect(() => {
    let live = true;
    void net.call<{ view: { ice: { value: number; mine: boolean }[] } }>("arcade:board").then((r) => {
      if (live && r.ok) setBest(r.view.ice.find((x) => x.mine)?.value ?? 0);
    });
    return () => { live = false; };
  }, [net]);

  const finish = useCallback(async (final: number) => {
    const t = await tokenRef.current;
    if (!t || !t.ok) { setResult({ ok: false, reason: "Scores can't be saved right now." }); return; }
    const r = await net.call<IceFinish>("ice:finish", { token: t.token, score: final });
    if (r.ok) {
      setResult({ ok: true, fin: r });
      setBest((b) => Math.max(b ?? 0, final));
      if (r.best && final > 0) sfx("jackpot"); else if (r.beans > 0) sfx("beans");
    } else setResult({ ok: false, reason: r.reason });
  }, [net, sfx]);

  // the game loop
  useEffect(() => {
    const c = canvas.current;
    const g = c?.getContext("2d");
    if (!c || !g) return;
    g.imageSmoothingEnabled = false;
    let raf = 0;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = game.current;
      if (phaseRef.current === "playing") {
        step(s, dt, input.current);
        for (const e of s.events.splice(0)) sfx(e === "jump" ? "jump" : e === "land" ? "place" : e === "crack" ? "reelStop" : "splash");
        setScore((v) => (v === s.score ? v : s.score));
        if (s.over) { phaseRef.current = "over"; setPhase("over"); void finish(s.score); }
      }
      draw(g, s, now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [finish, sfx]);

  // keyboard
  useEffect(() => {
    const press = (down: boolean) => (e: KeyboardEvent) => {
      const k = e.key;
      const left = k === "ArrowLeft" || k === "a" || k === "A";
      const right = k === "ArrowRight" || k === "d" || k === "D";
      const jump = k === " " || k === "ArrowUp" || k === "w" || k === "W";
      if (!left && !right && !jump) return;
      e.preventDefault();
      (document.activeElement as HTMLElement | null)?.blur(); // so Space never "clicks" a focused button
      if (left) input.current.left = down;
      if (right) input.current.right = down;
      if (jump && down && !e.repeat) {
        if (phaseRef.current === "ready" || phaseRef.current === "over") begin();
        input.current.jump = true;
      }
    };
    const dn = press(true), up = press(false);
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", dn); window.removeEventListener("keyup", up); };
  }, [begin]);

  // tap / click: jump toward the side you touched, keep steering while held
  const onPointer = (e: React.PointerEvent<HTMLElement>, down: boolean) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    if (!down) { input.current.left = false; input.current.right = false; return; }
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (phaseRef.current !== "playing") { begin(); }
    input.current.left = x < 0.33;
    input.current.right = x > 0.67;
    input.current.jump = true;
  };
  const hold = (dir: "left" | "right") => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); input.current[dir] = true; },
    onPointerUp: () => { input.current[dir] = false; },
    onPointerLeave: () => { input.current[dir] = false; },
    onPointerCancel: () => { input.current[dir] = false; },
  });

  return (
    <ArcadeFrame title="Cat Ice Jump" net={net} onClose={onClose} width="max-w-xl" accent="text-[#7fd8f0]">
      <div className="flex flex-col items-center gap-3">
        <div className="flex w-full max-w-xs justify-between text-xl">
          <span className="text-cream">Score <b className="text-amber">{score}</b></span>
          <span className="text-latte">Best <b className="text-cream">{best ?? "–"}</b></span>
        </div>
        <div className="relative w-full max-w-xs select-none" style={{ touchAction: "none" }}>
          <canvas
            ref={canvas} width={ICE.W} height={ICE.H}
            className="w-full border-4 border-bark [image-rendering:pixelated]"
            onPointerDown={(e) => onPointer(e, true)} onPointerUp={(e) => onPointer(e, false)} onPointerCancel={(e) => onPointer(e, false)}
            aria-label="Cat Ice Jump playfield"
          />
          {phase !== "playing" && (
            <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/35 p-3 text-center">
              <div className="bg-espresso/90 p-3">
                {phase === "ready" && <><p className="font-pixel text-xs text-amber">Ready?</p><p className="mt-2 text-xl text-cream">Press Space or tap to jump.<br />Hop up the ice. Don&apos;t get wet!</p></>}
                {phase === "over" && (
                  <>
                    <p className="font-pixel text-xs text-amber">Splash!</p>
                    <p className="mt-2 text-2xl text-cream">Score {score}</p>
                    {result?.ok && (
                      <p className="text-xl text-mint">
                        {result.fin.best && score > 0 ? "New personal best! " : ""}+{result.fin.beans} beans{result.fin.rank ? ` · rank #${result.fin.rank}` : ""}
                      </p>
                    )}
                    {result && !result.ok && <p className="text-xl text-ember">{result.reason}</p>}
                    {!result && <p className="text-latte">Saving…</p>}
                    <p className="mt-1 text-latte">Space or tap to play again</p>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="flex w-full max-w-xs gap-2" data-nosfx>
          <button className="px-btn flex-1 !py-4" {...hold("left")} aria-label="Move left">◀</button>
          <button className="px-btn flex-[2] !py-4" onPointerDown={(e) => { e.preventDefault(); if (phaseRef.current !== "playing") begin(); input.current.jump = true; }} aria-label="Jump">Jump</button>
          <button className="px-btn flex-1 !py-4" {...hold("right")} aria-label="Move right">▶</button>
        </div>
        <p className="text-center text-sm text-latte">
          ← → / A D steer · Space / W / ↑ jump · or tap the screen (left / right third steers). Cracked floes crumble, the water keeps rising.
          1 bean per 25 points, up to {ICE_MAX_BEANS} a run. Free to play.
        </p>
      </div>
    </ArcadeFrame>
  );
}
