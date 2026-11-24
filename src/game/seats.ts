// Seat occupancy, kept as plain serialisable state so Phase 4 (Socket.IO) can run
// the SAME class on the server as the source of truth and mirror it on clients:
//
//   client -> server : "sit" { seatId }     "stand"
//   server           : state.sit(playerId, seatId) -> ok/fail, then broadcasts snapshot()/diffs
//   client           : state.load(snapshot) and re-render
//
// Occupant ids are strings: "player:<id>" or "npc:<id>".

export type SeatId = string;
export type OccupantId = string;
export type SeatSnapshot = Record<SeatId, OccupantId>;

export class SeatState {
  private bySeat = new Map<SeatId, OccupantId>();
  private byWho = new Map<OccupantId, SeatId>();
  private listeners = new Set<(snapshot: SeatSnapshot) => void>();

  isFree(seatId: SeatId): boolean {
    return !this.bySeat.has(seatId);
  }

  occupantOf(seatId: SeatId): OccupantId | undefined {
    return this.bySeat.get(seatId);
  }

  seatOf(who: OccupantId): SeatId | undefined {
    return this.byWho.get(who);
  }

  /** Take a seat. Fails (false) if someone else is in it. Moving seats releases the old one. */
  sit(who: OccupantId, seatId: SeatId): boolean {
    const current = this.bySeat.get(seatId);
    if (current === who) return true;
    if (current !== undefined) return false;
    const old = this.byWho.get(who);
    if (old !== undefined) this.bySeat.delete(old);
    this.bySeat.set(seatId, who);
    this.byWho.set(who, seatId);
    this.emit();
    return true;
  }

  /** Leave whatever seat you are in. Returns the seat id you left, if any. */
  stand(who: OccupantId): SeatId | undefined {
    const seatId = this.byWho.get(who);
    if (seatId === undefined) return undefined;
    this.byWho.delete(who);
    this.bySeat.delete(seatId);
    this.emit();
    return seatId;
  }

  snapshot(): SeatSnapshot {
    return Object.fromEntries(this.bySeat);
  }

  /** Replace everything with a snapshot (e.g. received from the server). */
  load(snapshot: SeatSnapshot) {
    this.bySeat.clear();
    this.byWho.clear();
    for (const [seatId, who] of Object.entries(snapshot)) {
      this.bySeat.set(seatId, who);
      this.byWho.set(who, seatId);
    }
    this.emit();
  }

  onChange(fn: (snapshot: SeatSnapshot) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    if (this.listeners.size === 0) return;
    const snap = this.snapshot();
    this.listeners.forEach((fn) => fn(snap));
  }
}

/**
 * How to draw a sitter. We crop the bottom ~30% of the art (the legs, which the table or
 * sofa would hide anyway) and lift the sprite so the cropped bottom rests on the seat.
 * minY/maxY are the first/last non-empty rows of the 32x32 art.
 */
export function sitPose(minY: number, maxY: number, frame = 32) {
  const cut = Math.round((maxY - minY + 1) * 0.3);
  const cropH = Math.max(1, maxY - cut + 1);
  return { cropH, lift: frame - cropH };
}

/**
 * Apply the server's seat snapshot to our local SeatState without disturbing seats that only
 * exist locally (each browser animates its own copy of Ollie, the wandering NPC).
 *
 *  - every `player:*` occupant other than `self` mirrors the server exactly
 *  - `npc:*` entries in the snapshot are ignored (the NPCs seat themselves)
 *  - if a real player takes a seat a local NPC is using, `onNpcEvicted(npcId)` runs first
 *    so that NPC can stand up and get out of the way
 */
export function mergeRemoteSeats(
  local: SeatState,
  snapshot: SeatSnapshot,
  self: OccupantId,
  onNpcEvicted: (npcId: OccupantId) => void = () => {},
) {
  const mine = local.snapshot();
  for (const [seatId, who] of Object.entries(mine)) {
    if (who.startsWith("player:") && who !== self && snapshot[seatId] !== who) local.stand(who);
  }
  for (const [seatId, who] of Object.entries(snapshot)) {
    if (!who.startsWith("player:") || who === self) continue;
    const holder = local.occupantOf(seatId);
    if (holder === who) continue;
    if (holder !== undefined) {
      if (holder.startsWith("npc:")) onNpcEvicted(holder);
      if (local.occupantOf(seatId) !== undefined) local.stand(holder);
    }
    local.sit(who, seatId);
  }
}
