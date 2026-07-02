import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";
import { buildServer } from "./server.js";
import { collectDiagnostics, formatDiagnostics } from "./tools/checkConfig.js";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const config = loadConfig();

  if (args.includes("--version") || args.includes("-v")) {
    console.log(config.version);
    return;
  }

  if (args.includes("--check")) {
    const diag = await collectDiagnostics({ config, provider: createProvider(config) }, true);
    console.log(formatDiagnostics(diag));
    process.exitCode = diag.ok ? 0 : 1;
    return;
  }

  if (args.includes("--help") || args.includes("-h")) {
    console.log(
      [
        "mediamcp — MCP server for AI image and video generation (stdio transport)",
        "",
        "Usage: mediamcp [--check | --version | --help]",
        "",
        "  (no args)   run the MCP server on stdio (this is what MCP clients invoke)",
        "  --check     print configuration diagnostics and exit",
        "  --version   print the version and exit",
        "",
        "Configuration is passed via environment variables — see",
        "https://github.com/legolev/mediamcp#configuration",
      ].join("\n"),
    );
    return;
  }

  const server = buildServer(config, createProvider(config));
  await server.connect(new StdioServerTransport());
  // stdout is the protocol channel; all human-facing logs go to stderr.
  console.error(`mediamcp v${config.version} ready on stdio (endpoint: ${config.baseUrl})`);
}

main().catch((error) => {
  console.error("mediamcp failed to start:", error instanceof Error ? error.message : error);
  process.exit(1);
});
