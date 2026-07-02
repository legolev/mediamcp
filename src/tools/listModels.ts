import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { CURATED_MODELS } from "../constants.js";
import type { ModelInfo } from "../providers/types.js";
import type { ToolContext } from "./shared.js";

const modelShape = z.object({
  id: z.string(),
  name: z.string().optional(),
  description: z.string().optional(),
  pricing: z.string().optional(),
  type: z.enum(["image", "video"]),
  recommended: z.boolean().optional(),
});

function toMarkdown(models: ModelInfo[], defaults: { image: string; video: string }): string {
  const lines = [
    "| Model slug | Type | Name | Pricing | |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const model of models) {
    const marks = [
      model.id === defaults.image || model.id === defaults.video ? "default" : "",
      model.recommended ? "recommended" : "",
    ]
      .filter(Boolean)
      .join(", ");
    lines.push(`| ${model.id} | ${model.type} | ${model.name ?? ""} | ${model.pricing ?? ""} | ${marks} |`);
  }
  return lines.join("\n");
}

export function registerListModels(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "list_models",
    {
      title: "List Media Models",
      description:
        "List image- and video-capable model slugs available on the configured endpoint, with pricing where " +
        "known. Use this to pick a `model` value for generate_image, edit_image, or generate_video.",
      inputSchema: {
        refresh: z.boolean().default(false).describe("Bypass the 1h cache and re-query the endpoint."),
      },
      outputSchema: {
        source: z.enum(["live", "curated"]).describe("'live' = queried from the endpoint, 'curated' = built-in fallback"),
        models: z.array(modelShape),
        note: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ refresh }) => {
      const live = await ctx.provider.listModels(refresh).catch(() => null);
      const models = live ?? CURATED_MODELS;
      const source = live ? ("live" as const) : ("curated" as const);
      const note = live
        ? undefined
        : `The endpoint ${ctx.config.baseUrl} did not return a usable model list; showing the built-in curated list.`;
      const header =
        `${models.length} media model(s) via ${ctx.config.baseUrl} (${source}). ` +
        `Defaults: image '${ctx.config.imageModel}', video '${ctx.config.videoModel}'.` +
        (note ? `\n${note}` : "");
      return {
        content: [{ type: "text", text: `${header}\n\n${toMarkdown(models, { image: ctx.config.imageModel, video: ctx.config.videoModel })}` }],
        structuredContent: { source, models, ...(note ? { note } : {}) },
      };
    },
  );
}
