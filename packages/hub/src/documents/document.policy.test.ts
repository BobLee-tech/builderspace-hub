import { describe, expect, it } from "vitest";

import {
  canCreateDocument,
  canEditDocument,
  canManageEditors,
  canReadDocument,
  canRequestEdit,
  contentDisposition,
  FOLDER_MAX_DEPTH,
  inspectFile,
  MAX_FILE_BYTES,
  normaliseName,
  storageKeyFor,
  viewContentType,
} from "./document.policy";

describe("inspectFile", () => {
  it("accepts the formats we render and the ones we only keep", () => {
    expect(inspectFile({ filename: "Proposal.PDF", size: 10 })).toMatchObject({
      ok: true,
      ext: "pdf",
      contentType: "application/pdf",
      preview: "pdf",
    });
    expect(inspectFile({ filename: "deck.html", size: 10 })).toMatchObject({
      ok: true,
      preview: "html",
    });
    expect(inspectFile({ filename: "deck.pptx", size: 10 })).toMatchObject({
      ok: true,
      preview: null,
    });
    expect(inspectFile({ filename: "合同.docx", size: 10 })).toMatchObject({
      ok: true,
      ext: "docx",
      preview: null,
    });
  });

  it("refuses types that can run code or that we do not know", () => {
    for (const filename of ["x.exe", "x.svg", "x.js", "x.sh", "noext", "x."]) {
      expect(inspectFile({ filename, size: 10 })).toMatchObject({ ok: false });
    }
  });

  it("refuses empty and oversized files", () => {
    expect(inspectFile({ filename: "a.pdf", size: 0 })).toMatchObject({
      ok: false,
    });
    expect(
      inspectFile({ filename: "a.pdf", size: MAX_FILE_BYTES + 1 }),
    ).toMatchObject({ ok: false });
    expect(
      inspectFile({ filename: "a.pdf", size: MAX_FILE_BYTES }),
    ).toMatchObject({ ok: true });
  });

  it("strips paths and control characters from the display name", () => {
    expect(
      inspectFile({ filename: "../../etc/a\u0000b.pdf", size: 1 }),
    ).toMatchObject({ ok: true, displayName: "a b.pdf" });
    expect(
      inspectFile({ filename: "C:\\Users\\me\\合同.pdf", size: 1 }),
    ).toMatchObject({ ok: true, displayName: "合同.pdf" });
  });
});

describe("viewContentType", () => {
  it("is the type a file is shown as, or null when it is not shown", () => {
    expect(viewContentType("pdf")).toBe("application/pdf");
    expect(viewContentType("html")).toBe("text/html; charset=utf-8");
    // Markdown and CSV are shown as plain text, never interpreted.
    expect(viewContentType("md")).toBe("text/plain; charset=utf-8");
    expect(viewContentType("csv")).toBe("text/plain; charset=utf-8");
    expect(viewContentType("png")).toBe("image/png");
    expect(viewContentType("pptx")).toBeNull();
  });
});

describe("storageKeyFor", () => {
  it("never carries the file name, only the extension", () => {
    expect(storageKeyFor("pdf", "abc-123")).toBe("documents/abc-123.pdf");
  });
});

describe("contentDisposition", () => {
  it("encodes non-ASCII names and keeps an ASCII fallback", () => {
    const header = contentDisposition("attachment", "合同 v2.pdf");
    expect(header).toBe(
      `attachment; filename="_ v2.pdf"; filename*=UTF-8''%E5%90%88%E5%90%8C%20v2.pdf`,
    );
  });

  it("cannot be broken out of with quotes or line breaks", () => {
    const header = contentDisposition("inline", 'a"b\r\nc.pdf');
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
