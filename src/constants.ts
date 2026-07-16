import type { ModelInfo } from "./providers/types.js";

export const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
export const DEFAULT_IMAGE_MODEL = "google/gemini-2.5-flash-image";
export const DEFAULT_VIDEO_MODEL = "google/veo-3.1";
export const DEFAULT_TIMEOUT_MS = 120_000;
export const DEFAULT_PREVIEW_MAX_DIM = 768;
export const DEFAULT_REFERER = "https://github.com/legolev/mediamcp";
export const DEFAULT_TITLE = "mediamcp";

export const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_COUNT = 4;
export const MAX_SOURCE_IMAGES = 4;
export const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;
export const ERROR_BODY_LIMIT = 600;

export const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9"] as const;

/** Fallback model list for endpoints that don't expose GET /models. */
export const CURATED_MODELS: ModelInfo[] = [
  {
    id: "google/gemini-2.5-flash-image",
    name: "Gemini 2.5 Flash Image (Nano Banana)",
    description: "Fast and affordable. Great default for generation and editing.",
    type: "image",
    recommended: true,
  },
  {
    id: "openai/gpt-5-image",
    name: "GPT-5 Image",
    description: "Highest prompt adherence and quality, slower and pricier.",
    type: "image",
    recommended: true,
  },
  {
    id: "bytedance/seedream-4.5",
    name: "Seedream 4.5",
    description: "Photorealistic output, strong at people and scenes.",
    type: "image",
    recommended: true,
  },
  {
    id: "sourceful/riverflow-v2-pro",
    name: "Riverflow V2 Pro",
    description: "Design-oriented: logos, posters, accurate text rendering.",
    type: "image",
    recommended: true,
  },
  {
    id: "google/veo-3.1",
    name: "Veo 3.1",
    description: "High-quality video with audio. Text-to-video and image-to-video (first/last frame).",
    type: "video",
    recommended: true,
  },
  {
    id: "bytedance/seedance-2.0",
    name: "Seedance 2.0",
    description:
      "Affordable, strong at character/style consistency. Image-to-video (first & last frame) and reference-to-video.",
    type: "video",
    recommended: true,
  },
  {
    id: "bytedance/seedance-2.0-fast",
    name: "Seedance 2.0 Fast",
    description: "Fastest/cheapest option for image-to-video. Great for quick animations from a still image.",
    type: "video",
    recommended: true,
  },
  {
    id: "openai/sora-2-pro",
    name: "Sora 2 Pro",
    description: "Cinematic text-to-video and image-to-video (being retired on OpenRouter Sep 2026).",
    type: "video",
    recommended: true,
  },
];
