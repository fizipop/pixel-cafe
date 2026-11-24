// Pure pixel-editor logic. No React, no DOM, so it is easy to test and reuse
// (e.g. the game can render saved characters with the same data).

export const GRID = 32; // characters are 32x32 pixels
export type Pixels = string[]; // row-major, "" = transparent, otherwise "#rrggbb"
export type Tool = "pencil" | "eraser" | "bucket" | "picker";

export const emptyPixels = (): Pixels => Array(GRID * GRID).fill("");

export const inBounds = (x: number, y: number) =>
  x >= 0 && y >= 0 && x < GRID && y < GRID;

/** Cells on a straight line (Bresenham) so fast mouse moves leave no gaps. */
export function lineCells(x0: number, y0: number, x1: number, y1: number) {
  const cells: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    cells.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return cells;
}

/** Returns a new array with the cells painted, or the same array if nothing changed. */
export function paintCells(pixels: Pixels, cells: [number, number][], color: string): Pixels {
  let next: Pixels | null = null;
  for (const [x, y] of cells) {
    if (!inBounds(x, y)) continue;
    const i = y * GRID + x;
    if ((next ?? pixels)[i] === color) continue;
    if (!next) next = pixels.slice();
    next[i] = color;
  }
  return next ?? pixels;
}

/** Paint bucket (4-way flood fill). Returns the same array if nothing changed. */
export function floodFill(pixels: Pixels, x: number, y: number, color: string): Pixels {
  if (!inBounds(x, y)) return pixels;
  const target = pixels[y * GRID + x];
  if (target === color) return pixels;
  const next = pixels.slice();
  const stack: number[] = [y * GRID + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (next[i] !== target) continue;
    next[i] = color;
    const cx = i % GRID;
    const cy = (i / GRID) | 0;
    if (cx > 0) stack.push(i - 1);
    if (cx < GRID - 1) stack.push(i + 1);
    if (cy > 0) stack.push(i - GRID);
    if (cy < GRID - 1) stack.push(i + GRID);
  }
  return next;
}

export const isBlank = (pixels: Pixels) => pixels.every((p) => p === "");

/** Validate data loaded from storage so a corrupted save can never crash the app. */
export function isValidPixels(value: unknown): value is Pixels {
  return (
    Array.isArray(value) &&
    value.length === GRID * GRID &&
    value.every((v) => v === "" || (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)))
  );
}

export const PALETTE = [
  "#000000", "#1f140d", "#4a3222", "#8a6446", "#c68e5b", "#f1c27d", "#ffe0bd", "#ffffff",
  "#7a1f1f", "#d9622b", "#f2a93b", "#f7d154", "#3b7a3b", "#7fc8a9", "#1f6f78", "#2a4d8f",
  "#5b6ee1", "#9b5de5", "#c8438f", "#f28fad", "#5a5a66", "#8e8e9a", "#c4c4cc", "#e8e8ee",
];
