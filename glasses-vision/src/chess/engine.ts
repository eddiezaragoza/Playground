// Stockfish 19 (WASM, from npm) over UCI. Nothing to install separately.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface StockfishInstance {
  processCommand(cmd: string): void;
  terminate(): void;
  listener?: (line: string) => void;
}

export interface Evaluation {
  /** Best move in UCI notation, or null when the game is over. */
  bestMove: string | null;
  /** Centipawns from the side to move's point of view. */
  cp?: number;
  /** Moves to mate from the side to move's point of view (negative: getting mated). */
  mate?: number;
}

export class Engine {
  private sf: StockfishInstance;
  private waiting: ((line: string) => boolean) | null = null;

  private constructor(sf: StockfishInstance) {
    this.sf = sf;
    this.sf.listener = (line) => {
      if (this.waiting?.(line)) this.waiting = null;
    };
  }

  static async start(flavor = "lite-single"): Promise<Engine> {
    const init = require("stockfish") as (flavor: string) => StockfishInstance;
    const engine = new Engine(init(flavor));
    await engine.until("uci", (l) => l === "uciok");
    await engine.until("isready", (l) => l === "readyok");
    return engine;
  }

  private until(cmd: string, done: (line: string) => boolean): Promise<void> {
    return new Promise((resolve) => {
      this.waiting = (line) => {
        if (!done(line)) return false;
        resolve();
        return true;
      };
      this.sf.processCommand(cmd);
    });
  }

  async analyse(fen: string, depth = 16): Promise<Evaluation> {
    const result: Evaluation = { bestMove: null };
    this.sf.processCommand(`position fen ${fen}`);
    await new Promise<void>((resolve) => {
      this.waiting = (line) => {
        const score = line.match(/^info .*\bscore (cp|mate) (-?\d+)/);
        if (score) {
          result.cp = score[1] === "cp" ? Number(score[2]) : undefined;
          result.mate = score[1] === "mate" ? Number(score[2]) : undefined;
        }
        const best = line.match(/^bestmove (\S+)/);
        if (!best) return false;
        result.bestMove = best[1] === "(none)" ? null : best[1];
        resolve();
        return true;
      };
      this.sf.processCommand(`go depth ${depth}`);
    });
    return result;
  }

  stop() {
    this.sf.terminate();
  }
}
