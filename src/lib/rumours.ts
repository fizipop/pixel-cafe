// Rumour Board data layer. Everything is stored in localStorage for now.
// When the backend arrives, keep these function signatures and swap the bodies
// for Supabase calls (the validation and sorting stay as they are).

export const RUMOUR_MAX = 200;
export const RUMOUR_TTL_MS = 48 * 60 * 60 * 1000; // posts vanish after 48 hours
export const POST_COOLDOWN_MS = 15_000;

export type Rumour = {
  id: string;
  text: string;
  createdAt: number;
  likes: number;
  sample?: boolean; // pre-pinned by the cafe, never expires
};

export type RumourState = {
  posts: Rumour[]; // posts written on this device
  liked: string[]; // ids this device has liked
  lastPostAt: number;
};

export type SortMode = "new" | "popular";
type Store = Pick<Storage, "getItem" | "setItem">;

const KEY = "pixelcafe.rumours.v1";

export const SAMPLE_RUMOURS: Rumour[] = [
  { id: "s1", text: "The oat milk latte here tastes like a warm hug. Do not tell the oat milk haters.", createdAt: 0, likes: 14, sample: true },
  { id: "s2", text: "Someone left a tiny pixel cat on the second table by the window. It is still there. We love it.", createdAt: 0, likes: 22, sample: true },
  { id: "s3", text: "Does anyone else hear the lofi piano get slower when it rains outside?", createdAt: 0, likes: 9, sample: true },
  { id: "s4", text: "To whoever is drawing the purple scarf outfit: please enter the outfit contest. Please.", createdAt: 0, likes: 17, sample: true },
  { id: "s5", text: "Reminder: drink some water. Yes, you. Right now. This board believes in you.", createdAt: 0, likes: 31, sample: true },
  { id: "s6", text: "Is it weird that my favourite spot is the chair nobody ever picks, next to the plant?", createdAt: 0, likes: 6, sample: true },
];

// ----------------------------------------------------------------- validation

const URL_RE = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|gg|me|ly|co|app|xyz)\b)/i;
const EMAIL_RE = /\S+@\S+\.\S+/;
const MENTION_RE = /(^|\s)@\w{2,}/;
const PHONE_RE = /(\d[\s().-]*){7,}/;

export type Validation = { ok: true; text: string } | { ok: false; reason: string };

/** Light client-side guard. Real moderation belongs on the server later. */
export function validateText(raw: string, max: number): Validation {
  const text = raw.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  const length = Array.from(text).length;
  if (length === 0) return { ok: false, reason: "Write something first." };
  if (length > max) return { ok: false, reason: `Keep it under ${max} characters.` };
  if (URL_RE.test(text) || EMAIL_RE.test(text) || PHONE_RE.test(text) || MENTION_RE.test(text)) {
    return { ok: false, reason: "No links, emails, phone numbers or @names. Keep it anonymous and kind." };
  }
  return { ok: true, text };
}

export const validateRumour = (raw: string): Validation => validateText(raw, RUMOUR_MAX);

// -------------------------------------------------------------------- sorting

export const likesOf = (r: Rumour, liked: string[]) => r.likes + (liked.includes(r.id) ? 1 : 0);

export function sortRumours(list: Rumour[], mode: SortMode, liked: string[] = []): Rumour[] {
  const copy = [...list];
  if (mode === "popular") {
    copy.sort((a, b) => likesOf(b, liked) - likesOf(a, liked) || b.createdAt - a.createdAt);
  } else {
    copy.sort((a, b) => b.createdAt - a.createdAt || likesOf(b, liked) - likesOf(a, liked));
  }
  return copy;
}

export function timeAgo(r: Rumour, now: number): string {
  if (r.sample) return "pinned by the cafe";
  const mins = Math.max(0, Math.floor((now - r.createdAt) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// -------------------------------------------------------------------- storage

const defaultStore = (): Store | null => {
  try { return typeof localStorage === "undefined" ? null : localStorage; } catch { return null; }
};

export function loadState(now = Date.now(), store: Store | null = defaultStore()): RumourState {
  const empty: RumourState = { posts: [], liked: [], lastPostAt: 0 };
  if (!store) return empty;
  try {
    const raw = JSON.parse(store.getItem(KEY) ?? "null");
    if (!raw || !Array.isArray(raw.posts)) return empty;
    const posts: Rumour[] = raw.posts.filter(
      (p: Rumour) =>
        p && typeof p.id === "string" && typeof p.text === "string" &&
        typeof p.createdAt === "number" && now - p.createdAt < RUMOUR_TTL_MS,
    );
    return {
      posts,
      liked: Array.isArray(raw.liked) ? raw.liked.filter((x: unknown) => typeof x === "string") : [],
      lastPostAt: typeof raw.lastPostAt === "number" ? raw.lastPostAt : 0,
    };
  } catch {
    return empty;
  }
}

function save(state: RumourState, store: Store | null): boolean {
  if (!store) return false;
  try { store.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}

export function allRumours(state: RumourState): Rumour[] {
  return [...state.posts, ...SAMPLE_RUMOURS];
}

export type PostResult = { ok: true; state: RumourState } | { ok: false; reason: string };

export function addRumour(
  raw: string,
  now = Date.now(),
  store: Store | null = defaultStore(),
  makeId: () => string = () => `p${now.toString(36)}${Math.random().toString(36).slice(2, 7)}`,
): PostResult {
  const state = loadState(now, store);
  const v = validateRumour(raw);
  if (!v.ok) return v;
  if (now - state.lastPostAt < POST_COOLDOWN_MS) {
    const wait = Math.ceil((POST_COOLDOWN_MS - (now - state.lastPostAt)) / 1000);
    return { ok: false, reason: `Give it a moment: you can pin another in ${wait}s.` };
  }
  if (state.posts.some((p) => p.text === v.text)) return { ok: false, reason: "You already pinned that one." };
  const next: RumourState = {
    ...state,
    posts: [{ id: makeId(), text: v.text, createdAt: now, likes: 0 }, ...state.posts],
    lastPostAt: now,
  };
  if (!save(next, store)) return { ok: false, reason: "Couldn't save (browser storage is full or blocked)." };
  return { ok: true, state: next };
}

export function toggleLike(id: string, now = Date.now(), store: Store | null = defaultStore()): RumourState {
  const state = loadState(now, store);
  const liked = state.liked.includes(id) ? state.liked.filter((x) => x !== id) : [...state.liked, id];
  const next = { ...state, liked };
  save(next, store);
  return next;
}
