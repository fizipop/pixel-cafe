// Rumour Board + Guestbook data sources for the UI. The same components work with either:
//   - a NETWORK source (shared live through the Socket.IO server), or
//   - a LOCAL source (this device only, localStorage) used when the server is offline.
// Both give React a stable snapshot through subscribe/getSnapshot (useSyncExternalStore).
import {
  POST_COOLDOWN_MS, SAMPLE_RUMOURS, addRumour, loadState as loadRumours, toggleLike,
} from "@/lib/rumours";
import { SAMPLE_ENTRIES, canSign, loadState as loadBook, signBook } from "@/lib/guestbook";
import { unescapeHtml } from "@/shared/text";
import type { Result } from "@/shared/protocol";
import type { NetClient } from "./client";

export type RumourItem = { id: string; text: string; createdAt: number; likes: number; likedByMe: boolean; mine: boolean; sample?: boolean };
export type NoteItem = { id: string; name: string; text: string; createdAt: number; mine: boolean; sample?: boolean };

export type RumourSource = {
  networked: boolean;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => RumourItem[];
  post: (text: string) => Promise<Result>;
  like: (id: string) => void;
};
export type GuestbookSource = {
  networked: boolean;
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => { entries: NoteItem[]; signedToday: boolean };
  sign: (text: string) => Promise<Result>;
};

// ---------------------------------------------------------------- network

export function netRumours(net: NetClient): RumourSource {
  let cacheKey: unknown = null;
  let cache: RumourItem[] = [];
  return {
    networked: true,
    subscribe: net.subscribe,
    getSnapshot() {
      if (cacheKey !== net.rumours) {
        cacheKey = net.rumours;
        cache = net.rumours.map((r) => ({ ...r, text: unescapeHtml(r.text) }));
      }
      return cache;
    },
    post: (text) => net.rumourPost(text),
    like: (id) => net.rumourLike(id),
  };
}

export function netGuestbook(net: NetClient): GuestbookSource {
  let cacheKey: unknown = null;
  let cache = { entries: [] as NoteItem[], signedToday: false };
  return {
    networked: true,
    subscribe: net.subscribe,
    getSnapshot() {
      if (cacheKey !== net.guestbook) {
        cacheKey = net.guestbook;
        cache = {
          signedToday: net.guestbook.signedToday,
          entries: net.guestbook.entries.map((e) => ({
            id: e.id, name: unescapeHtml(e.name), text: unescapeHtml(e.text), createdAt: e.createdAt, mine: !!e.mine, sample: e.sample,
          })),
        };
      }
      return cache;
    },
    sign: (text) => net.guestbookSign(text),
  };
}

// ------------------------------------------------------------------ local

function emitter() {
  const subs = new Set<() => void>();
  return {
    subscribe: (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn); }; },
    emit: () => subs.forEach((f) => f()),
  };
}

export function localRumours(): RumourSource {
  const { subscribe, emit } = emitter();
  let cache: RumourItem[] | null = null;
  const build = (): RumourItem[] => {
    const st = loadRumours(Date.now());
    return [
      ...st.posts.map((p) => ({ id: p.id, text: p.text, createdAt: p.createdAt, likes: p.likes + (st.liked.includes(p.id) ? 1 : 0), likedByMe: st.liked.includes(p.id), mine: true })),
      ...SAMPLE_RUMOURS.map((p) => ({ id: p.id, text: p.text, createdAt: 0, likes: p.likes + (st.liked.includes(p.id) ? 1 : 0), likedByMe: st.liked.includes(p.id), mine: false, sample: true })),
    ];
  };
  return {
    networked: false,
    subscribe,
    getSnapshot: () => (cache ??= build()),
    async post(text) {
      const r = addRumour(text, Date.now());
      if (!r.ok) return r;
      cache = null; emit();
      return { ok: true };
    },
    like(id) { toggleLike(id); cache = null; emit(); },
  };
}

export function localGuestbook(username: string): GuestbookSource {
  const { subscribe, emit } = emitter();
  let cache: { entries: NoteItem[]; signedToday: boolean } | null = null;
  const build = () => {
    const st = loadBook();
    return {
      signedToday: !canSign(st, Date.now()),
      entries: [
        ...[...st.posts].sort((a, b) => b.createdAt - a.createdAt).map((e) => ({ id: e.id, name: e.name, text: e.text, createdAt: e.createdAt, mine: true })),
        ...SAMPLE_ENTRIES.map((e) => ({ id: e.id, name: e.name, text: e.text, createdAt: e.createdAt, mine: false, sample: true })),
      ],
    };
  };
  return {
    networked: false,
    subscribe,
    getSnapshot: () => (cache ??= build()),
    async sign(text) {
      const r = signBook(text, username, Date.now());
      if (!r.ok) return r;
      cache = null; emit();
      return { ok: true };
    },
  };
}

export { POST_COOLDOWN_MS };
