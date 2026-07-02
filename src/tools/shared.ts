import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import type { Config } from "../config.js";
import { ASPECT_RATIOS, MAX_IMAGE_COUNT } from "../constants.js";
import { extensionForMime } from "../media/dataUrl.js";
import { makePreview } from "../media/preview.js";
import { buildFilename, resolveOutputDir, saveBytes, type MediaKind } from "../media/storage.js";
import type { GeneratedImage, MediaProvider } from "../providers/types.js";

export interface ToolContext {
  config: Config;
  provider: MediaProvider;
}

// --- shared input fields ------------------------------------------------------

export const promptField = z
  .string()
  .min(1)
  .max(4000)
  .describe("Detailed description of the desired result. Be specific about subject, style, lighting, composition.");

export const modelField = z
  .string()
  .optional()
  .describe(
    "Model slug, e.g. 'google/gemini-2.5-flash-image' or 'openai/gpt-5-image'. " +
      "Omit to use the configured default. Call list_models to see options.",
  );

export const aspectRatioField = z
  .enum(ASPECT_RATIOS)
  .optional()
  .describe("Desired aspect ratio. Support varies by model; treated as a strong hint.");

export const outputDirField = z
  .string()
  .optional()
  .describe("Directory to save into (absolute, or ~ for home). Defaults to the configured output directory.");

export const filenamePrefixField = z
  .string()
  .max(40)
  .optional()
  .describe("Short label used in the saved filename, e.g. 'hero-banner'. Sanitized to letters, digits, dashes.");

export const countField = z
  .number()
  .int()
  .min(1)
  .max(MAX_IMAGE_COUNT)
  .default(1)
  .describe(`Number of variations to generate (1-${MAX_IMAGE_COUNT}, parallel requests, billed per image).`);

// --- shared output schema for image tools --------------------------------------

export const imageOutputShape = {
  images: z.array(
    z.object({
      path: z.string().describe("Absolute path of the saved file"),
      mime: z.string(),
      bytes: z.number(),
      model: z.string(),
    }),
  ),
  failed: z.array(z.string()).describe("Error messages for variations that failed"),
};

export interface SavedImage {
  path: string;
  mime: string;
  bytes: number;
  model: string;
}

/** Save generated images and assemble the standard image-tool result. */
export async function imageToolResult(
  ctx: ToolContext,
  kind: MediaKind,
  images: GeneratedImage[],
  failures: string[],
  opts: { label: string; model: string; outputDir?: string | undefined },
): Promise<CallToolResult> {
  const dir = resolveOutputDir(ctx.config.outputDir, opts.outputDir);
  const saved: SavedImage[] = [];
  const content: CallToolResult["content"] = [];

  for (const image of images) {
    const ext = extensionForMime(image.mime, "png");
    const filePath = await saveBytes(dir, buildFilename(kind, opts.label, image.bytes, ext), image.bytes);
    saved.push({ path: filePath, mime: image.mime, bytes: image.bytes.length, model: opts.model });
  }

  const lines = saved.map(
    (s) => `Saved ${s.mime} to ${s.path} (${s.bytes.toLocaleString("en-US")} bytes) using ${s.model}.`,
  );
  for (const failure of failures) lines.push(`One variation failed: ${failure}`);
  content.push({ type: "text", text: lines.join("\n") });

  if (ctx.config.preview) {
    for (const image of images) {
      const preview = await makePreview(image.bytes, ctx.config.previewMaxDim);
      if (preview) content.push({ type: "image", data: preview.data, mimeType: preview.mimeType });
    }
  }

  return { content, structuredContent: { images: saved, failed: failures } };
}

export function imageErrorResult(failures: string[]): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: failures.join("\n") || "Image generation failed." }],
    structuredContent: { images: [], failed: failures },
  };
}

// --- misc ----------------------------------------------------------------------

/** Best-effort progress ping; harmless when the client didn't ask for progress. */
export async function sendProgress(
  extra: { _meta?: { progressToken?: string | number }; sendNotification?: (n: never) => Promise<void> },
  progress: number,
  message: string,
): Promise<void> {
  const progressToken = extra._meta?.progressToken;
  if (progressToken === undefined || !extra.sendNotification) return;
  try {
    await extra.sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress, message },
    } as never);
  } catch {
    // progress is advisory — never fail the tool call over it
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
