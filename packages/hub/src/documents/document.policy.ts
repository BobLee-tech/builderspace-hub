import type { HubRole } from "../accounts/roles";
import { can } from "../accounts/roles";

/** Largest file we accept; PPT decks are the big ones. */
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

/** How deep folders may nest (a top-level folder is depth 1). */
export const FOLDER_MAX_DEPTH = 3;

export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 500;
export const FOLDER_NAME_MAX_LENGTH = 80;
export const REQUEST_NOTE_MAX_LENGTH = 280;

/** How a file is shown on its page. `null` means download only. */
export type PreviewKind = "pdf" | "html" | "image" | "text";

interface FileType {
  /** What the bytes are stored as. */
  contentType: string;
  preview: PreviewKind | null;
  label: string;
}

const TEXT_VIEW = "text/plain; charset=utf-8";

/**
 * Every format a document may have. An allowlist: anything that can run code
 * on its own (scripts, executables, SVG) is left out. HTML is allowed because
 * it is a format we render, and is only ever shown inside a sandbox.
 */
const FILE_TYPES: Record<string, FileType> = {
  pdf: { contentType: "application/pdf", preview: "pdf", label: "PDF" },
  html: {
    contentType: "text/html; charset=utf-8",
    preview: "html",
    label: "HTML",
  },
  htm: {
    contentType: "text/html; charset=utf-8",
    preview: "html",
    label: "HTML",
  },
  png: { contentType: "image/png", preview: "image", label: "PNG" },
  jpg: { contentType: "image/jpeg", preview: "image", label: "JPG" },
  jpeg: { contentType: "image/jpeg", preview: "image", label: "JPG" },
  gif: { contentType: "image/gif", preview: "image", label: "GIF" },
  webp: { contentType: "image/webp", preview: "image", label: "WEBP" },
  txt: { contentType: TEXT_VIEW, preview: "text", label: "TXT" },
  md: {
    contentType: "text/markdown; charset=utf-8",
    preview: "text",
    label: "MD",
  },
  csv: {
    contentType: "text/csv; charset=utf-8",
    preview: "text",
    label: "CSV",
  },
  json: {
    contentType: "application/json",
    preview: "text",
    label: "JSON",
  },
  doc: { contentType: "application/msword", preview: null, label: "Word" },
  docx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    preview: null,
    label: "Word",
  },
  ppt: {
    contentType: "application/vnd.ms-powerpoint",
    preview: null,
    label: "PPT",
  },
  pptx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    preview: null,
    label: "PPT",
  },
  xls: {
    contentType: "application/vnd.ms-excel",
    preview: null,
    label: "Excel",
  },
  xlsx: {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    preview: null,
    label: "Excel",
  },
  key: {
    contentType: "application/vnd.apple.keynote",
    preview: null,
    label: "Keynote",
  },
  pages: {
    contentType: "application/vnd.apple.pages",
    preview: null,
    label: "Pages",
  },
  numbers: {
    contentType: "application/vnd.apple.numbers",
    preview: null,
    label: "Numbers",
  },
  zip: { contentType: "application/zip", preview: null, label: "ZIP" },
};

export type FileCheck =
  | {
      ok: true;
      ext: string;
      contentType: string;
      preview: PreviewKind | null;
      /** The name to show, with any path and control characters removed. */
      displayName: string;
    }
  | { ok: false; reason: string };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;

/** The last path segment, whichever separator the uploader's system used. */
function baseName(filename: string): string {
  const segments = filename.split(/[\\/]/);
  return segments[segments.length - 1] ?? "";
}

/**
 * Decides whether a file with this name and size may be stored. The type comes
 * from the extension only: the browser's claim about the content type is never
 * trusted, because it decides how the file is served later.
 */
export function inspectFile(input: {
  filename: string;
  size: number;
}): FileCheck {
  const displayName = baseName(input.filename.normalize("NFC"))
    .replace(CONTROL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(-200);

  const dot = displayName.lastIndexOf(".");
  const ext = dot === -1 ? "" : displayName.slice(dot + 1).toLowerCase();
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;

  if (!type) {
    return { ok: false, reason: "不支持这种文件格式" };
  }
  if (!Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, reason: "文件是空的" };
  }
  if (input.size > MAX_FILE_BYTES) {
    return {
      ok: false,
      reason: `文件太大，上限 ${MAX_FILE_BYTES / 1024 / 1024} MB`,
    };
  }
  return {
    ok: true,
    ext,
    contentType: type.contentType,
    preview: type.preview,
    displayName,
  };
}

/** The format's short label for the list ("PDF", "PPT"), or the extension. */
export function fileLabel(filename: string): string {
  const dot = filename.lastIndexOf(".");
  const ext = dot === -1 ? "" : filename.slice(dot + 1).toLowerCase();
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
  return type?.label ?? ext.toUpperCase();
}

/** How a previewable file is shown, or null for download-only formats. */
export function previewKindOf(ext: string): PreviewKind | null {
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
  return type?.preview ?? null;
}

/**
 * The content type a file is served with when shown in the page. Text-like
 * formats (Markdown, CSV, JSON) are shown as plain text so nothing in them is
 * ever interpreted. Null for formats that are not shown.
 */
export function viewContentType(ext: string): string | null {
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
  if (!type?.preview) return null;
  return type.preview === "text" ? TEXT_VIEW : type.contentType;
}

/**
 * The object key. It carries the extension (handy in a bucket listing) and
 * nothing the uploader chose: file names are untrusted input.
 */
export function storageKeyFor(ext: string, random: string): string {
  return `documents/${random}.${ext}`;
}

/** `Content-Disposition` for showing a file in the page or saving it. */
export function contentDisposition(
  mode: "inline" | "attachment",
  filename: string,
): string {
  const fallback = filename.replace(/(?:[^\x20-\x7e]|["\\%;])+/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Trims and collapses whitespace; null when empty or longer than `max`. */
export function normaliseName(value: string, max: number): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  return name.length === 0 || name.length > max ? null : name;
}

/** Creating documents and folders is for back-office owners and admins. */
export function canCreateDocument(role: HubRole | null): boolean {
  return can(role, "documents.manage");
}

/**
 * Changing a document (its details, its file, its folder, deleting it) is for
 * owners and for the people it was assigned to. An admin is not an editor of
 * everything: edit rights are handed out one document at a time.
 */
export function canEditDocument(input: {
  role: HubRole | null;
  isEditor: boolean;
}): boolean {
  return input.role === "owner" || input.isEditor;
}

/**
 * Handing out edit rights and deciding requests: owners, and admins who are
 * themselves editors of the document. A member who was granted edit cannot
 * pass it on.
 */
export function canManageEditors(input: {
  role: HubRole | null;
  isEditor: boolean;
}): boolean {
  return input.role === "owner" || (input.role === "admin" && input.isEditor);
}

/** Every document is readable for now; one marked unreadable is only for editors. */
export function canReadDocument(input: {
  readable: boolean;
  canEdit: boolean;
}): boolean {
  return input.readable || input.canEdit;
}

export function canRequestEdit(input: {
  canRead: boolean;
  canEdit: boolean;
  hasPendingRequest: boolean;
}): boolean {
  return input.canRead && !input.canEdit && !input.hasPendingRequest;
}
