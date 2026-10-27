#!/usr/bin/env node
// glasses-vision CLI.
//   review <video>        Reconstruct a finished chess game from glasses footage and review it
//   analyze <pgn|moves>   Review a game you already have as PGN or SAN moves (no vision)
//   ask <image|video> <q> Ask anything about what the glasses saw (the reusable bit)
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { Chess } from "chess.js";
import { z } from "zod";
import { formatTime, framesFromFolder, framesFromVideo, isImage, sample, type Frame } from "./core/frames.js";
import { speak } from "./core/speak.js";
import { askAboutImages, VisionRefusal } from "./core/vision.js";
import { Engine } from "./chess/engine.js";
import { readBoard } from "./chess/readBoard.js";
import { reviewGame, toMarkdown, toPgn } from "./chess/review.js";
import { GameTracker } from "./chess/tracker.js";

const HELP = `glasses-vision

  review <video|frames-dir> [--side white|black] [--fps 0.5] [--start-fen FEN]
                            [--depth 16] [--model ID] [--out DIR]
      Rebuild a finished game from a recording, then review it with Stockfish.
      Writes game.pgn and review.md. Runs only on finished recordings.

  analyze <file.pgn | "e4 e5 Nf3 ..."> [--depth 16] [--out DIR]
      Review a game you already have. No vision, no API key needed.

  ask <image|video|frames-dir> "question" [--frames 6] [--speak] [--model ID]
      Ask anything about what the glasses saw.
`;

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      side: { type: "string", default: "white" },
      fps: { type: "string", default: "0.5" },
      "start-fen": { type: "string" },
      depth: { type: "string", default: "16" },
      model: { type: "string" },
      out: { type: "string" },
      frames: { type: "string", default: "6" },
      speak: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, input, ...rest] = positionals;
  if (values.help || !command || !input) {
    console.log(HELP);
    return;
  }
  const outDir = values.out ?? path.join("out", path.parse(input).name);
  const depth = Number(values.depth);

  if (command === "review") {
    const side = values.side === "black" ? "black" : "white";
    await review(input, outDir, { side, fps: Number(values.fps), startFen: values["start-fen"], depth, model: values.model });
  } else if (command === "analyze") {
    await analyze(input, outDir, depth);
  } else if (command === "ask") {
    const question = rest.join(" ");
    if (!question) throw new Error('ask needs a question, e.g. ask clip.mp4 "What brand is this?"');
    await ask(input, question, { count: Number(values.frames), speak: values.speak, model: values.model, outDir });
  } else {
    console.log(HELP);
    process.exitCode = 1;
  }
}

async function loadFrames(input: string, outDir: string, fps: number): Promise<Frame[]> {
  if ((await stat(input)).isDirectory()) return framesFromFolder(input);
  if (isImage(input)) return [{ path: input }];
  console.log(`Extracting frames at ${fps} fps…`);
  return framesFromVideo(input, path.join(outDir, "frames"), { fps });
}

async function review(
  input: string,
  outDir: string,
  opts: { side: "white" | "black"; fps: number; startFen?: string; depth: number; model?: string },
) {
  const frames = await loadFrames(input, outDir, opts.fps);
  if (frames.length < 2) throw new Error("Need at least two frames of the game");
  console.log(`${frames.length} distinct frames. The first one must show the start position.`);

  const tracker = new GameTracker({ startFen: opts.startFen });
  let reference = frames[0];
  const sans: string[] = [];
  const times: (number | undefined)[] = [];
  const log: string[] = [];

  for (const frame of frames.slice(1)) {
    if (tracker.chess.isGameOver()) break;
    const at = formatTime(frame.time).padStart(6);
    let reading;
    try {
      reading = await readBoard({
        frame: frame.path,
        reference: reference.path,
        referenceGrid: tracker.grid,
        cameraSide: opts.side,
        model: opts.model,
      });
    } catch (err) {
      if (!(err instanceof VisionRefusal)) throw err;
      reading = { usable: false, reason: `refused: ${err.message}` };
    }
    if (!reading.usable || !reading.grid) {
      log.push(`${at} skip (${reading.reason})`);
      continue;
    }
    const obs = tracker.observe(reading.grid);
    switch (obs.status) {
      case "committed":
        for (const m of obs.moves) {
          sans.push(m.san);
          times.push(frame.time);
        }
        reference = frame;
        log.push(`${at} move ${obs.moves.map((m) => m.san).join(" ")}`);
        console.log(`${at}  ${obs.moves.map((m) => m.san).join(" ")}`);
        break;
      case "unchanged":
        reference = frame;
        break;
      case "pending":
        log.push(`${at} saw ${obs.moves.join(" ")} (${obs.seen}x)`);
        break;
      case "ambiguous":
        log.push(`${at} ambiguous: ${obs.options.join(" | ")}`);
        break;
      case "unmatched":
        log.push(`${at} no legal match (${obs.distance} squares off)`);
        break;
    }
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, "tracking.log"), log.join("\n") + "\n");
  console.log(`Reconstructed ${sans.length} plies. Reviewing with Stockfish (depth ${opts.depth})…`);
  await writeReview(sans, outDir, { startFen: opts.startFen, depth: opts.depth, times, source: input });
}

async function analyze(input: string, outDir: string, depth: number) {
  const chess = new Chess();
  const isFile = await stat(input).then((s) => s.isFile(), () => false);
  if (isFile) chess.loadPgn(await readFile(input, "utf8"));
  else for (const san of input.trim().split(/\s+/).filter((t) => !/^\d+\.+$/.test(t))) chess.move(san);
  const startFen = chess.getHeaders().FEN;
  await writeReview(chess.history(), outDir, { startFen, depth, source: input });
}

async function writeReview(
  sans: string[],
  outDir: string,
  opts: { startFen?: string; depth: number; times?: (number | undefined)[]; source: string },
) {
  const engine = await Engine.start();
  try {
    const result = await reviewGame(sans, engine, {
      startFen: opts.startFen,
      depth: opts.depth,
      times: opts.times,
      onProgress: (done, total) => process.stdout.write(`\r  analysed ${done}/${total}`),
    });
    process.stdout.write("\n");
    await mkdir(outDir, { recursive: true });
    const date = new Date().toISOString().slice(0, 10).replaceAll("-", ".");
    await writeFile(path.join(outDir, "game.pgn"), toPgn(result, { Event: "Glasses review", Date: date }));
    await writeFile(path.join(outDir, "review.md"), toMarkdown(result, `Review of ${path.basename(opts.source)}`));
    console.log(toMarkdown(result));
    console.log(`Saved ${path.join(outDir, "game.pgn")} and review.md`);
  } finally {
    engine.stop();
  }
}

async function ask(input: string, question: string, opts: { count: number; speak: boolean; model?: string; outDir: string }) {
  const frames = sample(await loadFrames(input, opts.outDir, 1), opts.count);
  const { answer } = await askAboutImages({
    model: opts.model,
    images: frames.map((f, i) => ({ path: f.path, label: `Frame ${i + 1}${f.time !== undefined ? ` at ${formatTime(f.time)}` : ""}:` })),
    system: "You see through the user's smart glasses. Answer briefly and plainly, as if speaking in their ear.",
    prompt: question,
    schema: z.object({ answer: z.string() }),
    effort: "medium",
  });
  console.log(answer);
  if (opts.speak) await speak(answer);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
