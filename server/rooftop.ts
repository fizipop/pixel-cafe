// Floor 3 in one place: marshmallow roasting, the star-wish wall and the Polaroid Wall. Like the
// Arcade, it never touches sockets: the Room hands it a small `host` and routes the rooftop socket
// events to `handle()`. All the rules (timing, rate limits, who is in a photo) live here.
import { ROOFTOP_REACH, PHOTO_MAX_PEOPLE, PHOTO_STAND, TELESCOPE, isFireSeat } from "../src/game/rooftopLayout.ts";
import { validateText } from "../src/lib/rumours.ts";
import {
  POLAROID_COOLDOWN_MS, POLAROID_WALL_CAP, ROAST_MAX_MS, ROAST_PERFECT_BEANS, ROAST_RATE_MAX, ROAST_RATE_MIN, ROAST_REWARD_GAP_MS,
  WISH_CAP, WISH_COOLDOWN_MS, WISH_MAX, WISH_SHOWN, WISH_TTL_MS, packPixels, roastGrade, roastHeat,
} from "../src/shared/rooftop.ts";
import { escapeHtml } from "../src/shared/text.ts";
import type { Floor } from "../src/shared/floors.ts";
import type { PolaroidView, RooftopEvent, StarWishView, StarsView } from "../src/shared/protocol.ts";
import { fail } from "./arcadeTypes.ts";
import type { PolaroidRecord, Repository } from "./repository.ts";
import type { Wallets } from "./wallet.ts";

/** A connected player as the rooftop sees them. */
export type RoofWho = { sockId: string; clientId: string; name: string; pixels: string[]; x: number; y: number; floor: Floor; seat: string | null };

export type RooftopHost = {
  now: () => number;
  rng: () => number;
  emitTo: (sockId: string, event: string, payload: unknown) => void;
  who: (sockId: string) => RoofWho | undefined;
  /** Everyone currently on Floor 3. */
  onRooftop: () => RoofWho[];
  /** A line for the chat panel of everyone on Floor 3. */
  announce: (text: string) => void;
  wallets: Wallets;
  pushWallet: (clientId: string) => void;
};

/** A few wishes already on the wall, so a quiet night still has stars to read (never stored). */
const SAMPLE_WISHES: { id: string; text: string }[] = [
  { id: "sw1", text: "I wish for one really quiet, sunny Sunday." },
  { id: "sw2", text: "May everyone in this cafe get a good night's sleep tonight." },
  { id: "sw3", text: "I hope my plants survive the winter." },
];

