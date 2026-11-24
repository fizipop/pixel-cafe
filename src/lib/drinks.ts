// Drink menu + the timing mini-game rules. Pure functions so they are easy to test.

export type DrinkKind = "espresso" | "matcha" | "macchiato" | "cocoa";
export type Rating = "perfect" | "good" | "meh";

export const MAKE_MS = 3000; // the whole mini-game lasts 3 seconds
export const GIFT_BEANS = 2;

export type DrinkInfo = {
  id: DrinkKind;
  name: string;
  blurb: string;
  key: string; // menu shortcut
  liquid: string; // colour of the drink
  top: string; // foam / topping colour
  action: string; // what you are doing in the mini-game
  half: number; // half-width of the sweet spot (0..1): smaller = harder
  period: number; // ms for the slider to go from one end to the other and back
};

export const DRINKS: DrinkInfo[] = [
  { id: "espresso", name: "Espresso", blurb: "Short, strong and a bit smug.", key: "1", liquid: "#3a2314", top: "#a8703c", action: "Pull the shot", half: 0.075, period: 1000 },
  { id: "matcha", name: "Matcha Latte", blurb: "Mina's personal favourite.", key: "2", liquid: "#7fb35a", top: "#e6f1c8", action: "Whisk the foam", half: 0.11, period: 1250 },
  { id: "macchiato", name: "Caramel Macchiato", blurb: "Sweet, layered, dangerous.", key: "3", liquid: "#c68e5b", top: "#fff0cf", action: "Pour the milk", half: 0.09, period: 1100 },
  { id: "cocoa", name: "Hot Cocoa", blurb: "A warm hug in a cup.", key: "4", liquid: "#5a3322", top: "#fff6e0", action: "Stir and top up", half: 0.14, period: 1400 },
];

export const drinkInfo = (id: DrinkKind) => DRINKS.find((d) => d.id === id)!;
export const drinkName = (id: DrinkKind) => drinkInfo(id).name;

/** Slider position 0..1, sweeping back and forth like a triangle wave. */
export function sliderPos(elapsedMs: number, periodMs: number): number {
  const t = (((elapsedMs / periodMs) % 2) + 2) % 2; // 0..2
  return t <= 1 ? t : 2 - t;
}

export type Zone = { center: number; half: number };

/** A fresh sweet spot, never too close to the edges. */
export function newZone(kind: DrinkKind, rng: () => number = Math.random): Zone {
  const half = drinkInfo(kind).half;
  return { center: 0.25 + rng() * 0.5, half };
}

export function rate(pos: number, zone: Zone): Rating {
  const d = Math.abs(pos - zone.center);
  if (d <= zone.half * 0.45) return "perfect";
  if (d <= zone.half) return "good";
  return "meh";
}

export const beansFor = (r: Rating) => (r === "perfect" ? 5 : r === "good" ? 3 : 1);

export const RATING_TEXT: Record<Rating, string> = {
  perfect: "Perfect! Silky and balanced.",
  good: "Nice one. Smells great.",
  meh: "A bit wobbly, but it's hot and it's yours.",
};

/** What Mina says when she sees your drink. */
export const BARISTA_REACTION: Record<Rating, string> = {
  perfect: "Ooh, barista-level! Hire this person.",
  good: "Nice pour. Enjoy it!",
  meh: "Hey, it's the thought that counts.",
};
