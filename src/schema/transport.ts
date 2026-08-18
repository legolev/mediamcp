import type { Transport, TransportSendOptions } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";

import { convertDialect, type SchemaDialect } from "./dialect.js";

/**
 * Transport decorator that restates advertised tool schemas in the configured dialect.
 *
 * The rewrite has to happen after `McpServer` has built the `tools/list` result — that is
 * where the draft-07 target is hard-coded (see ./dialect.ts) — and the transport boundary
 * is the last public seam before the response leaves the process. Hooking here keeps the
 * fix universal: every tool is covered, including ones added later, with no per-tool
 * wiring to forget. It is also transport-agnostic, since it only depends on `Transport`.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Rewrite the schemas in a `tools/list` result.
 *
 * A JSON-RPC response carries no method name, so the payload is recognised by shape.
 * That is deliberate rather than lossy: the only thing this touches is a tool's
 * `inputSchema`/`outputSchema`, and restating those in the target dialect is correct for
 * any message that carries them.
 */
export function convertMessageSchemas(message: JSONRPCMessage, dialect: SchemaDialect): JSONRPCMessage {
  if (!("result" in message) || !isRecord(message.result)) return message;
  const tools = message.result.tools;
  if (!Array.isArray(tools)) return message;

  let changed = false;
  const converted = tools.map((tool) => {
    if (!isRecord(tool)) return tool;
    const next: Record<string, unknown> = { ...tool };
    for (const key of ["inputSchema", "outputSchema"] as const) {
      const schema = next[key];
      if (isRecord(schema)) {
        next[key] = convertDialect(schema, dialect);
        changed = true;
      }
    }
    return changed ? next : tool;
  });

  if (!changed) return message;
  return { ...message, result: { ...message.result, tools: converted } };
}

class SchemaDialectTransport implements Transport {
  constructor(
    private readonly inner: Transport,
    private readonly dialect: SchemaDialect,
  ) {}

  start(): Promise<void> {
    return this.inner.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    return this.inner.send(convertMessageSchemas(message, this.dialect), options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  // The protocol layer assigns these callbacks on whatever object it was handed, so they
  // have to reach the real transport rather than land on the wrapper.
  get onclose(): Transport["onclose"] {
    return this.inner.onclose;
  }
  set onclose(handler: Transport["onclose"]) {
    this.inner.onclose = handler;
  }

  get onerror(): Transport["onerror"] {
    return this.inner.onerror;
  }
  set onerror(handler: Transport["onerror"]) {
    this.inner.onerror = handler;
  }

  get onmessage(): Transport["onmessage"] {
    return this.inner.onmessage;
  }
  set onmessage(handler: Transport["onmessage"]) {
    this.inner.onmessage = handler;
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  get setProtocolVersion(): ((version: string) => void) | undefined {
    const forward = this.inner.setProtocolVersion;
    return forward ? (version: string) => forward.call(this.inner, version) : undefined;
  }
}

/**
 * Wrap `transport` so advertised tool schemas are restated in `dialect`.
 * Returns the transport unchanged when the SDK's native output is what we want.
 */
export function withSchemaDialect(transport: Transport, dialect: SchemaDialect): Transport {
  return dialect === "draft-7" ? transport : new SchemaDialectTransport(transport, dialect);
}
