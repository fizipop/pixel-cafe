import * as Phaser from "phaser";
import { ellipse, make, rect, type Ctx } from "./art";
import { RIG } from "./arcadeLayout";

// The newer Floor 2 pieces, drawn in code like everything else: the two Huff & Xtra Puff slot cabinets, the Plinko
// cabinet, the lottery booth, the sit-down racing rigs, the Beat Battle dance pads and the sports lounge's big screen.

const OUT = "#0a0716";

/** HUFF & XTRA PUFF: a straw-yellow cabinet with a thatched roof top, three reels and a pig snout on the panel. */
function drawHuff(c: Ctx) {
  const W = 54, H = 66;
  ellipse(c, "#00000055", W / 2, H - 2, 24, 3);
  rect(c, OUT, 2, 8, W - 4, H - 9);
  rect(c, "#8a4a1a", 3, 10, W - 6, H - 12);
  rect(c, "#e8a33a", 3, 10, 3, H - 12); rect(c, "#e8a33a", W - 6, 10, 3, H - 12);
  // thatched roof marquee
  for (let i = 0; i < 12; i++) rect(c, i % 2 ? "#c8a040" : "#f2d27a", 2 + i * 4, 2 + Math.abs(6 - i) * 0.4, 5, 10);
  rect(c, "#5a2a10", 2, 11, W - 4, 2);
  rect(c, "#fff6e0", 12, 5, 30, 4); rect(c, "#d9304a", 14, 6, 26, 2);
  // reels
  rect(c, OUT, 7, 16, W - 14, 22);
  for (let i = 0; i < 3; i++) {
    const x = 9 + i * 12;
    rect(c, "#f6ecd6", x, 18, 11, 18);
    if (i === 0) { rect(c, "#f2d27a", x + 2, 22, 7, 5); rect(c, "#6a4428", x + 4, 25, 3, 4); } // straw house
    if (i === 1) { rect(c, "#ffadc0", x + 2, 22, 7, 7); rect(c, "#1f140d", x + 3, 24, 1, 1); rect(c, "#1f140d", x + 7, 24, 1, 1); rect(c, "#e888a0", x + 4, 26, 3, 2); } // pig
    if (i === 2) { rect(c, "#c8503a", x + 2, 23, 7, 6); rect(c, "#5a2a2a", x + 2, 21, 7, 2); } // brick house
  }
  rect(c, "#ffe080", 7, 26, W - 14, 1); // win line
  rect(c, "#ffffff22", 9, 18, W - 18, 3);
  // control panel with a snout button and a wind-up key
  rect(c, "#5a2a10", 6, 41, W - 12, 9); rect(c, "#7a3a1c", 6, 41, W - 12, 2);
  rect(c, "#ffadc0", 21, 43, 11, 6); rect(c, "#a04060", 24, 45, 2, 2); rect(c, "#a04060", 28, 45, 2, 2);
  rect(c, "#c89a20", 38, 43, 6, 2); rect(c, "#c89a20", 40, 45, 2, 3);
  rect(c, OUT, 10, 52, W - 20, 10); rect(c, "#f2c36b", 23, 55, 8, 3);
}

/** HUFF & XTRA PUFF BONUS: wider, a pink brick-house cabinet with a chimney, five reels and a house-build meter. */
function drawHuffBonus(c: Ctx) {
  const W = 66, H = 68;
  ellipse(c, "#00000055", W / 2, H - 2, 30, 3);
  rect(c, OUT, 2, 10, W - 4, H - 11);
  rect(c, "#5a1a3a", 3, 12, W - 6, H - 14);
  for (let y = 14; y < H - 4; y += 4) for (let x = 3 + ((y / 4) % 2) * 3; x < W - 4; x += 6) rect(c, "#6a2a4a", x, y, 5, 3); // brick texture
  rect(c, "#d8708a", 3, 12, 2, H - 14); rect(c, "#d8708a", W - 5, 12, 2, H - 14);
  // roof + chimney marquee
  for (let i = 0; i < 10; i++) rect(c, "#8a3a3a", 5 + i * 3, 10 - i, W - 10 - i * 6, 1);
  rect(c, "#6a6a72", W - 16, 0, 6, 8);
  rect(c, "#ffe080", 14, 4, 38, 4); rect(c, "#d8708a", 16, 5, 34, 2);
  // five reels
  rect(c, OUT, 6, 16, W - 12, 20);
  for (let i = 0; i < 5; i++) {
    const x = 8 + i * 10;
    rect(c, "#f6ecd6", x, 18, 9, 16);
    const col = ["#f2d27a", "#b8743a", "#c8503a", "#ffadc0", "#d0a020"][i];
    rect(c, col, x + 2, 22, 5, 6);
  }
  rect(c, "#ffffff22", 8, 18, W - 16, 3);
  // build meter: straw, wood, brick, mansion lamps
  ["#f2d27a", "#b8743a", "#c8503a", "#ffe080"].forEach((col, i) => { rect(c, OUT, 10 + i * 12, 38, 10, 5); rect(c, col, 11 + i * 12, 39, 8, 3); });
  rect(c, "#3a1028", 6, 45, W - 12, 8); rect(c, "#d0a020", 28, 47, 10, 4); rect(c, "#7a4a22", 32, 49, 2, 4); // golden hammer button
  rect(c, OUT, 12, 55, W - 24, 9); rect(c, "#f2c36b", 29, 58, 8, 3);
}

