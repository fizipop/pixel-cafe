// The cafe's extra residents (pure data, no Phaser):
//   * the Pixel Restaurant startup crew: four friends at one Floor 1 table, laptops out, building a website
//   * the Arcade & Casino crowd on Floor 2: Togi at the roulette table, plus a cast of regulars with their own habits
// All gambling talk is about Cafe Beans, the cafe's fictional play currency.
import { FLOOR2_X } from "../shared/floors.ts";
import { TILE } from "./constants.ts";
import { NPC_SEATS, TABLES, type Seat } from "./layout.ts";
import type { NpcSpec } from "./npcs.ts";

const X0 = FLOOR2_X;

// ------------------------------------------------------------------ Pixel Restaurant (Floor 1)

/** The crew's table (index into TABLES): the front-right table, all four seats. */
export const CREW_TABLE = 5;
const crewSeat = (side: string) => `t${CREW_TABLE}-${side}`;
export const crewTablePos = () => { const [col, row] = TABLES[CREW_TABLE]; return { x: col * TILE, y: row * TILE }; };

export const CREW: NpcSpec[] = [
  {
    id: "faizan", name: "Faizan", tag: "Founder", behavior: "sitter", home: { x: 0, y: 0 }, seatId: crewSeat("top"), idle: "type",
    greet: ["Oh hey! Welcome to Pixel Restaurant HQ. Well, table six.", "Pull up a chair, we're shipping something big today."],
    lines: [
      "We're building Pixel Restaurant: order food from little pixel chefs. The menu looks like a retro game.",
      "I'm on the booking flow. Picking a table should feel like choosing a level.",
      "Puneet says the pricing page needs more pixels. Puneet is right. Don't tell him.",
      "Our launch checklist has 42 items. 41 of them say 'fix the CSS'.",
      "If you see a bug on pixelrestaurant, no you didn't. Coffee first, then hotfix.",
      "Big idea: the waiter is a sprite that walks your order to the kitchen in real time.",
    ],
    ambientSay: ["Deploying... deploying... okay it's up!", "Who renamed the database table to 'final_final_v3'?", "Coffee's kicking in. Time to refactor."],
  },
  {
    id: "puneet", name: "Puneet", tag: "Designer", behavior: "sitter", home: { x: 0, y: 0 }, seatId: crewSeat("left"), idle: "type",
    greet: ["Hey hey! You hungry? We're literally building a restaurant website.", "Ah, a visitor! Want to beta test Pixel Restaurant?"],
    lines: [
      "I'm doing the menu design. Every dish gets a 16x16 sprite. The samosa took me two hours.",
      "Restaurant idea: a 'chef's mood' meter. Happy chef, bonus garlic naan.",
      "Faizan wants dark mode. I want butter chicken. We compromised on dark mode with butter chicken.",
      "Our logo is a fork made of pixels. Took us a week to agree on the fork.",
      "Next sprint: online ordering. Then world domination. Then lunch.",
      "Nick keeps pushing straight to main. Cris keeps reverting it. It's a family tradition.",
    ],
    ambientSay: ["Who wants chai? I'm ordering for the table.", "That menu font? Chef's kiss.", "We need more food photos. For research."],
  },
  {
    id: "cris", name: "Cris", tag: "Backend", behavior: "sitter", home: { x: 0, y: 0 }, seatId: crewSeat("right"), idle: "type",
    greet: ["Yo! I'm Cris. The handsome twin.", "Welcome! Mind the cables, we've got four laptops on one plug."],
    lines: [
      "I do the backend. Orders come in, tickets go to the kitchen, nobody's pizza gets lost.",
      "Nick and I are twins. I'm the one with the flannel. And the working code.",
      "Found the bug: the cart counted every taco twice. Customers would've loved it. Accounting wouldn't.",
      "We're adding reservations next. Pick your table on a little pixel floor plan, like this cafe.",
      "Startup tip: name your variables like you'll read them at 2am. Because you will.",
    ],
    ambientSay: ["Tests passing. All of them. Suspicious.", "Nick, did you push to main again?", "Merging. Hold your breath."],
  },
  {
    id: "nick", name: "Nick", tag: "Frontend", behavior: "sitter", home: { x: 0, y: 0 }, seatId: crewSeat("bottom"), idle: "type",
    greet: ["Hey! I'm Nick. The cooler twin. The beanie proves it.", "Oh hi! Want to see our landing page? It has a dancing taco."],
    lines: [
      "I'm on frontend. The 'Order Now' button bounces. Cris says that's unprofessional. I say it's delightful.",
      "Cris and I have the same face but very different opinions about tabs versus spaces.",
      "Restaurant concept: every order earns pixel stamps. Ten stamps, free dessert sprite.",
      "I made the 404 page a little chef dropping a plate. It's the best page on the site.",
      "We pitched Pixel Restaurant to Mina. She said 'cute, now buy a coffee'. Fair.",
    ],
    ambientSay: ["Pushed! ...to main. Oops.", "Who's ordering lunch? I vote tacos.", "Lighthouse score 100. Screenshot it, quick!"],
  },
];

