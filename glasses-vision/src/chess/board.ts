// Occupancy grids: what a camera can reliably see is which squares hold a
// white piece, a black piece, or nothing. Piece identity comes from replaying
// legal moves, not from the picture.
import type { Chess } from "chess.js";

/** 8 strings, rank 8 first, each a-file to h-file, using "w", "b" or ".". */
export type Grid = string[];

export function gridOf(chess: Chess): Grid {
  return chess.board().map((rank) => rank.map((sq) => (sq ? sq.color : ".")).join(""));
}

export function isValidGrid(grid: unknown): grid is Grid {
  return Array.isArray(grid) && grid.length === 8 && grid.every((r) => typeof r === "string" && /^[wb.]{8}$/.test(r));
}

/** Number of squares that differ. */
export function distance(a: Grid, b: Grid): number {
  let d = 0;
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (a[r][f] !== b[r][f]) d++;
  return d;
}

export function formatGrid(grid: Grid): string {
  return grid.map((rank, i) => `${8 - i} ${rank}`).join("\n") + "\n  abcdefgh";
}
