import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfig } from "../src/config.js";
import { buildDataUrl } from "../src/media/dataUrl.js";
import { OpenAiCompatibleProvider } from "../src/providers/openaiCompatible.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const PNG_B64 = Buffer.from(PNG_BYTES).toString("base64");

const config = loadConfig({ OPENROUTER_API_KEY: "sk-or-v1-testkey-0123456789" });
const customConfig = loadConfig({
  MEDIAMCP_API_KEY: "sk-test-0123456789",
  MEDIAMCP_BASE_URL: "https://api.example.com/v1",
});

type MockCall = { url: string; init: RequestInit };

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

let calls: MockCall[];

function mockFetch(...responses: Array<Response | (() => Response)>): void {
  const queue = [...responses];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      const next = queue.shift();
      if (!next) throw new Error("mock fetch queue exhausted");
      return typeof next === "function" ? next() : next;
    }),
  );
}

function bodyOf(call: MockCall): Record<string, unknown> {
  return JSON.parse((call.init.body as string | undefined) ?? "{}") as Record<string, unknown>;
}

function formOf(call: MockCall): FormData {
  return call.init.body as unknown as FormData;
}

beforeEach(() => {
  calls = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateImage", () => {
  it("uses the dedicated /images endpoint with aspect_ratio and parses b64_json", async () => {
    mockFetch(jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));
    const provider = new OpenAiCompatibleProvider(config);
    const image = await provider.generateImage({ prompt: "a red panda", model: "test/model", aspectRatio: "16:9" });

    expect(image.mime).toBe("image/png");
    expect(Buffer.from(image.bytes)).toEqual(Buffer.from(PNG_BYTES));
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/images");
    const body = bodyOf(calls[0]!);
    expect(body.model).toBe("test/model");
    expect(body.prompt).toBe("a red panda"); // ratio goes as a param, not into the prompt
    expect(body.aspect_ratio).toBe("16:9");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toContain("sk-or-v1-testkey");
  });

  it("passes GPT-image controls to /images/generations", async () => {
    mockFetch(jsonResponse(404, {}), jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));
    const provider = new OpenAiCompatibleProvider(config);
    await provider.generateImage({
      prompt: "an otter",
      model: "gpt-image-2.5-flare",
      size: "1536x864",
      quality: "high",
      background: "opaque",
      outputFormat: "webp",
      outputCompression: 80,
      moderation: "low",
    });

    expect(new URL(calls[1]!.url).pathname).toBe("/api/v1/images/generations");
    const body = bodyOf(calls[1]!);
    expect(body).toMatchObject({
      size: "1536x864",
      quality: "high",
      background: "opaque",
      output_format: "webp",
      output_compression: 80,
      moderation: "low",
    });
    expect(body.aspect_ratio).toBeUndefined();
    expect(body.outputCompression).toBeUndefined(); // snake_case on the wire
  });

  it("keeps OpenAI-only controls off the OpenRouter /images route", async () => {
    mockFetch(jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));
    const provider = new OpenAiCompatibleProvider(config);
    await provider.generateImage({ prompt: "an otter", model: "m", size: "1536x864", quality: "high" });

    expect(new URL(calls[0]!.url).pathname).toBe("/api/v1/images");
    const body = bodyOf(calls[0]!);
    expect(body.size).toBeUndefined();
    expect(body.quality).toBeUndefined();
  });

  it("falls back to chat/completions when image endpoints are missing, and remembers", async () => {
    const chatResponse = {
      choices: [{ message: { images: [{ image_url: { url: buildDataUrl("image/png", PNG_BYTES) } }] } }],
    };
    mockFetch(
      jsonResponse(404, { error: "no such route" }),
      jsonResponse(404, { error: "no such route" }),
      jsonResponse(200, chatResponse),
      jsonResponse(200, chatResponse),
    );
    const provider = new OpenAiCompatibleProvider(config);
    const image = await provider.generateImage({ prompt: "a fox", model: "m", aspectRatio: "16:9" });

    expect(image.mime).toBe("image/png");
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v1/images",
      "/api/v1/images/generations",
      "/api/v1/chat/completions",
    ]);
    const chatBody = bodyOf(calls[2]!);
    expect(chatBody.modalities).toEqual(["image", "text"]);
    expect(chatBody.messages).toEqual([
      { role: "user", content: expect.stringContaining("16:9 aspect ratio") },
    ]);

    // Second call goes straight to the remembered strategy.
    await provider.generateImage({ prompt: "again", model: "m" });
    expect(calls).toHaveLength(4);
    expect(new URL(calls[3]!.url).pathname).toBe("/api/v1/chat/completions");
  });

  it("surfaces the model's refusal text when chat returns no image", async () => {
    mockFetch(
      jsonResponse(404, {}),
      jsonResponse(404, {}),
      jsonResponse(200, { choices: [{ message: { content: "I cannot draw that." } }] }),
    );
    const provider = new OpenAiCompatibleProvider(config);
    await expect(provider.generateImage({ prompt: "x", model: "m" })).rejects.toThrow(/I cannot draw that/);
  });

  it("retries on 429 honoring Retry-After, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      mockFetch(
        jsonResponse(429, { error: "slow down" }, { "retry-after": "1" }),
        jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }),
      );
      const provider = new OpenAiCompatibleProvider(config);
      const pending = provider.generateImage({ prompt: "x", model: "m" });
      await vi.runAllTimersAsync();
      const image = await pending;
      expect(image.mime).toBe("image/png");
      expect(calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not retry 401 and produces an actionable, redacted message", async () => {
    mockFetch(jsonResponse(401, { error: `bad key sk-or-v1-testkey-0123456789` }));
    const provider = new OpenAiCompatibleProvider(config);
    const error = await provider.generateImage({ prompt: "x", model: "m" }).catch((e: Error) => e);
    expect(String(error)).toContain("https://openrouter.ai/keys");
    expect(String(error)).not.toContain("sk-or-v1-testkey-0123456789");
    expect(calls).toHaveLength(1);
  });

  it("fails fast with instructions when no key is configured", async () => {
    mockFetch();
    const provider = new OpenAiCompatibleProvider(loadConfig({}));
    await expect(provider.generateImage({ prompt: "x", model: "m" })).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(calls).toHaveLength(0);
  });
});

