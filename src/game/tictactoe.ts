// Tic-Tac-Toe as a pure reducer. Nothing here knows about Phaser, React or NPCs.
//
// Phase 4 note: two real players can play each other by dispatching the same actions.
// `players` holds who owns X and O ("player:<id>" or "npc:<id>"); the server would simply
// run `tttReduce` and broadcast the new state.

export type Side = "X" | "O";
export type Cell = Side | null;

export type TttState = {
  board: Cell[]; // 9 cells, row by row
  turn: Side;
  winner: Side | "draw" | null;
  line: number[] | null; // the winning three cells
  players: Record<Side, string | null>;
  round: number; // starts at 0; the starting side alternates every round
  scores: { X: number; O: number; draw: number };
};

export type TttAction =
  | { type: "join"; side: Side; by: string }
  | { type: "leave"; by: string }
  | { type: "move"; idx: number; by: string }
  | { type: "reset"; by: string };

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6],
];

export const other = (s: Side): Side => (s === "X" ? "O" : "X");
const isNpc = (id: string | null) => !!id && id.startsWith("npc:");

export function newTable(): TttState {
  return {
    board: Array<Cell>(9).fill(null),
    turn: "X",
    winner: null,
    line: null,
    players: { X: null, O: null },
    round: 0,
    scores: { X: 0, O: 0, draw: 0 },
  };
}

export function findWinner(board: Cell[]): { winner: Side | "draw" | null; line: number[] | null } {
  for (const l of LINES) {
    const [a, b, c] = l;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: l };
  }
  return board.every(Boolean) ? { winner: "draw", line: null } : { winner: null, line: null };
}

const emptyBoard = (s: TttState): TttState => ({
  ...s,
  board: Array<Cell>(9).fill(null),
  turn: s.round % 2 === 0 ? "X" : "O",
  winner: null,
  line: null,
});

const hasMoves = (s: TttState) => s.board.some(Boolean);

/**
 * Returns the next state, the SAME object if nothing changed, or null if the action is not allowed.
 */
export function tttReduce(s: TttState, a: TttAction): TttState | null {
  switch (a.type) {
    case "join": {
      const holder = s.players[a.side];
      if (holder === a.by) return s;
      if (s.players[other(a.side)] === a.by) return null; // can't play both sides
      // A real player may take a seat from an NPC; nobody can take a seat from another real player.
      if (holder && !(isNpc(holder) && !isNpc(a.by))) return null;
      const next = { ...s, players: { ...s.players, [a.side]: a.by } };
      return hasMoves(s) ? emptyBoard(next) : next;
    }
    case "leave": {
      const side = (["X", "O"] as Side[]).find((x) => s.players[x] === a.by);
      if (!side) return s;
      const next = { ...s, players: { ...s.players, [side]: null } };
      return hasMoves(s) ? emptyBoard(next) : next; // an abandoned game is cleared
    }
    case "move": {
      if (s.winner || !s.players.X || !s.players.O) return null;
      if (s.players[s.turn] !== a.by) return null; // not your turn
      if (!Number.isInteger(a.idx) || a.idx < 0 || a.idx > 8 || s.board[a.idx]) return null;
      const board = s.board.slice();
      board[a.idx] = s.turn;
      const { winner, line } = findWinner(board);
      const scores = { ...s.scores };
      if (winner === "draw") scores.draw++;
      else if (winner) scores[winner]++;
      return { ...s, board, winner, line, scores, turn: winner ? s.turn : other(s.turn) };
    }
    case "reset": {
      if (s.players.X !== a.by && s.players.O !== a.by) return null;
      if (!hasMoves(s)) return s;
      return emptyBoard({ ...s, round: s.round + 1 });
    }
  }
}

// ------------------------------------------------------------------- the NPC

function minimax(board: Cell[], turn: Side, me: Side): number {
  const { winner } = findWinner(board);
  if (winner === me) return 1;
  if (winner === "draw") return 0;
  if (winner) return -1;
  let best = turn === me ? -2 : 2;
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = turn;
    const v = minimax(board, other(turn), me);
    board[i] = null;
    best = turn === me ? Math.max(best, v) : Math.min(best, v);
  }
  return best;
}

/** Best possible moves for `side` (all moves tied for best). */
export function bestMoves(board: Cell[], side: Side): number[] {
  const scored: [number, number][] = [];
  const work = board.slice();
  for (let i = 0; i < 9; i++) {
    if (work[i]) continue;
    work[i] = side;
    scored.push([i, minimax(work, other(side), side)]);
    work[i] = null;
  }
  const top = Math.max(...scored.map(([, v]) => v));
  return scored.filter(([, v]) => v === top).map(([i]) => i);
}

/** A friendly opponent: plays well, but blunders now and then so the player can win. */
export function chooseMove(board: Cell[], side: Side, rng: () => number = Math.random, blunder = 0.25): number {
  const free = board.map((c, i) => (c ? -1 : i)).filter((i) => i >= 0);
  if (free.length === 0) return -1;
  if (rng() < blunder) return free[Math.floor(rng() * free.length)];
  const best = bestMoves(board, side);
  return best[Math.floor(rng() * best.length)];
}
