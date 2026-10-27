// The vision half of chess tracking: one call per frame that reports which
// squares are occupied by which color.
import { z } from "zod";
import { askAboutImages } from "../core/vision.js";
import { formatGrid, isValidGrid, type Grid } from "./board.js";

const BoardReading = z.object({
  boardVisible: z.boolean().describe("The whole board is in view and in focus"),
  handOverBoard: z.boolean().describe("A hand or arm is covering any square"),
  ranks: z
    .array(z.string())
    .describe('8 strings, rank 8 first; each is files a-h using "w", "b" or "."'),
});

export interface ReadResult {
  usable: boolean;
  reason?: string;
  grid?: Grid;
}

export async function readBoard(opts: {
  frame: string;
  reference: string;
  referenceGrid: Grid;
  cameraSide: "white" | "black";
  model?: string;
}): Promise<ReadResult> {
  const answer = await askAboutImages({
    model: opts.model,
    images: [
      { path: opts.reference, label: "Image 1 (reference frame, position known):" },
      { path: opts.frame, label: "Image 2 (new frame):" },
    ],
    system:
      "You read chessboards from first-person camera footage for post-game review. " +
      "Report only what is visible; never infer or suggest moves.",
    prompt: [
      `The camera wearer sits behind the ${opts.cameraSide} pieces.`,
      "In Image 1 the occupancy was (w = white piece, b = black piece, . = empty):",
      formatGrid(opts.referenceGrid),
      "Use Image 1 and that grid to orient yourself, then report the occupancy of all 64 squares in Image 2,",
      "in the same orientation (rank 8 first, files a to h).",
      "If the board is not fully visible or a hand covers squares, say so in the flags.",
    ].join("\n"),
    schema: BoardReading,
  });

  if (!answer.boardVisible) return { usable: false, reason: "board not fully visible" };
  if (answer.handOverBoard) return { usable: false, reason: "hand over the board" };
  if (!isValidGrid(answer.ranks)) return { usable: false, reason: "malformed reading" };
  return { usable: true, grid: answer.ranks };
}
