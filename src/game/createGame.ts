import * as Phaser from "phaser";
import { CafeScene, type CafeCallbacks } from "./CafeScene";
import type { DrinkKind, Rating } from "@/lib/drinks";
import type { WorldStore } from "./worldState";
import type { NetClient } from "@/net/client";
import type { Floor } from "@/shared/floors";

export type { CafeCallbacks, DrinkKind, Rating };

export type CafeHandle = {
  setCharacter: (pixels: string[]) => void;
  /** Pause/resume keyboard control (used while a React modal is open). */
  setInputEnabled: (enabled: boolean) => void;
  serveDrink: (kind: DrinkKind, rating: Rating) => void;
  talkToBarista: () => void;
  /** Ride the elevator to another floor (from the floor picker). */
  travel: (floor: Floor) => void;
  /** Stand up from the table you are sitting at (used by the blackjack / roulette windows). */
  standUp: () => void;
  destroy: () => void;
};

/** Boots the Phaser game inside `parent`. Only ever import this from client-side code. */
export function createCafeGame(
  parent: HTMLElement,
  opts: { username: string; pixels: string[]; callbacks: CafeCallbacks; world: WorldStore; net: NetClient | null },
): CafeHandle {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    backgroundColor: "#1f140d",
    pixelArt: true,
    roundPixels: true,
    audio: { noAudio: true }, // music is handled by src/lib/lofi.ts
    scale: { mode: Phaser.Scale.RESIZE, width: "100%", height: "100%" },
    physics: { default: "arcade", arcade: { debug: false } },
    scene: [CafeScene],
    callbacks: {
      preBoot: (g) => {
        g.registry.set("username", opts.username);
        g.registry.set("pixels", opts.pixels);
        g.registry.set("callbacks", opts.callbacks);
        g.registry.set("world", opts.world);
        g.registry.set("net", opts.net);
      },
    },
  });

  let destroyed = false;
  const scene = () => (destroyed ? null : (game.scene.getScene("Cafe") as CafeScene | null));

  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __cafe?: Phaser.Game }).__cafe = game; // handy for debugging
  }

  return {
    setCharacter: (pixels) => game.registry.set("pixels", pixels),
    setInputEnabled: (enabled) => scene()?.setInputEnabled(enabled),
    serveDrink: (kind, rating) => scene()?.serveDrink(kind, rating),
    talkToBarista: () => scene()?.talkToBarista(),
    travel: (floor) => void scene()?.travel(floor),
    standUp: () => scene()?.standUpFromHud(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      game.destroy(true);
    },
  };
}
