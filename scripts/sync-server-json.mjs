// Keeps server.json's versions in lockstep with package.json.
//
// `npm version` only bumps package.json, so server.json silently kept the previous
// number and the MCP registry rejected the release with "cannot publish duplicate
// version" — after npm had already published. Wired into the `version` lifecycle
// script, this runs between the bump and the version commit, so the two files can
// never drift apart again.
import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const server = JSON.parse(readFileSync("server.json", "utf8"));

server.version = pkg.version;
for (const entry of server.packages ?? []) {
  if (entry.registryType === "npm" && entry.identifier === pkg.name) entry.version = pkg.version;
}

writeFileSync("server.json", `${JSON.stringify(server, null, 2)}\n`);
console.log(`server.json synced to ${pkg.version}`);
