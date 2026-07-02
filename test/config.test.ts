import { homedir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { expandHome, loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("applies defaults with an empty environment", () => {
    const config = loadConfig({});
    expect(config.apiKey).toBeNull();
    expect(config.apiKeySource).toBeNull();
    expect(config.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(config.isOpenRouter).toBe(true);
    expect(config.imageModel).toBe("google/gemini-2.5-flash-image");
    expect(config.videoModel).toBe("google/veo-3.1");
    expect(config.timeoutMs).toBe(120_000);
    expect(config.preview).toBe(true);
    expect(config.previewMaxDim).toBe(768);
    expect(config.outputDir.startsWith(homedir())).toBe(true);
    expect(config.outputDir.endsWith("mediamcp")).toBe(true);
  });

  it("prefers MEDIAMCP_API_KEY over OPENROUTER_API_KEY", () => {
    const config = loadConfig({ MEDIAMCP_API_KEY: "generic-key", OPENROUTER_API_KEY: "sk-or-v1-abc" });
    expect(config.apiKey).toBe("generic-key");
    expect(config.apiKeySource).toBe("MEDIAMCP_API_KEY");
  });

  it("falls back to OPENROUTER_API_KEY", () => {
    const config = loadConfig({ OPENROUTER_API_KEY: "sk-or-v1-abc" });
    expect(config.apiKey).toBe("sk-or-v1-abc");
    expect(config.apiKeySource).toBe("OPENROUTER_API_KEY");
  });

  it("strips trailing slashes from the base URL and detects non-OpenRouter endpoints", () => {
    const config = loadConfig({ MEDIAMCP_BASE_URL: "https://example.com/v1///" });
    expect(config.baseUrl).toBe("https://example.com/v1");
    expect(config.isOpenRouter).toBe(false);
  });

  it("does not treat lookalike hosts as OpenRouter", () => {
    expect(loadConfig({ MEDIAMCP_BASE_URL: "https://evilopenrouter.ai/v1" }).isOpenRouter).toBe(false);
    expect(loadConfig({ MEDIAMCP_BASE_URL: "https://openrouter.ai.evil.com/v1" }).isOpenRouter).toBe(false);
  });

  it("expands ~ in the output dir override", () => {
    const config = loadConfig({ MEDIAMCP_OUTPUT_DIR: "~/my-media" });
    expect(config.outputDir).toBe(path.join(homedir(), "my-media"));
  });

  it("parses booleans and numbers leniently", () => {
    const config = loadConfig({ MEDIAMCP_PREVIEW: "false", MEDIAMCP_TIMEOUT_MS: "not-a-number" });
    expect(config.preview).toBe(false);
    expect(config.timeoutMs).toBe(120_000);
  });
});

describe("expandHome", () => {
  it("expands ~ and ~/", () => {
    expect(expandHome("~")).toBe(homedir());
    expect(expandHome("~/x")).toBe(path.join(homedir(), "x"));
    expect(expandHome("/abs/x")).toBe("/abs/x");
  });
});
