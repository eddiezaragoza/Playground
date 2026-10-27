// Frame sources. Everything downstream works on plain image files, so any
// source (a glasses recording, a folder of photos, a window capture) plugs in.
import { execFile } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Frame {
  path: string;
  /** Seconds from the start of the source, when known. */
  time?: number;
}

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function isImage(file: string): boolean {
  return IMAGE_EXT.has(path.extname(file).toLowerCase());
}

/**
 * Samples a video at `fps` and drops near-duplicate frames (ffmpeg's
 * mpdecimate), so a still board costs one frame, not hundreds.
 * Frames are scaled to at most `maxWidth` px to keep vision calls cheap.
 */
export async function framesFromVideo(
  video: string,
  outDir: string,
  { fps = 0.5, maxWidth = 1280, dedupe = true } = {},
): Promise<Frame[]> {
  await mkdir(outDir, { recursive: true });
  const filters = [`fps=${fps}`, dedupe ? "mpdecimate" : "", `scale='min(${maxWidth},iw)':-2`]
    .filter(Boolean)
    .join(",");
  await run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-i", video,
    "-vf", filters,
    "-fps_mode", "vfr",
    "-frame_pts", "1",
    "-q:v", "3",
    path.join(outDir, "frame_%06d.jpg"),
  ]);
  const files = (await readdir(outDir)).filter((f) => f.startsWith("frame_")).sort();
  // With -frame_pts the number in the name is the pts in 1/fps units.
  return files.map((f) => ({
    path: path.join(outDir, f),
    time: Number(f.match(/(\d+)/)?.[1] ?? 0) / fps,
  }));
}

export async function framesFromFolder(dir: string): Promise<Frame[]> {
  const files = (await readdir(dir)).filter(isImage).sort();
  return files.map((f) => ({ path: path.join(dir, f) }));
}

/** Picks up to `count` frames spread evenly across the list. */
export function sample<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items;
  const step = (items.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, i) => items[Math.round(i * step)]);
}

/**
 * macOS only: saves one window (e.g. a WhatsApp video call from the glasses)
 * as a JPEG. Find window ids with `GetWindowID` or similar tools.
 */
export async function captureWindow(windowId: number, outPath: string): Promise<Frame> {
  if (process.platform !== "darwin") throw new Error("captureWindow needs macOS (screencapture)");
  await run("screencapture", ["-x", "-o", "-t", "jpg", "-l", String(windowId), outPath]);
  return { path: outPath, time: Date.now() / 1000 };
}

export function formatTime(seconds?: number): string {
  if (seconds === undefined) return "";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
