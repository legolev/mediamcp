import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Config } from "./config.js";
import type { MediaProvider } from "./providers/types.js";
import { registerCheckConfig } from "./tools/checkConfig.js";
import { registerEditImage } from "./tools/editImage.js";
import { registerGenerateImage } from "./tools/generateImage.js";
import { registerListModels } from "./tools/listModels.js";
import { registerCheckVideoStatus, registerGenerateVideo } from "./tools/video.js";

export function buildServer(config: Config, provider: MediaProvider): McpServer {
  const server = new McpServer(
    { name: "mediamcp", version: config.version },
    {
      instructions:
        "Generates and edits images and videos via cloud AI models (OpenRouter by default). " +
        "Files are always saved to disk — every response includes the absolute path. " +
        "Use generate_image for text-to-image, edit_image to transform existing images, " +
        "generate_video for text-to-video (slow, async), and check_config to troubleshoot setup.",
    },
  );

  const ctx = { config, provider };
  registerGenerateImage(server, ctx);
  registerEditImage(server, ctx);
  registerGenerateVideo(server, ctx);
  registerCheckVideoStatus(server, ctx);
  registerListModels(server, ctx);
  registerCheckConfig(server, ctx);

  return server;
}
