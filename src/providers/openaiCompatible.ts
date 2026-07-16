import type { Config } from "../config.js";
import { CURATED_MODELS, MODELS_CACHE_TTL_MS } from "../constants.js";
import { httpError, MediaMcpError } from "../errors.js";
import { parseDataUrl, sniffImageMime } from "../media/dataUrl.js";
import type {
  Download,
  EditImageRequest,
  GeneratedImage,
  GenerateImageRequest,
  KeyCheck,
  MediaProvider,
  ModelInfo,
  StartVideoRequest,
  VideoJob,
  VideoStatus,
} from "./types.js";

type ImageStrategy = "images" | "generations" | "chat";

const GENERATE_STRATEGIES: ImageStrategy[] = ["images", "generations", "chat"];
const EDIT_STRATEGIES: ImageStrategy[] = ["images", "chat"];
const MAX_ATTEMPTS = 3;
const MAX_RETRY_AFTER_MS = 15_000;

interface JsonRecord {
  [key: string]: unknown;
}

/**
 * Talks to OpenRouter or any OpenAI-compatible endpoint. Image calls probe
 * three API shapes in order — the dedicated /images endpoint (OpenRouter),
 * /images/generations (OpenAI classic), and /chat/completions with
 * modalities — and remember whichever works for the rest of the session.
 */
export class OpenAiCompatibleProvider implements MediaProvider {
  private generateStrategy: ImageStrategy | null = null;
  private editStrategy: ImageStrategy | null = null;
  private modelsCache: { at: number; models: ModelInfo[] } | null = null;

  constructor(private readonly config: Config) {}

  // --- images ---------------------------------------------------------------

  async generateImage(req: GenerateImageRequest): Promise<GeneratedImage> {
    return this.runImageStrategies(
      this.generateStrategy ? [this.generateStrategy] : GENERATE_STRATEGIES,
      (strategy) => (this.generateStrategy = strategy),
      req,
      [],
    );
  }

  async editImage(req: EditImageRequest): Promise<GeneratedImage> {
    return this.runImageStrategies(
      this.editStrategy ? [this.editStrategy] : EDIT_STRATEGIES,
      (strategy) => (this.editStrategy = strategy),
      { prompt: req.prompt, model: req.model },
      req.imageUrls,
    );
  }

  private async runImageStrategies(
    strategies: ImageStrategy[],
    remember: (strategy: ImageStrategy) => void,
    req: GenerateImageRequest,
    imageUrls: string[],
  ): Promise<GeneratedImage> {
    let lastError: unknown;
    for (let i = 0; i < strategies.length; i++) {
      const strategy = strategies[i]!;
      try {
        const image = await this.runImageStrategy(strategy, req, imageUrls);
        remember(strategy);
        return image;
      } catch (error) {
        lastError = error;
        const status = error instanceof MediaMcpError ? error.status : undefined;
        const endpointMissing = status === 404 || status === 405;
        if (!endpointMissing || i === strategies.length - 1) throw error;
      }
    }
    throw lastError;
  }

  private async runImageStrategy(
    strategy: ImageStrategy,
    req: GenerateImageRequest,
    imageUrls: string[],
  ): Promise<GeneratedImage> {
    // Only the dedicated /images endpoint takes aspect_ratio as a parameter;
    // for the other shapes the ratio is expressed in the prompt.
    const prompt =
      req.aspectRatio && strategy !== "images"
        ? `${req.prompt}\n\nRender the image with a ${req.aspectRatio} aspect ratio.`
        : req.prompt;

    if (strategy === "images" || strategy === "generations") {
      const body: JsonRecord = { model: req.model, prompt };
      if (strategy === "images") {
        if (req.aspectRatio) body.aspect_ratio = req.aspectRatio;
        if (imageUrls.length > 0) {
          body.input_references = imageUrls.map((url) => ({ type: "image_url", image_url: { url } }));
        }
      }
      const path = strategy === "images" ? "/images" : "/images/generations";
      const json = await this.postJson(path, body, req.model);
      return this.parseImagesResponse(json, req.model);
    }

    const content =
      imageUrls.length > 0
        ? [{ type: "text", text: prompt }, ...imageUrls.map((url) => ({ type: "image_url", image_url: { url } }))]
        : prompt;
    const json = await this.postJson(
      "/chat/completions",
      { model: req.model, messages: [{ role: "user", content }], modalities: ["image", "text"] },
      req.model,
    );
    return this.parseChatResponse(json, req.model);
  }

