// Turns a stream of noisy occupancy readings into legal moves. A move is only
// committed once `confirmations` readings in a row agree on it.
import { Chess, type Move } from "chess.js";
import { distance, gridOf, type Grid } from "./board.js";

export interface TrackerOptions {
  startFen?: string;
  /** Readings in a row that must agree before a move is committed. */
  confirmations?: number;
  /** Most misread squares tolerated when matching a reading to a position. */
  maxNoise?: number;
}

export type Observation =
  | { status: "unchanged" }
  | { status: "pending"; moves: string[]; seen: number }
  | { status: "committed"; moves: Move[] }
  | { status: "unmatched"; distance: number }
  | { status: "ambiguous"; options: string[] };

interface Candidate {
  moves: Move[];
  grid: Grid;
}

export class GameTracker {
  readonly chess: Chess;
  private readonly confirmations: number;
  private readonly maxNoise: number;
  private pending: { key: string; seen: number } | null = null;

  constructor({ startFen, confirmations = 2, maxNoise = 2 }: TrackerOptions = {}) {
    this.chess = startFen ? new Chess(startFen) : new Chess();
    this.confirmations = confirmations;
    this.maxNoise = maxNoise;
  }

  get grid(): Grid {
    return gridOf(this.chess);
  }

  /**
   * Candidates are the current position, every legal move, and every legal
   * pair of moves (in case a frame between them was skipped). Promotions are
   * assumed to be queens, since the grid can't tell pieces apart.
   */
  private candidates(): Candidate[] {
    const out: Candidate[] = [{ moves: [], grid: this.grid }];
    if (this.chess.isGameOver()) return out;
    for (const m1 of this.legal()) {
      this.chess.move(m1);
      out.push({ moves: [m1], grid: gridOf(this.chess) });
      if (!this.chess.isGameOver()) {
        for (const m2 of this.legal()) {
          this.chess.move(m2);
          out.push({ moves: [m1, m2], grid: gridOf(this.chess) });
          this.chess.undo();
        }
      }
      this.chess.undo();
    }
    return out;
  }

  private legal(): Move[] {
    return this.chess.moves({ verbose: true }).filter((m) => !m.promotion || m.promotion === "q");
  }

  observe(reading: Grid): Observation {
    const scored = this.candidates().map((c) => ({ ...c, d: distance(c.grid, reading) }));
    const best = Math.min(...scored.map((c) => c.d));
    if (best > this.maxNoise) {
      this.pending = null;
      return { status: "unmatched", distance: best };
    }
    // Among equally good matches prefer the explanation with the fewest moves.
    const fewest = Math.min(...scored.filter((c) => c.d === best).map((c) => c.moves.length));
    const top = scored.filter((c) => c.d === best && c.moves.length === fewest);
    if (fewest === 0) {
      this.pending = null;
      return { status: "unchanged" };
    }
    if (top.length > 1) {
      this.pending = null;
      return { status: "ambiguous", options: top.map((c) => c.moves.map((m) => m.san).join(" ")) };
    }

    const winner = top[0];
    const key = winner.moves.map((m) => m.lan).join(" ");
    this.pending = this.pending?.key === key ? { key, seen: this.pending.seen + 1 } : { key, seen: 1 };
    if (this.pending.seen < this.confirmations) {
      return { status: "pending", moves: winner.moves.map((m) => m.san), seen: this.pending.seen };
    }
    this.pending = null;
    for (const m of winner.moves) this.chess.move(m);
    return { status: "committed", moves: winner.moves };
  }
}
