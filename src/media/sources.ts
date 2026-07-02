import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expandHome } from "../config.js";
import { MAX_SOURCE_BYTES } from "../constants.js";
import { MediaMcpError } from "../errors.js";
import { buildDataUrl, mimeForExtension, parseDataUrl, sniffImageMime } from "./dataUrl.js";

const MAX_MB = Math.round(MAX_SOURCE_BYTES / 1024 / 1024);

function isLocalhost(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
}

async function fileToDataUrl(filePath: string): Promise<string> {
  const resolved = path.resolve(expandHome(filePath));
  let size: number;
  try {
    size = (await stat(resolved)).size;
  } catch {
    throw new MediaMcpError(
      `Source image not found: ${resolved}. Pass an absolute file path, an https:// URL, or a data: URL.`,
    );
  }
  if (size > MAX_SOURCE_BYTES) {
    throw new MediaMcpError(`Source image ${resolved} is ${Math.round(size / 1024 / 1024)} MB — max is ${MAX_MB} MB.`);
  }
  const bytes = new Uint8Array(await readFile(resolved));
  const mime = sniffImageMime(bytes) ?? mimeForExtension(path.extname(resolved));
  if (!mime || !mime.startsWith("image/")) {
    throw new MediaMcpError(
      `${resolved} does not look like an image (expected PNG, JPEG, WebP, or GIF).`,
    );
  }
  return buildDataUrl(mime, bytes);
}

async function localUrlToDataUrl(url: URL): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) {
    throw new MediaMcpError(`Failed to fetch source image ${url.href}: HTTP ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_SOURCE_BYTES) {
    throw new MediaMcpError(`Source image ${url.href} exceeds the ${MAX_MB} MB limit.`);
  }
  const mime = sniffImageMime(bytes) ?? response.headers.get("content-type")?.split(";")[0] ?? null;
  if (!mime || !mime.startsWith("image/")) {
    throw new MediaMcpError(`${url.href} did not return an image.`);
  }
  return buildDataUrl(mime, bytes);
}

/**
 * Normalize one edit_image source into a URL the provider API accepts:
 * - data: URLs are validated and passed through
 * - https:// URLs are passed through (the provider fetches them server-side)
 * - http://localhost URLs are fetched locally and inlined
 * - file:// URLs and plain paths are read from disk and inlined
 */
export async function loadImageSource(source: string): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.startsWith("data:")) {
    const parsed = parseDataUrl(trimmed);
    if (!parsed || !parsed.mime.startsWith("image/")) {
      throw new MediaMcpError("Invalid data: URL — expected a base64 image data URL.");
    }
    return trimmed;
  }
  if (trimmed.startsWith("https://")) {
    return trimmed;
  }
  if (trimmed.startsWith("http://")) {
    const url = new URL(trimmed);
    if (!isLocalhost(url)) {
      throw new MediaMcpError(
        `Refusing plain-http source ${url.href}. Use https://, a local file path, or download the file first.`,
      );
    }
    return localUrlToDataUrl(url);
  }
  if (trimmed.startsWith("file://")) {
    return fileToDataUrl(fileURLToPath(trimmed));
  }
  return fileToDataUrl(trimmed);
}
