// Protocol smoke test: start dist/index.js on stdio, initialize, list tools.
// Also asserts the advertised schema dialect and that a message above the SDK's 10 MiB
// default stdio limit is accepted (an inlined data: URL photo easily exceeds it). This is
// the only check that exercises the real StdioServerTransport — the vitest suite runs
// over an in-memory pair.
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
const LARGE_MESSAGE_MIB = 12;

const server = spawn("node", ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
let done = false;

function finish(code, text) {
  done = true;
  clearTimeout(timeout);
  server.kill();
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}

const timeout = setTimeout(() => finish(1, "SMOKE FAIL: no response within 10s"), 10_000);
server.on("exit", (code) => {
  if (!done) finish(1, `SMOKE FAIL: server exited early (code ${code})`);
});
server.stdin.on("error", (error) => {
  if (!done) finish(1, `SMOKE FAIL: could not write to the server: ${error.message}`);
});

function send(message) {
  server.stdin.write(JSON.stringify(message) + "\n");
}

let toolSummary = "";
let buffer = "";
server.stdout.on("data", (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split("\n");
  buffer = lines.pop() ?? "";
  for (const line of lines) {
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
      if (missing.length > 0) finish(1, `SMOKE FAIL: missing tools: ${missing.join(", ")}`);
      if (wrongDialect.length > 0) {
        finish(1, `SMOKE FAIL: schemas not advertised as 2020-12: ${[...new Set(wrongDialect)].join(", ")}`);
      }
      toolSummary = `${names.length} tools registered, schemas are JSON Schema 2020-12`;
      const pad = "A".repeat(LARGE_MESSAGE_MIB * 1024 * 1024);
      send({ jsonrpc: "2.0", id: 3, method: "ping", params: { _meta: { pad } } });
    }
    if (message.id === 3) {
      if (message.error) finish(1, `SMOKE FAIL: ${LARGE_MESSAGE_MIB} MiB message rejected: ${message.error.message}`);
      finish(0, `SMOKE OK: ${toolSummary}, ${LARGE_MESSAGE_MIB} MiB message accepted`);
    }
  }
});

send({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
});
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
