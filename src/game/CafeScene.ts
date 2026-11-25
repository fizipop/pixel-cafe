import * as Phaser from "phaser";
import { GRID } from "@/lib/editor";
import { buildTextures } from "./art";
import { buildSpriteTextures } from "./sprites";
import { PLAYER_ID, SPAWN, TILE, WORLD_H, WORLD_W, WALL_H } from "./constants";
import {
  BOARD, COFFEE_TABLE, COUNTER, COUNTER_ZONE, GAME_NPC, GAME_SEAT_PREFIX, GAME_TABLE,
  GUESTBOOK_SPOT, JUKEBOX_SPOT, OUTFIT_STAND, PRIVATE_TABLES, SOFAS, TABLES, buildSeats, gameBoardPos, privateTableOf, type Seat,
} from "./layout";
import { SeatState, mergeRemoteSeats, sitPose } from "./seats";
import { RemotePlayer } from "./remotePlayers";
import type { NetClient } from "@/net/client";
import { MOVE_HZ, type FloorState, type PlayerState } from "@/shared/protocol";
import { unescapeHtml } from "@/shared/text";
import { NavGrid, type Rect } from "./pathing";
import { Bubbles } from "./bubbles";
import { HeldCup, type DrinkKind } from "./heldCup";
import { NPC_SPECS, Npc, type NpcWorld } from "./npcs";
import { buildPropTextures, JUKEBOX } from "./props";
import { buildArcadeTextures } from "./arcadeArt";
import { buildArcadeFloor } from "./arcadeFloor";
import { buildRooftopTextures } from "./rooftopArt";
import { buildRooftopFloor } from "./rooftopFloor";
import { PHOTO_STAND, POLAROID_WALL, TELESCOPE, isFireSeat, type RooftopGame } from "./rooftopLayout";
import { ARCADE_H, MACHINES, ROULETTE_WATCH, TABLE_GAME, TABLE_NAME, arcadeSeatInfo, arcadeSolids, arcadeWalls, isRigSeat, type ArcadeGame, type Machine } from "./arcadeLayout";
import { FLOOR2_X, FLOOR3_X, STAIRS, WORLD_TOTAL_H, WORLD_TOTAL_W, floorBounds, type Floor } from "@/shared/floors";
import { buildCasinoTextures } from "./casinoArt";
import { ARCADE_CROWD, CAFE_REGULARS, CREW, ROOFTOP_CROWD, TALK_GROUPS } from "./crowd";
import type { CrowdMood } from "./npcs";
import { WeatherLayer } from "./weather";
import { Cat } from "./cat";
import { reactionFor } from "./gifts";
import { chooseMove, newTable, type TttState } from "./tictactoe";
import type { WorldAction, WorldState, WorldStore } from "./worldState";
import { BARISTA_REACTION, GIFT_BEANS, beansFor, drinkName, type Rating } from "@/lib/drinks";
import type { Mood } from "@/lib/moods";
import type { SfxName } from "@/lib/sfx";

/** How the scene talks to the React UI. Everything is optional-safe on the React side. */
export type CafeCallbacks = {
  onOpenBoard: () => void;
  onOpenOrder: () => void;
  onOpenJukebox: () => void;
  onOpenGuestbook: () => void;
  onOpenGame: () => void;
  onOpenOutfits: () => void;
  onOpenArcade: (game: ArcadeGame) => void;
  /** The elevator's floor picker (pick a floor, then the page calls `travel`). */
  onOpenFloors: () => void;
  /** A Floor 3 window: roast a marshmallow, stargaze, take a Polaroid or look at the Polaroid Wall. */
  onOpenRooftop: (game: RooftopGame) => void;
  onSfx: (name: SfxName) => void;
  onBeans: (amount: number, drinkMade: boolean) => void;
};

const MOOD_GLOW: Record<Mood, number> = { dusk: 0xf2a93b, rain: 0x7fa8e8, bossa: 0xa8e07f };

const SPEED = 130; // pixels per second
const SEAT_RANGE = 34;
const NPC_RANGE = 56;
const BOARD_RANGE = 46;
const JUKEBOX_RANGE = 40;
const GUESTBOOK_RANGE = 54;
const OUTFIT_RANGE = 46;
const CAT_RANGE = 40;
const MACHINE_RANGE = 40;
const STAIRS_RANGE = 46;
const ROOF_RANGE = 44; // telescope / photo stand / Polaroid Wall prompts
const CUP_MS = 60_000;
/** The camera may scroll this far above a floor's back wall, so the HUD's top bar sits over a dark "ceiling" band
 *  instead of covering what hangs on the wall (the sports lounge's big screen and its sign, the cabinet marquees). */
export const CAM_TOP = 64;
/** How far above the player the camera centres (world px). */
export const CAM_LOOK_UP = 64;

const PLANTS: [number, number][] = [
  [62, 740], [962, 740], [962, 150], [456, 168], [452, 726], [580, 726], [662, 372],
];

const EMOTES = ["emote_wave", "emote_coffee", "emote_heart", "emote_note"]; // keys 1-4

type Target =
  | { kind: "seat"; seat: Seat }
  | { kind: "npc"; npc: Npc }
  | { kind: "counter" }
  | { kind: "board" }
  | { kind: "jukebox" }
  | { kind: "guestbook" }
  | { kind: "outfits" }
  | { kind: "cat" }
  | { kind: "elevator" }
  | { kind: "machine"; machine: Machine }
  | { kind: "watch" }
  | { kind: "stars" }
  | { kind: "photo" }
  | { kind: "wall" };

export class CafeScene extends Phaser.Scene {
  private hitbox!: Phaser.Physics.Arcade.Image;
  private avatar!: Phaser.GameObjects.Image;
  private label!: Phaser.GameObjects.Text;
  private shadow!: Phaser.GameObjects.Image;
  private prompt!: Phaser.GameObjects.Text;
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private glows: Phaser.GameObjects.Image[] = [];

  private solidRects: Rect[] = [];
  private nav!: NavGrid;
  private seats = new SeatState(); // who sits where (sync-ready, see seats.ts)
  private seatList: Seat[] = buildSeats();
  private seatMap = new Map(this.seatList.map((s) => [s.id, s]));
  private bubbles!: Bubbles;
  private npcs: Npc[] = [];
  private barista!: Npc;

  private art = { minY: 8, maxY: 31 }; // first/last painted rows of the player's art
  private seated: Seat | null = null;
  private inputEnabled = true;
  private playerCup!: HeldCup;
  private cupUntil = 0;
  private lastEmoteAt = 0;
  private giftCount = 0;
  private world!: WorldStore;
  private weather!: WeatherLayer;
  private cat!: Cat;
  private badge!: Phaser.GameObjects.Image;
  private crown!: Phaser.GameObjects.Image;
  private selfCrowned = false;
  private padlocks = new Map<string, Phaser.GameObjects.Image>(); // private table id -> padlock
  private jukeGlow!: Phaser.GameObjects.Image;
  private jukeMood: Mood | null = null;
  private tttTex!: Phaser.Textures.CanvasTexture;
  private aiPending = false;
  private lastWinner: TttState["winner"] = null;
  private unsubWorld: (() => void) | null = null;
  // ---- multiplayer (all null/empty when playing solo)
  private net: NetClient | null = null;
  private selfOcc = PLAYER_ID; // our id in seat + table state
  private remotes = new Map<string, RemotePlayer>();
  private offNet: (() => void)[] = [];
  private lastSent = { x: -1, y: -1, flip: false, moving: false, t: 0 };
  private sitPending = false;
  private floor: Floor = 1;
  private floorBusy = false;
  private shuttingDown = false;
  // Key presses are captured from keydown *events* (not polled), so a very quick tap that
  // goes down and up inside one frame is never lost.
  private pressed = { interact: false, gift: false, emotes: [false, false, false, false], move: false };

