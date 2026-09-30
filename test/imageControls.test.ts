import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/providers/index.js";
import { buildServer } from "../src/server.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

type MockCall = { url: string; init: RequestInit };
let calls: MockCall[];

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function mockFetch(...responses: Response[]): void {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = queue.shift();
      if (!next) throw new Error("mock fetch queue exhausted");
      return next;
    }),
  );
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Boot the real server over an in-memory pair, run one tool call, tear down. */
async function callToolOnce(name: string, args: Record<string, unknown>) {
  const outputDir = await mkdtemp(path.join(tmpdir(), "mediamcp-test-"));
  const config = {
    ...loadConfig({ MEDIAMCP_API_KEY: "sk-test-0123456789", MEDIAMCP_PREVIEW: "false" }),
    outputDir,
  };
  const server = buildServer(config, createProvider(config));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mediamcp-test", version: "0.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)
      .map((part) => part.text ?? "")
      .join("\n");
    return { result, text };
  } finally {
    await client.close();
    await server.close();
  }
}

describe("image tool controls", () => {
  it("forwards generate_image controls to the classic /images/generations endpoint", async () => {
    mockFetch(jsonResponse(404, {}), jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));

    const { result, text } = await callToolOnce("generate_image", {
      prompt: "an otter",
      model: "gpt-image-2.5-flare",
      size: "1536x864",
      quality: "high",
      background: "opaque",
      output_format: "webp",
      output_compression: 80,
      moderation: "low",
    });

    expect(result.isError).toBeFalsy();
    expect(text).toContain("Saved image/png");
    expect(new URL(calls[1]!.url).pathname).toBe("/api/v1/images/generations");
    expect(JSON.parse(String(calls[1]!.init.body))).toMatchObject({
      model: "gpt-image-2.5-flare",
      prompt: "an otter",
      size: "1536x864",
      quality: "high",
      background: "opaque",
      output_format: "webp",
      output_compression: 80,
      moderation: "low",
    });
  });
});
