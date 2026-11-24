"use client";
import type { RooftopGame } from "@/game/rooftopLayout";
import PhotoBooth from "./PhotoBooth";
import PolaroidWall from "./PolaroidWall";
import Roast from "./Roast";
import Stargazing from "./Stargazing";
import type { RooftopProps } from "./ui";

/** Picks the right Floor 3 window. Each one talks to the server through the NetClient. */
export default function RooftopHost({ game, ...props }: { game: RooftopGame } & RooftopProps) {
  switch (game) {
    case "roast": return <Roast {...props} />;
    case "stars": return <Stargazing {...props} />;
    case "photo": return <PhotoBooth {...props} />;
    case "wall": return <PolaroidWall {...props} />;
  }
}
