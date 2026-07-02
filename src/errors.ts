import { ERROR_BODY_LIMIT } from "./constants.js";
import { redactSecrets } from "./util/redact.js";

/** Error whose message is safe and useful to show to the calling agent. */
export class MediaMcpError extends Error {
  readonly status: number | undefined;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "MediaMcpError";
    this.status = status;
  }
}

export interface HttpErrorContext {
  model?: string;
  baseUrl: string;
  isOpenRouter: boolean;
  secrets?: Array<string | null | undefined>;
}

/** Map an HTTP failure to a message the agent can act on. */
export function httpError(status: number, body: string, ctx: HttpErrorContext): MediaMcpError {
  const detail = redactSecrets(body.slice(0, ERROR_BODY_LIMIT), ctx.secrets ?? []);
  const keyHint = ctx.isOpenRouter
    ? "Get a key at https://openrouter.ai/keys, set OPENROUTER_API_KEY in the env block of your MCP client config, and restart the client."
    : "Check the API key configured via OPENROUTER_API_KEY / MEDIAMCP_API_KEY in your MCP client config, then restart the client.";

  switch (status) {
    case 401:
    case 403:
      return new MediaMcpError(
        `Authentication failed (HTTP ${status}). ${keyHint} Run the check_config tool to verify. Details: ${detail}`,
        status,
      );
    case 402:
      return new MediaMcpError(
        `Out of credits (HTTP 402). Top up at https://openrouter.ai/credits. Details: ${detail}`,
        status,
      );
    case 404:
      return new MediaMcpError(
        `Not found (HTTP 404) at ${ctx.baseUrl}${ctx.model ? ` for model '${ctx.model}'` : ""}. ` +
          `The model slug or endpoint may be wrong — run list_models for valid slugs. Details: ${detail}`,
        status,
      );
    case 429:
      return new MediaMcpError(
        `Rate limited (HTTP 429). Wait a moment and retry, or switch to another model. Details: ${detail}`,
        status,
      );
    default:
      return new MediaMcpError(`Request failed with HTTP ${status}. Details: ${detail}`, status);
  }
}

/** Normalize unknown thrown values into a safe message. */
export function toErrorMessage(error: unknown, secrets: Array<string | null | undefined> = []): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw, secrets);
}