/** PIXEL PLINKO: a tall cabinet with a glass pegboard, a ball chute and multiplier slots at the bottom. */
function drawPlinko(c: Ctx) {
  const W = 60, H = 86;
  ellipse(c, "#00000055", W / 2, H - 2, 27, 3);
  rect(c, OUT, 2, 2, W - 4, H - 3);
  rect(c, "#2a1048", 3, 4, W - 6, H - 6);
  rect(c, "#ff5fa8", 3, 4, 2, H - 6); rect(c, "#ff5fa8", W - 5, 4, 2, H - 6);
  rect(c, "#ff5fa8", 8, 5, W - 16, 8); rect(c, "#fff6e0", 12, 7, W - 24, 4); // marquee
  rect(c, OUT, 7, 15, W - 14, 50);
  rect(c, "#140a2a", 8, 16, W - 16, 48);
  rect(c, "#3a2a5a", 26, 16, 8, 4); // chute
  for (let r = 0; r < 8; r++) for (let k = 0; k <= r + 2; k++) {
    const x = Math.round(W / 2 - (r + 2) * 2.4 + k * 4.8), y = 22 + r * 5;
    if (x > 9 && x < W - 10) rect(c, "#9fb8d8", x, y, 1, 1);
  }
  rect(c, "#f2c36b", 29, 31, 2, 2); // the ball mid-fall
  ["#ff3b6b", "#ff8a3a", "#f2c36b", "#7fc8a9", "#58a6e0", "#7fc8a9", "#f2c36b", "#ff8a3a", "#ff3b6b"].forEach((col, i) => rect(c, col, 9 + i * 4.7, 59, 4, 5));
  rect(c, "#ffffff18", 10, 16, 6, 48); // glass glare
  rect(c, "#3a1a5a", 6, 67, W - 12, 6); rect(c, "#d9304a", 26, 68, 8, 4);
  rect(c, OUT, 12, 75, W - 24, 8); rect(c, "#f2c36b", 26, 77, 8, 3);
}

/** The LUCKY BEAN LOTTERY booth: a little kiosk with an awning, a number board and a ticket window. */
function drawLottery(c: Ctx) {
  const W = 84, H = 76;
  ellipse(c, "#00000055", W / 2, H - 2, 38, 3);
  rect(c, OUT, 4, 14, W - 8, H - 15);
  rect(c, "#0b2a20", 5, 16, W - 10, H - 18);
  // striped awning
  for (let i = 0; i < 10; i++) { rect(c, i % 2 ? "#fff6e0" : "#7fe0a9", 2 + i * 8, 4, 8, 12); rect(c, i % 2 ? "#fff6e0" : "#7fe0a9", 2 + i * 8 + 1, 16, 6, 3); }
  rect(c, OUT, 2, 3, W - 4, 1);
  // the number board: three lit balls
  rect(c, OUT, 12, 22, W - 24, 18);
  rect(c, "#05140f", 13, 23, W - 26, 16);
  ["#ff5fa8", "#f2c36b", "#58e1ff"].forEach((col, i) => { const x = 22 + i * 16; rect(c, col, x, 26, 10, 10); rect(c, "#fff6e0", x + 2, 28, 3, 2); rect(c, OUT, x + 4, 30, 2, 4); });
  // ticket window and counter
  rect(c, OUT, 24, 44, W - 48, 16);
  rect(c, "#9fd8f0", 25, 45, W - 50, 14); rect(c, "#ffffff55", 26, 46, 6, 12);
  rect(c, "#3a2a22", 8, 60, W - 16, 6); rect(c, "#5a4232", 8, 60, W - 16, 2);
  rect(c, "#fff6e0", 34, 58, 16, 4); rect(c, "#d9304a", 36, 59, 12, 1); // a ticket on the counter
  rect(c, "#7fe0a9", 10, 66, W - 20, 6);
}