describe("editImage", () => {
  it("sends input_references on the /images endpoint", async () => {
    mockFetch(jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));
    const provider = new OpenAiCompatibleProvider(config);
    const source = buildDataUrl("image/png", PNG_BYTES);
    await provider.editImage({ prompt: "make it night", model: "m", imageUrls: [source] });

    const body = bodyOf(calls[0]!);
    expect(body.input_references).toEqual([{ type: "image_url", image_url: { url: source } }]);
  });

  it("uploads multipart to /images/edits when the dedicated /images endpoint is missing", async () => {
    mockFetch(jsonResponse(404, {}), jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));
    const provider = new OpenAiCompatibleProvider(customConfig);
    const source = buildDataUrl("image/png", PNG_BYTES);
    const image = await provider.editImage({ prompt: "make it night", model: "m", imageUrls: [source] });

    expect(image.mime).toBe("image/png");
    expect(new URL(calls[1]!.url).pathname).toBe("/v1/images/edits");
    const form = formOf(calls[1]!);
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("model")).toBe("m");
    expect(form.get("prompt")).toBe("make it night");
    const file = form.get("image") as File;
    expect(file.name).toBe("image-1.png");
    expect(file.type).toBe("image/png");
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG_BYTES);
    const headers = calls[1]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toContain("sk-test-0123456789");
    expect(headers["Content-Type"]).toBeUndefined(); // fetch sets the multipart boundary itself
  });

  it("uses image[] for several sources and remembers the edits strategy", async () => {
    mockFetch(
      jsonResponse(404, {}),
      jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }),
      jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }),
    );
    const provider = new OpenAiCompatibleProvider(customConfig);
    const source = buildDataUrl("image/png", PNG_BYTES);
    await provider.editImage({ prompt: "combine", model: "m", imageUrls: [source, source] });

    const files = formOf(calls[1]!).getAll("image[]") as File[];
    expect(files.map((f) => f.name)).toEqual(["image-1.png", "image-2.png"]);

    // Second edit skips the probes entirely.
    await provider.editImage({ prompt: "again", model: "m", imageUrls: [source] });
    expect(calls).toHaveLength(3);
    expect(new URL(calls[2]!.url).pathname).toBe("/v1/images/edits");
  });

  it("downloads https sources for multipart upload without leaking the key", async () => {
    mockFetch(
      jsonResponse(404, {}),
      new Response(PNG_BYTES, { status: 200, headers: { "content-type": "image/png" } }),
      jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }),
    );
    const provider = new OpenAiCompatibleProvider(customConfig);
    await provider.editImage({ prompt: "p", model: "m", imageUrls: ["https://cdn.example.com/pic.png"] });

    expect(calls[1]!.url).toBe("https://cdn.example.com/pic.png");
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
    const file = formOf(calls[2]!).get("image") as File;
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("uploads mask and GPT-image controls on the multipart edits request", async () => {
    mockFetch(jsonResponse(404, {}), jsonResponse(200, { data: [{ b64_json: PNG_B64 }] }));
    const provider = new OpenAiCompatibleProvider(customConfig);
    const source = buildDataUrl("image/png", PNG_BYTES);
    await provider.editImage({
      prompt: "extend the scene",
      model: "m",
      imageUrls: [source],
      maskUrl: source,
      size: "1024x1024",
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
    });

    expect(new URL(calls[1]!.url).pathname).toBe("/v1/images/edits");
    const form = formOf(calls[1]!);
    expect((form.get("mask") as File).name).toBe("mask.png");
    expect(form.get("size")).toBe("1024x1024");
    expect(form.get("quality")).toBe("high");
    expect(form.get("output_format")).toBe("png");
    expect(form.get("input_fidelity")).toBe("high");
  });

  it("falls back to multimodal chat content when /images is missing", async () => {
    mockFetch(
      jsonResponse(404, {}),
      jsonResponse(200, {
        choices: [{ message: { images: [{ image_url: { url: buildDataUrl("image/png", PNG_BYTES) } }] } }],
      }),
    );
    const provider = new OpenAiCompatibleProvider(config);
    const source = "https://example.com/pic.png";
    await provider.editImage({ prompt: "make it night", model: "m", imageUrls: [source] });

    expect(new URL(calls[1]!.url).pathname).toBe("/api/v1/chat/completions");
    const body = bodyOf(calls[1]!);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "make it night" },
          { type: "image_url", image_url: { url: source } },
        ],
      },
    ]);
  });

  it("never probes /images/edits on OpenRouter (config.isOpenRouter)", async () => {
    mockFetch(
      jsonResponse(404, {}),
      jsonResponse(200, {
        choices: [{ message: { images: [{ image_url: { url: buildDataUrl("image/png", PNG_BYTES) } }] } }],
      }),
    );
    const provider = new OpenAiCompatibleProvider(config);
    const source = buildDataUrl("image/png", PNG_BYTES);
    await provider.editImage({ prompt: "make it night", model: "m", imageUrls: [source] });

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/api/v1/images",
      "/api/v1/chat/completions",
    ]);
  });

  it("tries chat when /images/edits rejects the model with 400", async () => {
    mockFetch(
      jsonResponse(404, {}),
      jsonResponse(400, { error: { message: "model does not support edits" } }),
      jsonResponse(200, {
        choices: [{ message: { images: [{ image_url: { url: buildDataUrl("image/png", PNG_BYTES) } }] } }],
      }),
    );
    const provider = new OpenAiCompatibleProvider(customConfig);
    const source = buildDataUrl("image/png", PNG_BYTES);
    const image = await provider.editImage({
      prompt: "make it night",
      model: "google/gemini-2.5-flash-image",
      imageUrls: [source],
    });

    expect(image.mime).toBe("image/png");
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/images",
      "/v1/images/edits",
      "/v1/chat/completions",
    ]);
  });

  it("falls back to multimodal chat only when /images and /images/edits are both missing", async () => {
    mockFetch(
      jsonResponse(404, {}),
      jsonResponse(404, {}),
      jsonResponse(200, {
        choices: [{ message: { images: [{ image_url: { url: buildDataUrl("image/png", PNG_BYTES) } }] } }],
      }),
    );
    const provider = new OpenAiCompatibleProvider(customConfig);
    const source = buildDataUrl("image/png", PNG_BYTES);
    await provider.editImage({ prompt: "make it night", model: "m", imageUrls: [source] });

    expect(calls.map((c) => new URL(c.url).pathname)).toEqual([
      "/v1/images",
      "/v1/images/edits",
      "/v1/chat/completions",
    ]);
    const body = bodyOf(calls[2]!);
    expect(body.messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "make it night" },
          { type: "image_url", image_url: { url: source } },
        ],
      },
    ]);
  });
});