/** Conversations around the crew's table: each step is who speaks and what they say (the others turn to look). */
export const CREW_TALKS: [string, string][][] = [
  [["faizan", "Okay team, Pixel Restaurant launch. Where are we?"], ["cris", "Backend's green. Orders flow straight to the kitchen."], ["nick", "Frontend's... bouncy."], ["puneet", "Menu's done. The samosa sprite is perfect."]],
  [["nick", "What if the waiter sprite moonwalks to your table?"], ["cris", "No."], ["faizan", "...Actually, maybe."], ["puneet", "Moonwalk with a tray of biryani. Ship it."]],
  [["puneet", "Restaurant idea: a mystery dish button."], ["faizan", "Like loot boxes, but it's lunch."], ["cris", "Legally it's just a surprise menu."], ["nick", "I'd press it every day."]],
  [["cris", "Who pushed to main without a review?"], ["nick", "...Define 'pushed'."], ["faizan", "Nick."], ["puneet", "Classic Nick."]],
  [["faizan", "Coding problem: the reservation calendar thinks February has 31 days."], ["cris", "Time zones?"], ["faizan", "Worse. My for-loop."], ["nick", "Off by three, a new record."]],
  [["nick", "Design question: should the logo fork be gold or pixel-silver?"], ["puneet", "Gold. Food is luxury."], ["cris", "Silver. Forks are silver."], ["faizan", "Make it a spork and nobody's happy. Perfect compromise."]],
  [["puneet", "I'm getting hungry just designing this menu."], ["faizan", "Same. Let's dogfood it: order lunch through Pixel Restaurant."], ["cris", "It'll arrive in... error 500."], ["nick", "I'll get tacos from Mina instead."]],
];

/** Seats the crew sit in all day (the server marks them taken). */
export const CREW_SEATS: Record<string, string> = Object.fromEntries(CREW.map((s) => [s.seatId!, `npc:${s.id}`]));

// ------------------------------------------------------------------ the Arcade & Casino crowd (Floor 2)

const CASINO_Y = 712;

