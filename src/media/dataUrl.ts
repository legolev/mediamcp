export interface ParsedDataUrl {
  mime: string;
  bytes: Uint8Array;
}

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,(.*)$/s;

export function parseDataUrl(url: string): ParsedDataUrl | null {
  const match = DATA_URL_RE.exec(url);
  if (!match) return null;
  const mime = match[1] || "application/octet-stream";
  const data = match[3] ?? "";
  try {
    const bytes = match[2]
      ? Uint8Array.from(Buffer.from(data, "base64"))
      : new TextEncoder().encode(decodeURIComponent(data));
    if (bytes.length === 0) return null;
    return { mime, bytes };
  } catch {
    return null;
  }
}

export function buildDataUrl(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

export function extensionForMime(mime: string, fallback = "bin"): string {
  return MIME_TO_EXT[mime.toLowerCase().split(";")[0]?.trim() ?? ""] ?? fallback;
}

export function mimeForExtension(ext: string): string | null {
  return EXT_TO_MIME[ext.toLowerCase().replace(/^\./, "")] ?? null;
}

function startsWith(bytes: Uint8Array, prefix: number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((b, i) => bytes[offset + i] === b);
}

/** Identify an image format from magic bytes; extensions are never trusted. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}