  constructor() {
    super("Cafe");
  }

  create() {
    buildTextures(this);
    buildSpriteTextures(this);
    buildPropTextures(this);
    buildArcadeTextures(this);
    buildCasinoTextures(this);
    buildRooftopTextures(this);
    this.world = this.registry.get("world") as WorldStore;
    this.net = (this.registry.get("net") as NetClient | null | undefined) ?? null;
    if (this.net) this.selfOcc = this.net.occupant;
    this.physics.world.setBounds(0, 0, WORLD_TOTAL_W, WORLD_TOTAL_H); // all three floors live side by side (Floor 2 is the tallest)
    this.add.image(0, 0, "bg").setOrigin(0).setDepth(0);
    this.add.image(BOARD.x, BOARD.y, "board").setOrigin(0).setDepth(2);

    this.bubbles = new Bubbles(this);
    this.createPlayer();
    this.buildWorld();
    this.nav = new NavGrid(WORLD_W, WORLD_H, this.solidRects);
    this.createNpcs();
    this.playerCup = new HeldCup(this);
    this.badge = this.add.image(0, 0, "cup_espresso").setVisible(false);
    this.crown = this.add.image(0, 0, "crown").setVisible(false);
    this.cat = new Cat(this, this.nav, this.bubbles);
    this.weather = new WeatherLayer(this, WORLD_W, WORLD_H);
    this.startJukeboxNotes();

    this.add.image(0, 0, "vignette").setOrigin(0).setDepth(100000);

    this.prompt = this.add
      .text(0, 0, "", {
        fontFamily: "VT323, monospace",
        fontSize: "16px",
        color: "#fff6e0",
        backgroundColor: "#1f140dd9",
        align: "center",
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5, 0)
      .setResolution(3)
      .setDepth(90002)
      .setVisible(false);

    const cam = this.cameras.main;
    cam.setZoom(2);
    cam.setBounds(0, -CAM_TOP, WORLD_W, WORLD_H + CAM_TOP); // Floor 1; changeFloor() moves this to the floor you travel to
    // the ceiling band above each floor (what the camera shows behind the HUD's top bar)
    for (const [x0, col] of [[0, 0x140d08], [FLOOR2_X, 0x0a0716], [FLOOR3_X, 0x0b1020]] as const) this.add.rectangle(x0, -CAM_TOP, WORLD_W, CAM_TOP, col).setOrigin(0).setDepth(0);
    cam.startFollow(this.hitbox, true, 0.12, 0.12);
    cam.setFollowOffset(0, CAM_LOOK_UP); // frame a little above you: wall-mounted things (the lounge screen) clear the top bar
    cam.roundPixels = true;

    this.keys = this.input.keyboard!.addKeys(
      "W,A,S,D,UP,DOWN,LEFT,RIGHT,E,SPACE,ONE,TWO,THREE,FOUR",
    ) as Record<string, Phaser.Input.Keyboard.Key>;

    this.input.keyboard!.on("keydown", this.onKeyDown, this);
    this.registry.events.on("changedata-pixels", this.onPixels, this);

    // Shared state (jukebox mood, weather, table game) comes from the WorldStore.
    this.unsubWorld = this.world.subscribe((state, action) => this.onWorld(state, action));
    if (this.net) {
      this.goOnline(this.net);
    } else {
      this.world.dispatch({ type: "ttt", action: { type: "leave", by: PLAYER_ID } }); // clean slate if we re-enter
      this.world.dispatch({ type: "ttt", action: { type: "join", side: "O", by: GAME_NPC } }); // Theo takes the O seat
    }
    this.lastWinner = this.world.getState().table.winner; // don't "react" to a game that ended before we arrived
    this.onWorld(this.world.getState(), null);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.shuttingDown = true;
      this.offNet.forEach((f) => f());
      this.offNet = [];
      this.remotes.forEach((r) => r.destroy());
      this.remotes.clear();
      if (this.net) this.world.setRemote(null);
      this.unsubWorld?.();
      this.unsubWorld = null;
      this.registry.events.off("changedata-pixels", this.onPixels, this);
      this.input.keyboard?.off("keydown", this.onKeyDown, this);
    });

