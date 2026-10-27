// After-the-game review: evaluate every position of a finished game and flag
// the moves that lost the most ground.
import { Chess } from "chess.js";
import type { Engine, Evaluation } from "./engine.js";

const CAP = 1500; // centipawns; keeps mates from swamping averages

export type Verdict = "best" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface PlyReview {
  ply: number;
  moveNumber: number;
  color: "w" | "b";
  san: string;
  bestSan: string | null;
  /** Evaluation before the move, white's point of view, in centipawns. */
  evalBefore: number;
  evalAfter: number;
  /** Centipawns the mover gave up compared with the engine's best. */
  loss: number;
  verdict: Verdict;
  time?: number;
}

export interface GameReview {
  startFen: string;
  plies: PlyReview[];
  result: string;
  summary: Record<"w" | "b", { avgLoss: number; inaccuracy: number; mistake: number; blunder: number }>;
}

/** Converts an engine evaluation to capped centipawns from white's view. */
export function whiteCp(ev: Evaluation, turn: "w" | "b"): number {
  let cp: number;
  if (ev.mate !== undefined) cp = ev.mate === 0 ? -CAP : Math.sign(ev.mate) * CAP;
  else cp = Math.max(-CAP, Math.min(CAP, ev.cp ?? 0));
  return turn === "w" ? cp : -cp;
}

export function verdictFor(loss: number, playedBest: boolean): Verdict {
  if (playedBest) return "best";
  if (loss >= 300) return "blunder";
  if (loss >= 100) return "mistake";
  if (loss >= 50) return "inaccuracy";
  return "good";
}

function positionCp(chess: Chess, ev: Evaluation): number {
  if (chess.isCheckmate()) return chess.turn() === "w" ? -CAP : CAP;
  if (chess.isDraw() || chess.isStalemate()) return 0;
  return whiteCp(ev, chess.turn());
}

export interface ReviewOptions {
  startFen?: string;
  depth?: number;
  /** Video time of each ply, for the report. */
  times?: (number | undefined)[];
  onProgress?: (done: number, total: number) => void;
}

export async function reviewGame(
  sans: string[],
  engine: Engine,
  opts: ReviewOptions = {},
): Promise<GameReview> {
  const { startFen, depth = 16, times = [], onProgress } = opts;
  const chess = startFen ? new Chess(startFen) : new Chess();
  const fen0 = chess.fen();
  let ev = await engine.analyse(chess.fen(), depth);
  let before = positionCp(chess, ev);
  const plies: PlyReview[] = [];

  for (const [i, san] of sans.entries()) {
    const color = chess.turn();
    const moveNumber = chess.moveNumber();
    const bestUci = ev.bestMove;
    let bestSan: string | null = null;
    if (bestUci) {
      const probe = new Chess(chess.fen());
      bestSan = probe.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] }).san;
    }
    const played = chess.move(san);
    ev = chess.isGameOver() ? { bestMove: null } : await engine.analyse(chess.fen(), depth);
    const after = positionCp(chess, ev);
    const sign = color === "w" ? 1 : -1;
    const loss = Math.max(0, sign * (before - after));
    plies.push({
      ply: i + 1,
      moveNumber,
      color,
      san: played.san,
      bestSan,
      evalBefore: before,
      evalAfter: after,
      loss,
      verdict: verdictFor(loss, played.san === bestSan),
      time: times[i],
    });
    before = after;
    onProgress?.(i + 1, sans.length);
  }

  const summary = { w: tally(plies, "w"), b: tally(plies, "b") };
  return { startFen: fen0, plies, result: resultOf(chess), summary };
}

function tally(plies: PlyReview[], color: "w" | "b") {
  const mine = plies.filter((p) => p.color === color);
  const count = (v: Verdict) => mine.filter((p) => p.verdict === v).length;
  return {
    avgLoss: mine.length ? Math.round(mine.reduce((s, p) => s + p.loss, 0) / mine.length) : 0,
    inaccuracy: count("inaccuracy"),
    mistake: count("mistake"),
    blunder: count("blunder"),
  };
}

function resultOf(chess: Chess): string {
  if (chess.isCheckmate()) return chess.turn() === "w" ? "0-1" : "1-0";
  if (chess.isDraw() || chess.isStalemate()) return "1/2-1/2";
  return "*";
}

const pawns = (cp: number) => (cp >= CAP ? "+M" : cp <= -CAP ? "-M" : `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`);
const SYMBOL: Record<Verdict, string> = { best: "", good: "", inaccuracy: "?!", mistake: "?", blunder: "??" };

export function toPgn(review: GameReview, headers: Record<string, string> = {}): string {
  const chess = new Chess(review.startFen);
  for (const [k, v] of Object.entries(headers)) chess.setHeader(k, v);
  chess.setHeader("Result", review.result);
  if (review.startFen !== new Chess().fen()) {
    chess.setHeader("SetUp", "1");
    chess.setHeader("FEN", review.startFen);
  }
  for (const p of review.plies) {
    chess.move(p.san);
    const notes = [`[%eval ${(p.evalAfter / 100).toFixed(2)}]`];
    if (p.verdict === "inaccuracy" || p.verdict === "mistake" || p.verdict === "blunder") {
      notes.push(`${SYMBOL[p.verdict]} ${p.verdict}, ${pawns(p.evalBefore)} → ${pawns(p.evalAfter)}. Best was ${p.bestSan}.`);
    }
    chess.setComment(notes.join(" "));
  }
  return chess.pgn() + "\n";
}

export function toMarkdown(review: GameReview, title = "Game review"): string {
  const s = review.summary;
  const lines = [
    `# ${title}`,
    "",
    `Result: **${review.result}** · ${review.plies.length} plies`,
    "",
    "| | Avg. loss (cp) | Inaccuracies | Mistakes | Blunders |",
    "|---|---|---|---|---|",
    `| White | ${s.w.avgLoss} | ${s.w.inaccuracy} | ${s.w.mistake} | ${s.w.blunder} |`,
    `| Black | ${s.b.avgLoss} | ${s.b.inaccuracy} | ${s.b.mistake} | ${s.b.blunder} |`,
    "",
    "## Key moments",
    "",
  ];
  const key = review.plies.filter((p) => p.verdict === "mistake" || p.verdict === "blunder");
  if (!key.length) lines.push("No mistakes or blunders at this depth. Clean game.");
  for (const p of key) {
    const move = `${p.moveNumber}${p.color === "w" ? "." : "..."} ${p.san}${SYMBOL[p.verdict]}`;
    const at = p.time !== undefined ? ` (video ${Math.floor(p.time / 60)}:${String(Math.floor(p.time % 60)).padStart(2, "0")})` : "";
    lines.push(`- **${move}**${at}: ${p.verdict}, ${pawns(p.evalBefore)} → ${pawns(p.evalAfter)}. Best was **${p.bestSan}**.`);
  }
  return lines.join("\n") + "\n";
}
