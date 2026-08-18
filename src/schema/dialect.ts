/**
 * JSON Schema dialect normalisation for advertised tool schemas.
 *
 * The MCP TypeScript SDK converts every tool's `inputSchema`/`outputSchema` with a
 * hard-coded draft-07 target: `McpServer`'s `tools/list` handler calls
 * `toJsonSchemaCompat(obj, { strictUnions, pipeStrategy })` without a `target`, and
 * that helper falls back to `'draft-7'`. `registerTool` exposes no way to influence it
 * (verified against @modelcontextprotocol/sdk 1.29.0 and 1.30.0).
 *
 * Clients that compile tool schemas with a 2020-12-only validator therefore reject
 * every tool outright — Claude Desktop reports:
 *
 *     Tool 'check_config' has an invalid outputSchema: JSON Schema declares an
 *     unsupported dialect ("$schema": "http://json-schema.org/draft-07/schema#").
 *     The default validator supports JSON Schema 2020-12 only.
 *
 * So we restate the schemas in the target dialect on the way out. This is a structural
 * rewrite rather than a relabelled `$schema`: the keywords that actually differ between
 * the two drafts are translated, so the advertised schema still means what it said.
 *
 * The walk is schema-aware on purpose. A naive deep rewrite would corrupt a schema that
 * has a *property* named `items` or `definitions`, so keyword rules are only applied in
 * positions where the JSON Schema spec says a schema lives.
 */

export const SCHEMA_DIALECTS = ["2020-12", "draft-7"] as const;

/**
 * Dialect to advertise tool schemas in.
 * - `2020-12` — upgrade the SDK's draft-07 output to JSON Schema 2020-12 (default).
 * - `draft-7` — pass the SDK's native output through untouched.
 */
export type SchemaDialect = (typeof SCHEMA_DIALECTS)[number];

export const DIALECT_2020_12_URI = "https://json-schema.org/draft/2020-12/schema";
export const DIALECT_DRAFT_7_URI = "http://json-schema.org/draft-07/schema#";

export function isSchemaDialect(value: string): value is SchemaDialect {
  return (SCHEMA_DIALECTS as readonly string[]).includes(value);
}

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
type JsonObject = { [key: string]: JsonValue };

/** Keywords whose value is a map of name → schema. */
const SCHEMA_MAPS = ["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"];
/** Keywords whose value is an array of schemas. */
const SCHEMA_LISTS = ["allOf", "anyOf", "oneOf", "prefixItems"];
/** Keywords whose value is a single schema — plus draft-07 `items`, which may be an array. */
const SCHEMA_VALUES = [
  "additionalItems",
  "additionalProperties",
  "contains",
  "else",
  "if",
  "items",
  "not",
  "propertyNames",
  "then",
  "unevaluatedItems",
  "unevaluatedProperties",
];

function isObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rewrite `#/definitions/...` pointers to `#/$defs/...` after the keyword is renamed. */
function upgradeRef(ref: string): string {
  return ref.startsWith("#") ? ref.replaceAll("/definitions/", "/$defs/") : ref;
}

/**
 * draft-07 → 2020-12 for a single schema node. Children are converted first so that
 * keyword renames here never have to reach back into already-rewritten subtrees.
 */
function upgradeNode(node: JsonObject): JsonObject {
  const out: JsonObject = {};

  for (const [key, value] of Object.entries(node)) {
    // Nested `$schema` only ever muddies things; the dialect is stamped once at the root.
    if (key === "$schema") continue;

    if (key === "$ref" && typeof value === "string") {
      out[key] = upgradeRef(value);
    } else if (SCHEMA_MAPS.includes(key) && isObject(value)) {
      const mapped: JsonObject = {};
      for (const [name, child] of Object.entries(value)) mapped[name] = upgradeValue(child);
      out[key] = mapped;
    } else if (SCHEMA_LISTS.includes(key) && Array.isArray(value)) {
      out[key] = value.map(upgradeValue);
    } else if (SCHEMA_VALUES.includes(key)) {
      out[key] = Array.isArray(value) ? value.map(upgradeValue) : upgradeValue(value);
    } else {
      // Data keywords (enum, const, default, examples, …) are carried over verbatim.
      out[key] = value;
    }
  }

  // `definitions` → `$defs`. An existing `$defs` wins; merging two definition pools
  // silently would be a guess, and the SDK never emits both.
  if ("definitions" in out) {
    const definitions = out.definitions;
    delete out.definitions;
    if (!("$defs" in out)) out.$defs = definitions;
  }

  // Tuple form: draft-07 `items: [A, B]` + `additionalItems: S`
  //          → 2020-12 `prefixItems: [A, B]` + `items: S`.
  if (Array.isArray(out.items)) {
    out.prefixItems = out.items;
    delete out.items;
    if ("additionalItems" in out) {
      out.items = out.additionalItems as JsonValue;
    }
  }
  // Outside the tuple form `additionalItems` is ignored by draft-07 too, so it carries
  // no meaning worth preserving.
  delete out.additionalItems;

  // `dependencies` splits by value type: string[] → `dependentRequired`, schema → `dependentSchemas`.
  if (isObject(out.dependencies)) {
    const required: JsonObject = {};
    const schemas: JsonObject = isObject(out.dependentSchemas) ? { ...out.dependentSchemas } : {};
    for (const [name, value] of Object.entries(out.dependencies)) {
      if (Array.isArray(value)) required[name] = value;
      else schemas[name] = value;
    }
    delete out.dependencies;
    const existingRequired = isObject(out.dependentRequired) ? out.dependentRequired : {};
    if (Object.keys(required).length > 0) out.dependentRequired = { ...existingRequired, ...required };
    if (Object.keys(schemas).length > 0) out.dependentSchemas = schemas;
  }

  return out;
}

function upgradeValue(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(upgradeValue);
  return isObject(value) ? upgradeNode(value) : value;
}

/**
 * Restate `schema` in `dialect`. The input is never mutated.
 *
 * Converting an already-converted schema is a no-op, so this is safe to apply more than
 * once (`tools/list` may be served repeatedly).
 */
export function convertDialect<T extends object>(schema: T, dialect: SchemaDialect): T {
  if (dialect === "draft-7") return schema;
  const upgraded = upgradeNode(schema as JsonObject);
  return { $schema: DIALECT_2020_12_URI, ...upgraded } as unknown as T;
}
