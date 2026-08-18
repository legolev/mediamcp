// Protocol smoke test: start dist/index.js on stdio, initialize, list tools.
// Also asserts the advertised schema dialect, which is the only check that exercises
// the real StdioServerTransport — the vitest suite runs over an in-memory pair.
import { spawn } from "node:child_process";

const EXPECTED_TOOLS = [
  "generate_image",
  "edit_image",
  "generate_video",
  "check_video_status",
  "list_models",
  "check_config",
];

const DIALECT_2020_12 = "https://json-schema.org/draft/2020-12/schema";

const server = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
const timeout = setTimeout(() => {
  console.error("SMOKE FAIL: no response within 10s");
  server.kill();
  process.exit(1);
}, 10_000);

let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  for (const line of buffer.split("\n")) {
    if (!line.trim()) continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }
    if (message.id === 2) {
      const tools = message.result?.tools ?? [];
      const names = tools.map((tool) => tool.name);
      const missing = EXPECTED_TOOLS.filter((name) => !names.includes(name));
      const wrongDialect = tools
        .flatMap((tool) => [tool.inputSchema, tool.outputSchema].filter(Boolean).map((schema) => [tool, schema]))
        .filter(([, schema]) => schema.$schema !== DIALECT_2020_12)
        .map(([tool]) => tool.name);
      clearTimeout(timeout);
      server.kill();
      if (missing.length > 0) {
        console.error(`SMOKE FAIL: missing tools: ${missing.join(", ")}`);
        process.exit(1);
      }
      if (wrongDialect.length > 0) {
        console.error(`SMOKE FAIL: schemas not advertised as 2020-12: ${[...new Set(wrongDialect)].join(", ")}`);
        process.exit(1);
      }
      console.log(`SMOKE OK: ${names.length} tools registered, schemas are JSON Schema 2020-12`);
      process.exit(0);
    }
  }
});

server.stdin.write(
  JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
  }) + "\n",
);
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
server.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }) + "\n");
