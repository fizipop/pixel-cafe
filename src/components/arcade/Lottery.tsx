"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { HOURLY_MAX_TICKETS, LOTTERY, validLotteryNumber } from "@/shared/casino";
import type { HourlyLotteryView, LotteryResult } from "@/shared/protocol";
import { ArcadeFrame, useBeans, type ArcadeProps } from "./ui";

const DRAW_MS = 2200;
const pad = (n: number) => String(n).padStart(4, "0");
const clock = (ms: number) => { const t = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const hourOf = (at: number) => new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The lottery booth: pick 1-1000, pay 20 beans, the server draws instantly; an exact match pays 10,000. */
export default function Lottery({ net, onClose, sfx, announce }: ArcadeProps) {
  const beans = useBeans(net);
  const [pick, setPick] = useState(777);
  const [text, setText] = useState("777");
  const [stage, setStage] = useState<"pick" | "confirm" | "drawing" | "done">("pick");
  const [shown, setShown] = useState("0000");
  const [result, setResult] = useState<LotteryResult | null>(null);
  const [err, setErr] = useState("");
  const [tickets, setTickets] = useState<LotteryResult[]>([]);
  const [mode, setMode] = useState<"instant" | "hourly">("instant");
  const [hourly, setHourly] = useState<HourlyLotteryView | null>(null);
  const [offset, setOffset] = useState(0); // server clock minus ours
  const [nowMs, setNowMs] = useState(0);
  const seenResults = useRef<number | null>(null); // results already shown (by draw time) when the window opened
  const timers = useRef<number[]>([]);
  const clear = () => { timers.current.forEach((t) => { window.clearTimeout(t); window.clearInterval(t); }); timers.current = []; };
  useEffect(() => () => { clear(); net.release(); }, [net]);

  // the hourly draw: refresh its state every few seconds while the window is open, and call out your results
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const r = await net.call<{ view: HourlyLotteryView }>("lottery:hourly");
      if (!alive || !r.ok) return;
      setOffset(r.view.now - Date.now());
      setHourly(r.view);
      const newest = r.view.results[0]?.at ?? 0;
      if (seenResults.current === null) seenResults.current = newest;
      else if (newest > seenResults.current) {
        seenResults.current = newest;
        const mineNow = r.view.results.filter((x) => x.at === newest);
        if (mineNow.some((x) => x.won)) { sfx("jackpot"); announce("LOTTERY WINNER!"); } else { sfx("drawReveal"); announce("BETTER LUCK NEXT TIME!"); }
      }
    };
    void load();
    const t = window.setInterval(() => void load(), 4000);
    const c = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => { alive = false; window.clearInterval(t); window.clearInterval(c); };
  }, [announce, net, sfx]);

  const buyHourly = useCallback(async () => {
    if (!validLotteryNumber(pick)) return;
    if (net.beans < LOTTERY.COST) { setErr(`A ticket costs ${LOTTERY.COST} Cafe Beans.`); return; }
    setErr("");
    const r = await net.call<{ view: HourlyLotteryView }>("lottery:hourlyBuy", { pick });
    if (!r.ok) { setErr(r.reason); setStage("pick"); return; }
    setHourly(r.view); setOffset(r.view.now - Date.now());
    setStage("pick");
    sfx("coin");
  }, [net, pick, sfx]);

  const valid = validLotteryNumber(pick);
  const choose = (n: number) => { setPick(n); setText(String(n)); setErr(""); sfx("select"); };

  const enter = useCallback(async () => {
    if (stage === "drawing" || !valid) return;
    const before = net.beans;
    if (before < LOTTERY.COST) { setErr(`An entry costs ${LOTTERY.COST} Cafe Beans.`); return; }
    setStage("drawing"); setErr(""); setResult(null);
    const r = await net.call<LotteryResult>("lottery:enter", { pick });
    if (!r.ok) { setStage("pick"); setErr(r.reason); return; }
    net.hold(before - LOTTERY.COST);
    sfx("coin");
    // the draw machine: each digit spins, then the digits lock left to right on the server's number
    const target = pad(r.draw);
    let locked = 0;
    const iv = window.setInterval(() => {
      setShown(target.slice(0, locked) + Array.from({ length: 4 - locked }, () => Math.floor(Math.random() * 10)).join(""));
      sfx("drawTick");
    }, 60);
    timers.current.push(iv);
    for (let d = 1; d <= 4; d++) timers.current.push(window.setTimeout(() => { locked = d; sfx("reelStop"); }, (DRAW_MS / 4) * d));
    timers.current.push(window.setTimeout(() => {
      clear();
      setShown(target);
      net.release();
      setResult(r);
      setTickets((t) => [r, ...t].slice(0, 6));
      setStage("done");
      sfx("drawReveal");
      if (r.won) { sfx("jackpot"); announce("LOTTERY WINNER!"); }
      else if (Math.abs(r.draw - r.pick) <= 5) { sfx("nearMiss"); announce("SO CLOSE!"); }
      else { sfx("lose"); announce("BETTER LUCK NEXT TIME!"); }
    }, DRAW_MS + 150));
  }, [announce, net, pick, sfx, stage, valid]);

  return (
    <ArcadeFrame title="Lucky Bean Lottery" net={net} onClose={onClose} width="max-w-2xl" accent="text-[#7fe0a9]">
      <div className="mb-3 flex justify-center gap-2" role="tablist" aria-label="Draw type">
        {([["instant", "Instant draw"], ["hourly", "Hourly draw"]] as const).map(([m, label]) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`px-btn !py-1 ${mode === m ? "active" : "secondary"}`} disabled={stage === "drawing"} onClick={() => { setMode(m); setStage("pick"); setErr(""); sfx("select"); }}>{label}</button>
        ))}
      </div>
      {mode === "hourly" && (
        <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
          <div className="flex flex-col items-center gap-3">
            <div className="border-8 border-[#7fe0a9] bg-[#0b2a20] px-5 py-3 text-center shadow-[0_0_24px_#7fe0a966]">
              <p className="font-pixel text-[0.55rem] text-[#ffe080]">★ NEXT HOURLY DRAW ★</p>
              <p className="mt-2 font-pixel text-2xl text-cream" aria-live="off">{hourly && nowMs ? clock(hourly.nextDrawAt - (nowMs + offset)) : "--:--"}</p>
              <p className="text-latte">{hourly ? `at ${hourOf(hourly.nextDrawAt)}` : ""}</p>
            </div>
            <label className="flex items-center gap-2 text-xl">
              <span className="text-latte">Your number (1–1000):</span>
              <input className="px-input !w-28 !py-1 !text-xl" type="number" inputMode="numeric" min={1} max={1000} value={text}
                onChange={(e) => { setText(e.target.value); setPick(Number(e.target.value)); setStage("pick"); }} aria-label="Your hourly lottery number" />
            </label>
            <div className="flex flex-wrap justify-center gap-2">
              <button className="px-btn secondary !py-1" onClick={() => choose(1 + Math.floor(Math.random() * 1000))}>Quick pick</button>
            </div>
            {!valid && <p className="text-ember">Pick a whole number from 1 to 1000.</p>}
            {stage !== "confirm" ? (
              <button className="px-btn !px-6 !py-3" disabled={!valid || beans < LOTTERY.COST || (hourly?.mine.filter((t) => t.drawAt === hourly.nextDrawAt).length ?? 0) >= HOURLY_MAX_TICKETS} onClick={() => { setStage("confirm"); sfx("select"); }}>Enter the hourly draw ({LOTTERY.COST} beans)</button>
            ) : (
              <div className="flex flex-col items-center gap-2 bg-black/30 p-3">
                <p className="text-xl text-cream">Enter <b className="text-amber">#{pick}</b> in the {hourly ? hourOf(hourly.nextDrawAt) : "next"} draw for {LOTTERY.COST} beans?</p>
                <div className="flex gap-2">
                  <button className="px-btn" onClick={() => void buyHourly()}>Confirm ticket</button>
                  <button className="px-btn secondary" onClick={() => setStage("pick")}>Back</button>
                </div>
              </div>
            )}
            {hourly && hourly.mine.length > 0 && (
              <p className="text-center text-cream">Your tickets for the next draw: {hourly.mine.map((t) => <b key={t.id} className="mx-1 text-amber">#{t.pick}</b>)}</p>
            )}
            {err && <p className="text-ember" role="alert">{err}</p>}
          </div>
          <div className="bg-espresso/70 p-3 text-latte">
            <h3 className="mb-2 font-pixel text-[0.6rem] text-amber">Hourly rules</h3>
            <ul className="list-disc space-y-1 pl-4">
              <li>Same ticket: pick 1–1000, <b className="text-cream">{LOTTERY.COST}</b> beans.</li>
              <li>One number is drawn for everyone at the top of each hour.</li>
              <li>An exact match pays <b className="text-cream">{LOTTERY.JACKPOT.toLocaleString()}</b> (paid automatically, even if you&apos;re away).</li>
              <li>1 in 1,000 per ticket. Up to {HOURLY_MAX_TICKETS} tickets a draw.</li>
            </ul>
            {hourly?.last && (
              <p className="mt-3">Last draw ({hourOf(hourly.last.at)}): <b className="text-cream">{hourly.last.number}</b> · {hourly.last.tickets} ticket{hourly.last.tickets === 1 ? "" : "s"} · {hourly.last.winners.length ? `winners: ${hourly.last.winners.join(", ")}` : "no winner"}</p>
            )}
            {hourly && hourly.results.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-sm" aria-label="Your hourly results">
                {hourly.results.map((x, i) => <li key={i} className={x.won ? "text-mint" : ""}>{hourOf(x.at)}: #{x.pick} vs {x.number}{x.won ? " · WON" : ""}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}
      {mode === "instant" && <div className="grid gap-4 sm:grid-cols-[1fr_13rem]">
        <div className="flex flex-col items-center gap-3">
          <div className="border-8 border-[#7fe0a9] bg-[#0b2a20] px-5 py-3 shadow-[0_0_24px_#7fe0a966]">
            <p className="text-center font-pixel text-[0.55rem] text-[#ffe080]">★ TODAY&apos;S DRAW ★</p>
            <div className="mt-2 flex gap-1" aria-live="polite" aria-label={`Drawn number ${stage === "done" ? Number(shown) : "pending"}`}>
              {shown.split("").map((d, i) => (
                <span key={i} className={`grid h-16 w-12 place-items-center border-4 border-black bg-[#fff6e0] font-pixel text-2xl ${stage === "drawing" ? "text-[#7a6a4a]" : "text-[#1f140d]"}`}>{d}</span>
              ))}
            </div>
          </div>
          {stage !== "drawing" && (
            <>
              <label className="flex items-center gap-2 text-xl">
                <span className="text-latte">Your number (1–1000):</span>
                <input className="px-input !w-28 !py-1 !text-xl" type="number" inputMode="numeric" min={1} max={1000} value={text}
                  onChange={(e) => { setText(e.target.value); setPick(Number(e.target.value)); setStage("pick"); }} aria-label="Your lottery number" />
              </label>
              <div className="flex flex-wrap justify-center gap-2">
                <button className="px-btn secondary !py-1" onClick={() => choose(1 + Math.floor(Math.random() * 1000))}>Quick pick</button>
                {[7, 77, 500, 777, 1000].map((n) => <button key={n} className="px-btn secondary !px-2 !py-1" onClick={() => choose(n)}>{n}</button>)}
              </div>
              {!valid && <p className="text-ember">Pick a whole number from 1 to 1000.</p>}
              {stage !== "confirm" ? (
                <button className="px-btn !px-6 !py-3" disabled={!valid || beans < LOTTERY.COST} onClick={() => { setStage("confirm"); sfx("select"); }}>Buy a ticket ({LOTTERY.COST} beans)</button>
              ) : (
                <div className="flex flex-col items-center gap-2 bg-black/30 p-3">
                  <p className="text-xl text-cream">Enter <b className="text-amber">#{pick}</b> for {LOTTERY.COST} Cafe Beans?</p>
                  <div className="flex gap-2">
                    <button className="px-btn" onClick={() => void enter()}>Confirm & draw</button>
                    <button className="px-btn secondary" onClick={() => setStage("pick")}>Back</button>
                  </div>
                </div>
              )}
            </>
          )}
          {stage === "drawing" && <p className="text-xl text-amber" role="status">Ticket #{pick} entered. Drawing…</p>}
          {result && stage === "done" && (
            <p className={`text-center text-xl ${result.won ? "text-mint" : "text-latte"}`} role="status">
              Your number <b>{result.pick}</b> · drawn <b>{result.draw}</b> —{" "}
              {result.won ? `JACKPOT! +${result.win.toLocaleString()} Cafe Beans!` : Math.abs(result.draw - result.pick) <= 5 ? "so close! No win this time." : "no match this time."}
            </p>
          )}
          {err && <p className="text-ember" role="alert">{err}</p>}
        </div>
        <div className="bg-espresso/70 p-3 text-latte">
          <h3 className="mb-2 font-pixel text-[0.6rem] text-amber">Rules</h3>
          <ul className="list-disc space-y-1 pl-4">
            <li>Pick any number from {LOTTERY.MIN} to {LOTTERY.MAX}.</li>
            <li>Each ticket costs <b className="text-cream">{LOTTERY.COST}</b> beans.</li>
            <li>An exact match pays <b className="text-cream">{LOTTERY.JACKPOT.toLocaleString()}</b> beans.</li>
            <li>Odds: <b className="text-cream">1 in 1,000</b> per ticket (every draw is independent).</li>
            <li>The number is drawn by the cafe server after your ticket is paid.</li>
          </ul>
          {tickets.length > 0 && (
            <>
              <h3 className="mb-1 mt-3 font-pixel text-[0.55rem] text-amber">Your tickets</h3>
              <ul className="space-y-0.5 text-sm">
                {tickets.map((t) => <li key={t.ticket} className={t.won ? "text-mint" : ""}>#{t.pick} vs {t.draw} {t.won ? "· WON" : ""}</li>)}
              </ul>
            </>
          )}
        </div>
      </div>}
    </ArcadeFrame>
  );
}
