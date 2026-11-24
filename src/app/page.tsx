import Link from "next/link";
import CharacterPreview from "@/components/CharacterPreview";

// Small hand-drawn sprites for the landing page.
const SPRITE = [
  "....HHHH....",
  "...HHHHHH...",
  "..HHHHHHHH..",
  "..HSSSSSSH..",
  "..SSESSESS..",
  "..SSSSSSSS..",
  "...SSSSSS...",
  "..TTTTTTTT..",
  ".TTTTTTTTTT.",
  ".STTTTTTTTS.",
  ".SSTTTTTTSS.",
  "..PPPPPPPP..",
  "..PPP..PPP..",
  "..BBB..BBB..",
];

function sprite(p: Record<string, string>) {
  return SPRITE.join("").split("").map((ch) => p[ch] ?? "");
}

const PEOPLE = [
  { H: "#4a3222", S: "#f1c27d", E: "#1f140d", T: "#d9622b", P: "#2a4d8f", B: "#1f140d" },
  { H: "#f2a93b", S: "#ffe0bd", E: "#1f140d", T: "#7fc8a9", P: "#5a5a66", B: "#1f140d" },
  { H: "#9b5de5", S: "#8a6446", E: "#1f140d", T: "#f28fad", P: "#1f6f78", B: "#000000" },
];

const CUP = [
  "............",
  "..WWWWWWWW..",
  ".WCCCCCCCCWW",
  ".WCCCCCCCCW.W",
  ".WCCCCCCCCW.W",
  "..WCCCCCCWWW",
  "...WWWWWW...",
].map((r) => r.padEnd(13, "."));

const FEATURES = [
  { title: "Draw yourself", text: "No presets. Paint your own pixel character in a real pixel editor, and keep as many outfits as you like." },
  { title: "Stay anonymous", text: "You get a random name like MistyMuffin472. No real name, no photo, no profile to curate." },
  { title: "Hang out", text: "Walk around with other real people, chat with whoever is nearby, make a drink, change the music and weather together, play Tic-Tac-Toe, sign the guestbook, claim a private table with friends, vote for the best outfit of the day, or ride the elevator up to the Arcade." },
];

const ROADMAP = [
  { name: "Character Studio", status: "Open now" },
  { name: "Main Cafe: NPCs, sitting & emotes", status: "Open now" },
  { name: "Make drinks: timing game & Cafe Beans", status: "Open now" },
  { name: "Jukebox, window weather & sound effects", status: "Open now" },
  { name: "Tic-Tac-Toe, guestbook & the cafe cat", status: "Open now" },
  { name: "Multiplayer: meet real people, live", status: "Open now" },
  { name: "Proximity Chat: talk to people nearby", status: "Open now" },
  { name: "Rumour Board & Guestbook (shared live, saved on the server, rumours fade after 48h)", status: "Open now" },
  { name: "Private Tables: up to 6 seats, private table chat, open or lock it", status: "Open now" },
  { name: "Outfit Leaderboard: daily upvotes & a crown for the top outfit", status: "Open now" },
  { name: "Floor 2 · Arcade: take the elevator up to a neon carpet room with its own chiptune music", status: "Open now" },
  { name: "Blackjack table: Hit, Stand & Double Down against the house, alone or with other players", status: "Open now" },
  { name: "Roulette table: one live wheel for everyone seated or watching, red/black, odd/even or a number", status: "Open now" },
  { name: "Pixel Slots: 3 reels of coffee cups, croissants, golden beans, pixel cats and 7s", status: "Open now" },
  { name: "Cafe Mines: a 5×5 board of spilled coffee, build the multiplier and cash out", status: "Open now" },
  { name: "To the Moon: a shared rocket, cash out before it fizzles", status: "Open now" },
  { name: "Cat Ice Jump: a playable arcade cabinet, plus Leaderboards for top runs, biggest multipliers and richest beans", status: "Open now" },
  { name: "Voice Lounge", status: "Someday" },
];

const ARCADE_NOTE =
  "Everything upstairs uses Cafe Beans: a fictional play currency you earn by making drinks. Beans can't be bought, cashed out or traded, and if you ever run dry you get a free daily starter top-up.";

export default function Home() {
  return (
    <div className="scanlines">
      <main className="mx-auto w-full max-w-5xl px-4">
        {/* Hero */}
        <section className="flex flex-col items-center gap-8 py-16 text-center sm:py-24">
          <div className="relative">
            <div className="absolute -top-8 left-1/2 flex -translate-x-1/2 gap-3" aria-hidden>
              {[0, 0.8, 1.6].map((d) => (
                <span key={d} className="steam block h-4 w-2 bg-cream/60" style={{ animationDelay: `${d}s` }} />
              ))}
            </div>
            <CharacterPreview
              pixels={CUP.join("").split("").map((c) => (c === "W" ? "#f4e4c1" : c === "C" ? "#8a6446" : ""))}
              cols={13}
              scale={10}
            />
          </div>
          <h1 className="font-pixel text-3xl leading-tight text-amber sm:text-5xl">Pixel Cafe</h1>
          <p className="max-w-xl text-2xl text-cream sm:text-3xl">
            A little place on the internet where you can just exist. Draw a character, walk in, sit down with strangers.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link href="/create" className="px-btn !text-sm !px-6 !py-4">Draw your character</Link>
            <Link href="/play" className="px-btn secondary !text-sm !px-6 !py-4">Enter the cafe</Link>
          </div>
        </section>

        {/* Characters on a cafe floor */}
        <section aria-hidden className="px-panel mb-16 flex items-end justify-center gap-10 bg-bark p-8" style={{ background: "repeating-conic-gradient(#3a2819 0% 25%, #43301f 0% 50%) 0 0 / 32px 32px" }}>
          {PEOPLE.map((p, i) => (
            <div key={i} className="bob" style={{ animationDelay: `${i * 0.3}s` }}>
              <CharacterPreview pixels={sprite(p)} cols={12} scale={8} />
            </div>
          ))}
        </section>

        {/* Features */}
        <section className="mb-16 grid gap-6 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="px-panel p-5">
              <h2 className="mb-3 font-pixel text-xs leading-relaxed text-amber">{f.title}</h2>
              <p>{f.text}</p>
            </article>
          ))}
        </section>

        {/* Roadmap */}
        <section className="mb-16">
          <h2 className="mb-4 text-center font-pixel text-sm text-amber">What&apos;s on the menu</h2>
          <p className="mb-3 text-center text-latte">{ARCADE_NOTE}</p>
          <ul className="px-panel divide-y-4 divide-espresso">
            {ROADMAP.map((r) => (
              <li key={r.name} className="flex items-center justify-between px-5 py-3">
                <span>{r.name}</span>
                <span className={r.status === "Open now" ? "text-mint" : "text-latte"}>{r.status}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="pb-10 text-center text-latte">
          Pixel Cafe · no real names, no pressure
        </footer>
      </main>
    </div>
  );
}