describe("video", () => {
  it("starts a job and returns id + polling url", async () => {
    mockFetch(jsonResponse(202, { id: "job1", polling_url: "https://openrouter.ai/api/v1/videos/job1" }));
    const provider = new OpenAiCompatibleProvider(config);
    const job = await provider.startVideo({ prompt: "waves", model: "google/veo-3.1", durationSeconds: 8 });
    expect(job).toMatchObject({ id: "job1", pollingUrl: "https://openrouter.ai/api/v1/videos/job1" });
    expect(bodyOf(calls[0]!)).toMatchObject({ model: "google/veo-3.1", prompt: "waves", duration: 8 });
  });

  it("sends frame_images for image-to-video (first/last frame)", async () => {
    mockFetch(jsonResponse(202, { id: "job2", polling_url: "https://openrouter.ai/api/v1/videos/job2" }));
    const provider = new OpenAiCompatibleProvider(config);
    const first = buildDataUrl("image/png", PNG_BYTES);
    await provider.startVideo({
      prompt: "animate it",
      model: "bytedance/seedance-2.0",
      frameImages: [
        { url: first, frameType: "first_frame" },
        { url: "https://example.com/last.png", frameType: "last_frame" },
      ],
    });
    const body = bodyOf(calls[0]!);
    expect(body.frame_images).toEqual([
      { type: "image_url", image_url: { url: first }, frame_type: "first_frame" },
      { type: "image_url", image_url: { url: "https://example.com/last.png" }, frame_type: "last_frame" },
    ]);
    expect(body.input_references).toBeUndefined();
  });

  it("sends input_references for reference-to-video", async () => {
    mockFetch(jsonResponse(202, { id: "job3", polling_url: "https://openrouter.ai/api/v1/videos/job3" }));
    const provider = new OpenAiCompatibleProvider(config);
    await provider.startVideo({
      prompt: "same backpack, neon city",
      model: "bytedance/seedance-2.0",
      referenceImages: ["https://example.com/ref.jpg"],
    });
    const body = bodyOf(calls[0]!);
    expect(body.input_references).toEqual([{ type: "image_url", image_url: { url: "https://example.com/ref.jpg" } }]);
    expect(body.frame_images).toBeUndefined();
  });

  it("omits image arrays entirely for plain text-to-video", async () => {
    mockFetch(jsonResponse(202, { id: "job4", polling_url: "https://openrouter.ai/api/v1/videos/job4" }));
    const provider = new OpenAiCompatibleProvider(config);
    await provider.startVideo({ prompt: "waves", model: "google/veo-3.1" });
    const body = bodyOf(calls[0]!);
    expect(body.frame_images).toBeUndefined();
    expect(body.input_references).toBeUndefined();
  });

  it("reads unsigned_urls from the poll response", async () => {
    mockFetch(
      jsonResponse(200, { id: "job1", status: "completed", unsigned_urls: ["https://openrouter.ai/dl/1"] }),
    );
    const provider = new OpenAiCompatibleProvider(config);
    const status = await provider.getVideoStatus("job1");
    expect(status.status).toBe("completed");
    expect(status.downloadUrls).toEqual(["https://openrouter.ai/dl/1"]);
    expect(calls[0]!.url).toBe("https://openrouter.ai/api/v1/videos/job1");
  });

  it("refuses to poll a foreign origin (key protection)", async () => {
    mockFetch();
    const provider = new OpenAiCompatibleProvider(config);
    await expect(provider.getVideoStatus("https://evil.example.com/steal")).rejects.toThrow(/Refusing to poll/);
    expect(calls).toHaveLength(0);
  });

  it("does not attach the API key when downloading from a foreign origin", async () => {
    mockFetch(new Response(PNG_BYTES, { status: 200, headers: { "content-type": "video/mp4" } }));
    const provider = new OpenAiCompatibleProvider(config);
    const download = await provider.download("https://cdn.example.com/video.mp4");
    expect(download.mime).toBe("video/mp4");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});

describe("listModels", () => {
  it("filters to image/video models and caches", async () => {
    mockFetch(
      jsonResponse(200, {
        data: [
          { id: "a/text-model", architecture: { output_modalities: ["text"] } },
          {
            id: "google/gemini-2.5-flash-image",
            name: "Gemini Image",
            architecture: { output_modalities: ["image", "text"] },
            pricing: { image: "0.03" },
          },
          { id: "b/video-model", architecture: { output_modalities: ["video"] } },
        ],
      }),
    );
    const provider = new OpenAiCompatibleProvider(config);
    const models = await provider.listModels();
    expect(models?.map((m) => m.id)).toEqual(["google/gemini-2.5-flash-image", "b/video-model"]);
    expect(models?.[0]).toMatchObject({ recommended: true, pricing: "$0.030/image", type: "image" });
    expect(models?.[1]?.type).toBe("video");

    const again = await provider.listModels();
    expect(again).toBe(models);
    expect(calls).toHaveLength(1);
  });

  it("returns null when the endpoint has no /models", async () => {
    mockFetch(jsonResponse(404, {}));
    const provider = new OpenAiCompatibleProvider(config);
    expect(await provider.listModels()).toBeNull();
  });
});
