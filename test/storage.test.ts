import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildFilename, resolveOutputDir, saveBytes, slugify } from "../src/media/storage.js";

describe("slugify", () => {
  it("keeps only [a-z0-9-]", () => {
    expect(slugify("Hero Banner: Red Panda!")).toBe("hero-banner-red-panda");
    expect(slugify("../../etc/passwd")).toBe("etc-passwd");
    expect(slugify("Кириллица целиком")).toBe("media");
  });

  it("caps the length", () => {
    expect(slugify("a".repeat(100)).length).toBeLessThanOrEqual(32);
  });
});

describe("buildFilename", () => {
  it("follows the kind_timestamp_slug_hash.ext scheme", () => {
    const name = buildFilename("img", "Red Panda", new Uint8Array([1, 2, 3]), "png");
    expect(name).toMatch(/^img_\d{8}_\d{6}_red-panda_[0-9a-f]{6}\.png$/);
  });

  it("never lets the label escape the directory", () => {
    const name = buildFilename("edit", "../..///weird", new Uint8Array([1]), "png");
    expect(name).not.toContain("/");
    expect(name).not.toContain("..");
  });
});

describe("saveBytes", () => {
  it("creates the directory and never overwrites existing files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mediamcp-test-"));
    const nested = path.join(dir, "a", "b");
    const first = await saveBytes(nested, "img_x.png", new Uint8Array([1]));
    const second = await saveBytes(nested, "img_x.png", new Uint8Array([2]));
    expect(first).toBe(path.join(nested, "img_x.png"));
    expect(second).toBe(path.join(nested, "img_x-1.png"));
    expect(new Uint8Array(await readFile(first))).toEqual(new Uint8Array([1]));
    expect(new Uint8Array(await readFile(second))).toEqual(new Uint8Array([2]));
    expect((await readdir(nested)).sort()).toEqual(["img_x-1.png", "img_x.png"]);
  });
});

describe("resolveOutputDir", () => {
  it("uses the default when no override is given", () => {
    expect(resolveOutputDir("/default/dir")).toBe("/default/dir");
    expect(resolveOutputDir("/default/dir", "  ")).toBe("/default/dir");
  });

  it("resolves overrides to absolute paths", () => {
    expect(path.isAbsolute(resolveOutputDir("/d", "relative/dir"))).toBe(true);
  });
});
