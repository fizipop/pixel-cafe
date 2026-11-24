// Where everything is on Floor 3 (the Rooftop Lounge). All positions are WORLD pixels (Floor 3 is
// shifted right by FLOOR3_X, see src/shared/floors.ts). Shared by the server (seats, who stands near
// the telescope / photo stand) and the Phaser scene.
import { FLOOR3_X } from "../shared/floors.ts";
import type { Seat } from "./layout.ts";

const X0 = FLOOR3_X;

export type RooftopGame = "roast" | "stars" | "photo" | "wall";

type Spot = { x: number; y: number; w: number; h: number; solid: { x: number; y: number; w: number; h: number }; spot: { x: number; y: number } };

/** The campfire pit in the middle of the deck. */
export const FIREPIT: Spot = {
  x: X0 + 490, y: 386, w: 60, h: 52,
  solid: { x: X0 + 496, y: 408, w: 48, h: 26 },
  spot: { x: X0 + 520, y: 462 },
};

/** Four logs around the fire. `seats` is how many people each holds. */
export const LOGS = [
  { id: "top", x: X0 + 440, y: 312, w: 160, h: 18, seats: 2, vertical: false },
  { id: "bottom", x: X0 + 440, y: 508, w: 160, h: 18, seats: 2, vertical: false },
  { id: "left", x: X0 + 408, y: 368, w: 18, h: 96, seats: 1, vertical: true },
  { id: "right", x: X0 + 614, y: 368, w: 18, h: 96, seats: 1, vertical: true },
] as const;

/** Brass telescope near the railing (E to stargaze). */
export const TELESCOPE: Spot = {
  x: X0 + 806, y: 124, w: 48, h: 64,
  solid: { x: X0 + 818, y: 164, w: 26, h: 20 },
  spot: { x: X0 + 832, y: 214 },
};

/** The Polaroid stand: a camera on a tripod with a little flash (E to take a group Polaroid). */
export const PHOTO_STAND: Spot = {
  x: X0 + 214, y: 540, w: 52, h: 68,
  solid: { x: X0 + 222, y: 590, w: 36, h: 16 },
  spot: { x: X0 + 240, y: 640 },
};

/** The shared Rooftop Polaroid Wall: a wooden panel with a clothesline of pinned photos. */
export const POLAROID_WALL: Spot = {
  x: X0 + 116, y: 120, w: 128, h: 76,
  solid: { x: X0 + 120, y: 172, w: 120, h: 18 },
  spot: { x: X0 + 180, y: 220 },
};

/** Planters, as [x, y of the base]. */
export const ROOF_PLANTS: [number, number][] = [
  [X0 + 66, 724], [X0 + 958, 724], [X0 + 958, 150], [X0 + 330, 300], [X0 + 730, 640], [X0 + 170, 700], [X0 + 700, 292], [X0 + 880, 470],
];

/** A Polaroid has room for the photographer and up to five more people from the rooftop (nearest to the stand first). */
export const PHOTO_MAX_PEOPLE = 6;
/** How close you must be to use the telescope / photo stand (the client prompt is tighter). */
export const ROOFTOP_REACH = 110;

/** Seat ids: "f3-fire-1" ... "f3-fire-6". */
export function rooftopSeats(): Seat[] {
  const seats: Seat[] = [];
  let n = 1;
  for (const log of LOGS) {
    for (let i = 0; i < log.seats; i++) {
      const id = `f3-fire-${n++}`;
      if (log.vertical) {
        const x = log.x + log.w / 2;
        const y = log.y + log.h / 2;
        const left = log.id === "left";
        seats.push({ id, kind: "sofa", x, y, depth: log.y + log.h + 2, flipX: !left, exit: { x: left ? log.x - 22 : log.x + log.w + 22, y } });
      } else {
        const x = log.x + (log.w / (log.seats + 1)) * (i + 1);
        const y = log.y + 9;
        const top = log.id === "top";
        seats.push({ id, kind: "sofa", x, y, depth: log.y + log.h + 2, flipX: false, exit: { x, y: top ? log.y - 18 : log.y + log.h + 20 } });
      }
    }
  }
  return seats;
}

/** True for a seat at the campfire (the only seats on Floor 3 that open the roasting window). */
export const isFireSeat = (seatId: string | null | undefined): boolean => !!seatId && /^f3-fire-[1-6]$/.test(seatId);

// ---- string lights ------------------------------------------------------------------------

/** Wooden posts that hold the fairy lights up: [x, y of the base]. They are solid (a little base only). */
export const LIGHT_POSTS: [number, number][] = [[X0 + 110, 290], [X0 + 914, 290], [X0 + 110, 650], [X0 + 914, 650]];

export type Strand = { x0: number; y0: number; x1: number; y1: number; sag: number; bulbs: number };
export const LIGHT_STRANDS: Strand[] = [
  { x0: X0 + 110, y0: 222, x1: X0 + 914, y1: 222, sag: 34, bulbs: 22 }, // post to post, north
  { x0: X0 + 110, y0: 582, x1: X0 + 914, y1: 582, sag: 34, bulbs: 22 }, // post to post, south
  { x0: X0 + 36, y0: 106, x1: X0 + 988, y1: 106, sag: 16, bulbs: 28 }, // along the glass railing
];

/** n points evenly spaced along a drooping strand (a parabola that sags `sag` pixels at the middle). */
export function strandPoints(s: Strand, n: number): { x: number; y: number }[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 0.5) / n;
    return { x: s.x0 + (s.x1 - s.x0) * t, y: s.y0 + (s.y1 - s.y0) * t + 4 * s.sag * t * (1 - t) };
  });
}

// ---- collision ----------------------------------------------------------------------------

export type Box = { x: number; y: number; w: number; h: number };
export const plantSolid = ([x, y]: [number, number]): Box => ({ x: x - 9, y: y - 12, w: 18, h: 12 });
export const postSolid = ([x, y]: [number, number]): Box => ({ x: x - 5, y: y - 8, w: 10, h: 8 });
export const logSolid = (log: (typeof LOGS)[number]): Box => ({ x: log.x, y: log.y + 2, w: log.w, h: log.h - 2 });

/** Every piece of furniture you cannot walk through on Floor 3 (the walls are separate). The scene and the layout test both use this. */
export function rooftopSolids(elevator: Box): Box[] {
  return [
    elevator, FIREPIT.solid, TELESCOPE.solid, PHOTO_STAND.solid, POLAROID_WALL.solid,
    ...LOGS.map(logSolid), ...ROOF_PLANTS.map(plantSolid), ...LIGHT_POSTS.map(postSolid),
  ];
}
