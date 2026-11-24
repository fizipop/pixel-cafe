# Pixel Cafe

An anonymous, multiplayer, pixel-art social experience. **Phase 1: landing page + pixel character editor. Phase 2: walkable cafe + lofi music. Phase 3: NPCs, sitting, Rumour Board, emotes. Phase 3.5: jukebox + weather, drink mini-game, table game, guestbook, cafe cat, sound effects. Phase 4: real-time multiplayer (Socket.IO), proximity chat, shared room state. Phase 5: private tables, outfit leaderboard, server persistence.**

## Run it

```bash
npm install
npm run dev:all    # website (http://localhost:3000) + multiplayer server (:3001), one terminal
npm test           # unit + server tests (editor, seats, pathing, rumours, room logic, real sockets)
npm run build      # production build check
```

Two terminals instead? Same thing:

```bash
npm run dev          # terminal 1: website on http://localhost:3000
npm run dev:server   # terminal 2: multiplayer server on http://localhost:3001
```

If the server isn't running, `/play` still works in **solo mode** (like Phase 3.5) and the HUD says `Solo · server offline`.

### Try multiplayer with two windows

1. `npm run dev:all`
2. Open `http://localhost:3000/create`, draw/save a character, then open `http://localhost:3000/play` and click **Enter the cafe**.
3. Open a **second window in a private/incognito window** (or another browser) at `http://localhost:3000/play`. Each browser profile has its own saved characters and random name, so you appear as two different people. Normal tabs of the same browser share one name and characters, which also works, but incognito is clearer.
4. Both HUDs should show `2 in cafe`. Walk near each other and press **Enter** to chat.

**Phase 5.** Sit at the long table in the lounge (6 seats) for chat only your table sees; use the HUD toggle to lock/open it. The Outfit Board (HUD button or the mannequin by the door) lets you give 1 upvote a day to someone else; today's #1 outfit(s) get a crown by their name tag. Rumours, guestbook notes and votes are saved to `server/data.json` (gitignored; override with `DATA_FILE`). Storage sits behind the `Repository` interface in `server/repository.ts`, so a Supabase version only needs a new class.

Environment variables (all optional): `PORT` (server port, default 3001), `CLIENT_ORIGIN` (comma-separated allowed website origins; default allows any), `NEXT_PUBLIC_SOCKET_URL` (where the browser finds the server; default `http://<this host>:3001`, so opening the site through your LAN IP also works).

## Where things live