  private async parseImagesResponse(json: JsonRecord, model: string): Promise<GeneratedImage> {
    const data = json.data;
    const first = Array.isArray(data) ? (data[0] as JsonRecord | undefined) : undefined;
    if (first && typeof first.b64_json === "string" && first.b64_json.length > 0) {
      const bytes = Uint8Array.from(Buffer.from(first.b64_json, "base64"));
      const mime =
        (typeof first.media_type === "string" && first.media_type) || sniffImageMime(bytes) || "image/png";
      return { bytes, mime };
    }
    if (first && typeof first.url === "string") {
      const download = await this.download(first.url);
      return { bytes: download.bytes, mime: download.mime ?? sniffImageMime(download.bytes) ?? "image/png" };
    }
    const errorMessage = (json.error as JsonRecord | undefined)?.message;
    throw new MediaMcpError(
      `Model '${model}' returned no image. ${typeof errorMessage === "string" ? `Details: ${errorMessage}` : `Response keys: ${Object.keys(json).join(", ")}`}`,
    );
  }

  private parseChatResponse(json: JsonRecord, model: string): GeneratedImage {
    const choices = json.choices;
    const message = Array.isArray(choices) ? ((choices[0] as JsonRecord | undefined)?.message as JsonRecord | undefined) : undefined;
    if (!message) {
      throw new MediaMcpError(`Unexpected response shape from '${model}' — no choices[0].message.`);
    }
    const images = Array.isArray(message.images) ? message.images : [];
    const first = images[0] as JsonRecord | undefined;
    const url = (first?.image_url as JsonRecord | undefined)?.url;
    if (typeof url !== "string") {
      const refusal = typeof message.content === "string" && message.content ? message.content : "<no content>";
      throw new MediaMcpError(
        `Model '${model}' did not return an image and said: ${refusal}. ` +
          `Rephrase the prompt, or run list_models and try an image-capable model.`,
      );
    }
    const parsed = parseDataUrl(url);
    if (!parsed) throw new MediaMcpError(`Model '${model}' returned an unparsable image URL.`);
    return { bytes: parsed.bytes, mime: parsed.mime };
  }

  // --- models ---------------------------------------------------------------

