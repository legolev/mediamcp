import { describe, expect, it } from "vitest";

import { maskKey, redactSecrets } from "../src/util/redact.js";

describe("redactSecrets", () => {
  it("removes known secret values", () => {
    expect(redactSecrets("error with my-secret-key inside", ["my-secret-key"])).toBe("error with [redacted] inside");
  });

  it("removes OpenRouter-shaped keys", () => {
    const text = "Authorization failed for sk-or-v1-0123456789abcdef0123456789abcdef";
    expect(redactSecrets(text)).not.toContain("sk-or-v1-0123456789abcdef");
    expect(redactSecrets(text)).toContain("[redacted]");
  });

  it("removes Bearer tokens", () => {
    expect(redactSecrets("header was Bearer abcdef123456789")).not.toContain("abcdef123456789");
  });

  it("ignores null/undefined known secrets", () => {
    expect(redactSecrets("plain text", [null, undefined])).toBe("plain text");
  });
});

describe("maskKey", () => {
  it("keeps only the tail of the key", () => {
    const masked = maskKey("sk-or-v1-0123456789abcdef");
    expect(masked).toContain("cdef");
    expect(masked).not.toContain("0123456789");
  });

  it("handles short keys", () => {
    expect(maskKey("abcd")).toBe("…cd");
  });
});
