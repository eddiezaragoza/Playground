# glasses-vision

Turn what your Meta glasses saw into answers. A small toolkit of reusable parts,
plus one finished example: a **post-game chess review**.

Built after the viral "Ray-Ban chess" clip, but **analysis-only**. Nothing here
gives advice during a game. Chess review runs on a finished recording and
reports what happened after the fact, like a coach watching the tape.

## What's reusable

| Module | Does | Reuse it for |
|---|---|---|
| `src/core/frames.ts` | Video → de-duplicated JPEG frames (ffmpeg `mpdecimate` drops still frames for free). Also folders of photos, and macOS window capture. | Any skill that looks at footage |
| `src/core/vision.ts` | `askAboutImages({ images, prompt, schema })` → a typed answer from Claude, validated by a zod schema | Reading labels, receipts, whiteboards, counting reps, "what is this?" |
| `src/core/speak.ts` | Speaks text on macOS, optionally into a virtual audio device that a call app uses as its mic | Getting audio back to the glasses |
| `src/chess/*` | Board occupancy reading, legal-move tracking, Stockfish review | The worked example |

New skill = pick a frame source, write a prompt and a zod schema, call
`askAboutImages`. `ask` in `src/cli.ts` is about 15 lines and shows the pattern.

## Setup

```bash
cd glasses-vision
npm install
brew install ffmpeg          # or apt install ffmpeg
export ANTHROPIC_API_KEY=... # only for `review` and `ask`
```

Stockfish 19 comes from npm (WASM), so there's no engine to install.

## Commands

```bash
# Review a finished game recorded on the glasses (first frame = start position)
npm start -- review game.mp4 --side white

# Review a game you already have. No API key needed
npm start -- analyze game.pgn
npm start -- analyze "e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5"

# Ask anything about a photo, clip or folder of frames
npm start -- ask clip.mp4 "What's the name of the restaurant on the left?" --speak
```

Output goes to `out/<name>/`: `game.pgn` (with `[%eval]` comments, opens in
Lichess or ChessBase), `review.md` (summary and key moments with video
timestamps), and `tracking.log` (what was read from every frame).

### Review options

| Flag | Default | Meaning |
|---|---|---|
| `--side` | `white` | Which side the camera wearer sits on |
| `--fps` | `0.5` | Frames sampled per second before de-duplication |
| `--start-fen` | standard start | If the recording starts mid-game |
| `--depth` | `16` | Stockfish depth per position |
| `--model` | `claude-opus-5-5` | Vision model (or set `GLASSES_MODEL`) |

## How the chess review works

1. **Frames.** Sample the video and drop near-duplicates.
2. **Read occupancy, not pieces.** For each frame Claude reports only which
   squares hold a white piece, a black piece or nothing. It gets the last
   confirmed frame and grid as a reference. Telling a bishop from a pawn on a
   tilted head-cam frame is unreliable. Telling occupied from empty is not.
   Frames with a hand over the board or the board out of view are skipped.
3. **Match to legal moves.** The tracker compares the reading with every
   position one or two legal moves ahead, within 2 misread squares. Picking the
   piece's identity is left to chess rules. Two consecutive frames must agree
   before a move is committed. A lifted piece reads as "unchanged".
4. **Review.** Once the whole game is rebuilt, Stockfish evaluates every
   position and flags inaccuracies (≥50 cp lost), mistakes (≥100) and
   blunders (≥300).

## Known limits

- **Promotions are assumed to be queens.** Occupancy can't tell pieces apart.
  Fix underpromotions in the PGN.
- **The first frame must show the start position** (or pass `--start-fen`).
- **If the tracker loses the thread** (for example, more than two moves while
  the board was out of view), later moves won't match. Check `tracking.log`.
- **Cost.** Each read sends two images. Roughly 1–3¢ per frame on Opus, so a
  30-minute game at 0.5 fps is a few dollars. Lower `--fps` or pass a cheaper
  `--model` (e.g. `claude-haiku-5-5`) if it's good enough on your footage.
- **The live vision path hasn't been tested on real glasses footage yet.**
  The tracker, the engine and the review are covered by tests, and `analyze`
  runs end to end. Run `review` on a short real clip first and check
  `tracking.log`.

## Getting footage off the glasses

Easiest: record on the glasses, let the Meta AI app import the clip, AirDrop
or copy it to your computer, and run `review`. For live skills (not chess),
Meta's Wearables Device Access Toolkit gives apps direct camera access. That's
cleaner than screen-capturing a video call.

## Tests

```bash
npm test        # tracker + Stockfish review, no API key needed
npm run typecheck
```
