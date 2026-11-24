// Shared cafe state in one place: the jukebox mood, the window weather and the table game.
// (Seat occupancy lives in seats.ts and follows the same idea.)
//
// Everything changes through `dispatch(action)`. Phase 4 plan:
//   client  -> socket.emit("world:action", action)
//   server  -> runs worldReduce, then broadcasts { state, action } to everyone
//   client  -> store.load(state)   (or dispatch the same action locally)
// The reducer is pure and has no Phaser/React/audio code, so it can run on the server as is.

import { isMood, isWeather, type Mood, type Weather } from "../lib/moods.ts";
import { newTable, tttReduce, type TttAction, type TttState } from "./tictactoe.ts";

export type WorldState = { mood: Mood; weather: Weather; table: TttState };

export type WorldAction =
  | { type: "setMood"; mood: Mood; by?: string }
  | { type: "setWeather"; weather: Weather; by?: string }
  | { type: "ttt"; action: TttAction };

export function newWorld(prefs?: Partial<Pick<WorldState, "mood" | "weather">>): WorldState {
  return { mood: prefs?.mood ?? "dusk", weather: prefs?.weather ?? "dusk", table: newTable() };
}

/** Next state, the same object when nothing changed, or null when the action is rejected. */
export function worldReduce(s: WorldState, a: WorldAction): WorldState | null {
  switch (a.type) {
    case "setMood":
      if (!isMood(a.mood)) return null;
      return a.mood === s.mood ? s : { ...s, mood: a.mood };
    case "setWeather":
      if (!isWeather(a.weather)) return null;
      return a.weather === s.weather ? s : { ...s, weather: a.weather };
    case "ttt": {
      const table = tttReduce(s.table, a.action);
      if (!table) return null;
      return table === s.table ? s : { ...s, table };
    }
  }
}

export type WorldListener = (state: WorldState, action: WorldAction | null) => void;

export class WorldStore {
  private state: WorldState;
  private listeners = new Set<WorldListener>();
  private remote: ((action: WorldAction) => boolean) | null = null;

  constructor(initial: WorldState = newWorld()) {
    this.state = initial;
  }

  // Arrow functions so they can be passed straight to React's useSyncExternalStore.
  getState = () => this.state;

  subscribe = (fn: WorldListener) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  /**
   * Online mode: actions are sent to the server instead of being applied here, and the server's
   * answer arrives through load(). Pass null to go back to solo (local reducer) mode.
   */
  setRemote(send: ((action: WorldAction) => boolean) | null) {
    this.remote = send;
  }

  get isRemote() {
    return this.remote !== null;
  }

  /** Returns true if the action was accepted (online: handed to the server). Listeners only run when something changed. */
  dispatch(action: WorldAction): boolean {
    if (this.remote) return this.remote(action);
    const next = worldReduce(this.state, action);
    if (!next) return false;
    if (next !== this.state) {
      this.state = next;
      for (const fn of [...this.listeners]) fn(next, action);
    }
    return true;
  }

  /** Replace everything (what a client does with a snapshot from the server). */
  load(state: WorldState) {
    this.state = state;
    for (const fn of [...this.listeners]) fn(state, null);
  }
}

// -------------------------------------------------------- remembered on this device

const KEY = "pixelcafe.world.v1";
type Store = Pick<Storage, "getItem" | "setItem">;
const defaultStore = (): Store | null => (typeof localStorage === "undefined" ? null : localStorage);

export function loadWorldPrefs(store: Store | null = defaultStore()): { mood: Mood; weather: Weather } {
  try {
    const p = JSON.parse(store?.getItem(KEY) ?? "null");
    return { mood: isMood(p?.mood) ? p.mood : "dusk", weather: isWeather(p?.weather) ? p.weather : "dusk" };
  } catch {
    return { mood: "dusk", weather: "dusk" };
  }
}

export function saveWorldPrefs(s: WorldState, store: Store | null = defaultStore()) {
  try { store?.setItem(KEY, JSON.stringify({ mood: s.mood, weather: s.weather })); } catch { /* ignore */ }
}
