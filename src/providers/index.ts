import type { Config } from "../config.js";
import { OpenAiCompatibleProvider } from "./openaiCompatible.js";
import type { MediaProvider } from "./types.js";

export function createProvider(config: Config): MediaProvider {
  return new OpenAiCompatibleProvider(config);
}
