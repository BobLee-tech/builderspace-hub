import mammoth from "mammoth";
import TurndownService from "turndown";

import {
  MAX_IMPORT_FILE_BYTES,
  MAX_TEXT_BYTES,
  TITLE_MAX_LENGTH,
} from "./document.policy";

/**
 * Turning a file from someone's computer into a document. The library still
 * holds Markdown and HTML only: .md and .html files are read as they are, and
 * a Word file (.docx) becomes Markdown, so nothing needs a bucket. It runs in
 * the browser, before the text is sent, because a .docx with pictures is
 * easily bigger than the 1 MB a request may carry.
 */

export interface ImportedDocument {
  title: string;
  format: "md" | "html";
  content: string;
  /** The name of the file it came from, to show where the text came from. */
  fileName: string;
  /** Pictures in a Word file that were left out: documents hold text only. */
  droppedImages: number;
}

export type ImportResult =
  | { ok: true; document: ImportedDocument }
  | { ok: false; reason: string };

const TEXT_FORMATS: Record<string, ImportedDocument["format"]> = {
  md: "md",
  markdown: "md",
  html: "html",
  htm: "html",
};

const UNSUPPORTED = "只能上传 .md、.html 和 Word（.docx）文件";

/** Reads a file into a document that can still be checked and edited before it is saved. */
export async function importDocumentFile(file: {
  name: string;
  bytes: Uint8Array;
}): Promise<ImportResult> {
  const dot = file.name.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.name.slice(dot + 1).toLowerCase();
  const title = titleFrom(dot === -1 ? file.name : file.name.slice(0, dot));

  if (ext === "doc") {
    return {
      ok: false,
      reason: "老的 Word 格式（.doc）读不了，请在 Word 里另存为 .docx 再上传",
    };
  }
  const textFormat = TEXT_FORMATS[ext];
  if (!textFormat && ext !== "docx") return { ok: false, reason: UNSUPPORTED };
  if (file.bytes.byteLength === 0) return { ok: false, reason: "文件是空的" };
  if (file.bytes.byteLength > MAX_IMPORT_FILE_BYTES) {
    return {
      ok: false,
      reason: `文件太大，上限 ${MAX_IMPORT_FILE_BYTES / 1024 / 1024} MB`,
    };
  }

  let content: string;
  let droppedImages = 0;
  if (textFormat) {
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    } catch {
      return {
        ok: false,
        reason: "文件不是 UTF-8 编码，请另存为 UTF-8 再上传",
      };
    }
  } else {
    const converted = await docxToMarkdown(file.bytes);
    if (!converted) {
      return { ok: false, reason: "这个 Word 文件打不开，可能已经损坏" };
    }
    ({ content, droppedImages } = converted);
  }

  if (!content.trim()) return { ok: false, reason: "文件里没有文字" };
  if (new TextEncoder().encode(content).byteLength > MAX_TEXT_BYTES) {
    return {
      ok: false,
      reason: `文字内容超过 ${MAX_TEXT_BYTES / 1024} KB，拆成几份再上传`,
    };
  }
  return {
    ok: true,
    document: {
      title,
      format: textFormat ?? "md",
      content,
      fileName: file.name,
      droppedImages,
    },
  };
}

function titleFrom(baseName: string): string {
  const title = baseName.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX_LENGTH);
  return title || "未命名";
}

/**
 * Word to Markdown: headings, lists, tables, links and emphasis survive;
 * pictures, fonts, colours and page headers do not. Null when the file is
 * not a readable .docx.
 */
async function docxToMarkdown(
  bytes: Uint8Array,
): Promise<{ content: string; droppedImages: number } | null> {
  let droppedImages = 0;
  let html: string;
  try {
    // The browser build reads `arrayBuffer`, the Node build `buffer`.
    const data = bytes.slice().buffer;
    const result = await mammoth.convertToHtml(
      { arrayBuffer: data, buffer: data } as { arrayBuffer: ArrayBuffer },
      {
        convertImage: mammoth.images.imgElement(() => {
          droppedImages += 1;
          return Promise.resolve({ src: "" });
        }),
      },
    );
    html = result.value;
  } catch {
    return null;
  }

  const content = markdownService()
    .turndown(html)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { content: content ? `${content}\n` : "", droppedImages };
}

/** The few node members the table rules read, in the browser's DOM and on the server alike. */
interface TableNode {
  nodeName: string;
  parentNode: TableNode | null;
  childNodes: ArrayLike<TableNode>;
}

function markdownService(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  service.remove("img");

  // Word tables become GitHub tables. A Word table rarely marks a header row,
  // so the first row is taken as the header: Markdown tables need one.
  service.addRule("tableSection", {
    filter: ["thead", "tbody", "tfoot"],
    replacement: (content) => content,
  });
  service.addRule("tableCell", {
    filter: ["th", "td"],
    // Turndown has already escaped the text, backslashes included, so only
    // the pipe, which would end the cell, still needs a backslash.
    replacement: (content) =>
      `| ${content
        .replace(/\s*\n+\s*/g, " ")
        .replace(/\|/g, "\\|")
        .trim()} `,
  });
  service.addRule("tableRow", {
    filter: "tr",
    replacement: (content, node) => {
      const row = node as unknown as TableNode;
      const line = `${content}|\n`;
      if (!isFirstRow(row)) return line;
      return `${line}|${" --- |".repeat(Math.max(cellCount(row), 1))}\n`;
    },
  });
  service.addRule("table", {
    filter: "table",
    replacement: (content) => `\n\n${content.trim()}\n\n`,
  });
  return service;
}

function cellCount(row: TableNode): number {
  return Array.from(row.childNodes).filter(
    (child) => child.nodeName === "TD" || child.nodeName === "TH",
  ).length;
}

function isFirstRow(row: TableNode): boolean {
  let table = row.parentNode;
  while (table && table.nodeName !== "TABLE") table = table.parentNode;
  return !!table && firstRowOf(table) === row;
}

function firstRowOf(node: TableNode): TableNode | null {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeName === "TR") return child;
    if (child.nodeName === "TABLE") continue;
    const row = firstRowOf(child);
    if (row) return row;
  }
  return null;
}
