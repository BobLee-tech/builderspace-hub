import { describe, expect, it } from "vitest";

import {
  documentFileUrl,
  documentHref,
  documentsHref,
  formatBytes,
} from "./document-display";

describe("formatBytes", () => {
  it("uses the largest unit that keeps the number small", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5 MB");
    expect(formatBytes(150 * 1024 * 1024)).toBe("150 MB");
    expect(formatBytes(3.25 * 1024 * 1024 * 1024)).toBe("3.3 GB");
  });
});

describe("links", () => {
  it("point at the file route, and encode ids", () => {
    expect(documentFileUrl("abc")).toBe("/api/hub/documents/abc/file");
    expect(documentFileUrl("a b", "download")).toBe(
      "/api/hub/documents/a%20b/file?mode=download",
    );
  });

  it("point at the library and a document", () => {
    expect(documentsHref()).toBe("/documents");
    expect(documentsHref("f/1")).toBe("/documents?folder=f%2F1");
    expect(documentHref("x")).toBe("/documents/x");
  });
});
