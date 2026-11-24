// Cafe Beans: the little reward currency. Stored on this device for now.
// Swap these functions for server calls when accounts exist (same signatures).

type Store = Pick<Storage, "getItem" | "setItem">;
const KEY = "pixelcafe.profile.v1";
const defaultStore = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

export type Profile = { beans: number; drinks: number };

export function loadProfile(store: Store | null = defaultStore()): Profile {
  try {
    const p = JSON.parse(store?.getItem(KEY) ?? "null");
    if (p && Number.isFinite(p.beans) && Number.isFinite(p.drinks)) {
      return { beans: Math.max(0, Math.floor(p.beans)), drinks: Math.max(0, Math.floor(p.drinks)) };
    }
  } catch { /* fall through */ }
  return { beans: 0, drinks: 0 };
}

export function addBeans(n: number, drinkMade = false, store: Store | null = defaultStore()): Profile {
  const cur = loadProfile(store);
  const next = { beans: cur.beans + Math.max(0, Math.floor(n)), drinks: cur.drinks + (drinkMade ? 1 : 0) };
  try { store?.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
