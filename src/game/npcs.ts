import * as Phaser from "phaser";
import type { NavGrid, Point } from "./pathing";
import { SeatState, sitPose } from "./seats";
import type { Seat } from "./layout";
import type { Bubbles } from "./bubbles";
import { HeldCup, type DrinkKind } from "./heldCup";

export type NpcSpec = {
  id: string;
  name: string;
  tag: string; // shown as [Tag] before the name
  behavior: "barista" | "sitter" | "walker";
  home: Point; // feet position (barista, walker). Sitters start in their seat.
  seatId?: string;
  lines: string[]; // what they say when you talk to them (cycles)
  ambientSay?: string[]; // idle chatter shown in a speech bubble
  ambientEmote?: string[]; // idle emote bubbles (texture keys)
};

export const NPC_SPECS: NpcSpec[] = [
  {
    id: "mina", name: "Mina", tag: "Barista", behavior: "barista", home: { x: 224, y: 152 },
    lines: [
      "Welcome in! Grab a seat anywhere.",
      "Walk up to the counter and press E to order.",
      "The board by the window? Local rumours. Mostly harmless.",
      "Try the matcha. It's my favourite.",
    ],
    ambientSay: [
      "Fresh pour-over ready!",
      "Take a seat anywhere.",
      "Oat milk's back in stock!",
      "Careful, hot cups!",
      "Lofi's on and the kettle's on.",
    ],
  },
  {
    id: "theo", name: "Theo", tag: "Reader", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "t1-right",
    lines: [
      "Shh... just one more chapter.",
      "This book is about a cafe on the internet. Very meta.",
      "The good chairs are the ones by the window.",
      "Oh! Sorry, I was miles away.",
    ],
    ambientEmote: ["emote_coffee"],
  },
  {
    id: "kai", name: "Kai", tag: "Remote Worker", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "t3-top",
    lines: [
      "Shipping on a Sunday. Don't judge me.",
      "The wifi password is 'be kind'.",
      "I'm forty tabs deep. Send help. And coffee.",
      "Lofi plus deadlines is my whole personality.",
    ],
    ambientEmote: ["emote_dots"],
  },
  {
    id: "juno", name: "Juno", tag: "Regular", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "sofa-a-2",
    lines: [
      "This sofa has seen things. Cozy things.",
      "Best seat in the house. Come sit with me!",
      "I'm not asleep. I'm resting my eyes.",
      "Ever notice the music never repeats exactly?",
    ],
    ambientEmote: ["emote_note", "emote_heart"],
  },
  {
    id: "ollie", name: "Ollie", tag: "Wanderer", behavior: "walker", home: { x: 448, y: 216 }, // waits at the counter end, out of the order spot
   
    lines: [
      "Just doing my rounds. Counter, table, repeat.",
      "I'm on my third latte. Don't tell Mina.",
      "The rug lounge is lovely this time of day.",
      "Mind your step. I walk faster than I look.",
    ],
    ambientEmote: ["emote_coffee", "emote_wave"],
  },
];

export type NpcWorld = {
  scene: Phaser.Scene;
  bubbles: Bubbles;
  seats: SeatState;
  seatMap: Map<string, Seat>;
  nav: NavGrid;
  playerPos: () => Point;
  onClick: (npc: Npc) => void;
};