const newId = (prefix: string, t: number) => `${prefix}${t.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export class Rooftop {
  private repo: Repository;
  private host: RooftopHost;
  private roasts = new Map<string, { startedAt: number; rate: number }>(); // by socket id
  private lastReward = new Map<string, number>(); // roast bonus, by device
  private lastWish = new Map<string, number>();
  private lastPhoto = new Map<string, number>();
  /** Everyone with the telescope window open (they get new wishes live). */
  readonly stargazers = new Set<string>();

  constructor(repo: Repository, host: RooftopHost) {
    this.repo = repo;
    this.host = host;
    this.pruneWishes();
  }

  // ------------------------------------------------------------ lifecycle (called by the Room)

  /** The player stood up from a seat (or switched seats): their marshmallow is gone. */
  stoodUp(sockId: string) {
    this.roasts.delete(sockId);
  }

  /** The player left Floor 3 (elevator or disconnect). */
  leftFloor(sockId: string) {
    this.roasts.delete(sockId);
    this.stargazers.delete(sockId);
  }

  // ------------------------------------------------------------ requests

  handle(sockId: string, event: RooftopEvent, d: unknown): unknown {
    const w = this.host.who(sockId);
    if (!w) return fail("Not in the cafe.");
    if (w.floor !== 3) return fail("Take the elevator up to the Rooftop first.");
    const x = (d ?? {}) as Record<string, unknown>;
    switch (event) {
      case "roast:start": return this.roastStart(w);
      case "roast:pull": return this.roastPull(w);
      case "stars:join": return this.starsJoin(w);
      case "stars:leave": this.stargazers.delete(sockId); return { ok: true };
      case "stars:wish": return this.starsWish(w, x.text);
      case "polaroid:take": return this.polaroidTake(w);
      case "polaroid:wall": return { ok: true, photos: this.wall() };
      default: return fail("Unknown request.");
    }
  }

  // ------------------------------------------------------------ marshmallow roasting

  private roastStart(w: RoofWho) {
    if (!isFireSeat(w.seat)) return fail("Sit on a log by the campfire to roast a marshmallow.");
    const rate = ROAST_RATE_MIN + this.host.rng() * (ROAST_RATE_MAX - ROAST_RATE_MIN);
    this.roasts.set(w.sockId, { startedAt: this.host.now(), rate });
    return { ok: true, rate };
  }

  private roastPull(w: RoofWho) {
    const r = this.roasts.get(w.sockId);
    if (!r) return fail("Put a marshmallow on the stick first.");
    if (!isFireSeat(w.seat)) { this.roasts.delete(w.sockId); return fail("Sit on a log by the campfire to roast a marshmallow."); }
    this.roasts.delete(w.sockId);
    const t = this.host.now();
    const heat = roastHeat(Math.min(ROAST_MAX_MS, t - r.startedAt), r.rate);
    const grade = roastGrade(heat);
    const perfect = grade === "golden";
    let bonus = 0;
    if (perfect && t - (this.lastReward.get(w.clientId) ?? -Infinity) >= ROAST_REWARD_GAP_MS) {
      this.lastReward.set(w.clientId, t);
      this.host.wallets.credit(w.clientId, ROAST_PERFECT_BEANS);
      this.host.pushWallet(w.clientId);
      bonus = ROAST_PERFECT_BEANS;
      this.host.announce(`${w.name} roasted a perfect golden marshmallow`);
    }
    return { ok: true, grade, heat, perfect, bonus, beans: this.host.wallets.balance(w.clientId) };
  }

  // ------------------------------------------------------------ star wishes

  private pruneWishes() {
    this.repo.removeWishesBefore(this.host.now() - WISH_TTL_MS);
  }

  wishView(clientId: string): StarsView {
    this.pruneWishes();
    const real: StarWishView[] = this.repo.listWishes().slice(0, WISH_SHOWN).map((x) => ({ id: x.id, text: x.text, ts: x.ts, mine: x.author === clientId }));
    const samples: StarWishView[] = SAMPLE_WISHES.map((s) => ({ id: s.id, text: escapeHtml(s.text), ts: 0, mine: false }));
    return { wishes: [...real, ...samples].slice(0, WISH_SHOWN) };
  }

  private atTelescope(w: RoofWho) {
    return dist(w, TELESCOPE.spot) <= ROOFTOP_REACH;
  }

  private starsJoin(w: RoofWho) {
    if (!this.atTelescope(w)) return fail("Walk up to the telescope first.");
    this.stargazers.add(w.sockId);
    return { ok: true, ...this.wishView(w.clientId) };
  }

  private starsWish(w: RoofWho, raw: unknown) {
    if (!this.stargazers.has(w.sockId) || !this.atTelescope(w)) return fail("Look through the telescope to make a wish.");
    const v = validateText(typeof raw === "string" ? raw : "", WISH_MAX);
    if (!v.ok) return fail(v.reason);
    const t = this.host.now();
    const wait = WISH_COOLDOWN_MS - (t - (this.lastWish.get(w.clientId) ?? -Infinity));
    if (wait > 0) return fail(`The stars need a moment: you can wish again in ${Math.ceil(wait / 1000)}s.`);
    const text = escapeHtml(v.text);
    if (this.repo.listWishes().some((x) => x.text === text)) return fail("Someone already wished on that star.");
    this.lastWish.set(w.clientId, t);
    const id = newId("w", t);
    this.repo.addWish({ id, text, ts: t, author: w.clientId }, WISH_CAP);
    for (const sock of this.stargazers) {
      const s = this.host.who(sock);
      if (s) this.host.emitTo(sock, "stars:wishes", { ...this.wishView(s.clientId), fresh: id });
      else this.stargazers.delete(sock);
    }
    return { ok: true, ...this.wishView(w.clientId) };
  }

  // ------------------------------------------------------------ Polaroids

  private view(p: PolaroidRecord): PolaroidView {
    return { id: p.id, ts: p.ts, by: p.by, people: p.people };
  }

  wall(): PolaroidView[] {
    return this.repo.listPolaroids().map((p) => this.view(p));
  }

  private polaroidTake(w: RoofWho) {
    if (dist(w, PHOTO_STAND.spot) > ROOFTOP_REACH) return fail("Walk up to the photo stand first.");
    const t = this.host.now();
    const wait = POLAROID_COOLDOWN_MS - (t - (this.lastPhoto.get(w.clientId) ?? -Infinity));
    if (wait > 0) return fail(`The film is still developing: try again in ${Math.ceil(wait / 1000)}s.`);
    // everyone hanging out on the rooftop, the photographer first, then whoever is closest to the stand
    const others = this.host
      .onRooftop()
      .filter((p) => p.sockId !== w.sockId)
      .sort((a, b) => dist(a, PHOTO_STAND.spot) - dist(b, PHOTO_STAND.spot) || a.sockId.localeCompare(b.sockId))
      .slice(0, PHOTO_MAX_PEOPLE - 1);
    const people = [w, ...others].map((p) => ({ name: p.name, sprite: packPixels(p.pixels) }));
    this.lastPhoto.set(w.clientId, t);
    const rec: PolaroidRecord = { id: newId("p", t), ts: t, by: w.name, people };
    this.repo.addPolaroid(rec, POLAROID_WALL_CAP);
    const photo = this.view(rec);
    for (const p of this.host.onRooftop()) this.host.emitTo(p.sockId, "polaroid:new", photo);
    return { ok: true, photo };
  }
}