| Path | What it is |
|---|---|
| `src/app/page.tsx` | Landing page |
| `src/app/create/page.tsx` | Character Studio page |
| `src/components/PixelEditor.tsx` | The editor UI (tools, palette, save/load) |
| `src/components/CharacterPreview.tsx` | Crisp pixel renderer (previews, thumbnails, sprites) |
| `src/lib/editor.ts` | Pure logic: flood fill, lines, palette, validation (tested) |
| `src/lib/useHistory.ts` | Undo/redo |
| `src/app/play/page.tsx` | The cafe page |
| `src/components/CafeGame.tsx` | Enter screen, HUD, character switcher, music controls; boots Phaser |
| `src/game/CafeScene.ts` | Phaser scene: map, collisions, WASD movement, camera follow |
| `src/game/art.ts` | All art drawn in code (swap for sprite sheets later) |
| `src/game/createGame.ts` | Phaser config + handle (`setCharacter`, `destroy`) |
| `src/lib/lofi.ts` | Procedural lofi jazz + cafe ambience (Web Audio, no audio files) |
| `src/game/layout.ts` | Tables, sofas, counter, board positions and the 28 seats |
| `src/game/seats.ts` | `SeatState`: who sits where (`snapshot()`/`load()`/`onChange`, ready for Phase 4 sync) |
| `src/game/pathing.ts` | Grid A* so the wandering NPC never walks through furniture |
| `src/game/npcs.ts` / `npcArt.ts` | NPC specs, behaviours, dialogue, pixel sprites |
| `src/game/bubbles.ts` | Speech and emote bubbles |
| `src/game/heldCup.ts` / `sprites.ts` | Held drink cup, emote/cup/prop textures |
| `src/components/DrinkMaker.tsx` | Counter menu + 3-second timing mini-game |
| `src/components/JukeboxMenu.tsx` | Pick the music mood and window weather |
| `src/components/TableGame.tsx` | Tic-Tac-Toe board (reads shared state, dispatches moves) |
| `src/components/Guestbook.tsx` | Browse pages and sign today's note |
| `src/game/worldState.ts` | **Shared state + reducer**: jukebox mood, weather, table game. One `dispatch(action)` path, ready for Socket.IO |
| `src/game/tictactoe.ts` | Pure Tic-Tac-Toe rules and the friendly NPC opponent |
| `src/game/weather.ts` / `cat.ts` / `props.ts` / `gifts.ts` | Window skies + rain, Biscuit the cat, new prop art, NPC gift reactions |
| `src/lib/moods.ts` / `drinks.ts` / `profile.ts` / `guestbook.ts` | Mood and weather names, drink menu + timing rules, Cafe Beans, guestbook data |
| `src/lib/sfx.ts` | Procedural sound effects (no audio files) |
| `src/components/RumourBoard.tsx` | Rumour Board modal |
| `src/lib/rumours.ts` | Rumour rules + localStorage store (swap for a backend later) |
| `src/lib/characters.ts` | Saved characters + anonymous username (localStorage for now) |
| `server/room.ts` | **The authoritative cafe room** (no sockets): players, seats, chat rules, shared world, rumours, guestbook, Theo's Tic-Tac-Toe moves |
| `server/boards.ts` | In-memory Rumour Board (48 h expiry, cooldown, likes) and Guestbook |
| `server/app.ts` / `server/index.ts` | Socket.IO wiring / entry point (`/health` endpoint included) |
| `server/*.test.ts` | Room unit tests + a real two-socket integration test |
| `src/shared/protocol.ts` | The event contract + limits (shared by browser and server) |
| `src/shared/text.ts` | HTML escape helpers |
| `src/net/client.ts` | Browser Socket.IO client (`NetClient`) |
| `src/net/stores.ts` | Rumour/Guestbook data sources: shared (server) or local (offline) |
| `src/game/remotePlayers.ts` | Other players in Phaser: smoothing, live sprite swap, drink badge, seated pose |
| `src/components/ChatPanel.tsx` | Chat bar, collapsible nearby-chat log, system toasts |

Characters are 32x32 grids stored as an array of `"#rrggbb"` strings (`""` = transparent).
Saving is browser-only for now; `src/lib/characters.ts` is the one file to swap for Supabase later.

Shortcuts: P pencil, E eraser, B bucket, I picker, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo.


## Cafe controls

| Key | Action |
|---|---|
| WASD / arrows | Move (also stands you up from a seat) |
| E or Space | Interact: sit/stand, talk to NPCs, order at the counter, read the Rumour Board |
| Click an NPC | Talk to them |
| 1 / 2 / 3 / 4 | Emotes: wave, coffee, heart, music note |
| Esc | Close a modal |

Rumours: 200 characters max, no links/emails/phones/@names, 15 s between posts, expire after 48 h, saved on this device only.

### Phase 3.5 controls

| Where | Action |
|---|---|
| Jukebox (right wall) | `E` opens it. `1-3` music mood, `4-6` window weather |
| Counter | `E`, pick a drink (`1-4`), then `E`/Space/click to stop the slider in the green |
| Near an NPC while holding a drink | `G` gifts it (they react, you get +2 beans) |
| Table with the board (middle table, top row, next to Theo) | Sit down and the game opens. `1-9` pick a square, `R` new round, `E` re-opens it, walk to stand |
| Lounge coffee table | `E` opens the guestbook. One 80-character note per day |
| Cafe cat (Biscuit) | `E` to pet |
| HUD | Music and SFX toggles, volume slider (controls both), Cafe Beans counter |

