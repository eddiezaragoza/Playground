// Voice output. On macOS, `say` can target a virtual audio device (e.g.
// BlackHole) that a call app uses as its microphone, which is how audio gets
// back to the glasses. Elsewhere it just prints.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function speak(text: string, { device, voice }: { device?: string; voice?: string } = {}) {
  if (process.platform !== "darwin") {
    console.log(`[speak] ${text}`);
    return;
  }
  const args = [];
  if (voice) args.push("-v", voice);
  if (device) args.push("-a", device);
  await run("say", [...args, text]);
}
