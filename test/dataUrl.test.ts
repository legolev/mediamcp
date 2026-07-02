import { describe, expect, it } from "vitest";

import {
  buildDataUrl,
  extensionForMime,
  mimeForExtension,
  parseDataUrl,
  sniffImageMime,
} from "../src/media/dataUrl.js";

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("parseDataUrl", () => {
  it("parses a base64 data URL", () => {
    const url = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;
    const parsed = parseDataUrl(url);
    expect(parsed?.mime).toBe("image/png");
    expect(Buffer.from(parsed!.bytes)).toEqual(Buffer.from(PNG_BYTES));
  });

  it("round-trips with buildDataUrl", () => {
    const parsed = parseDataUrl(buildDataUrl("image/webp", PNG_BYTES));
    expect(parsed?.mime).toBe("image/webp");
    expect(parsed?.bytes.length).toBe(PNG_BYTES.length);
  });

  it("rejects non-data URLs and empty payloads", () => {
    expect(parseDataUrl("https://example.com/a.png")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
    expect(parseDataUrl("not a url")).toBeNull();
  });

  it("defaults the mime when missing", () => {
    expect(parseDataUrl("data:;base64," + Buffer.from("x").toString("base64"))?.mime).toBe(
      "application/octet-stream",
    );
  });
});

describe("mime/extension mapping", () => {
  it("maps common mimes to extensions", () => {
    expect(extensionForMime("image/png")).toBe("png");
    expect(extensionForMime("image/jpeg")).toBe("jpg");
    expect(extensionForMime("IMAGE/WEBP")).toBe("webp");
    expect(extensionForMime("video/mp4")).toBe("mp4");
    expect(extensionForMime("application/unknown", "png")).toBe("png");
  });

  it("maps extensions back to mimes", () => {
    expect(mimeForExtension(".png")).toBe("image/png");
    expect(mimeForExtension("JPEG")).toBe("image/jpeg");
    expect(mimeForExtension(".xyz")).toBeNull();
  });
});

describe("sniffImageMime", () => {
  it("detects png, jpeg, gif, webp", () => {
    expect(sniffImageMime(PNG_BYTES)).toBe("image/png");
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImageMime(new TextEncoder().encode("GIF89a..."))).toBe("image/gif");
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0);
    webp.set([0x57, 0x45, 0x42, 0x50], 8);
    expect(sniffImageMime(webp)).toBe("image/webp");
  });

  it("returns null for unknown bytes", () => {
    expect(sniffImageMime(new TextEncoder().encode("hello"))).toBeNull();
    expect(sniffImageMime(new Uint8Array([]))).toBeNull();
  });
});
