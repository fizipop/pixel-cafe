import { isValidPixels, type Pixels } from "./editor";

// Phase 1 stores everything in the browser (localStorage). In a later phase this
// file is the ONLY thing that needs to change to talk to Supabase instead.

export type SavedCharacter = {
  id: string;
  name: string;
  pixels: Pixels;
  updatedAt: number;
};

const CHARACTERS_KEY = "pixelcafe.characters.v1";
const ACTIVE_KEY = "pixelcafe.activeCharacter.v1";
const USERNAME_KEY = "pixelcafe.username.v1";

const ADJECTIVES = [
  "Misty", "Cloudy", "Sleepy", "Cozy", "Fuzzy", "Sunny", "Rusty", "Velvet", "Mellow", "Dusty",
  "Sparkly", "Lucky", "Quiet", "Wobbly", "Golden", "Frosty", "Breezy", "Toasty", "Gentle", "Jolly",
];
const NOUNS = [
  "Muffin", "Toast", "Ghost", "Latte", "Biscuit", "Pixel", "Mocha", "Waffle", "Noodle", "Pickle",
  "Cookie", "Moth", "Comet", "Pebble", "Maple", "Cinnamon", "Bagel", "Owl", "Teacup", "Sprout",
];

export function generateUsername(rand: () => number = Math.random) {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${Math.floor(rand() * 900) + 10}`;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // storage full or blocked (private mode)
  }
}

export function getUsername(): string {
  try {
    const existing = localStorage.getItem(USERNAME_KEY);
    if (existing) return existing;
    const name = generateUsername();
    localStorage.setItem(USERNAME_KEY, name);
    return name;
  } catch {
    return generateUsername();
  }
}

export function loadCharacters(): SavedCharacter[] {
  const list = read<SavedCharacter[]>(CHARACTERS_KEY);
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && typeof c.id === "string" && typeof c.name === "string" && isValidPixels(c.pixels))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function saveCharacter(input: { id?: string; name: string; pixels: Pixels }): {
  ok: boolean;
  character: SavedCharacter;
} {
  const all = loadCharacters();
  const character: SavedCharacter = {
    id: input.id ?? crypto.randomUUID(),
    name: input.name.trim().slice(0, 24) || "Unnamed",
    pixels: input.pixels,
    updatedAt: Date.now(),
  };
  const next = [character, ...all.filter((c) => c.id !== character.id)];
  return { ok: write(CHARACTERS_KEY, next), character };
}

export function deleteCharacter(id: string) {
  write(CHARACTERS_KEY, loadCharacters().filter((c) => c.id !== id));
  if (getActiveId() === id) setActiveId(null);
}

export const getActiveId = () => {
  try { return localStorage.getItem(ACTIVE_KEY); } catch { return null; }
};
export const setActiveId = (id: string | null) => {
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch { /* ignore */ }
};