/** A sit-down racing rig's cabinet: big screen showing the road, a dashboard, and a steering wheel, viewed from behind the seat. */
function drawRigCab(c: Ctx) {
  const W = RIG.w, H = RIG.cabH;
  rect(c, OUT, 2, 0, W - 4, H);
  rect(c, "#50381a", 3, 1, W - 6, H - 2);
  rect(c, "#f2a93b", 3, 1, W - 6, 2); rect(c, "#f2a93b", 3, 1, 2, H - 2); rect(c, "#f2a93b", W - 5, 1, 2, H - 2);
  rect(c, "#9a6a2d", 8, 3, W - 16, 6); rect(c, "#fff6e0", 12, 5, W - 24, 2); // NEON DRIFT marquee
  // the screen: sky, mountains, a road vanishing to the horizon and a little car
  rect(c, OUT, 7, 11, W - 14, 26);
  rect(c, "#3a8eea", 8, 12, W - 16, 10); rect(c, "#9fd9f7", 8, 19, W - 16, 3);
  rect(c, "#8a5236", 8, 20, W - 16, 3);
  rect(c, "#4aa040", 8, 23, W - 16, 13);
  for (let y = 0; y < 13; y++) { const hw = 2 + y * 1.6; rect(c, "#50535f", W / 2 - hw, 23 + y, hw * 2, 1); if (y % 3 === 0) rect(c, "#f6f1e6", W / 2 - 0.5, 23 + y, 1, 1); }
  rect(c, "#58e1ff", W / 2 - 3, 31, 6, 3); rect(c, "#d9304a", W / 2 - 3, 33, 2, 1); rect(c, "#d9304a", W / 2 + 1, 33, 2, 1);
  rect(c, "#ffffff22", 8, 12, W - 16, 2);
  // dashboard + steering wheel
  rect(c, "#2a2140", 5, 38, W - 10, 10); rect(c, "#3a2f5a", 5, 38, W - 10, 2);
  rect(c, "#7fe0a9", 9, 41, 6, 3); rect(c, "#f2c36b", W - 15, 41, 6, 3);
  ellipse(c, OUT, W / 2, 46, 11, 7); ellipse(c, "#3a3a44", W / 2, 46, 10, 6); ellipse(c, "#2a2140", W / 2, 46, 6, 3);
  rect(c, "#3a3a44", W / 2 - 1, 41, 2, 10); rect(c, "#d9304a", W / 2 - 1, 40, 2, 2);
  // pedals in the footwell
  rect(c, "#05030c", 14, 50, W - 28, 5); rect(c, "#9fb8d8", 20, 51, 6, 3); rect(c, "#9fb8d8", W - 26, 51, 6, 3);
}

/** A rig's bucket seat seen from behind (drawn in front of whoever sits in it, so only their head shows). */
function drawRigSeat(c: Ctx) {
  const W = RIG.w, H = RIG.seatH;
  ellipse(c, "#00000055", W / 2, H - 2, 22, 3);
  rect(c, OUT, 9, 2, W - 18, H - 4);
  rect(c, "#1a1a22", 10, 3, W - 20, H - 6);
  rect(c, "#d9304a", 12, 5, W - 24, 14); // red seat back
  rect(c, "#ff5f6a", 12, 5, W - 24, 2);
  rect(c, "#1a1a22", W / 2 - 1, 5, 2, 14); // centre stitch
  rect(c, "#f2a93b", 14, 20, W - 28, 2);
  rect(c, "#3a3a44", 6, H - 8, 6, 6); rect(c, "#3a3a44", W - 12, H - 8, 6, 6); // seat rails
}

/** A Beat Battle dance pad: a 3x3 panel with lit arrows on the four sides (the arrow lights are separate images). */
function drawDancePad(c: Ctx) {
  rect(c, OUT, 0, 0, 48, 48);
  rect(c, "#3a3a48", 1, 1, 46, 46);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) {
    const x = 2 + k * 15, y = 2 + r * 15;
    rect(c, (r + k) % 2 ? "#2a2a36" : "#4a4a5a", x, y, 14, 14);
    rect(c, "#6a6a7a", x, y, 14, 1);
  }
}
/** One arrow panel light (rotated for each direction): a chunky pixel arrow. */
function drawArrow(col: string, glow: string) {
  return (c: Ctx) => {
    rect(c, glow, 0, 0, 14, 14);
    rect(c, OUT, 6, 2, 2, 1);
    for (let i = 0; i < 5; i++) rect(c, col, 6 - i, 3 + i, 2 + i * 2, 1); // arrow head
    rect(c, col, 5, 8, 4, 4); // shaft
    rect(c, "#fff6e0", 6, 4, 2, 2);
  };
}

