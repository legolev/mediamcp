import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { toErrorMessage } from "../errors.js";
import { MAX_SOURCE_IMAGES } from "../constants.js";
import { extensionForMime } from "../media/dataUrl.js";
import { loadImageSource } from "../media/sources.js";
import { buildFilename, resolveOutputDir, saveBytes } from "../media/storage.js";
import type { VideoFrameImage, VideoStatus } from "../providers/types.js";
import {
  aspectRatioField,
  filenamePrefixField,
  modelField,
  outputDirField,
  promptField,
  sendProgress,
  sleep,
  type ToolContext,
} from "./shared.js";

const videoOutputShape = {
  status: z.string().describe("completed | pending | in_progress | timeout | failed | error"),
  path: z.string().optional().describe("Absolute path of the saved video, when completed"),
  video_id: z.string().optional(),
  polling_url: z.string().optional().describe("Pass to check_video_status to resume waiting"),
  message: z.string().optional(),
};

const TERMINAL_FAILURES = new Set(["failed", "canceled", "cancelled", "error"]);

async function downloadAndSave(
  ctx: ToolContext,
  status: VideoStatus,
  opts: { label: string; outputDir?: string | undefined },
): Promise<CallToolResult> {
  const url = status.downloadUrls[0];
  if (!url) {
    return videoResult(true, {
      status: "error",
      video_id: status.id,
      message: "Job completed but no download URL was returned.",
    });
  }
  const download = await ctx.provider.download(url);
  const mime = download.mime && download.mime.startsWith("video/") ? download.mime : "video/mp4";
  const dir = resolveOutputDir(ctx.config.outputDir, opts.outputDir);
  const filePath = await saveBytes(
    dir,
    buildFilename("vid", opts.label, download.bytes, extensionForMime(mime, "mp4")),
    download.bytes,
  );
  return videoResult(false, {
    status: "completed",
    path: filePath,
    video_id: status.id,
    message: `Saved ${mime} to ${filePath} (${download.bytes.length.toLocaleString("en-US")} bytes).`,
  });
}

function videoResult(
  isError: boolean,
  structured: { status: string; path?: string; video_id?: string; polling_url?: string; message?: string },
): CallToolResult {
  const text =
    structured.message ??
    `Video job ${structured.video_id ?? ""} status: ${structured.status}.` +
      (structured.polling_url ? ` Call check_video_status with polling_url '${structured.polling_url}' to resume.` : "");
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text", text }],
    structuredContent: structured,
  };
}

