import { describe, expect, it } from "vitest";

import { convertDialect, DIALECT_2020_12_URI, DIALECT_DRAFT_7_URI, isSchemaDialect } from "../src/schema/dialect.js";

const upgrade = <T extends object>(schema: T): Record<string, unknown> =>
  convertDialect(schema, "2020-12") as Record<string, unknown>;

describe("convertDialect", () => {
  it("stamps the 2020-12 dialect in place of draft-07", () => {
    const result = upgrade({ $schema: DIALECT_DRAFT_7_URI, type: "object" });
    expect(result.$schema).toBe(DIALECT_2020_12_URI);
  });

  it("adds the dialect when the source declared none", () => {
    expect(upgrade({ type: "object" }).$schema).toBe(DIALECT_2020_12_URI);
  });

  it("renames definitions to $defs and repoints refs at it", () => {
    const result = upgrade({
      type: "object",
      properties: { self: { $ref: "#/definitions/node" } },
      definitions: { node: { type: "string" } },
    });
    expect(result.definitions).toBeUndefined();
    expect(result.$defs).toEqual({ node: { type: "string" } });
    expect(result.properties).toEqual({ self: { $ref: "#/$defs/node" } });
  });

  it("leaves an existing $defs pool alone rather than guessing a merge", () => {
    const result = upgrade({ $defs: { a: { type: "string" } }, definitions: { b: { type: "number" } } });
    expect(result.$defs).toEqual({ a: { type: "string" } });
    expect(result.definitions).toBeUndefined();
  });

  it("converts the draft-07 tuple form to prefixItems", () => {
    const result = upgrade({
      type: "array",
      items: [{ type: "string" }, { type: "number" }],
      additionalItems: { type: "boolean" },
    });
    expect(result.prefixItems).toEqual([{ type: "string" }, { type: "number" }]);
    expect(result.items).toEqual({ type: "boolean" });
    expect(result.additionalItems).toBeUndefined();
  });

  it("keeps a single-schema items as items", () => {
    const result = upgrade({ type: "array", items: { type: "string" } });
    expect(result.items).toEqual({ type: "string" });
    expect(result.prefixItems).toBeUndefined();
  });

  it("drops additionalItems when there is no tuple for it to qualify", () => {
    const result = upgrade({ type: "array", items: { type: "string" }, additionalItems: false });
    expect(result.additionalItems).toBeUndefined();
    expect(result.items).toEqual({ type: "string" });
  });

  it("splits dependencies into dependentRequired and dependentSchemas", () => {
    const result = upgrade({
      type: "object",
      dependencies: {
        card: ["billing_address"],
        credit: { properties: { limit: { type: "number" } } },
      },
    });
    expect(result.dependencies).toBeUndefined();
    expect(result.dependentRequired).toEqual({ card: ["billing_address"] });
    expect(result.dependentSchemas).toEqual({ credit: { properties: { limit: { type: "number" } } } });
  });

  it("treats property names as names, not keywords", () => {
    // A schema describing an object that HAS properties called `items` and `definitions`.
    // A naive deep rewrite would mangle both.
    const result = upgrade({
      type: "object",
      properties: {
        items: { type: "array", items: { type: "string" } },
        definitions: { type: "string" },
      },
    });
    expect(result.properties).toEqual({
      items: { type: "array", items: { type: "string" } },
      definitions: { type: "string" },
    });
    expect(result.$defs).toBeUndefined();
  });

  it("carries data keywords over verbatim", () => {
    const source = {
      type: "string",
      enum: ["a", "b"],
      default: "a",
      examples: ["a"],
      description: "unchanged",
    };
    const result = upgrade(source);
    expect(result).toMatchObject(source);
  });

  it("recurses through composition keywords", () => {
    const result = upgrade({
      anyOf: [{ definitions: { x: { type: "string" } } }, { type: "null" }],
    });
    expect(result.anyOf).toEqual([{ $defs: { x: { type: "string" } } }, { type: "null" }]);
  });

  it("is idempotent", () => {
    const once = upgrade({ $schema: DIALECT_DRAFT_7_URI, type: "array", items: [{ type: "string" }] });
    expect(upgrade(once)).toEqual(once);
  });

  it("does not mutate its input", () => {
    const source = { $schema: DIALECT_DRAFT_7_URI, definitions: { a: { type: "string" } } };
    const snapshot = structuredClone(source);
    upgrade(source);
    expect(source).toEqual(snapshot);
  });

  it("passes the schema through untouched for draft-7", () => {
    const source = { $schema: DIALECT_DRAFT_7_URI, definitions: { a: { type: "string" } } };
    expect(convertDialect(source, "draft-7")).toBe(source);
  });
});

describe("isSchemaDialect", () => {
  it("accepts the supported dialects and rejects anything else", () => {
    expect(isSchemaDialect("2020-12")).toBe(true);
    expect(isSchemaDialect("draft-7")).toBe(true);
    expect(isSchemaDialect("draft-04")).toBe(false);
    expect(isSchemaDialect("")).toBe(false);
  });
});
