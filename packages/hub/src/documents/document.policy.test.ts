import { describe, expect, it } from "vitest";

import {
  canCreateDocument,
  canEditDocument,
  canManageEditors,
  canReadDocument,
  canRequestEdit,
  contentDisposition,
  FOLDER_MAX_DEPTH,
  importSizeProblem,
  inspectFile,
  MAX_IMPORT_FILE_BYTES,
  MAX_TEXT_BYTES,
  normaliseName,
  storageKeyFor,
  viewContentType,
} from "./document.policy";

describe("importSizeProblem", () => {
  it("refuses empty and oversized files on their size alone", () => {
    expect(importSizeProblem(0)).toBe("文件是空的");
    expect(importSizeProblem(MAX_IMPORT_FILE_BYTES)).toBeNull();
    expect(importSizeProblem(MAX_IMPORT_FILE_BYTES + 1)).toBe(
      "文件太大，上限 20 MB",
    );
  });
});

describe("inspectFile", () => {
  it("accepts Markdown and HTML, whatever the case", () => {
    expect(inspectFile({ filename: "Notes.MD", size: 10 })).toMatchObject({
      ok: true,
      ext: "md",
      contentType: "text/markdown; charset=utf-8",
      preview: "markdown",
    });
    for (const filename of ["deck.html", "deck.htm"]) {
      expect(inspectFile({ filename, size: 10 })).toMatchObject({
        ok: true,
        contentType: "text/html; charset=utf-8",
        preview: "html",
      });
    }
  });

  it("refuses every other format, files and scripts alike", () => {
    for (const filename of [
      "a.pdf",
      "a.pptx",
      "a.docx",
      "a.xlsx",
      "a.txt",
      "a.csv",
      "a.json",
      "a.png",
      "x.exe",
      "x.svg",
      "x.js",
      "x.sh",
      "noext",
      "x.",
    ]) {
      expect(inspectFile({ filename, size: 10 })).toMatchObject({ ok: false });
    }
  });

  it("refuses empty and oversized content", () => {
    expect(inspectFile({ filename: "a.md", size: 0 })).toMatchObject({
      ok: false,
    });
    expect(
      inspectFile({ filename: "a.md", size: MAX_TEXT_BYTES + 1 }),
    ).toMatchObject({ ok: false });
    expect(
      inspectFile({ filename: "a.md", size: MAX_TEXT_BYTES }),
    ).toMatchObject({ ok: true });
  });

  it("strips paths and control characters from the display name", () => {
    expect(
      inspectFile({ filename: "../../etc/a\u0000b.md", size: 1 }),
    ).toMatchObject({ ok: true, displayName: "a b.md" });
    expect(
      inspectFile({ filename: "C:\\Users\\me\\合同.md", size: 1 }),
    ).toMatchObject({ ok: true, displayName: "合同.md" });
  });
});

describe("viewContentType", () => {
  it("is the type a document is shown as", () => {
    expect(viewContentType("html")).toBe("text/html; charset=utf-8");
    // Markdown is shown as plain text, never interpreted.
    expect(viewContentType("md")).toBe("text/plain; charset=utf-8");
    expect(viewContentType("pdf")).toBeNull();
    expect(viewContentType("pptx")).toBeNull();
  });
});

describe("storageKeyFor", () => {
  it("never carries the file name, only the extension", () => {
    expect(storageKeyFor("md", "abc-123")).toBe("documents/abc-123.md");
  });
});

describe("contentDisposition", () => {
  it("encodes non-ASCII names and keeps an ASCII fallback", () => {
    const header = contentDisposition("attachment", "合同 v2.md");
    expect(header).toBe(
      `attachment; filename="_ v2.md"; filename*=UTF-8''%E5%90%88%E5%90%8C%20v2.md`,
    );
  });

  it("cannot be broken out of with quotes or line breaks", () => {
    const header = contentDisposition("inline", 'a"b\r\nc.md');
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.startsWith("inline; filename=")).toBe(true);
    expect(header).not.toContain('a"b');
  });
});

describe("normaliseName", () => {
  it("trims and collapses whitespace", () => {
    expect(normaliseName("  合同   2026 ", 80)).toBe("合同 2026");
  });

  it("returns null for empty or too long names", () => {
    expect(normaliseName("   ", 80)).toBeNull();
    expect(normaliseName("x".repeat(81), 80)).toBeNull();
    expect(normaliseName("x".repeat(80), 80)).toBe("x".repeat(80));
  });
});

describe("folder depth", () => {
  it("is limited", () => {
    expect(FOLDER_MAX_DEPTH).toBeGreaterThanOrEqual(2);
  });
});

describe("who may do what", () => {
  it("lets back-office owners and admins create documents, nobody else", () => {
    expect(canCreateDocument("owner")).toBe(true);
    expect(canCreateDocument("admin")).toBe(true);
    expect(canCreateDocument("viewer")).toBe(false);
    expect(canCreateDocument(null)).toBe(false);
  });

  it("lets owners and assigned editors change a document", () => {
    expect(canEditDocument({ role: "owner", isEditor: false })).toBe(true);
    expect(canEditDocument({ role: "admin", isEditor: true })).toBe(true);
    expect(canEditDocument({ role: null, isEditor: true })).toBe(true);
    // An admin is not an editor of everything: rights are assigned.
    expect(canEditDocument({ role: "admin", isEditor: false })).toBe(false);
    expect(canEditDocument({ role: null, isEditor: false })).toBe(false);
  });

  it("lets only owners and admin-editors hand out edit rights", () => {
    expect(canManageEditors({ role: "owner", isEditor: false })).toBe(true);
    expect(canManageEditors({ role: "admin", isEditor: true })).toBe(true);
    expect(canManageEditors({ role: "admin", isEditor: false })).toBe(false);
    // An ordinary member who was granted edit cannot pass it on.
    expect(canManageEditors({ role: null, isEditor: true })).toBe(false);
  });

  it("shows an unreadable document only to people who can edit it", () => {
    expect(canReadDocument({ readable: true, canEdit: false })).toBe(true);
    expect(canReadDocument({ readable: false, canEdit: false })).toBe(false);
    expect(canReadDocument({ readable: false, canEdit: true })).toBe(true);
  });

  it("lets a reader who cannot edit ask once", () => {
    const base = { canRead: true, canEdit: false, hasPendingRequest: false };
    expect(canRequestEdit(base)).toBe(true);
    expect(canRequestEdit({ ...base, canEdit: true })).toBe(false);
    expect(canRequestEdit({ ...base, canRead: false })).toBe(false);
    expect(canRequestEdit({ ...base, hasPendingRequest: true })).toBe(false);
  });
});
