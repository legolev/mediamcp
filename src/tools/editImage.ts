import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MAX_SOURCE_IMAGES } from "../constants.js";
import { toErrorMessage } from "../errors.js";
import { loadImageSource } from "../media/sources.js";
import {
  backgroundField,
  filenamePrefixField,
  imageErrorResult,
  imageOutputShape,
  imageToolResult,
  inputFidelityField,
  maskField,
  moderationField,
  modelField,
  outputCompressionField,
  outputDirField,
  outputFormatField,
  promptField,
  qualityField,
  sizeField,
  type ToolContext,
} from "./shared.js";

export function registerEditImage(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "edit_image",
    {
      title: "Edit Image",
      description:
        "Edit or transform existing image(s) with a text instruction — restyle, add or remove elements, " +
        "change background, or combine several images into one scene. The result is saved to disk and its " +
        "absolute path is returned, along with a small inline preview.",
      inputSchema: {
        prompt: promptField.describe(
          "Instruction describing the edit, e.g. 'remove the background', 'make it night time', " +
            "'combine these two photos into one scene'.",
        ),
        images: z
          .array(z.string())
          .min(1)
          .max(MAX_SOURCE_IMAGES)
          .describe(
            "Source image(s): absolute file paths, file:// URLs, https:// URLs, or data: URLs. " +
              "Pass several images for composition or style-transfer edits.",
          ),
        model: modelField,
        mask: maskField,
        size: sizeField,
        quality: qualityField,
        background: backgroundField,
        output_format: outputFormatField,
        output_compression: outputCompressionField,
        moderation: moderationField,
        input_fidelity: inputFidelityField,
        output_dir: outputDirField,
        filename_prefix: filenamePrefixField,
      },
      outputSchema: imageOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({
      prompt,
      images,
      model,
      mask,
      size,
      quality,
      background,
      output_format,
      output_compression,
      moderation,
      input_fidelity,
      output_dir,
      filename_prefix,
    }) => {
      const chosenModel = model?.trim() || ctx.config.imageModel;
      try {
        const [imageUrls, maskUrl] = await Promise.all([
          Promise.all(images.map((source) => loadImageSource(source))),
          mask ? loadImageSource(mask) : undefined,
        ]);
        const result = await ctx.provider.editImage({
          prompt,
          model: chosenModel,
          imageUrls,
          ...(maskUrl ? { maskUrl } : {}),
          ...(size ? { size } : {}),
          ...(quality ? { quality } : {}),
          ...(background ? { background } : {}),
          ...(output_format ? { outputFormat: output_format } : {}),
          ...(output_compression !== undefined ? { outputCompression: output_compression } : {}),
          ...(moderation ? { moderation } : {}),
          ...(input_fidelity ? { inputFidelity: input_fidelity } : {}),
        });
        return await imageToolResult(ctx, "edit", [result], [], {
          label: filename_prefix || prompt,
          model: chosenModel,
          outputDir: output_dir,
        });
      } catch (error) {
        return imageErrorResult([toErrorMessage(error, [ctx.config.apiKey])]);
      }
    },
  );
}
