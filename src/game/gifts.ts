// How NPCs react when you gift them a drink. Pure data + a tiny picker.
import type { DrinkKind } from "../lib/drinks.ts";

const FAVORITE: Record<string, DrinkKind | null> = {
  mina: "macchiato",
  theo: "cocoa",
  kai: "espresso",
  juno: "matcha",
  ollie: null, // Ollie loves whatever is free
};

const LOVED: Record<string, string[]> = {
  mina: ["A caramel macchiato?! You know me.", "Oh, you made my favourite. Customer of the year."],
  theo: ["Hot cocoa while I read? Best day ever.", "Cocoa! My book just got 40% better."],
  kai: ["Espresso. You just saved my sprint.", "Oh thank goodness. Caffeine. Merge approved."],
  juno: ["Matcha! You get it. You really get it.", "Mmm, matcha on the sofa. Peak life."],
  ollie: ["For me? A free drink is the best drink!", "I was just about to get one. Perfect timing!"],
};

const OTHER: Record<string, string[]> = {
  mina: ["Aw, thanks! I'll sip it on my break.", "A drink for the barista? Now I've seen everything."],
  theo: ["Thank you! I'll find a coaster.", "That's kind. I'll read slower to enjoy it."],
  kai: ["Thanks! I'll drink it before the next build.", "Aw, this is nice. Back to the code..."],
  juno: ["Oh, thanks! That's really sweet of you.", "You're a gem. Pull up a cushion."],
  ollie: ["Thanks, friend!", "Nice! I'll take it for the walk."],
};

export const favoriteOf = (npcId: string): DrinkKind | null => FAVORITE[npcId] ?? null;

/** `n` just picks which line (so repeated gifts don't repeat the same words). */
export function reactionFor(npcId: string, drink: DrinkKind, n = 0): { line: string; loved: boolean } {
  const fav = FAVORITE[npcId];
  const loved = fav === null || fav === drink; // Ollie (null) loves everything
  const pool = (loved ? LOVED[npcId] : OTHER[npcId]) ?? ["Thank you!"];
  return { line: pool[Math.abs(n) % pool.length], loved };
}