## Phase 4: multiplayer

### Controls added

| Key | Action |
|---|---|
| Enter | Open the chat bar (WASD, E, G and 1-4 are paused while it's open) |
| Enter (in the bar) | Send. Closes the bar |
| Esc (in the bar) | Cancel |

Chat rules: 150 characters, 1 message per second, plain text only. Only people within about one screen (280 px) receive your message and see your speech bubble. The corner log is collapsible and shows an unread count when closed.

### How it works

The server is the single source of truth. Browsers send what *they* did; the server checks it, updates the room, and tells everyone.

- **Positions** are sent about 15 times a second and batched on the server. Other players glide toward the latest position, so movement looks smooth even on a slow connection.
- **Seats**: `sit` is answered with ok/error, so two people can never share a chair. The NPCs' chairs (Theo, Kai, Juno) are reserved on the server. Ollie (the wanderer) lives in each browser, so he politely gets up if a real person takes "his" chair.
- **Shared room**: jukebox mood, window weather and the Tic-Tac-Toe board live on the server. The server forces the player id on every action, so nobody can move for someone else.
- **Tic-Tac-Toe**: sitting at the game table joins you as X (or O if X is taken). If two people sit there, they play each other; if one leaves, Theo sits back down. The server plays Theo's moves.
- **Rumours/Guestbook**: shared, in memory. Rumours expire after 48 h, 15 s cooldown per person, one guestbook note per person per day (a random id saved in your browser, `pixelcafe.clientId`, is how the server tells people apart).
- **Everything is in memory**: restarting the server clears rumours, guestbook notes and the room.
- **Safety**: all text is HTML-escaped on the server, sprites are validated (1024 cells, hex colours only), numbers are checked, and one bad packet can't crash the server.

### Socket.IO events

Browser to server (`ClientToServer` in `src/shared/protocol.ts`):

| Event | Payload | Answer |
|---|---|---|
| `join` | `{ clientId, name, pixels }` | `{ ok, init }` with your `selfId`, everyone else, seats, world, rumours, guestbook, online count |
| `move` | `{ x, y, flip, moving }` | none (seated players are ignored) |
| `profile` | `{ pixels }` | none. You switched characters |
| `drink` | `{ kind \| null }` | none. Held-drink badge |
| `emote` | `{ n }` (0-3 = keys 1-4) | none |
| `sit` | `{ seatId }` | `{ ok }` or `{ ok:false, reason }` |
| `stand` | none | none |
| `chat` | `{ text }` | `{ ok }` or `{ ok:false, reason }` |
| `world:action` | `{ action }` (`setMood`, `setWeather`, ttt `move`/`reset`) | `{ ok }` |
| `rumour:post` / `rumour:like` | `{ text }` / `{ id }` | `{ ok }` / none |
| `guestbook:sign` | `{ text }` | `{ ok }` or `{ ok:false, reason }` |

Server to browser (`ServerToClient`):

| Event | Payload | Sent to |
|---|---|---|
| `player:joined` / `player:left` | player state / `{ id }` | everyone else |
| `player:profile` | `{ id, pixels }` | everyone else |
| `player:drink` | `{ id, kind }` | everyone else |
| `moves` | `[{ id, x, y, flip, moving }]` (volatile, batched) | everyone except the movers |
| `emote` | `{ id, n }` | everyone else |
| `seats` | full seat snapshot | everyone |
| `chat` | `{ id, from, name, text, ts }` | the sender + players in range |
| `system` | `{ text }` ("X switched the jukebox to ...") | everyone |
| `world` | full `{ mood, weather, table }` | everyone |
| `rumours` / `guestbook` | list personalised for each player (likes, "mine") | everyone |
| `online` | `{ count }` | everyone |

### Known limits (on purpose for now)

- No accounts, moderation or persistence: it's a prototype for friends, not the open internet. Add a database, report/mute tools and per-IP limits before going public.
- One shared room (max 40 players).
- Beans stay on your device.
