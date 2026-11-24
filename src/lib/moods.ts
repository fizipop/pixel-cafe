// Names for the jukebox moods and window weather. Pure data, shared by the audio engine,
// the Phaser scene and the React menus.

export type Mood = "dusk" | "rain" | "bossa";
export type Weather = "dusk" | "rain" | "sun";

export const MOODS: { id: Mood; name: string; blurb: string }[] = [
  { id: "dusk", name: "Dusk Lofi Jazz", blurb: "Warm keys, soft drums, sleepy bass." },
  { id: "rain", name: "Rainy Midnight Keys", blurb: "Slow solo piano. No drums, just space." },
  { id: "bossa", name: "Morning Bossa", blurb: "Nylon strings, shaker and a gentle sway." },
];

export const WEATHERS: { id: Weather; name: string; blurb: string }[] = [
  { id: "dusk", name: "Warm Dusk", blurb: "Golden light through the windows." },
  { id: "rain", name: "Rainy Night", blurb: "Rain on the glass and soft rain sounds." },
  { id: "sun", name: "Sunny Morning", blurb: "Bright, clear and cheerful." },
];

export const isMood = (v: unknown): v is Mood => MOODS.some((m) => m.id === v);
export const isWeather = (v: unknown): v is Weather => WEATHERS.some((w) => w.id === v);
export const moodName = (id: Mood) => MOODS.find((m) => m.id === id)?.name ?? id;