export const ARCADE_CROWD: NpcSpec[] = [
  {
    id: "togi", name: "Togi", tag: "Roulette Legend", behavior: "stander", floor: 2, home: { x: X0 + 636, y: 452 }, face: 1, idle: "hype",
    greet: ["AYYY! New face at the wheel! You feeling LUCKY?", "Yo yo yo! Togi's here, the wheel's warm, let's GO!", "You want my system? Bet on red. Or black. Or vibes."],
    lines: [
      "Roulette is pure science. Watch: red, red, red... and then BLACK. Science!",
      "I once hit 17 three times in a row. Okay, twice. Okay, I saw it once. Still counts!",
      "My lucky cap stays backwards. Front-facing cap? Instant zero. Proven fact.",
      "Little ball goes round, my heart goes round, beans go... somewhere. It's beautiful!",
      "Sit at the table, throw some beans on a number, and scream when it spins. That's the rules. Mostly.",
      "Don't tell Mina, but I tipped the croupier in latte foam art.",
    ],
    ambientSay: ["Come on, come on, COME ON... 0?! Again?!", "Spin it like you mean it!", "The wheel is talking to me. It says 'red'.", "Everybody look! The ball's dancing!"],
    react: {
      jackpot: ["WHAAAT?! JACKPOT! I'M LOSING MY MIND!", "LET'S GOOOO! Somebody frame this moment!"],
      big: ["BIG WIN! I called it! I definitely called it!", "Yesss! The beans are FLOWING!"],
      win: ["Ayy, winner winner! Do it again!", "Told you, it's vibes!"],
      lose: ["Nooo! The wheel is rigged against vibes!", "Shake it off! Next spin is THE spin!"],
    },
  },
  {
    id: "vince", name: "Vince", tag: "Due For A Win", behavior: "wanderer", floor: 2, home: { x: X0 + 144, y: CASINO_Y }, idle: "gesture",
    waypoints: [{ x: X0 + 144, y: CASINO_Y, face: 1 }, { x: X0 + 212, y: CASINO_Y, face: -1 }, { x: X0 + 292, y: CASINO_Y, face: 1 }, { x: X0 + 378, y: CASINO_Y, face: -1 }],
    greet: ["Shh. This machine's warming up. I can feel it.", "Got a spare bean? I'm due. I've been due since Tuesday."],
    lines: [
      "Twelve spins without a pair. That means the next one HAS to pay. That's maths. Right?",
      "I'm not chasing losses, I'm... walking briskly after them.",
      "This one's cold. That one's hot. I keep a spreadsheet. It's mostly sighs.",
      "One more spin and I'm done. I've said that nine times. Tenth time's the charm.",
      "Pro tip from someone with no beans left: set a limit. I'm going to start tomorrow.",
    ],
    ambientSay: ["Come on... come on... aw.", "The pig was RIGHT there.", "Okay, NOW it's due.", "Bad luck follows me like a cat follows tuna."],
    react: { jackpot: ["THAT WAS MY MACHINE! I was warming it up!"], lose: ["See? Cold. Told you.", "Happens to the best of us. Mostly me."], win: ["Nice. Mine's next. Any minute now."] },
  },
  {
    id: "pip", name: "Pip", tag: "First Visit", behavior: "wanderer", floor: 2, home: { x: X0 + 476, y: CASINO_Y + 4 }, idle: "look",
    waypoints: [{ x: X0 + 476, y: CASINO_Y + 4, face: -1 }, { x: X0 + 560, y: CASINO_Y + 28, face: -1 }, { x: X0 + 180, y: CASINO_Y + 48 }, { x: X0 + 700, y: 560 }],
    greet: ["Um, hi! Do you know how any of these work?", "Is the lottery the one with the little balls? Or is that the Plinko?"],
    lines: [
      "So the Plinko ball just... bounces? And wherever it lands, that's it? Wild.",
      "The lottery booth says 1 in 1,000. Is that good? That sounds like a lot of numbers.",
      "Someone told me the pig is 'wild'. He looks so calm though!",
      "I put five beans in the slots and got two and a half back. Did I win? I feel like I won.",
      "Everyone's so loud when they win! I love it here.",
    ],
    ambientSay: ["Ooh, shiny!", "Wait, which button do I press?", "Does the Plinko machine take requests?"],
    react: { jackpot: ["OH MY GOSH! Is that normal?! Does that happen a lot?!"], big: ["Wow!! Teach me!"], win: ["Yay! I think? Yay!"], lose: ["Oh no! That's okay, right? It's just beans?"] },
  },
  {
    id: "goldie", name: "Goldie", tag: "Jackpot Winner", behavior: "stander", floor: 2, home: { x: X0 + 590, y: CASINO_Y + 4 }, face: -1, idle: "hype",
    greet: ["Hey superstar! You're looking at THE Brick House jackpot winner.", "Shades on, beans up. Hi!"],
    lines: [
      "Three brick houses across the middle. Two hundred and fifty times the bet. I screamed. A lot.",
      "Huff & Xtra Puff BONUS got me to the Mansion last night. The pig wink? Iconic.",
      "Winning tip: enjoy the lights, enjoy the noise, and walk away while you're grinning.",
      "My jacket used to be silver. It's gold now. That's what a jackpot does.",
    ],
    ambientSay: ["Who wants an autograph? Anybody?", "Feeling golden today.", "Mansion jackpot, baby!"],
    react: { jackpot: ["WELCOME TO THE CLUB! Jackpot twins!"], big: ["Ooh, that's a winner's glow!"], win: ["Keep it rolling!"], lose: ["Shake it off, superstar."] },
  },
  {
    id: "sterling", name: "Mr. Sterling", tag: "High Roller", behavior: "stander", floor: 2, home: { x: X0 + 402, y: 440 }, face: 1, idle: "gesture",
    greet: ["Good evening. The blackjack table awaits the bold.", "Ah. A fellow connoisseur of risk."],
    lines: [
      "I only bet the maximum. Five hundred Cafe Beans a hand. Nerves of steel, wallet of foam.",
      "Never split tens. Never insure. Never order decaf.",
      "Last week I doubled down on eleven against a six. I still dream about it.",
      "The house edge is a gentle breeze. I am a sailboat.",
      "Fictional beans, very real swagger.",
    ],
    ambientSay: ["Dealer, a fresh shoe, if you please.", "Hmm. Interesting play.", "Fortune favours the well dressed."],
    react: { jackpot: ["Impressive. Most impressive."], big: ["A respectable haul."], lose: ["Variance, my friend. Merely variance."] },
  },
  {
    id: "rika", name: "Rika", tag: "Arcade Regular", behavior: "wanderer", floor: 2, home: { x: X0 + 174, y: 206 }, idle: "bob",
    waypoints: [{ x: X0 + 174, y: 206, face: 1 }, { x: X0 + 238, y: 206 }, { x: X0 + 302, y: 206, face: 1 }, { x: X0 + 430, y: 206, face: 1 }],
    greet: ["You here for the high-score table? Good luck, I own half of it.", "Hey! Ever beaten the Penguin Cross gold line?"],
    lines: [
      "My Neon Drift best lap is 0:18.9. Come at me. Politely.",
      "The secret to Beat Battle: stop thinking, start tapping. Also, practice. Mostly practice.",
      "Pixel Fighter tip: crouch-block, then punish with a heavy kick. Works on everyone except my brother.",
      "I check the leaderboard kiosk every hour. It's healthy. Probably.",
      "Racing rigs are the best seats in the house. You actually sit in them!",
    ],
    ambientSay: ["New personal best! ...almost.", "Who took my spot on the board?!", "One more run."],
    react: { jackpot: ["Nice! Now try topping my score."], big: ["Clean!"], lose: ["GG. Rematch?"] },
  },
  {
    id: "dee", name: "Dee", tag: "Just Visiting", behavior: "wanderer", floor: 2, home: { x: X0 + 220, y: 520 }, idle: "look",
    waypoints: [{ x: X0 + 220, y: 520 }, { x: X0 + 620, y: 540 }, { x: X0 + 880, y: 740 }, { x: X0 + 470, y: 780 }, { x: X0 + 520, y: 300, face: 1 }],
    greet: ["Hi! I just came up for the sports screen honestly.", "Oh hey, isn't this place great?"],
    lines: [
      "I'm not much of a gambler. I mostly come for the lights and the people watching.",
      "The Lattes are up by one on the big screen. Go Lattes!",
      "Have you seen Togi at the roulette table? Pure chaos. I love him.",
      "Free entertainment: watch someone win on Plinko. The ball always takes the scenic route.",
    ],
    ambientSay: ["What a place.", "Ooh, is that a dance floor?", "Smells like popcorn and neon."],
    react: { jackpot: ["Whoa! Congrats!"], win: ["Nice!"], lose: ["Aww."] },
  },
  {
    id: "jojo", name: "Jojo", tag: "Dance Fan", behavior: "stander", floor: 2, home: { x: X0 + 846, y: 252 }, face: 1, idle: "hype",
    greet: ["Ready to hit the arrows? Both pads are open!", "Feel that beat? Step up to a pad and press E!"],
    lines: [
      "Two Beat Battle stations side by side. Grab a friend and battle!",
      "Full combo or bust! Okay, a B rank is fine too.",
      "The floor arrows light up with the beat. Stand on a pad to play.",
      "Rhythm tip: don't watch your feet, watch the notes.",
    ],
    ambientSay: ["Up! Down! Left! Right!", "This track SLAPS.", "Who's next on the pads?"],
    react: { big: ["INCREDIBLE!"], win: ["Nice moves!"] },
  },
  {
    id: "marco", name: "Marco", tag: "Sports Fan", behavior: "sitter", floor: 2, home: { x: 0, y: 0 }, seatId: "f2-ls-c-1", back: true, idle: "bob",
    greet: ["Shh! Shh! They're about to take a shot! ...Oh. Hi!", "Beans or Lattes? Choose wisely."],
    lines: ["Go Beans! Red and white till I die!", "That ref needs glasses. Pixel glasses.", "Best seat in the arcade. Couch, snacks, live football."],
    ambientSay: ["GOOOAL! ...no wait, offside.", "Come on, Beans!", "Pass it! PASS IT!"],
  },
  {
    id: "lena", name: "Lena", tag: "Sports Fan", behavior: "sitter", floor: 2, home: { x: 0, y: 0 }, seatId: "f2-ls-c-2", back: true, idle: "bob",
    greet: ["Hey! Lattes fan? There's room on the couch.", "Grab some popcorn, it's a close one!"],
    lines: ["Lattes all the way. Smooth passing, frothy finishing.", "Marco's been shouting since kick-off.", "The keeper for the Beans is unreal today."],
    ambientSay: ["What a save!", "Go Lattes!", "Ref! REF!"],
  },
];

