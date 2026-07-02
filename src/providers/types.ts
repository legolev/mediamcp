export interface GeneratedImage {
  bytes: Uint8Array;
  mime: string;
}

export interface ModelInfo {
  id: string;
  name?: string;
  description?: string;
  pricing?: string;
  type: "image" | "video";
  recommended?: boolean;
}

export interface GenerateImageRequest {
  prompt: string;
  model: string;
  aspectRatio?: string;
}

export interface EditImageRequest {
  prompt: string;
  model: string;
  /** data: or https: URLs, already normalized by media/sources. */
  imageUrls: string[];
}

export interface StartVideoRequest {
  prompt: string;
  model: string;
  durationSeconds?: number;
  resolution?: string;
  aspectRatio?: string;
  generateAudio?: boolean;
}

export interface VideoJob {
  id: string;
  pollingUrl: string;
  status: string;
}

export interface VideoStatus {
  id: string;
  status: string;
  downloadUrls: string[];
  error?: string;
}

export interface Download {
  bytes: Uint8Array;
  mime: string | null;
}

export interface KeyCheck {
  ok: boolean;
  detail: string;
}

/**
 * One media backend. v1 ships a single OpenAI-compatible implementation
 * (OpenRouter by default); fal.ai/Replicate would be siblings behind this
 * interface.
 */
export interface MediaProvider {
  generateImage(req: GenerateImageRequest): Promise<GeneratedImage>;
  editImage(req: EditImageRequest): Promise<GeneratedImage>;
  /** null = this endpoint cannot list models (no /models route). */
  listModels(refresh?: boolean): Promise<ModelInfo[] | null>;
  startVideo(req: StartVideoRequest): Promise<VideoJob>;
  getVideoStatus(pollingUrlOrId: string): Promise<VideoStatus>;
  download(url: string): Promise<Download>;
  checkKey(): Promise<KeyCheck>;
}
