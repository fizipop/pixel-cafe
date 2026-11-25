"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import CharacterPreview from "./CharacterPreview";
import { GRID } from "@/lib/editor";
import {
  getActiveId, getUsername, loadCharacters, setActiveId, type SavedCharacter,
} from "@/lib/characters";
import { LofiPlayer } from "@/lib/lofi";
import { ArcadeMusic } from "@/lib/arcadeMusic";
import { RooftopMusic } from "@/lib/rooftopMusic";
import { FLOOR_NAMES, type Floor } from "@/shared/floors";
import type { ArcadeGame } from "@/game/arcadeLayout";
import type { RooftopGame } from "@/game/rooftopLayout";
import ArcadeHost from "./arcade/ArcadeHost";
import RooftopHost from "./rooftop/RooftopHost";
import FloorPicker from "./FloorPicker";
import { Sfx, type SfxName } from "@/lib/sfx";
import { Announcer, moodOf, type AnnounceLine } from "@/lib/announcer";
import { moodName } from "@/lib/moods";
import { addBeans, loadProfile } from "@/lib/profile";
import { PLAYER_ID } from "@/game/constants";
import { WorldStore, loadWorldPrefs, newWorld, saveWorldPrefs } from "@/game/worldState";
import type { CafeHandle } from "@/game/createGame";
import RumourBoard from "./RumourBoard";
import DrinkMaker from "./DrinkMaker";
import JukeboxMenu from "./JukeboxMenu";
import TableGame from "./TableGame";
import Guestbook from "./Guestbook";
import ChatPanel from "./ChatPanel";
import OutfitBoard from "./OutfitBoard";
import TableStatus from "./TableStatus";
import { NetClient } from "@/net/client";
import { localGuestbook, localRumours, netGuestbook, netRumours } from "@/net/stores";

const AUDIO_KEY = "pixelcafe.audio.v1";

type Modal = null | "board" | "order" | "jukebox" | "guestbook" | "game" | "outfits" | "floors";

function loadAudioPrefs(): { volume: number; muted: boolean; sfx: boolean; voice: boolean } {
  try {
    const p = JSON.parse(localStorage.getItem(AUDIO_KEY) ?? "null");
    if (p && typeof p.volume === "number" && typeof p.muted === "boolean") {
      return { volume: p.volume, muted: p.muted, sfx: p.sfx !== false, voice: p.voice !== false };
    }
  } catch { /* ignore */ }
  return { volume: 0.5, muted: false, sfx: true, voice: true };
}

/** "3 in cafe" while connected; says so when the server isn't there. */
function OnlineBadge({ net, connecting }: { net: NetClient | null; connecting: boolean }) {
  const count = useSyncExternalStore(
    net ? net.subscribe : noopSubscribe,
    () => (net ? (net.closed ? -1 : net.online) : 0),
    () => 0,
  );
  if (connecting) return <span className="text-latte" role="status">Connecting…</span>;
  if (!net || count < 0) {
    return <span className="text-ember" title="Run the server with: npm run dev:all" role="status">Solo · server offline</span>;
  }
  return <span className="text-mint" role="status" title="Players in the cafe right now">● {count} in cafe</span>;
}
const noopSubscribe = () => () => {};