/** The big screen's frame (the picture itself is a live canvas drawn by the lounge). */
function drawScreenFrame(c: Ctx) {
  rect(c, OUT, 0, 0, 252, 90);
  rect(c, "#2a2a36", 2, 2, 248, 86);
  rect(c, "#3a3a4a", 2, 2, 248, 3);
  rect(c, "#05030c", 5, 5, 242, 80);
  rect(c, "#d9304a", 230, 82, 4, 2); // power light
  rect(c, "#1a1a22", 110, 88, 32, 2);
}

/** A little round lounge table with snacks. */
function drawLoungeTable(c: Ctx) {
  ellipse(c, "#00000044", 28, 26, 26, 4);
  ellipse(c, OUT, 28, 14, 27, 11);
  ellipse(c, "#6b4429", 28, 13, 26, 10);
  ellipse(c, "#8a5a36", 28, 12, 24, 8);
  rect(c, "#d9304a", 14, 8, 8, 6); rect(c, "#fff6e0", 14, 8, 8, 1); // popcorn
  rect(c, "#f2c36b", 15, 6, 2, 2); rect(c, "#f2c36b", 19, 6, 2, 2);
  rect(c, "#3a8a4a", 34, 7, 4, 8); rect(c, "#9fd8f0", 40, 8, 4, 7); // drinks
  rect(c, "#3a2a22", 25, 20, 6, 8);
}

/** The Pixel Restaurant crew's props: a laptop whose screen faces us (their site on it), a side-on laptop, a table tent. */
function drawLaptopScreen(c: Ctx) {
  rect(c, OUT, 0, 0, 16, 12);
  rect(c, "#f6f1e6", 1, 1, 14, 8); // the site: white page
  rect(c, "#e8642a", 1, 1, 14, 2); // orange header bar
  rect(c, "#fff6e0", 2, 1, 4, 1); // logo
  rect(c, "#d9304a", 2, 4, 3, 3); rect(c, "#f2c36b", 6, 4, 3, 3); rect(c, "#7fc8a9", 10, 4, 3, 3); // three dish tiles
  rect(c, "#3a8a4a", 5, 8, 6, 1); // "Order now"
  rect(c, "#8a8a96", 0, 9, 16, 3); rect(c, "#b0b0bc", 1, 10, 14, 1); // keyboard deck
}
function drawLaptopSide(c: Ctx) {
  rect(c, OUT, 0, 0, 6, 10);
  rect(c, "#8a8a96", 1, 1, 1, 8); // the lid, seen edge-on
  rect(c, "#b0b0bc", 1, 8, 5, 1);
  rect(c, "#58e1ff", 2, 1, 1, 7); // a glow from the screen
}
function drawTentCard(c: Ctx) {
  rect(c, OUT, 0, 2, 18, 8);
  rect(c, "#fff6e0", 1, 3, 16, 6);
  rect(c, "#e8642a", 1, 3, 16, 2);
  rect(c, "#1f140d", 3, 6, 2, 2); rect(c, "#1f140d", 3, 6, 4, 1); // a pixel "P"
  rect(c, "#1f140d", 9, 6, 1, 2); rect(c, "#1f140d", 11, 6, 1, 2); rect(c, "#1f140d", 13, 6, 1, 2); rect(c, "#1f140d", 9, 6, 5, 1); // a little fork
  rect(c, "#1f140d", 11, 8, 1, 1);
}

export function buildCasinoTextures(scene: Phaser.Scene) {
  make(scene, "laptop_screen", 16, 12, drawLaptopScreen);
  make(scene, "laptop_side", 6, 10, drawLaptopSide);
  make(scene, "tent_card", 18, 10, drawTentCard);
  make(scene, "cab_huff", 54, 66, drawHuff);
  make(scene, "cab_huff_bonus", 66, 68, drawHuffBonus);
  make(scene, "cab_plinko", 60, 86, drawPlinko);
  make(scene, "lottery_booth", 84, 76, drawLottery);
  make(scene, "rig_cab", RIG.w, RIG.cabH, drawRigCab);
  make(scene, "rig_seat", RIG.w, RIG.seatH, drawRigSeat);
  make(scene, "dance_pad", 48, 48, drawDancePad);
  make(scene, "dance_arrow", 14, 14, drawArrow("#ff5fa8", "#4a1a3a"));
  make(scene, "dance_arrow_b", 14, 14, drawArrow("#58e1ff", "#1a2a4a"));
  make(scene, "screen_frame", 252, 90, drawScreenFrame);
  make(scene, "lounge_table", 56, 30, drawLoungeTable);
}
