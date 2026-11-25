"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HUFF, HUFF_BONUS, HUFF_NAMES, type HuffMachine, type HuffSpin, type HuffSym } from "@/shared/casino";
import type { HuffResultMsg } from "@/shared/protocol";
import { ArcadeFrame, BetPicker, useBeans, type ArcadeProps } from "./ui";
import { HuffSprite } from "./huffArt";

// Two machines in one family. Each has its own reels, frame, paytable and bonus presentation; the server settles the
// paid spin and any free spins in one request, and this window plays them back one after another.
const CONF = {
  huff: {
    title: "Huff & Xtra Puff", accent: "text-[#f2d27a]", frame: "border-[#e8a33a]", glow: "shadow-[0_0_28px_#e8a33a77]", bg: "bg-[#3a1e10]",
    reelSyms: ["hay", "plank", "trowel", "straw", "wood", "brick", "pig", "key"] as HuffSym[],
    blurb: "3 reels · 5 lines · Wild Pig · 3 Wind-Up Keys anywhere start the WIND-UP BONUS: 6 free spins at ×2 (keys add +2, up to 20).",
  },
  huffBonus: {
    title: "Huff & Xtra Puff BONUS", accent: "text-[#ff8fb0]", frame: "border-[#d8708a]", glow: "shadow-[0_0_28px_#d8708a77]", bg: "bg-[#2a1028]",
    reelSyms: ["hay", "plank", "trowel", "straw", "wood", "brick", "pig", "hammer"] as HuffSym[],
    blurb: "5 reels · 243 ways · Wild Pig on reels 2–4 · 3 Golden Hammers start the HUFF AND PUFF BONUS: 8 free spins where every 2 hammers build the house up a level (Straw ×1 → Wood ×2 → Brick ×3 → Mansion ×5). Reach the Mansion for a ×50 Mansion Jackpot!",
  },
} as const;

const LEVEL_SYM: HuffSym[] = ["straw", "wood", "brick", "brick"];
const rnd = (syms: readonly HuffSym[]) => syms[Math.floor(Math.random() * syms.length)];

