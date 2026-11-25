"use client";
import { useMemo, useRef } from "react";
import type { ArcadeGame } from "@/game/arcadeLayout";
import type { SfxName } from "@/lib/sfx";
import ArcadeBoard from "./ArcadeBoard";
import Blackjack from "./Blackjack";
import Beat from "./Beat";
import Fighter from "./Fighter";
import HuffSlots from "./HuffSlots";
import Lottery from "./Lottery";
import Penguin from "./Penguin";
import Plinko from "./Plinko";
import Poker from "./Poker";
import Pool from "./Pool";
import Racer from "./Racer";
import Mines from "./Mines";
import Moon from "./Moon";
import Roulette from "./Roulette";
import Slots from "./Slots";
import type { ArcadeProps } from "./ui";

/** Games that announce their own big moments; the rest get the shared bridge below. */
const SELF_ANNOUNCING = new Set<ArcadeGame>(["slots", "plinko", "huff", "huffBonus", "lottery", "fighter", "racer", "beat", "roulette", "board"]);

/**
 * The shared announcer bridge for the games that only play result sounds (Cafe Mines, To the Moon, Penguin Cross,
 * Blackjack, Poker, 8-Ball): their own win / jackpot / loss sounds are real game events, so the announcer follows them.
 * A small win gets a minor "WINNER!" (the announcer's cooldown keeps it from repeating), a jackpot sound gets
 * "JACKPOT!", and losses only get a voice line on a run of three, so the cabinet never nags after every round.
 */
function useAnnouncingSfx(game: ArcadeGame, sfx: (n: SfxName) => void, announce: ArcadeProps["announce"]) {
  const losses = useRef(0);
  return useMemo(() => {
    if (SELF_ANNOUNCING.has(game)) return sfx;
    return (n: SfxName) => {
      sfx(n);
      if (n === "jackpot") { losses.current = 0; announce("JACKPOT!"); }
      else if (n === "win" || n === "cashout") { losses.current = 0; announce("WINNER!"); }
      else if (n === "lose" || n === "boom" || n === "splash") { if (++losses.current % 3 === 0) announce(losses.current >= 6 ? "TRY AGAIN!" : "BETTER LUCK NEXT TIME!"); }
    };
  }, [announce, game, sfx]);
}

/** Picks the right Floor 2 game window. Each one reads the shared state from the NetClient. */
export default function ArcadeHost({ game, ...props }: { game: ArcadeGame } & ArcadeProps) {
  const sfx = useAnnouncingSfx(game, props.sfx, props.announce);
  const p = { ...props, sfx };
  switch (game) {
    case "slots": return <Slots {...p} />;
    case "plinko": return <Plinko {...p} />;
    case "huff": return <HuffSlots machine="huff" {...p} />;
    case "huffBonus": return <HuffSlots machine="huffBonus" {...p} />;
    case "lottery": return <Lottery {...p} />;
    case "mines": return <Mines {...p} />;
    case "moon": return <Moon {...p} />;
    case "penguin": return <Penguin {...p} />;
    case "fighter": return <Fighter {...p} />;
    case "racer": return <Racer {...p} />;
    case "beat": return <Beat {...p} />;
    case "poker": return <Poker {...p} />;
    case "pool": return <Pool {...p} />;
    case "board": return <ArcadeBoard {...p} />;
    case "blackjack": return <Blackjack {...p} />;
    case "roulette": return <Roulette {...p} />;
  }
}
