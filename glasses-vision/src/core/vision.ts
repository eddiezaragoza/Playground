// One call shape for every glasses skill: some images + a question + a zod
// schema in, a typed answer out.
import { readFile } from "node:fs/promises";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

export const DEFAULT_MODEL = process.env.GLASSES_MODEL ?? "claude-opus-5-5";

type Effort = "low" | "medium" | "high" | "xhigh" | "max";
type ImageMediaType = "image/jpeg" | "image/png" | "image/webp" | "image/gif";

const MEDIA_TYPES: Record<string, ImageMediaType> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export interface LabeledImage {
  path: string;
  /** Text placed right before the image, e.g. "Image 1 (earlier frame):". */
  label?: string;
}

export interface AskOptions<T extends z.ZodType> {
  images: (string | LabeledImage)[];
  prompt: string;
  schema: T;
  system?: string;
  model?: string;
  effort?: Effort;
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  // Resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile.
  client ??= new Anthropic();
  return client;
}

export class VisionRefusal extends Error {}

export async function askAboutImages<T extends z.ZodType>(opts: AskOptions<T>): Promise<z.infer<T>> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  for (const [i, img] of opts.images.entries()) {
    const { path: file, label } = typeof img === "string" ? { path: img, label: undefined } : img;
    const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
    if (!mediaType) throw new Error(`Unsupported image type: ${file}`);
    content.push({ type: "text", text: label ?? `Image ${i + 1}:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: mediaType, data: (await readFile(file)).toString("base64") },
    });
  }
  content.push({ type: "text", text: opts.prompt });

  const response = await getClient().beta.messages.parse({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    ...(opts.system ? { system: opts.system } : {}),
    output_config: { effort: opts.effort ?? "low", format: betaZodOutputFormat(opts.schema) },
    messages: [{ role: "user", content }],
  });

  if (response.stop_reason === "refusal") {
    throw new VisionRefusal(response.stop_details?.explanation ?? "The model declined this request");
  }
  if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
    throw new Error(`No usable answer (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output as z.infer<T>;
}
