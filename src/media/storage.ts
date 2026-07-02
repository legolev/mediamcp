import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { expandHome } from "../config.js";

export type MediaKind = "img" | "edit" | "vid";

/** Keep only [a-z0-9-]; used for filename labels so tool input can never redirect a write. */
export function slugify(text: string, maxLen = 32): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen)
    .replace(/-+$/, "");
  return slug || "media";
}

export function timestamp(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  );
}

export function buildFilename(kind: MediaKind, label: string, bytes: Uint8Array, ext: string): string {
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 6);
  return `${kind}_${timestamp()}_${slugify(label)}_${hash}.${ext}`;
}

export function resolveOutputDir(defaultDir: string, override?: string): string {
  const dir = override?.trim() ? path.resolve(expandHome(override.trim())) : defaultDir;
  if (dir.includes("\0")) throw new Error("Invalid output directory path.");
  return dir;
}

/** Save bytes without ever overwriting an existing file. Returns the absolute path. */
export async function saveBytes(dir: string, filename: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dir, { recursive: true });
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let attempt = 0; ; attempt++) {
    const candidate = path.join(dir, attempt === 0 ? filename : `${stem}-${attempt}${ext}`);
    try {
      await writeFile(candidate, bytes, { flag: "wx" });
      return candidate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= 100) throw error;
    }
  }
}
