import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { maskKey } from "../util/redact.js";
import type { ToolContext } from "./shared.js";

export interface Diagnostics {
  ok: boolean;
  version: string;
  base_url: string;
  image_model: string;
  video_model: string;
  output_dir: string;
  output_dir_writable: boolean;
  api_key: string;
  api_key_source?: string;
  key_check?: string;
  preview: string;
  problems: string[];
}

export async function collectDiagnostics(ctx: ToolContext, ping: boolean): Promise<Diagnostics> {
  const { config, provider } = ctx;
  const problems: string[] = [];

  if (!config.apiKey) {
    problems.push(
      "No API key is set. Get one at https://openrouter.ai/keys and add OPENROUTER_API_KEY to the env block " +
        "of this MCP server in your client config, then restart the client.",
    );
  }

  let writable = false;
  try {
    await mkdir(config.outputDir, { recursive: true });
    const probe = path.join(config.outputDir, `.mediamcp-probe-${process.pid}`);
    await writeFile(probe, "ok");
    await rm(probe, { force: true });
    writable = true;
  } catch (error) {
    problems.push(
      `Output directory ${config.outputDir} is not writable (${(error as Error).message}). ` +
        "Set MEDIAMCP_OUTPUT_DIR to a writable directory.",
    );
  }

  let keyCheck: string | undefined;
  if (ping && config.apiKey) {
    const result = await provider.checkKey();
    keyCheck = result.detail;
    if (!result.ok) problems.push(`API key check failed: ${result.detail}`);
  }

  return {
    ok: problems.length === 0,
    version: config.version,
    base_url: config.baseUrl,
    image_model: config.imageModel,
    video_model: config.videoModel,
    output_dir: config.outputDir,
    output_dir_writable: writable,
    api_key: config.apiKey ? maskKey(config.apiKey) : "not set",
    ...(config.apiKeySource ? { api_key_source: config.apiKeySource } : {}),
    ...(keyCheck !== undefined ? { key_check: keyCheck } : {}),
    preview: config.preview ? `on (max ${config.previewMaxDim}px)` : "off",
    problems,
  };
}

export function formatDiagnostics(diag: Diagnostics): string {
  const lines = [
    `mediamcp v${diag.version} — ${diag.ok ? "configuration OK" : "configuration has problems"}`,
    `- endpoint: ${diag.base_url}`,
    `- api key: ${diag.api_key}${diag.api_key_source ? ` (from ${diag.api_key_source})` : ""}`,
    ...(diag.key_check ? [`- key check: ${diag.key_check}`] : []),
    `- default image model: ${diag.image_model}`,
    `- default video model: ${diag.video_model}`,
    `- output dir: ${diag.output_dir} (${diag.output_dir_writable ? "writable" : "NOT WRITABLE"})`,
    `- preview: ${diag.preview}`,
  ];
  for (const problem of diag.problems) lines.push(`PROBLEM: ${problem}`);
  return lines.join("\n");
}

export function registerCheckConfig(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "check_config",
    {
      title: "Check mediamcp Configuration",
      description:
        "Diagnose the mediamcp server setup: endpoint, API key presence and validity, default models, and " +
        "output directory writability. Run this first when any other mediamcp tool fails.",
      inputSchema: {
        ping: z.boolean().default(true).describe("Also verify the API key against the endpoint with a live request."),
      },
      outputSchema: {
        ok: z.boolean(),
        version: z.string(),
        base_url: z.string(),
        image_model: z.string(),
        video_model: z.string(),
        output_dir: z.string(),
        output_dir_writable: z.boolean(),
        api_key: z.string().describe("Masked key or 'not set'"),
        api_key_source: z.string().optional(),
        key_check: z.string().optional(),
        preview: z.string(),
        problems: z.array(z.string()),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ ping }) => {
      const diag = await collectDiagnostics(ctx, ping);
      return {
        content: [{ type: "text", text: formatDiagnostics(diag) }],
        structuredContent: { ...diag },
      };
    },
  );
}
