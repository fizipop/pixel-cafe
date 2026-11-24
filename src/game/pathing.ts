// Grid path-finding for NPCs. The grid is built from the same solid rectangles the
// player collides with, inflated by the walker's size, so any path it returns is
// collision-safe by construction.

export type Rect = { x: number; y: number; w: number; h: number };
export type Point = { x: number; y: number };

export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  private blocked: Uint8Array;

  constructor(worldW: number, worldH: number, solids: Rect[], cell = 16, padX = 8, padY = 6) {
    this.cell = cell;
    this.cols = Math.ceil(worldW / cell);
    this.rows = Math.ceil(worldH / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    for (const s of solids) {
      const x0 = Math.floor((s.x - padX) / cell);
      const x1 = Math.ceil((s.x + s.w + padX) / cell) - 1;
      const y0 = Math.floor((s.y - padY) / cell);
      const y1 = Math.ceil((s.y + s.h + padY) / cell) - 1;
      for (let cy = Math.max(0, y0); cy <= Math.min(this.rows - 1, y1); cy++) {
        for (let cx = Math.max(0, x0); cx <= Math.min(this.cols - 1, x1); cx++) {
          this.blocked[cy * this.cols + cx] = 1;
        }
      }
    }
  }

  private inGrid(cx: number, cy: number) {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows;
  }

  private cellFree(cx: number, cy: number) {
    return this.inGrid(cx, cy) && this.blocked[cy * this.cols + cx] === 0;
  }

  isFree(x: number, y: number): boolean {
    return this.cellFree(Math.floor(x / this.cell), Math.floor(y / this.cell));
  }

  center(cx: number, cy: number): Point {
    return { x: cx * this.cell + this.cell / 2, y: cy * this.cell + this.cell / 2 };
  }

  /** Closest walkable cell centre to (x, y), or null if nothing is nearby. */
  nearestFree(x: number, y: number, maxRadius = 6): Point | null {
    const cx0 = Math.floor(x / this.cell);
    const cy0 = Math.floor(y / this.cell);
    let best: Point | null = null;
    let bestD = Infinity;
    for (let r = 0; r <= maxRadius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.cellFree(cx0 + dx, cy0 + dy)) continue;
          const c = this.center(cx0 + dx, cy0 + dy);
          const d = (c.x - x) ** 2 + (c.y - y) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** True if a straight line between two points only crosses free cells. */
  lineClear(a: Point, b: Point): boolean {
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist / (this.cell / 4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.isFree(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
    }
    return true;
  }

  /** A* over the grid (8 directions, no corner cutting). Returns waypoints, or null. */
  findPath(from: Point, to: Point): Point[] | null {
    const start = this.nearestFree(from.x, from.y);
    const goal = this.nearestFree(to.x, to.y);
    if (!start || !goal) return null;
    const sx = Math.floor(start.x / this.cell), sy = Math.floor(start.y / this.cell);
    const gx = Math.floor(goal.x / this.cell), gy = Math.floor(goal.y / this.cell);
    const idx = (cx: number, cy: number) => cy * this.cols + cx;

    const g = new Float32Array(this.cols * this.rows).fill(Infinity);
    const parent = new Int32Array(this.cols * this.rows).fill(-1);
    const closed = new Uint8Array(this.cols * this.rows);
    const open: number[] = [idx(sx, sy)];
    g[idx(sx, sy)] = 0;
    const h = (cx: number, cy: number) => {
      const dx = Math.abs(cx - gx), dy = Math.abs(cy - gy);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };

    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
    while (open.length) {
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) {
        const cx = open[i] % this.cols, cy = Math.floor(open[i] / this.cols);
        const f = g[open[i]] + h(cx, cy);
        if (f < bf) { bf = f; bi = i; }
      }
      const cur = open.splice(bi, 1)[0];
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.cols, cy = Math.floor(cur / this.cols);
      if (cx === gx && cy === gy) {
        const cells: Point[] = [];
        for (let n = cur; n !== -1; n = parent[n]) cells.push(this.center(n % this.cols, Math.floor(n / this.cols)));
        cells.reverse();
        return this.smooth(cells);
      }
      for (const [dx, dy] of dirs) {
        const nx = cx + dx, ny = cy + dy;
        if (!this.cellFree(nx, ny) || closed[idx(nx, ny)]) continue;
        if (dx !== 0 && dy !== 0 && (!this.cellFree(cx + dx, cy) || !this.cellFree(cx, cy + dy))) continue;
        const ng = g[cur] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1);
        if (ng < g[idx(nx, ny)]) {
          g[idx(nx, ny)] = ng;
          parent[idx(nx, ny)] = cur;
          open.push(idx(nx, ny));
        }
      }
    }
    return null;
  }

  /** Drop waypoints that a straight, collision-free line can skip. */
  private smooth(path: Point[]): Point[] {
    if (path.length <= 2) return path;
    const out: Point[] = [path[0]];
    let anchor = 0;
    for (let i = 2; i < path.length; i++) {
      if (!this.lineClear(path[anchor], path[i])) {
        out.push(path[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(path[path.length - 1]);
    return out;
  }
}
