import assert from "node:assert/strict";
import { test } from "node:test";
import { Chess } from "chess.js";
import { distance, gridOf, isValidGrid, type Grid } from "../src/chess/board.js";
import { GameTracker } from "../src/chess/tracker.js";

function gridAfter(...sans: string[]): Grid {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return gridOf(c);
}

function flip(grid: Grid, rank: number, file: number, to: string): Grid {
  return grid.map((r, i) => (i === rank ? r.slice(0, file) + to + r.slice(file + 1) : r));
}

test("start grid looks right", () => {
  const g = gridOf(new Chess());
  assert.equal(g[0], "bbbbbbbb");
  assert.equal(g[7], "wwwwwwww");
  assert.equal(g[3], "........");
  assert.ok(isValidGrid(g));
  assert.ok(!isValidGrid(["wwww"]));
});

test("a move commits only after two agreeing readings", () => {
  const t = new GameTracker();
  const r = gridAfter("e4");
  assert.equal(t.observe(r).status, "pending");
  const obs = t.observe(r);
  assert.equal(obs.status, "committed");
  assert.deepEqual(obs.status === "committed" && obs.moves.map((m) => m.san), ["e4"]);
});

test("one misread square is tolerated", () => {
  const t = new GameTracker();
  const noisy = flip(gridAfter("e4"), 0, 0, "."); // a8 rook "vanishes"
  assert.equal(distance(noisy, gridAfter("e4")), 1);
  t.observe(noisy);
  const obs = t.observe(gridAfter("e4"));
  assert.equal(obs.status, "committed");
});

test("a lifted piece reads as unchanged, not as a move", () => {
  const t = new GameTracker();
  const lifted = flip(gridOf(new Chess()), 6, 4, "."); // e2 pawn in the air
  assert.equal(t.observe(lifted).status, "unchanged");
});

test("a skipped frame is recovered as two moves", () => {
  const t = new GameTracker();
  const r = gridAfter("e4", "e5");
  t.observe(r);
  const obs = t.observe(r);
  assert.equal(obs.status, "committed");
  assert.deepEqual(obs.status === "committed" && obs.moves.map((m) => m.san), ["e4", "e5"]);
});

test("a disagreeing reading resets confirmation", () => {
  const t = new GameTracker();
  t.observe(gridAfter("e4"));
  assert.equal(t.observe(gridAfter("d4")).status, "pending");
  assert.equal(t.observe(gridAfter("d4")).status, "committed");
  assert.equal(t.chess.history()[0], "d4");
});

test("garbage is unmatched", () => {
  const t = new GameTracker();
  const obs = t.observe(Array(8).fill("wbwbwbwb"));
  assert.equal(obs.status, "unmatched");
});

test("a position two white moves away is unmatched, not guessed", () => {
  const t = new GameTracker({ startFen: "4k3/8/8/8/8/8/8/R3K2R w - - 0 1", confirmations: 1, maxNoise: 0 });
  // Both rooks moved, which takes two white moves. Within two plies that's
  // impossible (black moves in between), so the tracker must not invent it.
  const reading = gridOf(new Chess("4k3/8/8/8/8/8/8/1R2K1R1 w - - 0 1"));
  assert.equal(t.observe(reading).status, "unmatched");
});
