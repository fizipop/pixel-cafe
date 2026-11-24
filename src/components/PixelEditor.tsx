"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import CharacterPreview from "./CharacterPreview";
import {
  GRID, PALETTE, emptyPixels, floodFill, isBlank, lineCells, paintCells,
  type Pixels, type Tool,
} from "@/lib/editor";
import { useHistory } from "@/lib/useHistory";
import {
  deleteCharacter, getActiveId, getUsername, loadCharacters, saveCharacter, setActiveId,
  type SavedCharacter,
} from "@/lib/characters";

const ZOOMS = [8, 12, 16, 20, 24];
const TOOLS: { id: Tool; label: string; key: string }[] = [
  { id: "pencil", label: "Pencil", key: "P" },
  { id: "eraser", label: "Eraser", key: "E" },
  { id: "bucket", label: "Bucket", key: "B" },
  { id: "picker", label: "Picker", key: "I" },
];

export default function PixelEditor() {
  const h = useHistory(emptyPixels());
  const [tool, setTool] = useState<Tool>("pencil");
  const [color, setColor] = useState(PALETTE[10]);
  const [zoomIdx, setZoomIdx] = useState(2);
  const [showGrid, setShowGrid] = useState(true);
  const [username, setUsername] = useState("");
  const [saved, setSaved] = useState<SavedCharacter[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>();
  const [name, setName] = useState("My Character");
  const [status, setStatus] = useState("");

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokeRef = useRef<{ before: Pixels; last: [number, number]; pixels: Pixels } | null>(null);
  const zoom = ZOOMS[zoomIdx];

  // ---- load saved characters + username on first render (browser only) ----
  const { reset } = h;
  useEffect(() => {
    // localStorage only exists in the browser, so we load after the first render.
    queueMicrotask(() => {
      setUsername(getUsername());
      const list = loadCharacters();
      setSaved(list);
      const active = list.find((c) => c.id === getActiveId());
      if (active) {
        reset(active.pixels);
        setCurrentId(active.id);
        setName(active.name);
      }
    });
  }, [reset]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    window.setTimeout(() => setStatus((s) => (s === msg ? "" : s)), 2500);
  }, []);

  // ---- draw the main canvas ----
  useEffect(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const size = GRID * zoom;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const c = h.pixels[y * GRID + x];
        // checkerboard shows what is transparent
        ctx.fillStyle = (x + y) % 2 ? "#3a2819" : "#43301f";
        ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        if (c) {
          ctx.fillStyle = c;
          ctx.fillRect(x * zoom, y * zoom, zoom, zoom);
        }
      }
    }
    if (showGrid && zoom >= 12) {
      ctx.fillStyle = "#00000040";
      for (let i = 1; i < GRID; i++) {
        ctx.fillRect(i * zoom, 0, 1, size);
        ctx.fillRect(0, i * zoom, size, 1);
      }
    }
  }, [h.pixels, zoom, showGrid]);

  // ---- pointer drawing ----
  const cellAt = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * GRID);
    const y = Math.floor(((e.clientY - r.top) / r.height) * GRID);
    return [Math.min(GRID - 1, Math.max(0, x)), Math.min(GRID - 1, Math.max(0, y))];
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = cellAt(e);
    const before = h.pixels;

    if (tool === "picker") {
      const c = before[y * GRID + x];
      if (c) setColor(c);
      setTool("pencil");
      return;
    }
    if (tool === "bucket") {
      const next = floodFill(before, x, y, color);
      h.setLive(next);
      h.commit(before);
      return;
    }
    const paint = tool === "eraser" ? "" : color;
    const next = paintCells(before, [[x, y]], paint);
    strokeRef.current = { before, last: [x, y], pixels: next };
    h.setLive(next);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const s = strokeRef.current;
    if (!s) return;
    const [x, y] = cellAt(e);
    if (x === s.last[0] && y === s.last[1]) return;
    const paint = tool === "eraser" ? "" : color;
    s.pixels = paintCells(s.pixels, lineCells(s.last[0], s.last[1], x, y), paint);
    s.last = [x, y];
    h.setLive(s.pixels);
  };

  const endStroke = () => {
    const s = strokeRef.current;
    if (!s) return;
    strokeRef.current = null;
    h.commit(s.before);
  };

  // ---- keyboard shortcuts ----
  const { undo, redo } = h;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" && (t as HTMLInputElement).type !== "color") return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if (mod && k === "y") { e.preventDefault(); redo(); return; }
      if (mod) return;
      const hit = TOOLS.find((t2) => t2.key.toLowerCase() === k);
      if (hit) setTool(hit.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  // ---- save / load / new / delete ----
  const onSave = () => {
    if (isBlank(h.pixels)) return flash("Draw something first!");
    const { ok, character } = saveCharacter({ id: currentId, name, pixels: h.pixels });
    setCurrentId(character.id);
    setName(character.name);
    setActiveId(character.id);
    setSaved(loadCharacters());
    flash(ok ? "Saved!" : "Couldn't save (browser storage is full or blocked)");
  };

  const onSaveAsNew = () => {
    if (isBlank(h.pixels)) return flash("Draw something first!");
    const { ok, character } = saveCharacter({ name, pixels: h.pixels });
    setCurrentId(character.id);
    setActiveId(character.id);
    setSaved(loadCharacters());
    flash(ok ? "Saved as a new character!" : "Couldn't save");
  };

  const onLoad = (c: SavedCharacter) => {
    reset(c.pixels);
    setCurrentId(c.id);
    setName(c.name);
    setActiveId(c.id);
  };

  const onNew = () => {
    reset(emptyPixels());
    setCurrentId(undefined);
    setName("My Character");
    setActiveId(null);
  };

  const onDelete = (c: SavedCharacter) => {
    if (!window.confirm(`Delete "${c.name}"? This can't be undone.`)) return;
    deleteCharacter(c.id);
    setSaved(loadCharacters());
    if (c.id === currentId) onNew();
  };

  const onClear = () => {
    const before = h.pixels;
    h.setLive(emptyPixels());
    h.commit(before);
  };

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      {/* ---------- Canvas column ---------- */}
      <section className="px-panel p-4">
        <div className="mb-3 flex flex-wrap gap-2">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`px-btn secondary ${tool === t.id ? "active" : ""}`}
              onClick={() => setTool(t.id)}
              title={`${t.label} (${t.key})`}
              aria-pressed={tool === t.id}
            >
              {t.label}
            </button>
          ))}
          <span className="mx-1 w-1 bg-bark" />
          <button className="px-btn secondary" onClick={h.undo} disabled={!h.canUndo} title="Undo (Ctrl+Z)">Undo</button>
          <button className="px-btn secondary" onClick={h.redo} disabled={!h.canRedo} title="Redo (Ctrl+Shift+Z)">Redo</button>
          <button className="px-btn danger" onClick={onClear} disabled={isBlank(h.pixels)}>Clear</button>
        </div>

        <div className="flex max-h-[75vh] max-w-full justify-center overflow-auto border-4 border-espresso bg-espresso">
          <canvas
            ref={canvasRef}
            width={GRID * zoom}
            height={GRID * zoom}
            className="pixelated block max-w-none shrink-0 touch-none"
            style={{ cursor: tool === "picker" ? "copy" : "crosshair" }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endStroke}
            onPointerCancel={endStroke}
            aria-label="Pixel drawing canvas"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button className="px-btn secondary" onClick={() => setZoomIdx((i) => Math.max(0, i - 1))} disabled={zoomIdx === 0} aria-label="Zoom out">−</button>
          <span className="w-20 text-center">{Math.round((zoom / 16) * 100)}%</span>
          <button className="px-btn secondary" onClick={() => setZoomIdx((i) => Math.min(ZOOMS.length - 1, i + 1))} disabled={zoomIdx === ZOOMS.length - 1} aria-label="Zoom in">+</button>
          <label className="ml-3 flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} className="h-5 w-5 accent-amber" />
            Grid
          </label>
        </div>
      </section>

      {/* ---------- Side column ---------- */}
      <div className="flex min-w-0 flex-col gap-6">
        <section className="px-panel p-4">
          <h2 className="mb-3 font-pixel text-xs text-amber">Colours</h2>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => { setColor(c); if (tool === "eraser" || tool === "picker") setTool("pencil"); }}
                className={`aspect-square border-4 ${color === c ? "border-foam" : "border-espresso"}`}
                style={{ background: c }}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <label className="mt-3 flex items-center gap-3">
            <input
              type="color"
              value={color}
              onChange={(e) => { setColor(e.target.value); if (tool === "eraser" || tool === "picker") setTool("pencil"); }}
              className="h-10 w-16 cursor-pointer border-4 border-espresso bg-transparent"
              aria-label="Custom colour"
            />
            <span className="uppercase">{color}</span>
          </label>
        </section>

        <section className="px-panel p-4">
          <h2 className="mb-3 font-pixel text-xs text-amber">Preview</h2>
          <div className="flex items-end gap-6">
            <div className="bg-bark p-2"><CharacterPreview pixels={h.pixels} cols={GRID} scale={4} /></div>
            <div className="bg-bark p-2"><CharacterPreview pixels={h.pixels} cols={GRID} scale={2} /></div>
            <div className="bg-bark p-2"><CharacterPreview pixels={h.pixels} cols={GRID} scale={1} /></div>
          </div>
          <p className="mt-3 text-latte">Your name in the cafe: <span className="text-cream">{username || "…"}</span></p>
          <p className="text-latte">Your username stays the same when you switch characters.</p>
        </section>

        <section className="px-panel p-4">
          <h2 className="mb-3 font-pixel text-xs text-amber">Save</h2>
          <input
            className="px-input mb-3"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            aria-label="Character name"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button className="px-btn" onClick={onSave}>{currentId ? "Save changes" : "Save"}</button>
            {currentId && <button className="px-btn secondary" onClick={onSaveAsNew}>Save as new</button>}
            <button className="px-btn secondary" onClick={onNew}>New</button>
            <span className="text-mint" role="status">{status}</span>
          </div>
        </section>

        <section className="px-panel p-4">
          <h2 className="mb-3 font-pixel text-xs text-amber">My characters ({saved.length})</h2>
          {saved.length === 0 ? (
            <p className="text-latte">Nothing saved yet. Draw someone and hit Save.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {saved.map((c) => (
                <li key={c.id} className={`flex flex-col items-center gap-1 border-4 p-2 ${c.id === currentId ? "border-mint" : "border-bark"}`}>
                  <button onClick={() => onLoad(c)} className="flex flex-col items-center gap-1" title={`Edit ${c.name}`}>
                    <div className="bg-bark"><CharacterPreview pixels={c.pixels} cols={GRID} scale={3} /></div>
                    <span className="max-w-full truncate">{c.name}</span>
                  </button>
                  <button onClick={() => onDelete(c)} className="text-ember underline">delete</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
