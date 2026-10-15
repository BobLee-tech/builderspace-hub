import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { Db } from "../db";
import type { ImportStatus } from "../documents";
import type { DocumentStorage } from "../documents/storage";
import { CLI_ACTOR } from "../audit";
import { ensureFolderPath, importDocument, previewImport } from "../documents";
import { fileLabel, inspectFile } from "../documents/document.policy";
import { isHubError } from "../shared/errors";
import { inlineLocalAssets } from "./inline-html";

export interface ImportSource {
  /** A directory on this machine. */
  dir: string;
  /** Where it goes in the library, top to bottom; empty for the top level. */
  folder: string[];
}

export interface ImportOptions {
  sources: ImportSource[];
  /** Also take files in sub-directories, mirrored as sub-folders. */
  recursive: boolean;
  /** Report what would happen and change nothing. */
  dryRun: boolean;
}

/** Folders that only ever hold dependencies or tool state. */
const SKIPPED_DIRECTORIES = new Set(["node_modules", "__MACOSX"]);

/** Names that are never documents: dotfiles, Office lock files. */
const isNoise = (name: string): boolean =>
  name.startsWith(".") || name.startsWith("~$");

interface Candidate {
  absolutePath: string;
  folder: string[];
  filename: string;
}

async function collect(
  dir: string,
  folder: string[],
  recursive: boolean,
  into: Candidate[],
): Promise<void> {
  const entries = await readdir(dir, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  for (const entry of entries) {
    if (isNoise(entry.name)) continue;
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive && !SKIPPED_DIRECTORIES.has(entry.name)) {
        await collect(absolutePath, [...folder, entry.name], recursive, into);
      }
    } else if (entry.isFile()) {
      into.push({ absolutePath, folder, filename: entry.name });
    }
  }
}

const STATUS_LABEL: Record<ImportStatus, string> = {
  created: "新建",
  updated: "替换",
  unchanged: "不变",
};

/** "1.4 MB" for the report. */
function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Puts local files into the document library, mirroring directories as
 * folders. Safe to run again: identical files are left alone and changed ones
 * replace the earlier copy. A dry run reads the library and the files but
 * writes nothing, and works without file storage configured.
 *
 * Files the library does not accept (unknown formats, too big) are reported
 * and skipped, never fatal, so one odd file cannot stop a whole import.
 */
export async function importDocuments(
  db: Db,
  storage: DocumentStorage | null,
  options: ImportOptions,
): Promise<string[]> {
  // Only a real run writes anything, and only a real run needs storage.
  const writer = options.dryRun ? null : storage;
  if (!options.dryRun && !writer) {
    return [
      "✗ 还没有配置文件存储，拒绝导入。",
      "  线上：设置 HUB_DOCUMENTS_BUCKET 和 S3_* 变量；本地开发：设置 HUB_DOCUMENTS_DIR。",
      "  只想看会导入什么，可以加 --dry-run。",
    ];
  }

  const lines: string[] = [];
  const counts: Record<ImportStatus | "skipped" | "failed", number> = {
    created: 0,
    updated: 0,
    unchanged: 0,
    skipped: 0,
    failed: 0,
  };

  for (const source of options.sources) {
    const candidates: Candidate[] = [];
    try {
      await collect(source.dir, source.folder, options.recursive, candidates);
    } catch {
      return [`✗ 读不了目录：${source.dir}`];
    }

    for (const candidate of candidates) {
      const where =
        [...candidate.folder, candidate.filename].join(" / ") ||
        candidate.filename;
      const info = await stat(candidate.absolutePath);
      const check = inspectFile({
        filename: candidate.filename,
        size: info.size,
      });
      if (!check.ok) {
        counts.skipped += 1;
        lines.push(`  · 跳过  ${where}（${check.reason}）`);
        continue;
      }

      try {
        let bytes = await readFile(candidate.absolutePath);
        let note = "";
        if (/\.html?$/i.test(candidate.filename)) {
          // Linked styles, fonts and images would not load from the library.
          const page = await inlineLocalAssets(bytes.toString("utf8"), {
            baseDir: path.dirname(candidate.absolutePath),
            root: source.dir,
          });
          bytes = Buffer.from(page.html);
          if (page.inlined > 0) note = `，内联 ${page.inlined} 个资源`;
          for (const reference of page.missing) {
            lines.push(`    ! 找不到被引用的文件：${reference}`);
          }
        }
        let status: ImportStatus;
        if (writer === null) {
          status = await previewImport(db, {
            folderNames: candidate.folder,
            filename: candidate.filename,
            bytes,
          });
        } else {
          const folderPublicId = await ensureFolderPath(
            db,
            CLI_ACTOR,
            candidate.folder,
          );
          ({ status } = await importDocument(db, writer, CLI_ACTOR, {
            folderPublicId,
            filename: candidate.filename,
            bytes,
          }));
        }
        counts[status] += 1;
        lines.push(
          `  ${status === "unchanged" ? "=" : "✓"} ${STATUS_LABEL[status]}  ${where}（${fileLabel(candidate.filename)}，${size(bytes.length)}${note}）`,
        );
      } catch (error) {
        if (!isHubError(error)) throw error;
        counts.failed += 1;
        lines.push(`  ✗ 失败  ${where}：${error.message}`);
      }
    }
  }

  const summary =
    `${counts.failed > 0 ? "✗ " : ""}${options.dryRun ? "预演" : "导入"}完成：新建 ${counts.created}，替换 ${counts.updated}，` +
    `不变 ${counts.unchanged}，跳过 ${counts.skipped}，失败 ${counts.failed}` +
    (options.dryRun ? "（没有改动任何东西）" : "");
  return [summary, ...lines];
}