/** Floor 2 seats the crowd sits in (the server keeps players out of them). */
export const CROWD_SEATS: Record<string, string> = Object.fromEntries(ARCADE_CROWD.filter((s) => s.seatId).map((s) => [s.seatId!, `npc:${s.id}`]));

/** Every point an NPC stands at or walks to (the layout test checks each one is clear and reachable). */
export function crowdSpots(seats: Seat[]): { id: string; x: number; y: number }[] {
  const out: { id: string; x: number; y: number }[] = [];
  for (const s of ARCADE_CROWD) {
    if (s.behavior === "stander") out.push({ id: s.id, ...s.home });
    for (const w of s.waypoints ?? []) out.push({ id: s.id, x: w.x, y: w.y });
    if (s.seatId && !seats.some((x) => x.id === s.seatId)) out.push({ id: `${s.id}:missing-seat`, x: -1, y: -1 });
  }
  return out;
}


// ------------------------------------------------------------------ more cafe regulars (Floor 1)

export const CAFE_REGULARS: NpcSpec[] = [
  {
    id: "ava", name: "Ava", tag: "Student", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "t0-left", idle: "type",
    greet: ["Hi! Sorry, finals week. Brain is 90% caffeine.", "Oh, hey. Is it bad if I've been here since opening?"],
    lines: [
      "Organic chemistry exam tomorrow. The molecules are winning.",
      "This cafe is my library now. The library doesn't have matcha.",
      "My study method: one chapter, one cookie. I'm on cookie six.",
      "If you see me asleep on this table, wake me up at 3. Please.",
    ],
    ambientSay: ["Okay. Flashcards. Focus.", "Wait, that's not how mitochondria work...", "One more page."],
  },
  {
    id: "ben", name: "Ben", tag: "Regular", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "t4-top", idle: "gesture",
    greet: ["Hey hey! You've got to try the cocoa here.", "Oh hi! Chloe and I are planning a road trip. Got any ideas?"],
    lines: ["Chloe wants mountains, I want the beach. We'll probably end up at a gas station.", "I've been coming here every Saturday for a year. Mina knows my order by heart.", "Have you been upstairs? The arcade is wild."],
    ambientSay: ["No way, really?", "Ha! That's hilarious."],
  },
  {
    id: "chloe", name: "Chloe", tag: "Regular", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "t4-bottom", idle: "gesture",
    greet: ["Hi! Don't mind Ben, he's very loud before his second coffee.", "Oh, hello! Love your look."],
    lines: ["Road trip debate update: still mountains. Always mountains.", "I write little reviews of every drink here. The macchiato has five stars.", "The rooftop at night is the best-kept secret in town."],
    ambientSay: ["Okay, okay, listen...", "You always say that!"],
  },
  {
    id: "hana", name: "Hana", tag: "Artist", behavior: "sitter", home: { x: 0, y: 0 }, seatId: "sofa-b-1", back: true, idle: "bob",
    greet: ["Hi! I'm sketching the cafe. You might end up in it!", "Oh! Hold still... perfect pose."],
    lines: ["I'm drawing the whole cafe in pixel art. The cat keeps moving.", "The light from that window at four o'clock is magic.", "Biscuit has posed for me twelve times. He charges in head scratches."],
    ambientSay: ["Hmm, needs more orange.", "Almost got the jukebox right."],
  },
  {
    id: "rosa", name: "Rosa", tag: "Rumour Fan", behavior: "stander", home: { x: 662, y: 122 }, face: -1, idle: "look",
    greet: ["Psst. Have you read the rumour board today?", "Ooh, a new face! Got any gossip?"],
    lines: ["Somebody wrote that the barista is secretly a retired DJ. I believe it.", "I come here for the coffee and stay for the rumours.", "Rumour has it the rooftop telescope can see the moon's backside. Nobody's checked."],
    ambientSay: ["No... way.", "I KNEW it!", "Hmm, very suspicious."],
  },
];

