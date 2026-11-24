// Lounge Guestbook data layer. Stored in localStorage for now; keep these signatures and swap
// the bodies for server calls later (same idea as rumours.ts).
import { validateText } from "./rumours.ts";

export const NOTE_MAX = 80;
export const PAGE_SIZE = 2;

export type Entry = {
  id: string;
  name: string;
  text: string;
  createdAt: number;
  sample?: boolean;
};

export type GuestbookState = {
  posts: Entry[]; // notes signed on this device
  lastSignDay: string | null; // "YYYY-MM-DD" of the last signature (one per day)
};

type Store = Pick<Storage, "getItem" | "setItem">;
const KEY = "pixelcafe.guestbook.v1";
const defaultStore = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

export const SAMPLE_ENTRIES: Entry[] = [
  { id: "g1", name: "SleepyOtter12", text: "Found my favourite sofa corner. Please don't tell anyone.", createdAt: 0, sample: true },
  { id: "g2", name: "MossyLantern7", text: "Came in for one coffee, stayed for three hours.", createdAt: 0, sample: true },
  { id: "g3", name: "QuietComet33", text: "The cat chose me today. Best day this month.", createdAt: 0, sample: true },
  { id: "g4", name: "BrightPebble90", text: "Rain on the windows + piano = perfect evening.", createdAt: 0, sample: true },
  { id: "g5", name: "CozyWaffle5", text: "Lost a tic-tac-toe game to Theo. Rematch soon.", createdAt: 0, sample: true },
  { id: "g6", name: "TinyKettle41", text: "First visit! Everyone here is so gentle. Thank you.", createdAt: 0, sample: true },
];

/** Local calendar day, e.g. "2026-11-22". */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function loadState(store: Store | null = defaultStore()): GuestbookState {
  try {
    const p = JSON.parse(store?.getItem(KEY) ?? "null");
    if (p && Array.isArray(p.posts)) {
      const posts = (p.posts as Entry[]).filter(
        (e) => e && typeof e.id === "string" && typeof e.text === "string" && typeof e.name === "string" && Number.isFinite(e.createdAt),
      );
      return { posts, lastSignDay: typeof p.lastSignDay === "string" ? p.lastSignDay : null };
    }
  } catch { /* fall through */ }
  return { posts: [], lastSignDay: null };
}

const save = (s: GuestbookState, store: Store | null) => {
  try { store?.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
};

export const canSign = (s: GuestbookState, now = Date.now()) => s.lastSignDay !== dayKey(now);

export type SignResult = { ok: true; state: GuestbookState } | { ok: false; reason: string };

export function signBook(
  raw: string,
  name: string,
  now = Date.now(),
  store: Store | null = defaultStore(),
  makeId: () => string = () => `g-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
): SignResult {
  const state = loadState(store);
  if (!canSign(state, now)) return { ok: false, reason: "You already signed today's page. Come back tomorrow!" };
  const v = validateText(raw, NOTE_MAX);
  if (!v.ok) return v;
  const next: GuestbookState = {
    posts: [...state.posts, { id: makeId(), name, text: v.text, createdAt: now }],
    lastSignDay: dayKey(now),
  };
  save(next, store);
  return { ok: true, state: next };
}

/** Newest first: your own notes, then the cafe's regulars. */
export function allEntries(s: GuestbookState): Entry[] {
  return [...[...s.posts].sort((a, b) => b.createdAt - a.createdAt), ...SAMPLE_ENTRIES];
}

export const pageCount = (n: number, size = PAGE_SIZE) => Math.max(1, Math.ceil(n / size));

export function pageOf<T>(list: T[], page: number, size = PAGE_SIZE): T[] {
  const p = Math.min(Math.max(0, page), pageCount(list.length, size) - 1);
  return list.slice(p * size, p * size + size);
}

export function entryDate(e: Entry): string {
  if (e.sample) return "Opening week";
  return new Date(e.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
