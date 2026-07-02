import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { toErrorMessage } from "../errors.js";
import type { GeneratedImage } from "../providers/types.js";
import {
  aspectRatioField,
  countField,
  filenamePrefixField,
  imageErrorResult,
  imageOutputShape,
  imageToolResult,
  modelField,
  outputDirField,
  promptField,
  type ToolContext,
} from "./shared.js";

export function registerGenerateImage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "generate_image",
    {
      title: "Generate Image",
      description:
        "Generate one or more images from a text prompt using a cloud AI model. " +
        "Every image is saved to disk and its absolute path is returned, along with a small inline preview. " +
        "Use edit_image instead when starting from an existing image.",
      inputSchema: {
        prompt: promptField,
        model: modelField,
        count: countField,
        aspect_ratio: aspectRatioField,
        output_dir: outputDirField,
        filename_prefix: filenamePrefixField,
      },
      outputSchema: imageOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ prompt, model, count, aspect_ratio, output_dir, filename_prefix }) => {
      const chosenModel = model?.trim() || ctx.config.imageModel;
      const results = await Promise.allSettled(
        Array.from({ length: count }, () =>
          ctx.provider.generateImage({
            prompt,
            model: chosenModel,
            ...(aspect_ratio ? { aspectRatio: aspect_ratio } : {}),
          }),
        ),
      );
      const images = results
        .filter((r): r is PromiseFulfilledResult<GeneratedImage> => r.status === "fulfilled")
        .map((r) => r.value);
      const failures = results
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => toErrorMessage(r.reason, [ctx.config.apiKey]));

      if (images.length === 0) return imageErrorResult(failures);
      return imageToolResult(ctx, "img", images, failures, {
        label: filename_prefix || prompt,
        model: chosenModel,
        outputDir: output_dir,
      });
    },
  );
}
