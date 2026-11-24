"use client";
import type { ArcadeGame } from "@/game/arcadeLayout";
import ArcadeBoard from "./ArcadeBoard";
import Blackjack from "./Blackjack";
import Beat from "./Beat";
import Fighter from "./Fighter";
import Penguin from "./Penguin";
import Poker from "./Poker";
import Pool from "./Pool";
import Racer from "./Racer";
import Mines from "./Mines";
import Moon from "./Moon";
import Roulette from "./Roulette";
import Slots from "./Slots";
import type { ArcadeProps } from "./ui";

/** Picks the right Floor 2 game window. Each one reads the shared state from the NetClient. */
export default function ArcadeHost({ game, ...props }: { game: ArcadeGame } & ArcadeProps) {
  switch (game) {
    case "slots": return <Slots {...props} />;
    case "mines": return <Mines {...props} />;
    case "moon": return <Moon {...props} />;
    case "penguin": return <Penguin {...props} />;
    case "fighter": return <Fighter {...props} />;
    case "racer": return <Racer {...props} />;
    case "beat": return <Beat {...props} />;
    case "poker": return <Poker {...props} />;
    case "pool": return <Pool {...props} />;
    case "board": return <ArcadeBoard {...props} />;
    case "blackjack": return <Blackjack {...props} />;
    case "roulette": return <Roulette {...props} />;
  }
}