export function registerGenerateVideo(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "generate_video",
    {
      title: "Generate Video",
      description:
        "Generate a video from a text prompt, and optionally from an input image (image-to-video). " +
        "Async job: starts generation, then waits and polls. Video generation typically takes 1-5 minutes. " +
        "The finished file is saved to disk and its absolute path is returned. If waiting times out, a " +
        "polling_url is returned — pass it to check_video_status later instead of starting a new (billed) job. " +
        "For image-to-video, pass first_frame_image so the clip animates from that exact picture (e.g. a still " +
        "produced by generate_image). Image inputs require an image-to-video-capable model such as " +
        "'bytedance/seedance-2.0', 'bytedance/seedance-2.0-fast', or 'google/veo-3.1'.",
      inputSchema: {
        prompt: promptField,
        model: modelField.describe(
          "Video model slug, e.g. 'google/veo-3.1' or 'openai/sora-2-pro'. For image-to-video use an i2v-capable " +
            "model like 'bytedance/seedance-2.0' or 'bytedance/seedance-2.0-fast'. Omit to use the configured default.",
        ),
        first_frame_image: z
          .string()
          .optional()
          .describe(
            "Image-to-video: the generated clip starts on this exact image and animates forward. " +
              "Accepts an absolute file path, file:// URL, https:// URL, or data: URL.",
          ),
        last_frame_image: z
          .string()
          .optional()
          .describe("Optional ending frame the clip animates toward. Same accepted formats as first_frame_image."),
        reference_images: z
          .array(z.string())
          .min(1)
          .max(MAX_SOURCE_IMAGES)
          .optional()
          .describe(
            "Style/content reference image(s) that guide the look without being exact frames (reference-to-video). " +
              "Same accepted formats as first_frame_image.",
          ),
        duration_seconds: z.number().int().min(1).max(60).optional().describe("Clip length in seconds (model-dependent)."),
        resolution: z
          .enum(["480p", "720p", "1080p", "2K", "4K"])
          .optional()
          .describe("Output resolution (model-dependent)."),
        aspect_ratio: aspectRatioField,
        generate_audio: z.boolean().default(true).describe("Whether the clip should include generated audio."),
        wait_seconds: z
          .number()
          .int()
          .min(10)
          .max(3600)
          .default(480)
          .describe("How long to wait for completion before returning a resumable polling_url."),
        output_dir: outputDirField,
        filename_prefix: filenamePrefixField,
      },
      outputSchema: videoOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (args, extra) => {
      const model = args.model?.trim() || ctx.config.videoModel;
      try {
        const frameImages: VideoFrameImage[] = [];
        if (args.first_frame_image) {
          frameImages.push({ url: await loadImageSource(args.first_frame_image), frameType: "first_frame" });
        }
        if (args.last_frame_image) {
          frameImages.push({ url: await loadImageSource(args.last_frame_image), frameType: "last_frame" });
        }
        const referenceImages = args.reference_images
          ? await Promise.all(args.reference_images.map((source) => loadImageSource(source)))
          : [];

        const job = await ctx.provider.startVideo({
          prompt: args.prompt,
          model,
          ...(args.duration_seconds !== undefined ? { durationSeconds: args.duration_seconds } : {}),
          ...(args.resolution !== undefined ? { resolution: args.resolution } : {}),
          ...(args.aspect_ratio !== undefined ? { aspectRatio: args.aspect_ratio } : {}),
          generateAudio: args.generate_audio,
          ...(frameImages.length ? { frameImages } : {}),
          ...(referenceImages.length ? { referenceImages } : {}),
        });

        const deadline = Date.now() + args.wait_seconds * 1000;
        const pollIntervalMs = 5000;
        let lastStatus = job.status;
        for (let poll = 1; Date.now() < deadline && !extra.signal.aborted; poll++) {
          await sleep(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
          const status = await ctx.provider.getVideoStatus(job.pollingUrl);
          lastStatus = status.status;
          await sendProgress(extra, poll, `Video job ${job.id}: ${status.status}`);
          const normalized = status.status.toLowerCase();
          if (normalized === "completed") {
            return await downloadAndSave(ctx, status, {
              label: args.filename_prefix || args.prompt,
              outputDir: args.output_dir,
            });
          }
          if (TERMINAL_FAILURES.has(normalized)) {
            return videoResult(true, {
              status: "failed",
              video_id: job.id,
              message: `Video job ${job.id} ended with status '${status.status}'${status.error ? `: ${status.error}` : ""}. You were likely not billed; adjust the prompt or model and retry.`,
            });
          }
        }
        return videoResult(false, {
          status: "timeout",
          video_id: job.id,
          polling_url: job.pollingUrl,
          message:
            `Video job ${job.id} is still '${lastStatus}' after ${args.wait_seconds}s of waiting. ` +
            `The job keeps running server-side — call check_video_status with polling_url '${job.pollingUrl}' ` +
            `to fetch the result without paying for a new generation.`,
        });
      } catch (error) {
        return videoResult(true, { status: "error", message: toErrorMessage(error, [ctx.config.apiKey]) });
      }
    },
  );
}

export function registerCheckVideoStatus(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    "check_video_status",
    {
      title: "Check Video Status",
      description:
        "Check a previously started video generation job (from generate_video's polling_url or video id). " +
        "If the job has completed, downloads the video, saves it to disk, and returns the absolute path.",
      inputSchema: {
        polling_url: z.string().optional().describe("The polling_url returned by generate_video."),
        video_id: z.string().optional().describe("Alternatively, the raw video job id."),
        output_dir: outputDirField,
        filename_prefix: filenamePrefixField,
      },
      outputSchema: videoOutputShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ polling_url, video_id, output_dir, filename_prefix }) => {
      const ref = polling_url?.trim() || video_id?.trim();
      if (!ref) {
        return videoResult(true, { status: "error", message: "Pass either polling_url or video_id." });
      }
      try {
        const status = await ctx.provider.getVideoStatus(ref);
        const normalized = status.status.toLowerCase();
        if (normalized === "completed") {
          return await downloadAndSave(ctx, status, {
            label: filename_prefix || `video-${status.id || "job"}`,
            outputDir: output_dir,
          });
        }
        if (TERMINAL_FAILURES.has(normalized)) {
          return videoResult(true, {
            status: "failed",
            video_id: status.id,
            message: `Video job ended with status '${status.status}'${status.error ? `: ${status.error}` : ""}.`,
          });
        }
        return videoResult(false, {
          status: status.status,
          video_id: status.id,
          ...(polling_url ? { polling_url } : {}),
          message: `Video job is '${status.status}'. Check again in ~30 seconds.`,
        });
      } catch (error) {
        return videoResult(true, { status: "error", message: toErrorMessage(error, [ctx.config.apiKey]) });
      }
    },
  );
}
