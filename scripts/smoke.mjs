// Protocol smoke test: start dist/index.js on stdio, initialize, list tools.
import { spawn } from "node:child_process";

const EXPECTED_TOOLS = [
  "generate_image",
  "edit_image",
  "generate_video",
  "check_video_status",
  "list_models",
  "check_config",
];

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
      const names = (message.result?.tools ?? []).map((tool) => tool.name);
      const missing = EXPECTED_TOOLS.filter((name) => !names.includes(name));
      clearTimeout(timeout);
      server.kill();
      if (missing.length > 0) {
        console.error(`SMOKE FAIL: missing tools: ${missing.join(", ")}`);
        process.exit(1);
      }
      console.log(`SMOKE OK: ${names.length} tools registered`);
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
