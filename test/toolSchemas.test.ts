import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createProvider } from "../src/providers/index.js";
import { DIALECT_2020_12_URI, DIALECT_DRAFT_7_URI, type SchemaDialect } from "../src/schema/dialect.js";
import { withSchemaDialect } from "../src/schema/transport.js";
import { buildServer } from "../src/server.js";


/** Boot the real server over an in-memory pair and read back what it advertises. */
async function advertisedTools(dialect: SchemaDialect): Promise<Tool[]> {
  const config = { ...loadConfig({}), schemaDialect: dialect };
  const server = buildServer(config, createProvider(config));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "mediamcp-test", version: "0.0.0" });

  await Promise.all([
    server.connect(withSchemaDialect(serverTransport, dialect)),
    client.connect(clientTransport),
  ]);

  try {
    const { tools } = await client.listTools();
    return tools;
  } finally {
    await client.close();
    await server.close();
  }
}

function schemasOf(tool: Tool): Record<string, unknown>[] {
  const schemas: Record<string, unknown>[] = [tool.inputSchema as Record<string, unknown>];
  if (tool.outputSchema) schemas.push(tool.outputSchema as Record<string, unknown>);
  return schemas;
}

describe("advertised tool schemas", () => {
  it("exposes the documented tool set", async () => {
    const names = (await advertisedTools("2020-12")).map((tool) => tool.name).sort();
    expect(names).toEqual([
      "check_config",
      "check_video_status",
      "edit_image",
      "generate_image",
      "generate_video",
      "list_models",
    ]);
  });

  it("declares every input and output schema as 2020-12", async () => {
    for (const tool of await advertisedTools("2020-12")) {
      for (const schema of schemasOf(tool)) {
        expect(schema.$schema, `${tool.name}`).toBe(DIALECT_2020_12_URI);
      }
    }
  });

  it("leaves no draft-07 marker anywhere in the payload", async () => {
    const payload = JSON.stringify(await advertisedTools("2020-12"));
    expect(payload).not.toContain(DIALECT_DRAFT_7_URI);
    expect(payload).not.toContain("draft-07");
  });

  // The regression guard: this is the exact check a strict client performs, and the
  // reason every tool was rejected before the dialect was normalised.
  it("compiles under a 2020-12-only validator", async () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    for (const tool of await advertisedTools("2020-12")) {
      for (const schema of schemasOf(tool)) {
        expect(() => ajv.compile(schema), `${tool.name}`).not.toThrow();
      }
    }
  });

  it("still reproduces the failure when the SDK output is passed through", async () => {
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const tools = await advertisedTools("draft-7");
    const schemas = tools.flatMap(schemasOf);

    expect(schemas.every((schema) => schema.$schema === DIALECT_DRAFT_7_URI)).toBe(true);
    expect(() => ajv.compile(schemas[0]!)).toThrow();
  });

  it("keeps the schemas usable — required fields and descriptions survive", async () => {
    const tools = await advertisedTools("2020-12");
    const generateImage = tools.find((tool) => tool.name === "generate_image");
    const input = generateImage?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };

    expect(input.required).toContain("prompt");
    expect(input.properties?.prompt).toMatchObject({ type: "string" });
  });
});