export default function CafeGame() {
  const [loaded, setLoaded] = useState(false);
  const [chars, setChars] = useState<SavedCharacter[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [username, setUsername] = useState("");
  const [entered, setEntered] = useState(false);
  const [volume, setVolume] = useState(0.5);
  const [muted, setMuted] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [sfxOn, setSfxOn] = useState(true);
  const [voiceOn, setVoiceOn] = useState(true);
  const [beans, setBeans] = useState(0);
  // Shared cafe state (jukebox mood, weather, table game). Online, the server owns it (see src/net).
  const [world] = useState(() => new WorldStore(newWorld()));
  const wstate = useSyncExternalStore(world.subscribe, world.getState, world.getState);

  const [net, setNet] = useState<NetClient | null>(null); // null = solo (server offline)
  const [connecting, setConnecting] = useState(false);
  const [chatting, setChatting] = useState(false);
  const [arcade, setArcade] = useState<ArcadeGame | null>(null); // the Floor 2 game window that is open
  const [rooftop, setRooftop] = useState<RooftopGame | null>(null); // the Floor 3 window that is open (roast, telescope, photo stand, wall)
  const [toast, setToast] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<CafeHandle | null>(null);
  const netRef = useRef<NetClient | null>(null);
  const musicRef = useRef<LofiPlayer | null>(null);
  const sfxRef = useRef<Sfx | null>(null);
  const announcerRef = useRef<Announcer | null>(null);
  const arcadeMusicRef = useRef<ArcadeMusic | null>(null);
  const rooftopMusicRef = useRef<RooftopMusic | null>(null);
  const initialRef = useRef<{ username: string; pixels: string[] } | null>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const playSfx = useCallback((n: SfxName) => sfxRef.current?.play(n), []);
  const announce = useCallback((line: AnnounceLine) => announcerRef.current?.say(line), []);

  // Which floor you are on, your server-side Cafe Beans and the daily top-up notice all come from the NetClient.
  const floor: Floor = useSyncExternalStore(net ? net.subscribe : noopSubscribe, () => (net && !net.closed ? net.floor : 1), () => 1);
  const netBeans = useSyncExternalStore(net ? net.subscribe : noopSubscribe, () => (net && !net.closed ? net.shownBeans : -1), () => -1);
  const topup = useSyncExternalStore(net ? net.subscribe : noopSubscribe, () => (net && !net.closed ? net.topupNote : null), () => null);
  const anyModal = modal !== null || arcade !== null || rooftop !== null;

  useEffect(() => {
    if (!topup) return;
    queueMicrotask(() => setToast(`Daily starter top-up: +${topup.amount} Cafe Beans. Never stuck!`));
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [topup]);

  // Floor 2 windows only make sense on Floor 2 (and while connected)
  useEffect(() => {
    if (floor !== 2 && arcade !== null) queueMicrotask(() => setArcade(null));
  }, [floor, arcade]);

  // Floor 3 windows only make sense on Floor 3 (and while connected); the elevator picker is only for Floor 1-3 travel
  useEffect(() => {
    if (floor !== 3 && rooftop !== null) queueMicrotask(() => setRooftop(null));
  }, [floor, rooftop]);

  // Load saved data (browser only).
  useEffect(() => {
    queueMicrotask(() => {
      const list = loadCharacters();
      const active = list.find((c) => c.id === getActiveId()) ?? list[0];
      setChars(list);
      setSelectedId(active?.id ?? "");
      setUsername(getUsername());
      const prefs = loadAudioPrefs();
      setVolume(prefs.volume);
      setMuted(prefs.muted);
      setSfxOn(prefs.sfx);
      setVoiceOn(prefs.voice);
      setBeans(loadProfile().beans);
      const wp = loadWorldPrefs();
      world.load({ ...world.getState(), mood: wp.mood, weather: wp.weather });
      setLoaded(true);
    });
  }, [world]);

  // Start Phaser once the player has entered.
  useEffect(() => {
    if (!entered) return;
    let cancelled = false;
    let handle: CafeHandle | undefined;
    (async () => {
      try { await document.fonts?.load("16px VT323"); } catch { /* font is optional */ }
      const { createCafeGame } = await import("@/game/createGame");
      if (cancelled || !initialRef.current) return;
      // Join the shared cafe first. If the server isn't running we carry on solo.
      setConnecting(true);
      const connection = await NetClient.connect({ name: initialRef.current.username, pixels: initialRef.current.pixels, beans: loadProfile().beans });
      if (cancelled || !containerRef.current) { connection?.close(); return; }
      netRef.current = connection;
      setNet(connection);
      setConnecting(false);
      handle = createCafeGame(containerRef.current, {
        ...initialRef.current,
        world,
        net: connection,
        callbacks: {
          onOpenBoard: () => setModal("board"),
          onOpenOrder: () => setModal("order"),
          onOpenJukebox: () => setModal("jukebox"),
          onOpenGuestbook: () => setModal("guestbook"),
          onOpenGame: () => setModal("game"),
          onOpenOutfits: () => setModal("outfits"),
          onOpenArcade: (game) => setArcade(game),
          onOpenFloors: () => setModal("floors"),
          onOpenRooftop: (game) => setRooftop(game),
          onSfx: (n) => sfxRef.current?.play(n),
          onBeans: (n, made) => { setBeans(addBeans(n, made).beans); netRef.current?.earn(n); },
        },
      });
      handleRef.current = handle;
    })();
    return () => {
      cancelled = true;
      handle?.destroy();
      handleRef.current = null;
      netRef.current?.close();
      netRef.current = null;
      setNet(null);
    };
  }, [entered, world]);

  // Pause the game keyboard while a modal is open so typing never walks the character.
  useEffect(() => {
    handleRef.current?.setInputEnabled(!anyModal && !chatting);
  }, [anyModal, chatting, net]);

  // Keep music + sound effects in sync with the controls, and remember them.
  useEffect(() => {
    musicRef.current?.setVolume(volume);
    musicRef.current?.setMuted(muted);
    sfxRef.current?.setVolume(volume);
    sfxRef.current?.setMuted(muted);
    sfxRef.current?.setEnabled(sfxOn);
    announcerRef.current?.setVolume(volume);
    announcerRef.current?.setMuted(muted); // the global mute silences the announcer too
    announcerRef.current?.setEnabled(voiceOn);
    arcadeMusicRef.current?.setVolume(volume);
    arcadeMusicRef.current?.setMuted(muted);
    rooftopMusicRef.current?.setVolume(volume);
    rooftopMusicRef.current?.setMuted(muted);
    if (!loaded) return;
    try { localStorage.setItem(AUDIO_KEY, JSON.stringify({ volume, muted, sfx: sfxOn, voice: voiceOn })); } catch { /* ignore */ }
  }, [volume, muted, sfxOn, voiceOn, loaded]);

  // closing a game window (or leaving Floor 2) cuts off whatever the announcer was saying
  useEffect(() => { if (arcade === null) announcerRef.current?.stop(); }, [arcade]);

  // Jukebox mood + window weather drive the music engine (and are remembered on this device).
  useEffect(() => {
    musicRef.current?.setMood(wstate.mood);
    musicRef.current?.setRain(wstate.weather === "rain");
    if (loaded && !world.isRemote) saveWorldPrefs(wstate); // online, the room's mood isn't "your" preference
  }, [wstate, wstate.mood, wstate.weather, entered, loaded, world]);

  // Upstairs, the cafe lofi gives way to each floor's own music: the Arcade's chiptune loop on Floor 2,
  // the Rooftop's piano, breeze and rain on Floor 3 (same volume + music toggle for all of them).
  useEffect(() => {
    musicRef.current?.setDucked(floor !== 1);
    arcadeMusicRef.current?.setActive(floor === 2 && arcade !== "beat"); // Beat Battle plays its own track
    rooftopMusicRef.current?.setActive(floor === 3);
  }, [floor, entered, arcade]);

  // Stop the audio if the player leaves the page.
  useEffect(() => () => { musicRef.current?.stop(); sfxRef.current?.stop(); announcerRef.current?.stop(); arcadeMusicRef.current?.stop(); rooftopMusicRef.current?.stop(); }, []);

  const selected = chars.find((c) => c.id === selectedId);

  // Rumours + guestbook: shared through the server when online, this device only when not.
  const rumourSource = useMemo(() => (net && !net.closed ? netRumours(net) : localRumours()), [net]);
  const bookSource = useMemo(() => (net && !net.closed ? netGuestbook(net) : localGuestbook(username)), [net, username]);

  const enter = () => {
    if (!selected) return;
    initialRef.current = { username, pixels: selected.pixels };
    // Browsers only allow audio after a click, so we start it here.
    const music = (musicRef.current ??= new LofiPlayer());
    music.setVolume(volume);
    music.setMuted(muted);
    music.setMood(world.getState().mood);
    music.setRain(world.getState().weather === "rain");
    music.start();
    const sfx = (sfxRef.current ??= new Sfx());
    sfx.setVolume(volume);
    sfx.setMuted(muted);
    sfx.setEnabled(sfxOn);
    sfx.start();
    const ann = (announcerRef.current ??= new Announcer((cue) => sfxRef.current?.play(cue)));
    ann.setVolume(volume);
    ann.setMuted(muted);
    ann.setEnabled(voiceOn);
    ann.start();
    // the arcade crowd hears the announcer too: nearby NPCs cheer a jackpot or groan at a loss
    ann.subscribe((line) => handleRef.current?.crowdReact(moodOf(line)));
    const arc = (arcadeMusicRef.current ??= new ArcadeMusic());
    arc.setVolume(volume);
    arc.setMuted(muted);
    arc.start();
    const roof = (rooftopMusicRef.current ??= new RooftopMusic());
    roof.setVolume(volume);
    roof.setMuted(muted);
    roof.start();
    setActiveId(selected.id);
    setEntered(true);
  };

  const switchCharacter = (id: string) => {
    const c = chars.find((x) => x.id === id);
    if (!c) return;
    setSelectedId(id);
    setActiveId(id);
    handleRef.current?.setCharacter(c.pixels);
    (document.activeElement as HTMLElement | null)?.blur(); // so WASD keeps moving, not the dropdown
  };

  if (!loaded) return <div className="grid h-dvh place-items-center text-latte">Loading…</div>;

  // ---- nothing saved yet ----
  if (chars.length === 0) {
    return (
      <div className="grid h-dvh place-items-center p-4">
        <div className="px-panel max-w-md p-6 text-center">
          <h1 className="mb-4 font-pixel text-sm text-amber">Draw someone first</h1>
          <p className="mb-5">The cafe needs a character to walk around in. Draw one and save it, then come back.</p>
          <Link href="/create" className="px-btn inline-block">Open Character Studio</Link>
        </div>
      </div>
    );
  }

  // ---- enter screen ----
  if (!entered) {
    return (
      <div className="grid h-dvh place-items-center p-4">
        <div className="px-panel w-full max-w-md p-6 text-center">
          <h1 className="mb-5 font-pixel text-sm text-amber">Pixel Cafe</h1>
          <div className="mx-auto mb-4 inline-block bg-bark p-3">
            {selected && <CharacterPreview pixels={selected.pixels} cols={GRID} scale={5} />}
          </div>
          <p className="text-latte">You&apos;ll walk in as</p>
          <p className="mb-4 text-2xl">{username}</p>
          <label className="mb-5 block text-left">
            <span className="text-latte">Character</span>
            <select className="px-input mt-1" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <button className="px-btn !px-6 !py-4 !text-sm" onClick={enter}>Enter the cafe</button>
          <p className="mt-4 text-latte">🎧 Sound on: lofi jazz and cafe ambience</p>
          <p className="mt-2">
            <Link href="/create" className="text-amber underline">Edit characters</Link>
            {" · "}
            <Link href="/" className="text-amber underline">Home</Link>
          </p>
        </div>
      </div>
    );
  }

  // ---- in the cafe ----
  return (
    <div
      className="relative h-dvh w-full overflow-hidden bg-espresso"
      onClickCapture={(e) => {
        const el = (e.target as HTMLElement).closest("button");
        if (el && !el.closest("[data-nosfx]")) playSfx("click"); // soft click for every button
      }}
    >
      <div ref={containerRef} className="absolute inset-0" />

      <div className="px-panel absolute left-3 top-3 z-10 flex flex-col gap-2 p-3 text-lg">
        <span className="text-amber">{username}</span>
        <span className="text-mint" data-testid="floor-name" title="Use the elevator to change floors">{FLOOR_NAMES[floor]}</span>
        <span className="text-latte" title="Fictional Cafe Beans: earn them making drinks, play with them on Floor 2">Beans: <b className="text-cream" data-testid="hud-beans">{netBeans >= 0 ? netBeans : beans}</b></span>
        <select
          className="px-input !w-auto !py-0.5 !text-lg"
          value={selectedId}
          onChange={(e) => switchCharacter(e.target.value)}
          aria-label="Switch character"
        >
          {chars.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="px-btn secondary !py-1" onClick={(e) => { setModal("outfits"); e.currentTarget.blur(); }} title="See outfits and upvote your favourite">
          👑 Outfits
        </button>
        <TableStatus net={net} />
        <div className="flex gap-3">
          <Link href="/create" className="text-latte underline">Edit</Link>
          <Link href="/" className="text-latte underline">Leave</Link>
        </div>
      </div>

      <div className="px-panel absolute right-3 top-3 z-10 flex items-center gap-3 p-3 text-lg">
        <button
          className={`px-btn secondary ${muted ? "" : "active"}`}
          onClick={(e) => { setMuted((m) => !m); e.currentTarget.blur(); }}
          aria-pressed={!muted}
          title="Toggle music"
        >
          {muted ? "Music off" : "Music on"}
        </button>
        <input
          type="range" min={0} max={1} step={0.05}
          value={volume}
          onChange={(e) => { setVolume(Number(e.target.value)); if (muted) setMuted(false); e.currentTarget.blur(); }}
          className="w-24 accent-amber"
          aria-label="Music volume"
        />
        <button
          className={`px-btn secondary ${sfxOn ? "active" : ""}`}
          onClick={(e) => { setSfxOn((v) => !v); e.currentTarget.blur(); }}
          aria-pressed={sfxOn}
          title="Toggle sound effects"
        >
          {sfxOn ? "SFX on" : "SFX off"}
        </button>
        <button
          className={`px-btn secondary ${voiceOn ? "active" : ""}`}
          onClick={(e) => { setVoiceOn((v) => !v); e.currentTarget.blur(); }}
          aria-pressed={voiceOn}
          title="Toggle the arcade announcer voice"
        >
          {voiceOn ? "Voice on" : "Voice off"}
        </button>
        <span className="hidden text-latte md:inline" title="Change it at the jukebox">♪ {moodName(wstate.mood)}</span>
        <OnlineBadge net={net} connecting={connecting} />
      </div>

      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 bg-espresso/80 px-4 py-1 text-latte">
        WASD move · E interact · G gift drink · 1-4 emotes
        {floor === 2 && " · E at a machine to play, sit at a table to join"}
        {floor === 3 && " · sit at the campfire (E) to roast · E at the telescope, photo stand or wall"}
      </div>

      {toast && <div className="px-panel pointer-events-none absolute left-1/2 top-20 z-20 -translate-x-1/2 px-4 py-2 text-xl text-mint" role="status">{toast}</div>}

      <ChatPanel net={net} disabled={anyModal} onTypingChange={setChatting} />

      {modal === "board" && <RumourBoard source={rumourSource} onClose={closeModal} />}
      {modal === "order" && (
        <DrinkMaker
          onClose={closeModal}
          sfx={playSfx}
          onServe={(drink, rating) => { handleRef.current?.serveDrink(drink, rating); setModal(null); }}
          onChat={() => { handleRef.current?.talkToBarista(); setModal(null); }}
        />
      )}
      {modal === "jukebox" && <JukeboxMenu world={world} onClose={closeModal} sfx={playSfx} />}
      {modal === "floors" && (
        <FloorPicker
          current={floor}
          onClose={closeModal}
          onPick={(f) => { setModal(null); handleRef.current?.travel(f); }}
        />
      )}
      {modal === "outfits" && <OutfitBoard net={net && !net.closed ? net : null} onClose={closeModal} sfx={playSfx} />}
      {modal === "guestbook" && <Guestbook username={username} source={bookSource} onClose={closeModal} sfx={playSfx} />}
      {arcade && net && !net.closed && (
        <ArcadeHost
          game={arcade}
          net={net}
          onClose={() => setArcade(null)}
          sfx={playSfx}
          announce={announce}
          onStand={() => { handleRef.current?.standUp(); setArcade(null); }}
        />
      )}
      {rooftop && net && !net.closed && (
        <RooftopHost
          game={rooftop}
          net={net}
          onClose={() => setRooftop(null)}
          sfx={playSfx}
          onOpen={(g) => setRooftop(g)}
        />
      )}
      {modal === "game" && <TableGame world={world} me={net?.occupant ?? PLAYER_ID} nameOf={net ? (o) => net.nameOf(o) : undefined} onClose={closeModal} sfx={playSfx} />}
    </div>
  );
}