export default function HuffSlots({ machine, net, onClose, sfx, announce }: ArcadeProps & { machine: HuffMachine }) {
  const cf = CONF[machine];
  const reels = machine === "huff" ? HUFF.reels : HUFF_BONUS.reels;
  const rows = 3;
  const beans = useBeans(net);
  const [bet, setBet] = useState(10);
  const [grid, setGrid] = useState<HuffSym[][]>(() => Array.from({ length: reels }, (_, r) => Array.from({ length: rows }, (_, k) => cf.reelSyms[(r * 2 + k) % cf.reelSyms.length])));
  const [spinning, setSpinning] = useState<boolean[]>(() => new Array(reels).fill(false));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good: boolean } | null>(null);
  const [winCells, setWinCells] = useState<Set<string>>(new Set());
  const [bonus, setBonus] = useState<{ title: string; left: number; total: number; level?: number; won: number } | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const timers = useRef<number[]>([]);
  const spinRef = useRef<boolean[]>(new Array(reels).fill(false));

  const clear = useCallback(() => { timers.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); }); timers.current = []; }, []);
  useEffect(() => () => { clear(); net.release(); }, [clear, net]);
  const later = (ms: number, fn: () => void) => { timers.current.push(window.setTimeout(fn, ms)); };

  /** Which cells take part in a spin's wins (to light them up). */
  const cellsOf = useCallback((s: HuffSpin) => {
    const out = new Set<string>();
    for (const w of s.wins) {
      if (w.line !== undefined) HUFF.lines[w.line].forEach((row, reel) => out.add(`${reel}:${row}`));
      else for (let reel = 0; reel < w.count; reel++) s.grid[reel].forEach((c, row) => { if (c === w.sym || c === "pig") out.add(`${reel}:${row}`); });
    }
    const sc: HuffSym = machine === "huff" ? "key" : "hammer";
    if (s.scatters >= 3) s.grid.forEach((col, reel) => col.forEach((c, row) => { if (c === sc) out.add(`${reel}:${row}`); }));
    return out;
  }, [machine]);

  /** Animate one spin landing on `s`; calls `done` when its wins have been shown. */
  const play = useCallback((s: HuffSpin, fast: boolean, done: () => void) => {
    setWinCells(new Set());
    spinRef.current = new Array(reels).fill(true);
    setSpinning([...spinRef.current]);
    sfx("spin");
    const iv = window.setInterval(() => setGrid((g) => g.map((col, r) => (spinRef.current[r] ? col.map(() => rnd(cf.reelSyms)) : col))), 70);
    timers.current.push(iv);
    const step = fast ? 160 : 300, first = fast ? 380 : 650;
    for (let r = 0; r < reels; r++) later(first + r * step, () => {
      spinRef.current[r] = false;
      setSpinning([...spinRef.current]);
      setGrid((g) => g.map((col, k) => (k === r ? s.grid[r] : col)));
      sfx("reelStop");
    });
    later(first + reels * step + 60, () => {
      window.clearInterval(iv);
      setWinCells(cellsOf(s));
      if (s.win > 0) sfx(s.win >= bet * 10 ? "jackpot" : "coin");
      later(s.win > 0 || s.scatters >= 3 ? (fast ? 650 : 900) : fast ? 250 : 120, done);
    });
  }, [bet, cellsOf, cf.reelSyms, reels, sfx]);

  const spin = useCallback(async () => {
    if (busy) return;
    const before = net.beans;
    if (before < bet) { setMsg({ text: "Not enough Cafe Beans for that bet.", good: false }); return; }
    setBusy(true); setMsg(null); setBonus(null); setBanner(null);
    const r = await net.call<HuffResultMsg>("huff:spin", { machine, bet });
    if (!r.ok) { setBusy(false); setMsg({ text: r.reason, good: false }); return; }
    net.hold(before - bet);
    const [base, ...free] = r.spins;
    let shown = base.win;
    const end = () => {
      net.release();
      setBusy(false);
      setBonus((b) => (b ? { ...b, left: 0 } : b));
      if (r.jackpot) { sfx("jackpot"); announce("JACKPOT!"); setBanner(machine === "huff" ? "★ BRICK HOUSE JACKPOT ★" : "★ MANSION JACKPOT ★"); }
      else if (r.total >= bet * 15) { sfx("jackpot"); announce("BIG WIN!"); }
      else if (r.total > bet) { sfx("win"); announce("WINNER!"); }
      else if (r.total === 0) {
        sfx("lose");
        const sc: HuffSym = machine === "huff" ? "key" : "hammer";
        if (base.scatters === 2) { sfx("nearMiss"); announce("SO CLOSE!"); } // one scatter short of the bonus
        void sc;
      }
      setMsg(r.total > 0 ? { text: `${r.bonus ? "Bonus total" : "You win"} +${r.total} beans${r.total > bet ? "" : " (less than the bet)"}`, good: r.total >= bet } : { text: "No win this time.", good: false });
    };
    play(base, false, () => {
      if (!r.bonus) return end();
      // the bonus: banner, announcer, then the free spins one by one
      sfx("bonus");
      announce("HUFF AND PUFF BONUS!");
      const isBuild = r.bonus.kind === "build";
      setBanner(isBuild ? "HUFF AND PUFF BONUS! Build the house!" : `WIND-UP BONUS! ${r.bonus.spins} free spins ×${HUFF.freeMult}`);
      setBonus({ title: isBuild ? "Huff and Puff Bonus" : "Wind-Up Bonus", left: free.length, total: free.length, level: isBuild ? 0 : undefined, won: shown });
      let k = 0;
      const next = () => {
        if (k >= free.length) {
          if (r.bonus?.mansion) { shown += r.total - shown; setBonus((b) => (b ? { ...b, won: r.total } : b)); }
          return later(500, end);
        }
        const s = free[k++];
        play(s, true, () => {
          shown += s.win;
          const lv = s.level;
          setBonus((b) => {
            if (!b) return b;
            if (isBuild && lv !== undefined && b.level !== undefined) {
              const after = free[k - 1 + 1]?.level ?? r.bonus?.level ?? lv; // the level the next spin plays at
              if (after > b.level) { sfx("streak"); setBanner(`The house is now ${HUFF_BONUS.levelNames[after]}! Wins ×${HUFF_BONUS.levelMult[after]}`); }
              return { ...b, left: free.length - k, level: after, won: shown };
            }
            return { ...b, left: free.length - k, won: shown };
          });
          next();
        });
      };
      later(900, next);
    });
  }, [announce, bet, busy, machine, net, play, sfx]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && !(e.target instanceof HTMLInputElement)) { e.preventDefault(); void spin(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [spin]);

  const cell = machine === "huff" ? 6 : 4;
  return (
    <ArcadeFrame title={cf.title} net={net} onClose={onClose} width="max-w-4xl" accent={cf.accent}>
      <div className="grid gap-4 lg:grid-cols-[1fr_15rem]">
        <div>
          {banner && <p className="mb-2 animate-pulse text-center font-pixel text-[0.65rem] text-[#ffe080]" role="status">{banner}</p>}
          {bonus && (
            <div className="mx-auto mb-2 flex w-fit items-center gap-3 bg-black/40 px-3 py-1 text-cream">
              <span>{bonus.title}: {bonus.total - bonus.left}/{bonus.total} spins</span>
              {bonus.level !== undefined && (
                <span className="flex items-center gap-1" aria-label={`House level ${HUFF_BONUS.levelNames[bonus.level]}`}>
                  {HUFF_BONUS.levelNames.map((n, i) => (
                    <span key={n} className={`flex flex-col items-center px-1 ${i <= bonus.level! ? "opacity-100" : "opacity-30"}`} title={`${n} ×${HUFF_BONUS.levelMult[i]}`}>
                      <HuffSprite sym={LEVEL_SYM[i]} scale={i === 3 ? 3 : 2} />
                      <small>×{HUFF_BONUS.levelMult[i]}</small>
                    </span>
                  ))}
                </span>
              )}
              <b className="text-mint">+{bonus.won}</b>
            </div>
          )}
          <div className={`mx-auto mb-4 w-fit border-8 ${cf.frame} ${cf.bg} p-2 ${cf.glow}`}>
            <div className="mb-1 text-center font-pixel text-[0.55rem] text-[#ffe080]">{machine === "huff" ? "★ HUFF & XTRA PUFF ★" : "★ HUFF & XTRA PUFF · BONUS ★"}</div>
            <div className="flex gap-1">
              {grid.map((col, r) => (
                <div key={r} className="flex flex-col gap-1 bg-black/30 p-1">
                  {col.map((s, row) => (
                    <div key={row} aria-label={`Reel ${r + 1} row ${row + 1}: ${HUFF_NAMES[s]}`}
                      className={`grid place-items-center border-2 ${winCells.has(`${r}:${row}`) ? "border-[#ffe080] bg-[#fff3c8] shadow-[0_0_12px_#ffe080]" : "border-black/40 bg-[#f6ecd6]"} ${spinning[r] ? "blur-[1px]" : ""}`}
                      style={{ width: cell * 12 + 10, height: cell * 12 + 8 }}>
                      <HuffSprite sym={s} scale={cell} />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="mb-3 flex justify-center"><BetPicker value={bet} onChange={setBet} balance={beans} disabled={busy} /></div>
          <div className="flex flex-col items-center gap-2">
            <button className="px-btn !px-8 !py-4 !text-sm" disabled={busy || beans < bet} onClick={() => void spin()}>{busy ? "Spinning…" : `Spin (${bet})`}</button>
            <p className="min-h-7 text-xl" role="status">{msg && <span className={msg.good ? "text-mint" : "text-latte"}>{msg.text}</span>}</p>
          </div>
        </div>
        <div className="bg-espresso/70 p-3 text-latte">
          <h3 className="mb-2 font-pixel text-[0.6rem] text-amber">Pays (× bet)</h3>
          <p className="mb-2 text-sm">{cf.blurb}</p>
          <ul className="space-y-1">
            {(["brick", "wood", "straw", "trowel", "plank", "hay"] as HuffSym[]).map((s) => (
              <li key={s} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1"><HuffSprite sym={s} scale={2} /><span className="text-sm">{HUFF_NAMES[s]}</span></span>
                <b className="text-cream">{machine === "huff" ? `×${HUFF.pays[s]}` : HUFF_BONUS.pays[s].map((p) => `${p}`).join(" / ")}</b>
              </li>
            ))}
            {machine === "huff" && (
              <>
                <li className="flex justify-between"><span>3 Wild Pigs on a line</span><b className="text-cream">×{HUFF.pays.pig}</b></li>
                <li className="flex justify-between text-[#ffe080]"><span>3 natural Brick Houses, middle line</span><b>JACKPOT ×{HUFF.jackpot}</b></li>
              </>
            )}
            {machine === "huffBonus" && <li className="text-sm">Ways pay for 3 / 4 / 5 of a kind from the left, per way.</li>}
          </ul>
        </div>
      </div>
    </ArcadeFrame>
  );
}
