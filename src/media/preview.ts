import { Jimp } from "jimp";

export interface Preview {
  /** base64-encoded image data (no data: prefix) — ready for MCP ImageContent. */
  data: string;
  mimeType: string;
}

/**
 * Downscale an image so its longest side is <= maxDim and re-encode as JPEG,
 * keeping inline previews token-cheap. Returns null when the format can't be
 * decoded (e.g. SVG) — callers then skip the preview; the saved file path is
 * always reported separately.
 */
export async function makePreview(bytes: Uint8Array, maxDim: number): Promise<Preview | null> {
  try {
    const image = await Jimp.read(Buffer.from(bytes));
    const { width, height } = image.bitmap;
    if (Math.max(width, height) > maxDim) {
      image.resize(width >= height ? { w: maxDim } : { h: maxDim });
    }
    const buffer = await image.getBuffer("image/jpeg", { quality: 80 });
    return { data: buffer.toString("base64"), mimeType: "image/jpeg" };
  } catch {
    return null;
  }
}
