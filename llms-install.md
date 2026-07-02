# mediamcp — installation instructions for AI agents

You are installing **mediamcp**, an MCP server (npm package `mediamcp`, stdio transport, requires Node.js >= 20) that adds image/video generation tools to the user's MCP client.

## Step 1 — get the API key from the human

Ask the user for their **OpenRouter API key** (starts with `sk-or-`). If they don't have one, tell them to create it at https://openrouter.ai/keys and add a few dollars of credit at https://openrouter.ai/credits. **Never invent, reuse, or hardcode a placeholder key.**

## Step 2 — register the server in the client you are running in

**Claude Code:**

```bash
claude mcp add mediamcp -e OPENROUTER_API_KEY=<KEY_FROM_STEP_1> -- npx -y mediamcp
```

**Claude Desktop** — merge into `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

**Cursor** — merge into `~/.cursor/mcp.json`:

**Windsurf** — merge into `~/.codeium/windsurf/mcp_config.json`:

For those three clients the entry is identical (top-level key is `mcpServers`):

```json
{
  "mcpServers": {
    "mediamcp": {
      "command": "npx",
      "args": ["-y", "mediamcp"],
      "env": { "OPENROUTER_API_KEY": "<KEY_FROM_STEP_1>" }
    }
  }
}
```

**VS Code** — merge into `.vscode/mcp.json`, note the different top-level key (`servers`):

```json
{
  "servers": {
    "mediamcp": {
      "command": "npx",
      "args": ["-y", "mediamcp"],
      "env": { "OPENROUTER_API_KEY": "<KEY_FROM_STEP_1>" }
    }
  }
}
```

When editing JSON config files: read the existing file first and merge the `mediamcp` entry into the existing `mcpServers`/`servers` object — do not overwrite other servers.

## Step 3 — restart and verify

1. Tell the user to restart the MCP client (Claude Code picks the server up immediately; Claude Desktop, Cursor, Windsurf, and VS Code need a restart/reload).
2. Verify by calling the `check_config` tool of the `mediamcp` server. Expect `ok: true`. If it reports problems, follow the fix instructions in its output verbatim.
3. Optional smoke test: call `generate_image` with prompt `"a tiny test image of a green circle"` and confirm a file path is returned.

## Configuration reference (optional env vars)

`MEDIAMCP_BASE_URL` (default `https://openrouter.ai/api/v1`, any OpenAI-compatible root), `MEDIAMCP_API_KEY` (key alias for custom endpoints), `MEDIAMCP_MODEL` (default `google/gemini-2.5-flash-image`), `MEDIAMCP_VIDEO_MODEL` (default `google/veo-3.1`), `MEDIAMCP_OUTPUT_DIR` (default `~/Pictures/mediamcp`), `MEDIAMCP_TIMEOUT_MS` (default `120000`), `MEDIAMCP_PREVIEW` (default `true`), `MEDIAMCP_PREVIEW_MAX_DIM` (default `768`).