    this.tweens.add({
      targets: this.glows,
      alpha: { from: 0.2, to: 0.28 },
      duration: 2400,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  private onKeyDown(e: KeyboardEvent) {
    if (e.repeat) return;
    switch (e.code) {
      case "KeyE": case "Space": this.pressed.interact = true; break;
      case "KeyG": this.pressed.gift = true; break;
      case "Digit1": case "Numpad1": this.pressed.emotes[0] = true; break;
      case "Digit2": case "Numpad2": this.pressed.emotes[1] = true; break;
      case "Digit3": case "Numpad3": this.pressed.emotes[2] = true; break;
      case "Digit4": case "Numpad4": this.pressed.emotes[3] = true; break;
      case "KeyW": case "KeyA": case "KeyS": case "KeyD":
      case "ArrowUp": case "ArrowDown": case "ArrowLeft": case "ArrowRight":
        this.pressed.move = true; break;
    }
  }

  private takePresses() {
    const p = this.pressed;
    const out = { interact: p.interact, gift: p.gift, emotes: [...p.emotes], move: p.move };
    p.interact = false; p.gift = false; p.move = false; p.emotes = [false, false, false, false];
    return out;
  }

  // ---------------------------------------------------------------- world

  private solid(x: number, y: number, w: number, h: number, nav = true) {
    if (nav) this.solidRects.push({ x, y, w, h }); // Floor 2 furniture isn't on the NPCs' map
    const z = this.add.zone(x + w / 2, y + h / 2, w, h);
    this.physics.add.existing(z, true);
    this.physics.add.collider(this.hitbox, z);
  }

  private place(key: string, x: number, y: number, flipX = false) {
    // (x, y) is the top-left; depth = bottom edge so things sort correctly
    const img = this.add.image(x, y, key).setOrigin(0).setFlipX(flipX);
    img.setDepth(y + img.height);
    return img;
  }

  private buildWorld() {
    // boundary walls
    this.solid(0, 0, WORLD_W, WALL_H);
    this.solid(0, 0, TILE, WORLD_H);
    this.solid(WORLD_W - TILE, 0, TILE, WORLD_H);
    this.solid(0, WORLD_H - TILE, WORLD_W, TILE);

    // counter + staff area behind it
    for (let col = COUNTER.col0; col <= COUNTER.col1; col++) this.place("counter", col * TILE, COUNTER.row * TILE);
    this.solid(COUNTER.col0 * TILE, COUNTER.row * TILE, (COUNTER.col1 - COUNTER.col0 + 1) * TILE, TILE);
    this.solid(TILE, WALL_H, 12 * TILE, 2 * TILE);
    const top = COUNTER.row * TILE + 8;
    const onCounter = COUNTER.row * TILE + 40;
    this.place("machine", 3 * TILE + 2, top - 30).setDepth(onCounter);
    this.place("register", 11 * TILE + 6, top - 12).setDepth(onCounter);
    [6, 7, 8].forEach((col, i) => this.place("cup", col * TILE + 12, top - 4 + (i % 2)).setDepth(onCounter));
    this.steam(3 * TILE + 14, top - 34);

    // tables + chairs
    TABLES.forEach(([col, row], i) => {
      const x = col * TILE;
      const y = row * TILE;
      this.place("chair_front", x + 20, y - 14).setDepth(y + 10); // behind the table
      this.place("chair_side", x - 18, y + 18);
      this.place("chair_side", x + 62, y + 18, true);
      this.place("table", x, y);
      this.place("chair_back", x + 20, y + 44).setDepth(y + 80); // in front of the table
      this.solid(x + 6, y + 22, 52, 28);
      this.lamp(x + 32, y);
      if (i === 3) this.place("laptop", x + 24, y + 12).setDepth(y + 57); // Kai's laptop (lid faces us)
      if (i === 5) this.crewProps(x, y); // the Pixel Restaurant crew's table
      if (i === GAME_TABLE) this.place("book", x + 8, y + 15).setDepth(y + 57); // Theo's book (he also plays tic-tac-toe)
    });

    // private table (6 seats): one long table, chairs placed from the seat list
    for (const t of PRIVATE_TABLES) {
      const seats = this.seatList.filter((s) => privateTableOf(s.id) === t.id);
      this.place("table_long", t.x, t.y);
      this.solid(t.x + 6, t.y + 22, t.w - 12, 28);
      this.lamp(t.x + t.w / 2, t.y);
      for (const s of seats) {
        const kind = s.id.slice(t.id.length + 1);
        if (kind.startsWith("top")) this.place("chair_front", s.x - 12, t.y - 14).setDepth(t.y + 10);
        else if (kind.startsWith("bottom")) this.place("chair_back", s.x - 12, t.y + 44).setDepth(t.y + 80);
        else if (kind === "left") this.place("chair_side", s.x - 9, t.y + 18);
        else this.place("chair_side", s.x - 11, t.y + 18, true);
      }
      const lock = this.add.image(t.x + t.w / 2, t.y + 8, "lock_icon").setDepth(t.y + 90).setVisible(false);
      this.padlocks.set(t.id, lock);
    }

    // fashion stand (outfit leaderboard)
    const os = OUTFIT_STAND;
    this.place("outfit_stand", os.x, os.y);
    this.solid(os.solid.x, os.solid.y, os.solid.w, os.solid.h);

    // lounge: two sofas around a coffee table on the rug
    const [sofaA, sofaB] = SOFAS;
    this.place("sofa_back", sofaA.x, sofaA.y);
    this.solid(sofaA.x, sofaA.y + 4, 96, 36);
    this.place("coffee_table", COFFEE_TABLE.x, COFFEE_TABLE.y);
    this.solid(COFFEE_TABLE.x + 4, COFFEE_TABLE.y + 8, 48, 18);
    this.place("sofa_front", sofaB.x, sofaB.y);
    this.solid(sofaB.x, sofaB.y, 96, 36);
    this.glow(748, 480, 1.7);
    this.place("guestbook", GUESTBOOK_SPOT.x, GUESTBOOK_SPOT.y).setDepth(COFFEE_TABLE.y + 40);

    // tic-tac-toe board on the game table (redrawn whenever the table state changes)
    const bp = gameBoardPos();
    this.tttTex = this.textures.createCanvas("ttt_board", 19, 13)!;
    this.add.image(bp.x, bp.y, "ttt_board").setOrigin(0).setDepth(bp.y + 60);

    // jukebox against the back wall
    const j = JUKEBOX_SPOT;
    this.place("jukebox", j.x, j.y).setDepth(j.y + JUKEBOX.h);
    this.solid(j.solid.x, j.solid.y, j.solid.w, j.solid.h);
    this.jukeGlow = this.add
      .image(j.x + JUKEBOX.w / 2, j.y + 18, "glow")
      .setScale(0.8)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.3)
      .setDepth(90001);
    this.tweens.add({ targets: this.jukeGlow, alpha: { from: 0.22, to: 0.38 }, duration: 900, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    for (const [x, y] of PLANTS) {
      const p = this.place("plant", x - 12, y - 40);
      p.setDepth(y);
      this.solid(x - 8, y - 12, 16, 12);
    }

    // the elevator on Floor 1, the whole Arcade on Floor 2 and the Rooftop Lounge on Floor 3
    const floorBuilder = {
      scene: this,
      place: (key: string, x: number, y: number, flip?: boolean) => this.place(key, x, y, flip),
      solid: (x: number, y: number, w: number, h: number, nav = false) => this.solid(x, y, w, h, nav),
    };
    buildArcadeFloor(floorBuilder);
    buildRooftopFloor(floorBuilder);
  }

  /** Four laptops (one per crew member, facing them) and a little Pixel Restaurant table tent, plus a subtle sign. */
  private crewProps(x: number, y: number) {
    this.place("laptop", x + 24, y + 10).setDepth(y + 57); // Faizan's (top seat): we see the lid
    this.place("laptop_screen", x + 24, y + 30).setDepth(y + 58); // Nick's (bottom seat): its screen faces us, the site is up
    this.place("laptop_side", x + 6, y + 24).setDepth(y + 57); // Puneet's (left)
    this.place("laptop_side", x + 52, y + 24, true).setDepth(y + 57); // Cris's (right)
    this.place("tent_card", x + 40, y + 14).setDepth(y + 57);
    this.add.text(x + 32, y + 104, "Pixel Restaurant HQ", { fontFamily: "VT323, monospace", fontSize: "12px", color: "#e8a070", stroke: "#1f140d", strokeThickness: 2 })
      .setOrigin(0.5, 1).setResolution(3).setAlpha(0.8).setDepth(y + 2); // below the table, clear of the crew's nameplates
  }

  private lamp(cx: number, tableY: number) {
    this.place("lamp", cx - 7, tableY - 70).setDepth(90000);
    this.glow(cx, tableY + 24, 1.5);
  }

  private glow(x: number, y: number, scale: number) {
    const g = this.add
      .image(x, y, "glow")
      .setScale(scale)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.22)
      .setDepth(90001);
    this.glows.push(g);
  }

  private steam(x: number, y: number) {
    for (let i = 0; i < 3; i++) {
      const p = this.add.image(x + i * 4 - 4, y, "puff").setDepth(COUNTER.row * TILE + 60).setAlpha(0);
      this.tweens.add({
        targets: p,
        y: y - 22,
        alpha: { from: 0.55, to: 0 },
        scale: { from: 0.6, to: 1.4 },
        duration: 1700,
        delay: i * 560,
        repeat: -1,
      });
    }
  }

  private createNpcs() {
    const world: NpcWorld = {
      scene: this,
      bubbles: this.bubbles,
      seats: this.seats,
      seatMap: this.seatMap,
      nav: this.nav,
      playerPos: () => ({ x: this.hitbox.x, y: this.hitbox.y }),
      onClick: (npc) => this.onNpcClick(npc),
    };
    const floor1 = [...NPC_SPECS, ...CREW, ...CAFE_REGULARS].map((spec) => new Npc(spec, world));
    world.others = () => floor1;
    // Floor 2 has its own path-finding grid built from the Arcade's furniture, so the crowd walks around machines,
    // tables, rigs and couches instead of through them
    const nav2 = new NavGrid(WORLD_TOTAL_W, ARCADE_H, [...arcadeSolids(STAIRS[2].solid), ...arcadeWalls()]);
    const world2: NpcWorld = { ...world, nav: nav2 };
    this.arcadeCrowd = ARCADE_CROWD.map((spec) => new Npc(spec, world2));
    world2.others = () => this.arcadeCrowd;
    // the rooftop has its own people (they stay at their spots, so they share Floor 1's grid just for the bookkeeping)
    const floor3 = ROOFTOP_CROWD.map((spec) => new Npc(spec, world));
    this.npcs = [...floor1, ...this.arcadeCrowd, ...floor3];
    this.barista = this.npcs.find((n) => n.spec.id === "mina")!;
    this.talks = TALK_GROUPS.map((g) => ({ ...g, people: this.npcs.filter((n) => g.members.includes(n.spec.id)), next: this.time.now + 5000 + Math.random() * 6000, idx: Math.floor(Math.random() * g.talks.length) }));
  }

  private arcadeCrowd: Npc[] = [];
  private talks: ((typeof TALK_GROUPS)[number] & { people: Npc[]; next: number; idx: number })[] = [];

  /**
   * Every so often each group (the crew, the friends, the rooftop couple) chats: each line in turn, the others turn to
   * look at whoever is speaking, and their idle chatter is held back so the conversation never piles up bubbles.
   */
  private updateGroupTalks(time: number) {
    const p = { x: this.hitbox.x, y: this.hitbox.y };
    for (const g of this.talks) {
      if (g.floor !== this.floor || time < g.next || g.people.length < g.members.length) continue;
      const talking = g.people.some((n) => Math.hypot(p.x - n.x, p.y - n.y) < 44); // the player is chatting with them: let them
      g.next = time + (talking ? 6000 : 14000 + Math.random() * 10000);
      if (talking) continue;
      const script = g.talks[g.idx++ % g.talks.length];
      for (const n of g.people) n.hold(script.length * 2700 + 600);
      script.forEach(([who, line], k) => {
        this.time.delayedCall(k * 2700, () => {
          const speaker = g.people.find((n) => n.spec.id === who);
          if (!speaker) return;
          speaker.say(line, 2600, "direct"); // a scripted line: shown (the held-back idle chatter is what gives way)
          for (const n of g.people) if (n !== speaker) n.lookAt(speaker.x, 2700);
        });
      });
      g.next = Math.max(g.next, time + script.length * 2700 + 4000);
    }
  }

  /** The announcer called a result: arcade NPCs near the player react (Togi reacts to anything he can hear). */
  crowdReact(mood: CrowdMood | "neutral") {
    if (mood === "neutral" || this.floor !== 2) return;
    const p = { x: this.hitbox.x, y: this.hitbox.y };
    const near = this.arcadeCrowd
      .map((n) => ({ n, d: Math.hypot(n.x - p.x, n.y - p.y) }))
      .filter(({ n, d }) => d < (n.spec.id === "togi" ? 420 : 280))
      .sort((a, b) => a.d - b.d);
    const togi = near.find((q) => q.n.spec.id === "togi");
    const pickd = [...(togi ? [togi] : []), ...near.filter((q) => q !== togi)].slice(0, mood === "jackpot" ? 3 : 2);
    pickd.forEach(({ n }, k) => this.time.delayedCall(350 + k * 700, () => n.react(mood)));
  }

  // --------------------------------------------------------------- player

  private createPlayer() {
    this.paintPlayer(this.registry.get("pixels") as string[]);

    this.hitbox = this.physics.add.image(SPAWN.x, SPAWN.y, "px").setVisible(false);
    (this.hitbox.body as Phaser.Physics.Arcade.Body).setSize(14, 10);
    this.hitbox.setCollideWorldBounds(true);

    this.shadow = this.add.image(SPAWN.x, SPAWN.y, "shadow");
    this.avatar = this.add.image(SPAWN.x, SPAWN.y, "player").setOrigin(0.5, 1);

    const name = (this.registry.get("username") as string) ?? "";
    this.label = this.add
      .text(SPAWN.x, SPAWN.y, name, {
        fontFamily: "VT323, monospace",
        fontSize: "16px",
        color: "#fff6e0",
        stroke: "#1f140d",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(3);
  }

  // Phaser calls "changedata-<key>" handlers with (parent, newValue, previousValue)
  private onPixels(_parent: unknown, value: string[]) {
    this.paintPlayer(value);
    this.net?.sendProfile(value); // everyone else sees the new look right away
  }

  private paintPlayer(pixels: string[]) {
    const tex = this.textures.exists("player")
      ? (this.textures.get("player") as Phaser.Textures.CanvasTexture)
      : this.textures.createCanvas("player", GRID, GRID);
    if (!tex) return;
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, GRID, GRID);
    let minY = GRID;
    let maxY = -1;
    pixels.forEach((color, i) => {
      if (!color) return;
      const y = Math.floor(i / GRID);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      ctx.fillStyle = color;
      ctx.fillRect(i % GRID, y, 1, 1);
    });
    tex.refresh();
    this.art = maxY < 0 ? { minY: 8, maxY: 31 } : { minY, maxY }; // used to rest feet/seat correctly
  }

  private playerHead = () => ({ x: this.avatar.x, y: this.label.y - this.label.height - 2 });

  // --------------------------------------------------------- public hooks

  /** Called by React when a modal opens/closes so typing doesn't walk the character. */
  setInputEnabled(enabled: boolean) {
    this.inputEnabled = enabled;
    const kb = this.input.keyboard!;
    kb.enabled = enabled;
    // Phaser also stops the browser from typing W/A/S/D/E/Space/1-4 ("global capture").
    // Turn that off while a text box is open, or those letters would never reach it.
    if (enabled) kb.enableGlobalCapture();
    else kb.disableGlobalCapture();
    this.takePresses();
    if (!enabled) {
      kb.resetKeys();
      this.hitbox.setVelocity(0, 0);
      this.prompt.setVisible(false);
    }
  }

  /** You finished the drink mini-game: hold the cup, show the badge, collect beans. */
  serveDrink(kind: DrinkKind, rating: Rating) {
    this.playerCup.show(kind);
    this.net?.sendDrink(kind);
    this.cupUntil = this.time.now + CUP_MS;
    this.bubbles.emote("player", this.playerHead, "emote_coffee", 3000);
    this.barista.say(BARISTA_REACTION[rating], 3400, "direct");
    const beans = beansFor(rating);
    this.cb()?.onBeans(beans, true);
    this.floatText(`+${beans} beans`);
  }

  private cb() {
    return this.registry.get("callbacks") as CafeCallbacks | undefined;
  }

  private sfx(name: SfxName) {
    this.cb()?.onSfx?.(name);
  }

  private floatText(text: string, color = "#f2c36b") {
    const t = this.add
      .text(this.avatar.x + 30, this.label.y - 6, text, {
        fontFamily: "VT323, monospace", fontSize: "16px", color, stroke: "#1f140d", strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(3)
      .setDepth(90003);
    this.tweens.add({ targets: t, y: t.y - 28, alpha: 0, duration: 1500, ease: "Cubic.easeOut", onComplete: () => t.destroy() });
  }

  talkToBarista() {
    this.talkTo(this.barista);
  }

  /** The table window's "Leave table" button. */
  standUpFromHud() {
    if (this.seated) this.standUp();
  }

  // ---------------------------------------------------------- interaction

  private findTarget(): Target | null {
    const px = this.hitbox.x;
    const py = this.hitbox.y;
    let best: { score: number; t: Target } | null = null;
    const offer = (score: number, t: Target) => {
      if (!best || score < best.score) best = { score, t };
    };

    for (const seat of this.seatList) {
      if (!this.seats.isFree(seat.id)) continue;
      const d = Math.hypot(px - seat.exit.x, py - seat.exit.y);
      if (d <= SEAT_RANGE) offer(d, { kind: "seat", seat });
    }
    for (const npc of this.npcs) {
      const d = Math.hypot(px - npc.x, py - npc.y);
      if (d <= NPC_RANGE) offer(d + 5, { kind: "npc", npc });
    }
    if (px >= COUNTER_ZONE.x0 && px <= COUNTER_ZONE.x1 && py >= COUNTER_ZONE.y0 && py <= COUNTER_ZONE.y1) {
      offer(4, { kind: "counter" }); // beats an NPC standing at the counter
    }
    const bd = Math.hypot(px - BOARD.spot.x, py - BOARD.spot.y);
    if (bd <= BOARD_RANGE) offer(bd, { kind: "board" });
    const jd = Math.hypot(px - JUKEBOX_SPOT.spot.x, py - JUKEBOX_SPOT.spot.y);
    if (jd <= JUKEBOX_RANGE) offer(jd, { kind: "jukebox" });
    const gd = Math.hypot(px - GUESTBOOK_SPOT.spot.x, py - GUESTBOOK_SPOT.spot.y);
    if (gd <= GUESTBOOK_RANGE) offer(gd + 8, { kind: "guestbook" });
    const od = Math.hypot(px - OUTFIT_STAND.spot.x, py - OUTFIT_STAND.spot.y);
    if (od <= OUTFIT_RANGE) offer(od + 4, { kind: "outfits" });
    const cd = Math.hypot(px - this.cat.x, py - this.cat.y);
    if (cd <= CAT_RANGE) offer(cd - 6, { kind: "cat" }); // the cat is small and cute: it wins ties
    const sp = STAIRS[this.floor].spot;
    const sd = Math.hypot(px - sp.x, py - sp.y);
    if (sd <= STAIRS_RANGE) offer(sd, { kind: "elevator" });
    if (this.floor === 2) {
      for (const m of MACHINES) {
        if (!m.game) continue;
        const md = Math.hypot(px - m.spot.x, py - m.spot.y);
        if (md <= MACHINE_RANGE) offer(md, { kind: "machine", machine: m });
      }
      const wd = Math.hypot(px - ROULETTE_WATCH.x, py - ROULETTE_WATCH.y);
      if (wd <= 40) offer(wd, { kind: "watch" });
    }
    if (this.floor === 3) {
      const near = (spot: { x: number; y: number }) => Math.hypot(px - spot.x, py - spot.y);
      if (near(TELESCOPE.spot) <= ROOF_RANGE) offer(near(TELESCOPE.spot), { kind: "stars" });
      if (near(PHOTO_STAND.spot) <= ROOF_RANGE) offer(near(PHOTO_STAND.spot), { kind: "photo" });
      if (near(POLAROID_WALL.spot) <= ROOF_RANGE) offer(near(POLAROID_WALL.spot), { kind: "wall" });
    }
    return best ? (best as { score: number; t: Target }).t : null;
  }

  private atGameTable() {
    return !!this.seated && this.seated.id.startsWith(GAME_SEAT_PREFIX);
  }

  private arcadeSeat() {
    return arcadeSeatInfo(this.seated?.id);
  }

  private promptFor(t: Target | null): string {
    if (this.seated) {
      const arc = this.arcadeSeat();
      if (arc) return `Press E to open the ${TABLE_NAME[arc.table]} table\nMove to stand up`;
      if (isRigSeat(this.seated.id)) return "Press E to race Neon Drift GP\nMove to climb out";
      if (this.seated.id.startsWith("f2-ls-")) return "Watching the Pixel League\nPress E to stand";
      if (isFireSeat(this.seated.id)) return "Press E to roast a marshmallow\nMove to stand up";
      if (this.atGameTable()) return "Press E to play Tic-Tac-Toe\nMove to stand up";
      if (privateTableOf(this.seated.id)) return "Private Table: chat stays at this table\nPress E to stand";
      return "Press E to stand";
    }
    if (!t) return "";
    switch (t.kind) {
      case "seat": {
        const arc = arcadeSeatInfo(t.seat.id);
        if (arc) return `Press E to sit at the ${TABLE_NAME[arc.table]} table`;
        if (isRigSeat(t.seat.id)) return "Press E to sit in the racing rig";
        if (t.seat.id.startsWith("f2-ls-")) return "Press E to sit and watch the game";
        if (isFireSeat(t.seat.id)) return "Press E to sit by the campfire";
        if (t.seat.id.startsWith(GAME_SEAT_PREFIX)) return "Press E to sit and play Tic-Tac-Toe";
        return privateTableOf(t.seat.id) ? "Press E to join the Private Table (up to 6)" : "Press E to sit";
      }
      case "npc": {
        const talk = `Press E to talk to ${t.npc.spec.name}`;
        return this.playerCup.visible && this.playerCup.kind ? `${talk}\nPress G to gift your ${drinkName(this.playerCup.kind)}` : talk;
      }
      case "counter": return "Press E to make a drink";
      case "board": return "Press E to read the rumours";
      case "jukebox": return "Press E to use the jukebox";
      case "guestbook": return "Press E to open the guestbook";
      case "outfits": return "Press E to view the Outfit Board";
      case "cat": return "Press E to pet Biscuit";
      case "elevator":
        if (!this.net) return "The elevator needs the cafe server\n(npm run dev:all)";
        return "Press E to use the elevator\n(Floors 1 · 2 · 3)";
      case "machine": return `Press E to ${t.machine.label}`;
      case "watch": return "Press E to watch & bet at the Roulette table";
      case "stars": return this.net ? "Press E to stargaze through the telescope" : "The stars need the cafe server\n(npm run dev:all)";
      case "photo": return this.net ? "Press E to take a group Polaroid" : "The photo stand needs the cafe server\n(npm run dev:all)";
      case "wall": return this.net ? "Press E to look at the Polaroid Wall" : "The wall needs the cafe server\n(npm run dev:all)";
    }
  }

  private activate(t: Target) {
    const cb = this.cb();
    switch (t.kind) {
      case "seat": this.sit(t.seat); break;
      case "npc": this.sfx("interact"); this.talkTo(t.npc); break;
      case "counter": this.sfx("interact"); cb?.onOpenOrder(); break;
      case "board": this.sfx("interact"); cb?.onOpenBoard(); break;
      case "jukebox": this.sfx("jukebox"); cb?.onOpenJukebox(); break;
      case "guestbook": this.sfx("page"); cb?.onOpenGuestbook(); break;
      case "outfits": this.sfx("page"); cb?.onOpenOutfits(); break;
      case "cat": this.petCat(); break;
      case "elevator": this.openElevator(); break;
      case "machine": this.sfx("interact"); if (t.machine.game) cb?.onOpenArcade(t.machine.game); break;
      case "watch": this.sfx("interact"); cb?.onOpenArcade("roulette"); break;
      case "stars": this.roofWindow("stars"); break;
      case "photo": this.roofWindow("photo"); break;
      case "wall": this.roofWindow("wall"); break;
    }
  }

  // ------------------------------------------------------------- floors

  /** E at the elevator: the page opens its floor picker, which calls `travel` with the floor you chose. */
  private openElevator() {
    if (!this.net) {
      this.bubbles.say("player", this.playerHead, "The elevator needs the cafe server.", 2600);
      return;
    }
    this.sfx("interact");
    this.cb()?.onOpenFloors();
  }

  /** Floor 3 windows (telescope, photo stand, Polaroid Wall) all need the server. */
  private roofWindow(game: RooftopGame) {
    if (!this.net) {
      this.bubbles.say("player", this.playerHead, "That needs the cafe server.", 2600);
      return;
    }
    this.sfx("interact");
    this.cb()?.onOpenRooftop(game);
  }

  /** Ride the elevator to `to` (you must be standing at it; the server checks). The answer also arrives as a `floor:state` event. */
  async travel(to: Floor) {
    if (!this.net || this.floorBusy || this.shuttingDown) return;
    if (to === this.floor) return;
    this.floorBusy = true;
    const r = await this.net.goFloor(to);
    this.floorBusy = false;
    if (!r.ok && !this.shuttingDown) this.bubbles.say("player", this.playerHead, r.reason, 2600);
  }

  /** Move everything that depends on the floor: who is visible, seats, camera, where we stand. */
  private changeFloor(floor: Floor, x: number, y: number, players: PlayerState[], seats: FloorState["seats"] | null) {
    this.floor = floor;
    for (const r of this.remotes.values()) { this.bubbles.clear(r.id); r.destroy(); }
    this.remotes.clear();
    if (seats) mergeRemoteSeats(this.seats, seats, this.selfOcc, (id) => this.evictNpc(id));
    for (const p of players) this.addRemote(p);
    this.refreshRemoteSeats();
    const body = this.hitbox.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(x, y);
    const b = floorBounds(floor);
    const cam = this.cameras.main;
    cam.setBounds(b.x, b.y - CAM_TOP, b.w, b.h + CAM_TOP);
    cam.centerOn(x, y);
    cam.fadeIn(350, 12, 8, 24);
    this.lastSent = { x: -1, y: -1, flip: false, moving: false, t: 0 };
    this.sfx("elevator");
  }

  private petCat() {
    this.cat.pet();
    this.sfx("purr");
    if (Math.random() < 0.35) this.time.delayedCall(450, () => this.sfx("meow"));
  }

  /** Put the cup down (it ran out, or we gave it away) and tell everyone. */
  private dropCup() {
    this.playerCup.hide();
    this.cupUntil = 0;
    this.net?.sendDrink(null);
  }

  private tryGift() {
    let near: Npc | null = null;
    let nd = NPC_RANGE;
    for (const npc of this.npcs) {
      const d = Math.hypot(this.hitbox.x - npc.x, this.hitbox.y - npc.y);
      if (d <= nd) { near = npc; nd = d; }
    }
    if (!near) return;
    const kind = this.playerCup.kind;
    if (!this.playerCup.visible || !kind) {
      this.bubbles.say("player", this.playerHead, "I need a drink to give!", 1800);
      return;
    }
    this.dropCup();
    const r = reactionFor(near.spec.id, kind, this.giftCount++);
    near.receiveGift(kind, r.line, r.loved);
    this.cb()?.onBeans(GIFT_BEANS, false);
    this.floatText(`+${GIFT_BEANS} beans`);
    this.sfx("gift");
  }

  private talkTo(npc: Npc) {
    npc.talk();
  }

  private onNpcClick(npc: Npc) {
    if (!this.inputEnabled) return;
    const d = Math.hypot(this.hitbox.x - npc.x, this.hitbox.y - npc.y);
    if (d <= NPC_RANGE + 40) this.talkTo(npc);
    else this.bubbles.say("player", this.playerHead, "Walk a bit closer!", 1800);
  }

  private sit(seat: Seat) {
    if (this.net) {
      // the server decides who gets the chair
      if (this.sitPending) return;
      this.sitPending = true;
      void this.net.sit(seat.id).then((r) => {
        this.sitPending = false;
        if (this.shuttingDown || this.seated) return;
        if (r.ok) this.finishSit(seat);
        else this.bubbles.say("player", this.playerHead, r.reason, 2600);
      });
      return;
    }
    if (!this.seats.sit(this.selfOcc, seat.id)) return;
    this.finishSit(seat);
  }

  private finishSit(seat: Seat) {
    if (this.net) {
      // the server already said yes: if a local NPC (Ollie) was in that chair, he gets up
      const holder = this.seats.occupantOf(seat.id);
      if (holder && holder !== this.selfOcc) {
        this.npcs.find((n) => n.id === holder)?.yieldSeat();
        if (this.seats.occupantOf(seat.id)) this.seats.stand(holder);
      }
      this.seats.sit(this.selfOcc, seat.id);
    }
    this.seated = seat;
    const body = this.hitbox.body as Phaser.Physics.Arcade.Body;
    body.enable = false;
    this.hitbox.setVelocity(0, 0);
    this.hitbox.setPosition(seat.x, seat.y - 4);
    this.sfx("sit");
    const arc = arcadeSeatInfo(seat.id);
    if (arc) this.time.delayedCall(450, () => { if (this.seated?.id === seat.id) this.cb()?.onOpenArcade(TABLE_GAME[arc.table]); });
    if (isRigSeat(seat.id)) this.time.delayedCall(450, () => { if (this.seated?.id === seat.id) this.cb()?.onOpenArcade("racer"); }); // buckle in, the race window opens
    if (seat.id.startsWith(GAME_SEAT_PREFIX)) {
      if (!this.net) this.world.dispatch({ type: "ttt", action: { type: "join", side: "X", by: this.selfOcc } }); // online: the server seats us
      this.time.delayedCall(450, () => { if (this.atGameTable()) this.cb()?.onOpenGame(); }); // the board comes to you
    }
  }

  private standUp() {
    const seat = this.seated;
    if (!seat) return;
    this.seats.stand(this.selfOcc);
    this.seated = null;
    this.sfx("stand");
    if (this.net) this.net.stand();
    else if (seat.id.startsWith(GAME_SEAT_PREFIX)) {
      this.world.dispatch({ type: "ttt", action: { type: "leave", by: this.selfOcc } });
    }
    const body = this.hitbox.body as Phaser.Physics.Arcade.Body;
    body.enable = true;
    body.reset(seat.exit.x, seat.exit.y);
    this.avatar.setCrop();
    this.lastSent.x = -1; // make sure our new position goes out right away
  }

  private emote(n: number) {
    const now = this.time.now;
    if (now - this.lastEmoteAt < 450) return;
    this.lastEmoteAt = now;
    this.bubbles.emote("player", this.playerHead, EMOTES[n], 2600);
    this.net?.sendEmote(n);
    this.sfx("emote");
  }

  // --------------------------------------------------------------- update

  update(time: number, delta: number) {
    this.bubbles.update(time);
    // NPCs only think when the player is on their floor (a hidden floor costs nothing)
    for (const npc of this.npcs) if ((npc.spec.floor ?? 1) === this.floor || npc.spec.behavior === "barista") npc.update(time, delta);
    this.updateGroupTalks(time);
    this.cat.update(time, delta);
    this.weather.update(delta);
    for (const r of this.remotes.values()) r.update(time, delta);

    if (this.playerCup.visible && time > this.cupUntil) this.dropCup();

    const k = this.keys;
    const { interact, gift, emotes, move: moveTapped } = this.takePresses();

    let dx = 0;
    let dy = 0;
    let target: Target | null = null;

    if (this.inputEnabled) {
      emotes.forEach((hit, n) => hit && this.emote(n));

      if (this.seated) {
        if (moveTapped) this.standUp();
        else if (interact) {
          const arc = this.arcadeSeat();
          if (isFireSeat(this.seated.id)) this.roofWindow("roast"); // E at the campfire: roast a marshmallow
          else if (arc) this.cb()?.onOpenArcade(TABLE_GAME[arc.table]); // E re-opens the table
          else if (isRigSeat(this.seated.id)) this.cb()?.onOpenArcade("racer"); // E in the rig: race again
          else if (this.atGameTable()) this.cb()?.onOpenGame(); // E re-opens the board; walking away stands you up
          else this.standUp();
        }
      } else {
        dx = (k.D.isDown || k.RIGHT.isDown ? 1 : 0) - (k.A.isDown || k.LEFT.isDown ? 1 : 0);
        dy = (k.S.isDown || k.DOWN.isDown ? 1 : 0) - (k.W.isDown || k.UP.isDown ? 1 : 0);
        if (dx && dy) { dx *= Math.SQRT1_2; dy *= Math.SQRT1_2; }
        target = this.findTarget();
        if (gift) this.tryGift();
        if (interact && target) { this.activate(target); target = null; }
      }
    }
    if (!this.seated) this.hitbox.setVelocity(dx * SPEED, dy * SPEED);

    this.renderPlayer(time, dx !== 0 || dy !== 0, dx);
    this.sendPosition(time, dx !== 0 || dy !== 0);

    const text = this.inputEnabled ? this.promptFor(target) : "";
    if (text) {
      if (this.prompt.text !== text) this.prompt.setText(text);
      const bounce = Math.round(Math.sin(time / 220));
      this.prompt.setPosition(Math.round(this.hitbox.x), Math.round(this.hitbox.y) + 10 + bounce).setVisible(true);
    } else {
      this.prompt.setVisible(false);
    }
  }

  // ------------------------------------------------- shared state -> visuals

  private onWorld(state: WorldState, action: WorldAction | null) {
    if (this.weather.weather !== state.weather || action === null) this.weather.set(state.weather);
    if (this.jukeMood !== state.mood) {
      this.jukeMood = state.mood;
      this.jukeGlow.setTint(MOOD_GLOW[state.mood]);
    }
    this.drawTable(state.table);
    if (!this.world.isRemote) this.tableAi(state.table); // online, the server plays Theo's moves
    this.tableReactions(state.table);
  }

  private drawTable(t: TttState) {
    const c = this.tttTex.getContext();
    c.clearRect(0, 0, 19, 13);
    c.fillStyle = "#8a5a36";
    c.fillRect(0, 0, 19, 13);
    c.fillStyle = "#f4e4c1";
    c.fillRect(1, 1, 17, 11);
    c.fillStyle = "#8a5a36"; // grid lines
    [6, 12].forEach((x) => c.fillRect(x, 1, 1, 11));
    [4, 8].forEach((y) => c.fillRect(1, y, 17, 1));
    t.board.forEach((cell, i) => {
      if (!cell) return;
      const cx = 1 + (i % 3) * 6 + 1;
      const cy = 1 + Math.floor(i / 3) * 4;
      const px = (dx: number, dy: number, col: string) => { c.fillStyle = col; c.fillRect(cx + dx, cy + dy, 1, 1); };
      if (cell === "X") [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]].forEach(([dx, dy]) => px(dx, dy, "#d9622b"));
      else [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]].forEach(([dx, dy]) => px(dx, dy, "#3a6fb0"));
    });
    this.tttTex.refresh();
  }

  /** When the table's turn belongs to an NPC, it thinks for a moment and then plays. */
  private tableAi(t: TttState) {
    if (t.winner || !t.players.X || !t.players.O || this.aiPending) return;
    const who = t.players[t.turn];
    if (!who || !who.startsWith("npc:")) return;
    this.aiPending = true;
    this.time.delayedCall(750 + Math.random() * 650, () => {
      this.aiPending = false;
      const cur = this.world.getState().table;
      if (cur.winner || cur.players[cur.turn] !== who) return; // things changed while thinking
      const idx = chooseMove(cur.board, cur.turn);
      if (idx >= 0) this.world.dispatch({ type: "ttt", action: { type: "move", idx, by: who } });
    });
  }

  private tableReactions(t: TttState) {
    if (t.winner === this.lastWinner) return;
    this.lastWinner = t.winner;
    if (!t.winner) return;
    const theo = this.npcs.find((n) => `npc:${n.spec.id}` === GAME_NPC);
    if (!theo || (t.players.X !== GAME_NPC && t.players.O !== GAME_NPC)) return; // only when Theo was playing
    const mine = t.winner !== "draw" && t.players[t.winner] === GAME_NPC;
    theo.say(t.winner === "draw" ? "A draw! Again?" : mine ? "Ha! Got you. Rematch?" : "Well played! You got me.", 3600, "direct");
  }

  private startJukeboxNotes() {
    const j = JUKEBOX_SPOT;
    this.time.addEvent({
      delay: 1500,
      loop: true,
      callback: () => {
        const n = this.add
          .image(j.x + 8 + Math.random() * 16, j.y - 2, "mini_note")
          .setTint(MOOD_GLOW[this.jukeMood ?? "dusk"])
          .setDepth(90004)
          .setAlpha(0.9);
        this.tweens.add({
          targets: n, y: n.y - 26, x: n.x + (Math.random() - 0.5) * 14, alpha: 0, duration: 2200,
          ease: "Sine.easeOut", onComplete: () => n.destroy(),
        });
      },
    });
  }

  // ----------------------------------------------------------- multiplayer

  /** Switch the room to the server: shared world, other players, seats, chat bubbles. */
  private goOnline(net: NetClient) {
    const init = net.init;
    this.world.setRemote((a) => net.worldAction(a));
    this.world.load(init.world);
    this.paintPlayer(this.registry.get("pixels") as string[]);
    net.sendProfile(this.registry.get("pixels") as string[]); // in case the character changed while connecting

    mergeRemoteSeats(this.seats, init.seats, this.selfOcc, (id) => this.evictNpc(id));
    for (const p of init.players) this.addRemote(p);
    this.refreshRemoteSeats();
    this.showLocks(init.locks);
    this.showCrowns(init.crowns);

    this.offNet.push(
      net.on("player:joined", (p) => { this.addRemote(p); this.refreshRemoteSeats(); }),
      net.on("player:left", ({ id }) => {
        this.remotes.get(id)?.destroy();
        this.remotes.delete(id);
        this.bubbles.clear(id);
      }),
      net.on("player:profile", ({ id, pixels }) => this.remotes.get(id)?.setPixels(pixels)),
      net.on("player:drink", ({ id, kind }) => this.remotes.get(id)?.setDrink(kind)),
      net.on("moves", (list) => {
        for (const m of list) this.remotes.get(m.id)?.setTarget(m.x, m.y, m.flip, m.moving);
      }),
      net.on("emote", ({ id, n }) => {
        const r = this.remotes.get(id);
        if (r && EMOTES[n]) this.bubbles.emote(id, r.head, EMOTES[n], 2600);
      }),
      net.on("seats", (snap) => {
        mergeRemoteSeats(this.seats, snap, this.selfOcc, (id) => this.evictNpc(id));
        this.refreshRemoteSeats();
      }),
      net.on("chat", (m) => {
        const text = unescapeHtml(m.text);
        const ms = Math.min(8000, 3200 + text.length * 40);
        if (m.from === net.selfId) this.bubbles.say("player", this.playerHead, text, ms);
        else {
          const r = this.remotes.get(m.from);
          if (r) this.bubbles.say(m.from, r.head, text, ms);
        }
      }),
      net.on("world", (state) => this.world.load(state)),
      net.on("floor:state", (fs) => {
        if (this.seated) { this.seats.stand(this.selfOcc); this.seated = null; this.avatar.setCrop(); }
        this.changeFloor(fs.floor, fs.x, fs.y, fs.players, fs.seats);
      }),
      net.on("locks", (ids) => this.showLocks(ids)),
      net.on("crowns", (ids) => this.showCrowns(ids)),
      net.onClose(() => this.goSolo()),
    );
  }

  private showLocks(ids: string[]) {
    for (const [id, img] of this.padlocks) img.setVisible(ids.includes(id));
  }

  private showCrowns(ids: string[]) {
    this.selfCrowned = !!this.net && ids.includes(this.net.selfId);
    for (const [id, r] of this.remotes) r.setCrowned(ids.includes(id));
  }

  private addRemote(p: PlayerState) {
    if (p.id === this.net?.selfId) return;
    this.remotes.get(p.id)?.destroy();
    const r = new RemotePlayer(this, p);
    r.setCrowned(!!this.net?.crowns.includes(p.id));
    this.remotes.set(p.id, r);
  }

  /** Make each remote player sit in the chair the server says they are in. */
  private refreshRemoteSeats() {
    for (const [id, r] of this.remotes) {
      const seatId = this.seats.seatOf(`player:${id}`);
      r.seat = seatId ? this.seatMap.get(seatId) ?? null : null;
    }
  }

  private evictNpc(occupant: string) {
    this.npcs.find((n) => n.id === occupant)?.yieldSeat();
  }

  /** Our position, at most MOVE_HZ times a second and only when something changed. */
  private sendPosition(time: number, moving: boolean) {
    if (!this.net || this.seated) return;
    const x = Math.round(this.hitbox.x);
    const y = Math.round(this.hitbox.y);
    const flip = this.avatar.flipX;
    const l = this.lastSent;
    if (x === l.x && y === l.y && moving === l.moving && flip === l.flip) return;
    if (time - l.t < 1000 / MOVE_HZ && moving === l.moving) return; // throttle (a stop is sent at once)
    this.lastSent = { x, y, flip, moving, t: time };
    this.net.sendMove(x, y, flip, moving);
  }

  /** The connection dropped: keep playing alone, like before the server existed. */
  private goSolo() {
    if (!this.net || this.shuttingDown) return;
    this.net = null;
    this.selfCrowned = false;
    if (this.floor !== 1) this.changeFloor(1, STAIRS[1].arrive.x, STAIRS[1].arrive.y, [], null); // the Arcade and Rooftop need the server
    this.showLocks([]);
    this.offNet.forEach((f) => f());
    this.offNet = [];
    this.remotes.forEach((r) => { this.bubbles.clear(r.id); r.destroy(); });
    this.remotes.clear();
    for (const [, who] of Object.entries(this.seats.snapshot())) {
      if (who.startsWith("player:") && who !== this.selfOcc) this.seats.stand(who);
    }
    this.world.setRemote(null);
    const w = this.world.getState();
    this.world.load({ ...w, table: newTable() });
    this.world.dispatch({ type: "ttt", action: { type: "join", side: "O", by: GAME_NPC } });
    if (this.atGameTable()) this.world.dispatch({ type: "ttt", action: { type: "join", side: "X", by: this.selfOcc } });
    this.bubbles.say("player", this.playerHead, "Lost the connection. Playing solo.", 3600);
  }

  private renderPlayer(time: number, moving: boolean, dx: number) {
    const { minY, maxY } = this.art;
    const { x, y } = this.hitbox;

    if (this.seated) {
      const seat = this.seated;
      const pose = sitPose(minY, maxY);
      this.avatar
        .setCrop(0, 0, GRID, pose.cropH)
        .setFlipX(seat.flipX)
        .setScale(1)
        .setPosition(seat.x, seat.y + pose.lift)
        .setDepth(seat.depth);
      this.shadow.setVisible(false);
    } else {
      // little hop while walking, a gentle squash on each step
      const phase = Math.abs(Math.sin(time / 95));
      const hop = moving ? Math.round(phase * 3) : 0;
      if (dx !== 0) this.avatar.setFlipX(dx < 0);
      const feet = GRID - 1 - maxY; // empty rows under the art, so feet touch the floor
      this.avatar
        .setScale(moving ? 1 + (1 - phase) * 0.04 : 1, moving ? 1 - (1 - phase) * 0.06 : 1)
        .setPosition(Math.round(x), Math.round(y) + 4 + feet - hop)
        .setDepth(y + 4);
      this.shadow.setVisible(true).setPosition(Math.round(x), Math.round(y) + 2).setScale(1 - hop * 0.06).setDepth(y + 3);
    }

    const artTop = this.avatar.y - (GRID - minY);
    this.label.setPosition(Math.round(this.avatar.x), Math.round(artTop) - 4).setDepth(80000);
    // a tiny cup next to the name shows which drink you are holding
    if (this.playerCup.visible && this.playerCup.kind) {
      this.badge
        .setTexture(`cup_${this.playerCup.kind}`)
        .setVisible(true)
        .setPosition(Math.round(this.label.x - this.label.width / 2 - 6), Math.round(this.label.y - this.label.height / 2))
        .setDepth(80001);
    } else this.badge.setVisible(false);
    if (this.selfCrowned) {
      this.crown
        .setVisible(true)
        .setPosition(Math.round(this.label.x + this.label.width / 2 + 7), Math.round(this.label.y - this.label.height / 2) - 1)
        .setDepth(80001);
    } else this.crown.setVisible(false);
    const handY = artTop + (maxY - minY + 1) * 0.62;
    this.playerCup.follow(this.avatar.x + (this.avatar.flipX ? -9 : 9), handY, this.avatar.depth + 1, time);
  }
}