// ------------------------------------------------------------------ the rooftop crowd (Floor 3)

const R0 = FLOOR2_X + 1280; // FLOOR3_X, without importing it twice

export const ROOFTOP_CROWD: NpcSpec[] = [
  {
    id: "stella", name: "Stella", tag: "Stargazer", behavior: "stander", floor: 3, home: { x: R0 + 770, y: 236 }, face: 1, idle: "look",
    greet: ["Hey! Clear sky tonight. Want a turn at the telescope?", "Shh... I think I just saw a shooting star."],
    lines: ["That bright one isn't a star, it's Jupiter. Say hi.", "Find the Big Dipper, follow the two end stars up, and there's Polaris.", "Make a wish at the telescope. It's free, unlike the coffee."],
    ambientSay: ["Ooh, a satellite!", "Look up, look up!", "The moon's extra bright tonight."],
  },
  {
    id: "jules", name: "Jules", tag: "Guitarist", behavior: "stander", floor: 3, home: { x: R0 + 690, y: 426 }, face: -1, idle: "bob",
    greet: ["Hey! Pull up a log. Any requests?", "Welcome to the campfire. I only know three songs, all of them bangers."],
    lines: ["This next one's about a marshmallow that dreamed of being golden.", "Roast tip: low and slow. Patience makes perfect s'mores.", "The rooftop's got the best acoustics in the city. Pigeons agree."],
    ambientSay: ["♪ la la la ♪", "One, two, three, four!", "Anyone know the chords to Wonderwall? Kidding."],
  },
  {
    id: "noor", name: "Noor", tag: "Night Owl", behavior: "stander", floor: 3, home: { x: R0 + 290, y: 170 }, face: 1, idle: "gesture",
    greet: ["Hi! Isn't the skyline gorgeous from up here?", "Oh, hello! We're just watching the city lights."],
    lines: ["Sam proposed... that we get dessert after this. Romantic.", "Count the lit windows. I'm at 412.", "Come back when it rains. The lights shimmer."],
    ambientSay: ["So pretty.", "Look, the bridge lights changed!"],
  },
  {
    id: "sam", name: "Sam", tag: "Night Owl", behavior: "stander", floor: 3, home: { x: R0 + 330, y: 170 }, face: -1, idle: "gesture",
    greet: ["Evening! Best view in town, right?", "Hey! Noor's been counting windows for an hour."],
    lines: ["I come up here to think. Mostly about snacks.", "We take a Polaroid every time we visit. The wall is half us.", "The fire's warm and the night's young."],
    ambientSay: ["Mmhm.", "You're not wrong."],
  },
  {
    id: "kaz", name: "Kaz", tag: "Photographer", behavior: "stander", floor: 3, home: { x: R0 + 310, y: 618 }, face: -1, idle: "look",
    greet: ["Say cheese! Kidding. Unless...?", "Hey! The photo stand takes great group shots. Grab some friends!"],
    lines: ["Golden hour was ten minutes ago. Blue hour is just as good.", "Stand by the string lights, they make everyone look like a movie star.", "Check the Polaroid Wall. There's a photo of a pigeon that's surprisingly artistic."],
    ambientSay: ["Ooh, nice light.", "Hold that pose!", "Click."],
  },
];

