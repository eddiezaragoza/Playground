import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { Engine } from "../src/chess/engine.js";
import { reviewGame, toMarkdown, toPgn, verdictFor, whiteCp } from "../src/chess/review.js";

let engine: Engine;
before(async () => {
  engine = await Engine.start();
});
after(() => engine.stop());

test("evaluation helpers", () => {
  assert.equal(whiteCp({ bestMove: "e2e4", cp: 30 }, "w"), 30);
  assert.equal(whiteCp({ bestMove: "e2e4", cp: 30 }, "b"), -30);
  assert.equal(whiteCp({ bestMove: "e2e4", mate: 3 }, "w"), 1500);
  assert.equal(whiteCp({ bestMove: "e2e4", cp: 99999 }, "w"), 1500);
  assert.equal(verdictFor(400, false), "blunder");
  assert.equal(verdictFor(120, false), "mistake");
  assert.equal(verdictFor(60, false), "inaccuracy");
  assert.equal(verdictFor(500, true), "best");
});

test("engine finds mate in one", async () => {
  const ev = await engine.analyse("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 2 3", 10);
  assert.equal(ev.bestMove?.slice(0, 4), "f3f7");
  assert.equal(ev.mate, 1);
});

test("scholar's mate review flags black's blunder and the result", async () => {
  const moves = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
  const review = await reviewGame(moves, engine, { depth: 10 });
  assert.equal(review.result, "1-0");
  assert.equal(review.plies.length, 7);
  const nf6 = review.plies[5];
  assert.equal(nf6.san, "Nf6");
  assert.equal(nf6.verdict, "blunder");
  assert.equal(review.plies[6].verdict, "best");
  assert.ok(review.summary.b.blunder >= 1);

  const pgn = toPgn(review);
  assert.match(pgn, /\[Result "1-0"\]/);
  assert.match(pgn, /Nf6 \{\[%eval [^}]*\?\? blunder/);
  assert.match(toMarkdown(review), /3\.\.\. Nf6\?\?/);
});
