"use client";
import { useCallback, useState } from "react";
import type { Pixels } from "./editor";

type State = { present: Pixels; past: Pixels[]; future: Pixels[] };
const LIMIT = 100;

/** Undo/redo for the canvas. `setLive` previews a stroke; `commit` records it. */
export function useHistory(initial: Pixels) {
  const [s, setS] = useState<State>({ present: initial, past: [], future: [] });

  const setLive = useCallback((p: Pixels) => setS((st) => ({ ...st, present: p })), []);

  /** Call once when a stroke ends, with the pixels from BEFORE the stroke. */
  const commit = useCallback(
    (before: Pixels) =>
      setS((st) =>
        before === st.present
          ? st
          : { present: st.present, past: [...st.past.slice(-(LIMIT - 1)), before], future: [] },
      ),
    [],
  );

  const undo = useCallback(
    () =>
      setS((st) => {
        if (!st.past.length) return st;
        const prev = st.past[st.past.length - 1];
        return { present: prev, past: st.past.slice(0, -1), future: [st.present, ...st.future] };
      }),
    [],
  );

  const redo = useCallback(
    () =>
      setS((st) => {
        if (!st.future.length) return st;
        const [next, ...rest] = st.future;
        return { present: next, past: [...st.past, st.present], future: rest };
      }),
    [],
  );

  /** Replace everything (loading a character) and clear history. */
  const reset = useCallback((p: Pixels) => setS({ present: p, past: [], future: [] }), []);

  return {
    pixels: s.present,
    canUndo: s.past.length > 0,
    canRedo: s.future.length > 0,
    setLive, commit, undo, redo, reset,
  };
}