/** Groups that chat among themselves: each step is who speaks and what they say (the others turn to look). */
export const TALK_GROUPS: { id: string; floor: 1 | 2 | 3; members: string[]; talks: [string, string][][] }[] = [
  { id: "crew", floor: 1, members: CREW.map((c) => c.id), talks: CREW_TALKS },
  {
    id: "friends", floor: 1, members: ["ben", "chloe"], talks: [
      [["ben", "Okay, beach trip. Sun, sand, ice cream."], ["chloe", "Or mountains. Fresh air, no sand in your shoes."]],
      [["chloe", "Have you tried the new matcha?"], ["ben", "Twice today. Don't tell Mina, she'll cut me off."]],
      [["ben", "Did you see Togi upstairs? He was yelling at the roulette wheel."], ["chloe", "He does that. The wheel never listens."]],
    ],
  },
  {
    id: "couple", floor: 3, members: ["noor", "sam"], talks: [
      [["noor", "Look, a shooting star!"], ["sam", "Quick, make a wish!"]],
      [["sam", "Marshmallows or a Polaroid first?"], ["noor", "Polaroid. Then marshmallows. Then another Polaroid."]],
      [["noor", "The city never sleeps, huh?"], ["sam", "Neither do we, apparently."]],
    ],
  },
];

/** Every chair an NPC sits in all day, on any floor: the server marks them all taken. */
export const ALL_NPC_SEATS: Record<string, string> = { ...NPC_SEATS, ...CREW_SEATS, ...CROWD_SEATS, ...Object.fromEntries(CAFE_REGULARS.filter((s) => s.seatId).map((s) => [s.seatId!, `npc:${s.id}`])) };
