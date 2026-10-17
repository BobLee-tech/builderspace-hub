import type { HubRole } from "../accounts/roles";
import { can } from "../accounts/roles";

/**
 * Largest document the server reads or writes. Text written in the page
 * travels as JSON through Kan's tRPC route, whose request body is capped at
 * 1 MB; quotes and line breaks double in size when escaped, so the limit
 * leaves that margin.
 */
export const MAX_TEXT_BYTES = 400 * 1024;

/** Files the upload button offers; each becomes a Markdown or HTML document (see file-import.ts). */
export const IMPORT_ACCEPT = ".md,.markdown,.html,.htm,.docx";

/**
 * Largest file read for an upload. A .docx is mostly pictures and zip
 * overhead, so it may be far bigger than the text that comes out of it; the
 * text itself is still held to MAX_TEXT_BYTES.
 */
export const MAX_IMPORT_FILE_BYTES = 20 * 1024 * 1024;

/**
 * Why a file of this size cannot be uploaded, or null. Checked on the size
 * alone, so the browser can refuse a huge file before reading it.
 */
export function importSizeProblem(size: number): string | null {
  if (size === 0) return "文件是空的";
  if (size > MAX_IMPORT_FILE_BYTES) {
    return `文件太大，上限 ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`;
  }
  return null;
}

/** How deep folders may nest (a top-level folder is depth 1). */
export const FOLDER_MAX_DEPTH = 3;

export const TITLE_MAX_LENGTH = 120;
export const DESCRIPTION_MAX_LENGTH = 500;
export const FOLDER_NAME_MAX_LENGTH = 80;
export const REQUEST_NOTE_MAX_LENGTH = 280;

/** How a document is shown on its page. */
export type PreviewKind = "html" | "markdown";

interface FileType {
  /** What the bytes are stored as. */
  contentType: string;
  preview: PreviewKind;
  label: string;
}

const TEXT_VIEW = "text/plain; charset=utf-8";

/**
 * The only two formats a document may have: Markdown and HTML, both written
 * and edited in the page. HTML can carry code, so it is only ever shown inside
 * a sandbox; Markdown is rendered without any raw HTML.
 */
const FILE_TYPES: Record<string, FileType> = {
  md: {
    contentType: "text/markdown; charset=utf-8",
    preview: "markdown",
    label: "Markdown",
  },
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
};

export type FileCheck =
  | {
      ok: true;
      ext: string;
      contentType: string;
      preview: PreviewKind;
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
    return {
      ok: false,
      reason: "文档只支持 Markdown（.md）和 HTML（.html）两种格式",
    };
  }
  if (!Number.isInteger(input.size) || input.size <= 0) {
    return { ok: false, reason: "内容是空的" };
  }
  if (input.size > MAX_TEXT_BYTES) {
    return {
      ok: false,
      reason: `内容太大，上限 ${MAX_TEXT_BYTES / 1024} KB`,
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

/** How a document is shown, or null for a format the library no longer holds. */
export function previewKindOf(ext: string): PreviewKind | null {
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
  return type?.preview ?? null;
}

/**
 * The content type a file is served with when shown in the page. Text-like
 * formats (Markdown) are shown as plain text so nothing in them is
 * ever interpreted. Null for formats the library does not hold.
 */
export function viewContentType(ext: string): string | null {
  const type = Object.hasOwn(FILE_TYPES, ext) ? FILE_TYPES[ext] : undefined;
  if (!type) return null;
  return type.preview === "markdown" ? TEXT_VIEW : type.contentType;
}

/**
 * The key a document's content is stored under. It carries the extension and
 * nothing the author chose: file names are untrusted input.
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