const MACHINE_SPOT = 140; // where the barista stands to pull espresso
const WIPE_MIN = 165;
const WIPE_MAX = 380;
const ART_TOP = 24; // NPC art is 24px tall, bottom-aligned in a 32px frame
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export class Npc {
  readonly spec: NpcSpec;
  x: number;
  y: number;
  mode: "stand" | "walk" | "sit" = "stand";
  seat: Seat | null = null;
  readonly sprite: Phaser.GameObjects.Image;
  readonly cup: HeldCup;

  private w: NpcWorld;
  private shadow: Phaser.GameObjects.Image;
  private label: Phaser.GameObjects.Text;
  private cloth: Phaser.GameObjects.Image | null = null;
  private path: Point[] = [];
  private lineIdx = 0;
  private busyUntil = 0;
  private nextAmbient = 0;
  readonly id: string;

  // barista state
  private bState: "wipe" | "toMachine" | "brew" | "toWipe" = "wipe";
  private bTimer = 0;
  private wipeX = 200;
  private steamAt = 0;
  private pendingOrder: (() => void) | null = null;
  // walker state
  private wState: "counter" | "toSeat" | "sit" | "back" = "counter";
  private wTimer = 0;

  constructor(spec: NpcSpec, world: NpcWorld) {
    this.spec = spec;
    this.w = world;
    this.id = `npc:${spec.id}`;
    this.x = spec.home.x;
    this.y = spec.home.y;
    const scene = world.scene;

    this.shadow = scene.add.image(this.x, this.y, "shadow");
    this.sprite = scene.add.image(this.x, this.y, `npc_${spec.id}`).setOrigin(0.5, 1);
    this.sprite.setInteractive({ useHandCursor: true });
    this.sprite.on("pointerdown", () => world.onClick(this));
    this.label = scene.add
      .text(this.x, this.y, `[${spec.tag}] ${spec.name}`, {
        fontFamily: "VT323, monospace",
        fontSize: "14px",
        color: "#d8b98a", // muted tan: NPC tags look different from player names
        stroke: "#1f140d",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(3)
      .setAlpha(0.9);
    this.cup = new HeldCup(scene);

    const now = scene.time.now;
    this.nextAmbient = now + rand(3000, 7000);
    if (spec.behavior === "sitter" && spec.seatId) {
      const seat = world.seatMap.get(spec.seatId);
      if (seat) this.sitAt(seat);
    }
    if (spec.behavior === "barista") {
      this.cloth = scene.add.image(0, 0, "cloth").setVisible(false);
      this.bTimer = rand(4000, 7000);
      this.wipeX = rand(WIPE_MIN, WIPE_MAX);
    }
    if (spec.behavior === "walker") this.wTimer = rand(2500, 4500);
  }

  /** A short name for what the NPC is doing (useful in tests). */
  get activity(): string {
    if (this.spec.behavior === "barista") return this.bState;
    if (this.spec.behavior === "walker") return this.wState;
    return this.mode;
  }

  // -------------------------------------------------------------- talking

  talk(): string {
    const line = this.spec.lines[this.lineIdx++ % this.spec.lines.length];
    const player = this.w.playerPos();
    this.sprite.setFlipX(player.x < this.x);
    this.say(line, 4600);
    this.busyUntil = this.w.scene.time.now + 4600;
    return line;
  }

  /** Someone gifted this NPC a drink: a reaction line, a heart, and a cup in hand for a while. */
  receiveGift(kind: DrinkKind, line: string, loved: boolean) {
    const player = this.w.playerPos();
    if (this.mode !== "sit") this.sprite.setFlipX(player.x < this.x);
    this.say(line, 4400);
    this.busyUntil = this.w.scene.time.now + 4400;
    if (loved) {
      this.w.bubbles.emote(`${this.id}:fx`, () => {
        const h = this.headAnchor();
        return { x: h.x + 22, y: h.y + 16 }; // beside the head, clear of the speech bubble
      }, "emote_heart", 2800);
    }
    this.cup.show(kind);
    this.w.scene.time.delayedCall(30_000, () => this.cup.hide());
  }

  say(text: string, ms = 3600) {
    this.w.bubbles.say(this.id, () => this.headAnchor(), text, ms);
  }

  private headAnchor() {
    return { x: this.sprite.x, y: this.sprite.y - ART_TOP - 18 };
  }

  // -------------------------------------------------------------- sitting

  private sitAt(seat: Seat) {
    this.w.seats.sit(this.id, seat.id);
    this.seat = seat;
    this.mode = "sit";
    const pose = sitPose(32 - ART_TOP, 31);
    this.x = seat.x;
    this.y = seat.y;
    this.sprite.setCrop(0, 0, 32, pose.cropH).setFlipX(seat.flipX);
    this.sprite.setPosition(seat.x, seat.y + pose.lift).setDepth(seat.depth);
    this.shadow.setVisible(false);
  }

  private standUp() {
    if (!this.seat) return;
    this.w.seats.stand(this.id);
    this.x = this.seat.exit.x;
    this.y = this.seat.exit.y;
    this.seat = null;
    this.mode = "stand";
    this.sprite.setCrop();
    this.shadow.setVisible(true);
  }

  /**
   * A real player (online) took the chair this walker had picked or was sitting in.
   * Get up, drop the cup and head back to the counter.
   */
  yieldSeat() {
    if (this.spec.behavior !== "walker" || !this.seat) return;
    if (this.mode === "sit") this.standUp();
    else { this.w.seats.stand(this.id); this.seat = null; }
    this.cup.hide();
    if (this.startPath(this.spec.home)) this.wState = "back";
    else { this.x = this.spec.home.x; this.y = this.spec.home.y; this.wState = "counter"; this.wTimer = rand(4000, 8000); }
  }

  // ------------------------------------------------------------- movement

  /** Walk along this.path. Returns true once the path is finished. */
  private follow(dtMs: number, speed: number): boolean {
    if (!this.path.length) return true;
    const t = this.path[0];
    const dx = t.x - this.x;
    const dy = t.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = (speed * dtMs) / 1000;
    if (dist > 0.001) {
      // wait politely if the player is standing right in front of us
      const p = this.w.playerPos();
      if (Math.hypot(p.x - (this.x + (dx / dist) * 14), p.y - (this.y + (dy / dist) * 14)) < 12) return false;
    }
    if (dist <= step) {
      this.x = t.x;
      this.y = t.y;
      this.path.shift();
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
    if (Math.abs(dx) > 0.5) this.sprite.setFlipX(dx < 0);
    return this.path.length === 0;
  }

  private startPath(to: Point): boolean {
    const path = this.w.nav.findPath({ x: this.x, y: this.y }, to);
    if (!path) return false;
    this.path = path;
    this.mode = "walk";
    return true;
  }

  // -------------------------------------------------------------- barista

  /** Brew a drink; `done` runs when it's ready. */
  brewFor(done: () => void) {
    this.pendingOrder = done;
    if (this.bState === "wipe" || this.bState === "toWipe") this.bState = "toMachine";
  }

  private steam() {
    const scene = this.w.scene;
    for (let i = 0; i < 3; i++) {
      const p = scene.add.image(112 + i * 5, 132, "puff").setDepth(260).setAlpha(0.7);
      scene.tweens.add({
        targets: p,
        y: 108,
        alpha: 0,
        scale: 1.8,
        duration: 1100,
        delay: i * 140,
        onComplete: () => p.destroy(),
      });
    }
  }

  private updateBarista(time: number, dt: number) {
    const moveTo = (tx: number, speed: number) => {
      const dx = tx - this.x;
      const step = (speed * dt) / 1000;
      if (Math.abs(dx) <= step) { this.x = tx; return true; }
      this.x += Math.sign(dx) * step;
      this.sprite.setFlipX(dx < 0);
      return false;
    };
    switch (this.bState) {
      case "wipe": {
        if (moveTo(this.wipeX, 20)) this.wipeX = rand(WIPE_MIN, WIPE_MAX);
        this.bTimer -= dt;
        if (this.bTimer <= 0) this.bState = "toMachine";
        break;
      }
      case "toMachine":
        if (moveTo(MACHINE_SPOT, 55)) {
          this.bState = "brew";
          this.bTimer = 2600;
          this.sprite.setFlipX(true);
          this.steam();
          this.steamAt = time + 800;
        }
        break;
      case "brew":
        this.bTimer -= dt;
        if (time > this.steamAt) { this.steam(); this.steamAt = time + 900; }
        if (this.bTimer <= 0) {
          const done = this.pendingOrder;
          this.pendingOrder = null;
          this.bState = "toWipe";
          done?.();
        }
        break;
      case "toWipe":
        if (moveTo(this.wipeX, 55)) {
          this.bState = "wipe";
          this.bTimer = rand(8000, 14000);
        }
        break;
    }
    // the wiping cloth rides along on the counter edge
    const wiping = this.bState === "wipe";
    this.cloth
      ?.setVisible(wiping)
      .setPosition(Math.round(this.x + (this.sprite.flipX ? -12 : 12) + Math.sin(time / 110) * 4), 160)
      .setDepth(190);
  }

  // --------------------------------------------------------------- walker

  private updateWalker(time: number, dt: number) {
    switch (this.wState) {
      case "counter":
        this.mode = "stand";
        this.wTimer -= dt;
        if (this.wTimer <= 0 && time >= this.busyUntil) {
          const free = [...this.w.seatMap.values()].filter((s) => s.kind === "chair" && this.w.seats.isFree(s.id));
          for (let tries = 0; tries < 4 && free.length; tries++) {
            const seat = free.splice(Math.floor(Math.random() * free.length), 1)[0];
            if (!this.startPath(seat.exit)) continue;
            this.w.seats.sit(this.id, seat.id); // reserve it so nobody else grabs it
            this.seat = seat;
            this.wState = "toSeat";
            this.cup.show(pick<DrinkKind>(["espresso", "matcha", "macchiato", "cocoa"]));
            this.say("Latte time!", 2200);
            return;
          }
          this.wTimer = rand(3000, 6000); // nothing free or reachable: try again later
        }
        break;
      case "toSeat":
        if (time < this.busyUntil) break;
        if (this.follow(dt, 55) && this.seat) {
          const seat = this.seat;
          this.seat = null;
          this.sitAt(seat);
          this.wState = "sit";
          this.wTimer = rand(14000, 22000);
        }
        break;
      case "sit":
        this.wTimer -= dt;
        if (this.wTimer <= 0 && time >= this.busyUntil) {
          this.standUp();
          this.cup.hide();
          if (this.startPath(this.spec.home)) this.wState = "back";
          else { this.x = this.spec.home.x; this.y = this.spec.home.y; this.wState = "counter"; this.wTimer = rand(4000, 8000); }
        }
        break;
      case "back":
        if (time < this.busyUntil) break;
        if (this.follow(dt, 55)) {
          this.mode = "stand";
          this.wState = "counter";
          this.wTimer = rand(5000, 9000);
          this.sprite.setFlipX(false);
        }
        break;
    }
  }

  // ----------------------------------------------------------------- tick

  update(time: number, dt: number) {
    if (this.spec.behavior === "barista") this.updateBarista(time, dt);
    else if (this.spec.behavior === "walker") this.updateWalker(time, dt);

    if (time >= this.nextAmbient && time >= this.busyUntil) {
      this.nextAmbient = time + rand(9000, 16000);
      const { ambientSay, ambientEmote } = this.spec;
      const preferSay = ambientSay && (!ambientEmote || Math.random() < 0.8);
      if (preferSay) this.say(pick(ambientSay!), 3800);
      else if (ambientEmote) this.w.bubbles.emote(this.id, () => this.headAnchor(), pick(ambientEmote), 2600);
    }

    // draw
    if (this.mode !== "sit") {
      const hop = this.mode === "walk" ? Math.round(Math.abs(Math.sin(time / 110)) * 2) : 0;
      const shake = this.bState === "brew" && this.spec.behavior === "barista" ? Math.round(Math.sin(time / 35)) : 0;
      this.sprite.setPosition(Math.round(this.x) + shake, Math.round(this.y) - hop).setDepth(this.y);
      this.shadow.setPosition(Math.round(this.x), Math.round(this.y) - 2).setDepth(this.y - 1);
    }
    this.label.setPosition(Math.round(this.sprite.x), Math.round(this.sprite.y) - ART_TOP - 4).setDepth(80000);
    this.cup.follow(this.sprite.x + (this.sprite.flipX ? -8 : 8), this.sprite.y - 13, this.sprite.depth + 1, time);
  }
}
