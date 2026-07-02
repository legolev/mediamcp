import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import packageJson from "../package.json" with { type: "json" };
import {
  DEFAULT_BASE_URL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_PREVIEW_MAX_DIM,
  DEFAULT_REFERER,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_TITLE,
  DEFAULT_VIDEO_MODEL,
} from "./constants.js";

export interface Config {
  readonly apiKey: string | null;
  readonly apiKeySource: "MEDIAMCP_API_KEY" | "OPENROUTER_API_KEY" | null;
  readonly baseUrl: string;
  readonly isOpenRouter: boolean;
  readonly imageModel: string;
  readonly videoModel: string;
  readonly outputDir: string;
  readonly timeoutMs: number;
  readonly preview: boolean;
  readonly previewMaxDim: number;
  readonly referer: string;
  readonly title: string;
  readonly version: string;
}

export function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/") || p.startsWith("~\\")) return path.join(homedir(), p.slice(2));
  return p;
}

function defaultOutputDir(): string {
  const pictures = path.join(homedir(), "Pictures");
  return existsSync(pictures) ? path.join(pictures, "mediamcp") : path.join(homedir(), "mediamcp");
}

function readNumber(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === "") return fallback;
  return !["false", "0", "no", "off"].includes(raw.trim().toLowerCase());
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mediamcpKey = env.MEDIAMCP_API_KEY?.trim();
  const openrouterKey = env.OPENROUTER_API_KEY?.trim();
  const apiKey = mediamcpKey || openrouterKey || null;
  const apiKeySource = mediamcpKey ? "MEDIAMCP_API_KEY" : openrouterKey ? "OPENROUTER_API_KEY" : null;

  const baseUrl = (env.MEDIAMCP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const outputDirRaw = env.MEDIAMCP_OUTPUT_DIR?.trim();

  return Object.freeze({
    apiKey,
    apiKeySource,
    baseUrl,
    isOpenRouter: /(^|\.)openrouter\.ai$/.test(safeHostname(baseUrl)),
    imageModel: env.MEDIAMCP_MODEL?.trim() || DEFAULT_IMAGE_MODEL,
    videoModel: env.MEDIAMCP_VIDEO_MODEL?.trim() || DEFAULT_VIDEO_MODEL,
    outputDir: outputDirRaw ? path.resolve(expandHome(outputDirRaw)) : defaultOutputDir(),
    timeoutMs: readNumber(env.MEDIAMCP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
    preview: readBool(env.MEDIAMCP_PREVIEW, true),
    previewMaxDim: readNumber(env.MEDIAMCP_PREVIEW_MAX_DIM, DEFAULT_PREVIEW_MAX_DIM),
    referer: env.MEDIAMCP_REFERER?.trim() || DEFAULT_REFERER,
    title: env.MEDIAMCP_TITLE?.trim() || DEFAULT_TITLE,
    version: packageJson.version,
  });
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
