import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { buildDataUrl } from "../src/media/dataUrl.js";
import { loadImageSource } from "../src/media/sources.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("loadImageSource", () => {
  it("passes valid data URLs through", async () => {
    const url = buildDataUrl("image/png", PNG_BYTES);
    await expect(loadImageSource(url)).resolves.toBe(url);
  });

  it("rejects non-image data URLs", async () => {
    await expect(loadImageSource("data:text/plain;base64,aGk=")).rejects.toThrow(/image data URL/);
  });

  it("passes https URLs through untouched", async () => {
    await expect(loadImageSource("https://example.com/pic.png")).resolves.toBe("https://example.com/pic.png");
  });

  it("rejects non-localhost http URLs", async () => {
    await expect(loadImageSource("http://example.com/pic.png")).rejects.toThrow(/Refusing plain-http/);
  });

  it("reads local files into data URLs, sniffing the real format", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mediamcp-src-"));
    const file = path.join(dir, "actually-png.jpg"); // wrong extension on purpose
    await writeFile(file, PNG_BYTES);
    const result = await loadImageSource(file);
    expect(result.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("supports file:// URLs", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mediamcp-src-"));
    const file = path.join(dir, "pic.png");
    await writeFile(file, PNG_BYTES);
    const result = await loadImageSource(`file://${file}`);
    expect(result.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects missing files with an actionable message", async () => {
    await expect(loadImageSource("/definitely/not/here.png")).rejects.toThrow(/not found/);
  });

  it("rejects non-image local files", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "mediamcp-src-"));
    const file = path.join(dir, "notes.txt");
    await writeFile(file, "just text");
    await expect(loadImageSource(file)).rejects.toThrow(/does not look like an image/);
  });
});