  async listModels(refresh = false): Promise<ModelInfo[] | null> {
    if (!refresh && this.modelsCache && Date.now() - this.modelsCache.at < MODELS_CACHE_TTL_MS) {
      return this.modelsCache.models;
    }
    let json: JsonRecord;
    try {
      json = await this.getJson(`${this.config.baseUrl}/models`);
    } catch {
      return null;
    }
    const data = json.data;
    if (!Array.isArray(data)) return null;

    const recommended = new Set(CURATED_MODELS.filter((m) => m.recommended).map((m) => m.id));
    const models: ModelInfo[] = [];
    for (const entry of data as JsonRecord[]) {
      const id = typeof entry.id === "string" ? entry.id : null;
      const architecture = entry.architecture as JsonRecord | undefined;
      const outputs = Array.isArray(architecture?.output_modalities) ? architecture.output_modalities : [];
      const type = outputs.includes("video") ? "video" : outputs.includes("image") ? "image" : null;
      if (!id || !type) continue;
      const pricing = entry.pricing as JsonRecord | undefined;
      const perImage = typeof pricing?.image === "string" ? Number(pricing.image) : NaN;
      models.push({
        id,
        type,
        ...(typeof entry.name === "string" ? { name: entry.name } : {}),
        ...(Number.isFinite(perImage) && perImage > 0 ? { pricing: `$${perImage.toFixed(3)}/image` } : {}),
        ...(recommended.has(id) ? { recommended: true } : {}),
      });
    }
    if (models.length === 0) return null;
    models.sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false) || a.id.localeCompare(b.id));
    this.modelsCache = { at: Date.now(), models };
    return models;
  }

  // --- video ----------------------------------------------------------------

  async startVideo(req: StartVideoRequest): Promise<VideoJob> {
    const body: JsonRecord = { model: req.model, prompt: req.prompt };
    if (req.durationSeconds !== undefined) body.duration = req.durationSeconds;
    if (req.resolution !== undefined) body.resolution = req.resolution;
    if (req.aspectRatio !== undefined) body.aspect_ratio = req.aspectRatio;
    if (req.generateAudio !== undefined) body.generate_audio = req.generateAudio;
    // Image-to-video: first/last frame control.
    if (req.frameImages?.length) {
      body.frame_images = req.frameImages.map((f) => ({
        type: "image_url",
        image_url: { url: f.url },
        frame_type: f.frameType,
      }));
    }
    // Reference-to-video: style/content guidance images.
    if (req.referenceImages?.length) {
      body.input_references = req.referenceImages.map((url) => ({ type: "image_url", image_url: { url } }));
    }

    const json = await this.postJson("/videos", body, req.model);
    const id = typeof json.id === "string" ? json.id : null;
    const pollingUrl =
      (typeof json.polling_url === "string" && json.polling_url) || (id ? `${this.config.baseUrl}/videos/${id}` : null);
    if (!id || !pollingUrl) {
      throw new MediaMcpError(`Video job response is missing id/polling_url (keys: ${Object.keys(json).join(", ")}).`);
    }
    this.assertSameOrigin(pollingUrl);
    return { id, pollingUrl, status: typeof json.status === "string" ? json.status : "pending" };
  }

  async getVideoStatus(pollingUrlOrId: string): Promise<VideoStatus> {
    const pollingUrl = /^https?:\/\//.test(pollingUrlOrId)
      ? pollingUrlOrId
      : `${this.config.baseUrl}/videos/${encodeURIComponent(pollingUrlOrId)}`;
    this.assertSameOrigin(pollingUrl);
    const json = await this.getJson(pollingUrl);
    const urls = (Array.isArray(json.unsigned_urls) && json.unsigned_urls) || (Array.isArray(json.urls) && json.urls) || [];
    const errorMessage = (json.error as JsonRecord | undefined)?.message;
    return {
      id: typeof json.id === "string" ? json.id : "",
      status: typeof json.status === "string" ? json.status : "unknown",
      downloadUrls: urls.filter((u): u is string => typeof u === "string"),
      ...(typeof errorMessage === "string" ? { error: errorMessage } : {}),
    };
  }

  async download(url: string): Promise<Download> {
    const sameOrigin = this.isSameOrigin(url);
    const response = await this.fetchWithRetry(url, {
      method: "GET",
      // The API key is only ever sent to the configured endpoint's origin.
      headers: sameOrigin ? this.headers() : {},
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, mime: response.headers.get("content-type")?.split(";")[0]?.trim() || null };
  }

  // --- diagnostics ------------------------------------------------------------

  async checkKey(): Promise<KeyCheck> {
    try {
      if (this.config.isOpenRouter) {
        const json = await this.getJson(`${this.config.baseUrl}/key`);
        const data = (json.data ?? {}) as JsonRecord;
        const label = typeof data.label === "string" ? data.label : "key";
        const usage = typeof data.usage === "number" ? `, usage so far $${data.usage.toFixed(2)}` : "";
        return { ok: true, detail: `OpenRouter accepted the key ('${label}'${usage}).` };
      }
      await this.getJson(`${this.config.baseUrl}/models`);
      return { ok: true, detail: `${this.config.baseUrl} accepted the key.` };
    } catch (error) {
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }

  // --- transport --------------------------------------------------------------

  private headers(): Record<string, string> {
    this.requireKey();
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": this.config.referer,
      "X-Title": this.config.title,
    };
  }

  private requireKey(): void {
    if (!this.config.apiKey) {
      throw new MediaMcpError(
        "No API key configured. Get one at https://openrouter.ai/keys, add OPENROUTER_API_KEY to the env block of " +
          "this MCP server in your client config, and restart the client. Run check_config to verify.",
      );
    }
  }

  private async postJson(path: string, body: JsonRecord, model?: string): Promise<JsonRecord> {
    const response = await this.fetchWithRetry(
      `${this.config.baseUrl}${path}`,
      { method: "POST", headers: this.headers(), body: JSON.stringify(body) },
      model,
    );
    return (await response.json()) as JsonRecord;
  }

  private async getJson(url: string): Promise<JsonRecord> {
    const response = await this.fetchWithRetry(url, { method: "GET", headers: this.headers() });
    return (await response.json()) as JsonRecord;
  }

  private async fetchWithRetry(url: string, init: RequestInit, model?: string): Promise<Response> {
    const ctx = {
      baseUrl: this.config.baseUrl,
      isOpenRouter: this.config.isOpenRouter,
      secrets: [this.config.apiKey],
      ...(model !== undefined ? { model } : {}),
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(backoffMs(attempt));
      let response: Response;
      try {
        response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.config.timeoutMs) });
      } catch (error) {
        if ((error as Error).name === "TimeoutError") {
          throw new MediaMcpError(
            `Request timed out after ${Math.round(this.config.timeoutMs / 1000)}s. Generation can be slow — ` +
              `raise MEDIAMCP_TIMEOUT_MS or try a faster model.`,
          );
        }
        lastError = new MediaMcpError(`Network error calling ${safeOrigin(url)}: ${(error as Error).message}`);
        continue;
      }
      if (response.ok) return response;

      const bodyText = await response.text().catch(() => "");
      const error = httpError(response.status, bodyText, ctx);
      if (response.status === 429 || response.status >= 500) {
        lastError = error;
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0 && attempt < MAX_ATTEMPTS - 1) {
          await sleep(Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS));
        }
        continue;
      }
      throw error;
    }
    throw lastError;
  }

  private isSameOrigin(url: string): boolean {
    try {
      return new URL(url).origin === new URL(this.config.baseUrl).origin;
    } catch {
      return false;
    }
  }

  private assertSameOrigin(url: string): void {
    if (!this.isSameOrigin(url)) {
      throw new MediaMcpError(
        `Refusing to poll ${safeOrigin(url)} — expected the configured endpoint ${new URL(this.config.baseUrl).origin}.`,
      );
    }
  }
}

function backoffMs(attempt: number): number {
  return 500 * 2 ** (attempt - 1) + Math.random() * 250;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "<invalid url>";
  }
}
