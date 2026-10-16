import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";

import { createLogger } from "@kan/logger";
import { generateUID } from "@kan/shared/utils";

import type { AdminActor } from "../accounts/account.service";
import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { DocumentRow } from "./document.repo";
import type { DocumentSource, DocumentStorage, UploadTarget } from "./storage";
import { recordAudit, withAudit } from "../audit";
import { HubError } from "../shared/errors";
import { loadReadable, requireEdit, requireUserId } from "./document.guard";
import {
  canCreateDocument,
  contentDisposition,
  DESCRIPTION_MAX_LENGTH,
  inspectFile,
  MAX_FILE_BYTES,
  normaliseName,
  storageKeyFor,
  TITLE_MAX_LENGTH,
  viewContentType,
} from "./document.policy";
import {
  addEditor,
  consumeUpload,
  deleteDocument as deleteDocumentRow,
  findDocumentByFilename,
  findDocumentById,
  findFolder,
  findUpload,
  insertDocument,
  insertUpload,
  updateDocument as updateDocumentRow,
} from "./document.repo";
import { findFolderPath } from "./library.service";

const log = createLogger("hub-documents");

/** How long a place to upload stays valid. */
export const UPLOAD_TTL_SECONDS = 30 * 60;

/** How long the signed link for viewing or downloading stays valid. */
export const OPEN_TTL_SECONDS = 60;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HubError(
      "INVALID_INPUT",
      result.error.issues[0]?.message ?? "输入不对",
    );
  }
  return result.data;
}

export function requireStorage(storage: DocumentStorage | null): DocumentStorage {
  if (!storage) {
    throw new HubError("CONFLICT", "文件存储还没有配置，暂时不能上传或下载");
  }
  return storage;
}

/** Storage that a browser can send a file to; the database alone cannot. */
export function requireUploadStorage(
  storage: DocumentStorage | null,
): DocumentStorage {
  const store = requireStorage(storage);
  if (!store.canUpload) {
    throw new HubError(
      "CONFLICT",
      "上传文件需要先配置对象存储（bucket）；现在只能新建和编辑文本文档",
    );
  }
  return store;
}

/** Deleting a file nobody points at any more must never fail the request. */
export async function discardObject(
  storage: DocumentStorage | null,
  key: string,
): Promise<void> {
  if (!storage) return;
  await storage.delete(key).catch((error: unknown) => {
    log.warn({ err: error, key }, "Could not delete a stored document file");
  });
}

const titleSchema = z
  .string()
  .transform((value) => normaliseName(value, TITLE_MAX_LENGTH))
  .refine((value): value is string => value !== null, {
    message: `标题要填写，最多 ${TITLE_MAX_LENGTH} 个字`,
  });

const descriptionSchema = z
  .string()
  .max(DESCRIPTION_MAX_LENGTH, `说明最多 ${DESCRIPTION_MAX_LENGTH} 个字`)
  .transform((value) => value.trim() || null);

const idSchema = z.string().min(1).max(32);

/* ── uploading ───────────────────────────────────────────────────────── */

const prepareSchema = z.object({
  filename: z.string().min(1).max(300),
  size: z.number().int(),
  /** Set to replace the file of this document instead of adding a new one. */
  documentPublicId: idSchema.nullish(),
});

export interface PreparedUpload {
  uploadId: string;
  target: UploadTarget;
  expiresAt: Date;
  /** The name the file will be stored and listed under. */
  displayName: string;
}

/**
 * Step one of an upload: checks the file may be stored and hands back an
 * address for the browser to send the bytes to. Nothing is created yet, so
 * nothing is audited; the document appears (and is logged) in `completeUpload`.
 */
export async function prepareUpload(
  db: Db,
  storage: DocumentStorage | null,
  actor: AdminActor,
  rawInput: z.input<typeof prepareSchema>,
  now: Date = new Date(),
): Promise<PreparedUpload> {
  const store = requireUploadStorage(storage);
  const userId = requireUserId(actor);
  const input = parse(prepareSchema, rawInput);

  let documentId: number | null = null;
  if (input.documentPublicId) {
    const access = await loadReadable(db, actor, input.documentPublicId);
    requireEdit(access);
    documentId = access.row.id;
  } else if (!canCreateDocument(actor.role)) {
    throw new HubError("FORBIDDEN", "只有所有者和管理员能上传新文档");
  }

  const file = inspectFile({ filename: input.filename, size: input.size });
  if (!file.ok) throw new HubError("INVALID_INPUT", file.reason);

  const uploadId = generateUID();
  const key = storageKeyFor(file.ext, randomUUID());
  const expiresAt = new Date(now.getTime() + UPLOAD_TTL_SECONDS * 1000);

  await insertUpload(db, {
    publicId: uploadId,
    userId,
    documentId,
    storageKey: key,
    filename: file.displayName,
    ext: file.ext,
    contentType: file.contentType,
    size: input.size,
    expiresAt,
  });

  const target = await store.createUpload({
    key,
    uploadId,
    contentType: file.contentType,
    size: input.size,
    expiresInSeconds: UPLOAD_TTL_SECONDS,
  });
  return { uploadId, target, expiresAt, displayName: file.displayName };
}

const completeSchema = z.object({
  uploadId: idSchema,
  title: titleSchema.nullish(),
  description: descriptionSchema.nullish(),
  folderPublicId: idSchema.nullish(),
  /** Defaults to readable by everyone; false hides it from the start. */
  readable: z.boolean().optional(),
});

/**
 * Step two: the browser says it has sent the bytes. We check they are really
 * there and the size matches what we signed for, then create the document (or
 * swap the file of the existing one). Only an upload this person started, once,
 * before it expires, can be completed.
 */
export async function completeUpload(
  db: Db,
  storage: DocumentStorage | null,
  actor: AdminActor,
  rawInput: z.input<typeof completeSchema>,
  now: Date = new Date(),
): Promise<{ publicId: string }> {
  const store = requireUploadStorage(storage);
  const userId = requireUserId(actor);
  const input = parse(completeSchema, rawInput);

  const upload = await findUpload(db, input.uploadId);
  if (!upload || upload.userId !== userId) {
    throw new HubError("NOT_FOUND", "找不到这次上传，请重新选择文件");
  }
  if (upload.consumedAt) {
    throw new HubError("CONFLICT", "这次上传已经完成过了");
  }
  if (upload.expiresAt.getTime() < now.getTime()) {
    throw new HubError("INVALID_INPUT", "上传已过期，请重新选择文件");
  }

  // Rights are checked again now: they may have changed since step one.
  let existing: DocumentRow | null = null;
  if (upload.documentId !== null) {
    const row = await findDocumentById(db, upload.documentId);
    if (!row) throw new HubError("NOT_FOUND", "找不到这份文档");
    const access = await loadReadable(db, actor, row.publicId);
    requireEdit(access);
    existing = row;
  } else if (!canCreateDocument(actor.role)) {
    throw new HubError("FORBIDDEN", "只有所有者和管理员能上传新文档");
  }

  const stored = await store.stat(upload.storageKey);
  if (!stored) {
    throw new HubError("INVALID_INPUT", "文件还没有上传完成，请稍后再试");
  }
  if (stored.size !== upload.size || stored.size > MAX_FILE_BYTES) {
    await discardObject(store, upload.storageKey);
    throw new HubError("INVALID_INPUT", "文件大小对不上，请重新上传");
  }

  if (existing) {
    const target = existing;
    const oldKey = target.storageKey;
    await withAudit(
      db,
      async (tx) => {
        if (!(await consumeUpload(tx, upload.id, now))) {
          throw new HubError("CONFLICT", "这次上传已经完成过了");
        }
        await updateDocumentRow(
          tx,
          target.id,
          {
            filename: upload.filename,
            ext: upload.ext,
            contentType: upload.contentType,
            size: upload.size,
            sha256: null,
            storageKey: upload.storageKey,
          },
          now,
        );
      },
      () => ({
        actor,
        action: "document.file_replaced",
        entityType: "document",
        entityId: target.publicId,
        summary: `替换了「${target.title}」的文件：${upload.filename}`,
      }),
    );
    await discardObject(store, oldKey);
    return { publicId: target.publicId };
  }

  const folder = input.folderPublicId
    ? await findFolder(db, input.folderPublicId)
    : null;
  if (input.folderPublicId && !folder) {
    throw new HubError("NOT_FOUND", "找不到这个文件夹");
  }
  const title =
    input.title ??
    normaliseName(upload.filename.replace(/\.[^.]+$/, ""), TITLE_MAX_LENGTH) ??
    upload.filename;

  return withAudit(
    db,
    async (tx) => {
      if (!(await consumeUpload(tx, upload.id, now))) {
        throw new HubError("CONFLICT", "这次上传已经完成过了");
      }
      const created = await insertDocument(tx, {
        publicId: generateUID(),
        folderId: folder?.id ?? null,
        title,
        description: input.description ?? null,
        filename: upload.filename,
        ext: upload.ext,
        contentType: upload.contentType,
        size: upload.size,
        sha256: null,
        storageKey: upload.storageKey,
        readable: input.readable ?? true,
        uploadedBy: userId,
        now,
      });
      // The person who adds a document can change it afterwards.
      await addEditor(tx, {
        documentId: created.id,
        userId,
        grantedBy: userId,
      });
      return { publicId: created.publicId };
    },
    (result) => ({
      actor,
      action: "document.created",
      entityType: "document",
      entityId: result.publicId,
      summary: `上传了「${title}」（${upload.filename}）`,
    }),
  );
}

/* ── changing ────────────────────────────────────────────────────────── */

const updateSchema = z.object({
  documentPublicId: idSchema,
  title: titleSchema.optional(),
  description: descriptionSchema.nullish(),
  /** `null` moves it to the top level. */
  folderPublicId: idSchema.nullish(),
  readable: z.boolean().optional(),
});

export async function updateDocument(
  db: Db,
  actor: AdminActor,
  rawInput: z.input<typeof updateSchema>,
  now: Date = new Date(),
): Promise<void> {
  const input = parse(updateSchema, rawInput);
  const access = await loadReadable(db, actor, input.documentPublicId);
  requireEdit(access);
  const { row } = access;

  const patch: Parameters<typeof updateDocumentRow>[2] = {};
  const changes: string[] = [];

  if (input.title !== undefined && input.title !== row.title) {
    patch.title = input.title;
    changes.push(`标题改为「${input.title}」`);
  }
  if (input.description !== undefined) {
    const next = input.description ?? null;
    if (next !== row.description) {
      patch.description = next;
      changes.push("修改了说明");
    }
  }
  if (input.folderPublicId !== undefined) {
    const folder = input.folderPublicId
      ? await findFolder(db, input.folderPublicId)
      : null;
    if (input.folderPublicId && !folder) {
      throw new HubError("NOT_FOUND", "找不到这个文件夹");
    }
    if ((folder?.id ?? null) !== row.folderId) {
      patch.folderId = folder?.id ?? null;
      changes.push(folder ? `移到文件夹「${folder.name}」` : "移到最上层");
    }
  }
  const readableChanged =
    input.readable !== undefined && input.readable !== row.readable;
  if (readableChanged) patch.readable = input.readable;

  if (changes.length === 0 && !readableChanged) return;

  await db.transaction(async (tx) => {
    await updateDocumentRow(tx, row.id, patch, now);
    if (changes.length > 0) {
      await recordAudit(tx, {
        actor,
        action: "document.updated",
        entityType: "document",
        entityId: row.publicId,
        summary: `「${row.title}」：${changes.join("，")}`,
      });
    }
    if (readableChanged) {
      await recordAudit(tx, {
        actor,
        action: "document.readable_changed",
        entityType: "document",
        entityId: row.publicId,
        summary: `「${row.title}」${input.readable ? "设为所有成员可读" : "设为仅编辑者可见"}`,
      });
    }
  });
}

export async function deleteDocument(
  db: Db,
  storage: DocumentStorage | null,
  actor: AdminActor,
  documentPublicId: string,
): Promise<void> {
  const access = await loadReadable(db, actor, documentPublicId);
  requireEdit(access);
  const { row } = access;

  await withAudit(
    db,
    (tx) => deleteDocumentRow(tx, row.id),
    () => ({
      actor,
      action: "document.deleted",
      entityType: "document",
      entityId: row.publicId,
      summary: `删除了「${row.title}」（${row.filename}）`,
    }),
  );
  await discardObject(storage, row.storageKey);
}

/* ── viewing and downloading ─────────────────────────────────────────── */

export type OpenMode = "view" | "download";

export interface OpenedDocument {
  source: DocumentSource;
  /** What the browser is told the bytes are. */
  contentType: string;
  disposition: string;
  /** How it will be shown, so the route can add the right protections. */
  mode: OpenMode;
  ext: string;
}

/**
 * Hands a signed-in reader the file: a short-lived signed link, or the bytes
 * to stream. Viewing is only for formats we know how to show safely; those are
 * served as the type we decide, never the one the uploader claimed.
 */
export async function openDocument(
  db: Db,
  storage: DocumentStorage | null,
  actor: AdminActor,
  input: { documentPublicId: string; mode: OpenMode },
): Promise<OpenedDocument> {
  const store = requireStorage(storage);
  const { row } = await loadReadable(db, actor, input.documentPublicId);

  let contentType = row.contentType;
  if (input.mode === "view") {
    const viewType = viewContentType(row.ext);
    if (!viewType) {
      throw new HubError("INVALID_INPUT", "这种格式不能在线预览，请下载后查看");
    }
    contentType = viewType;
  }
  const disposition = contentDisposition(
    input.mode === "view" ? "inline" : "attachment",
    row.filename,
  );

  const source = await store.open({
    key: row.storageKey,
    contentType,
    disposition,
    expiresInSeconds: OPEN_TTL_SECONDS,
  });
  return { source, contentType, disposition, mode: input.mode, ext: row.ext };
}

/* ── import (operations command line) ────────────────────────────────── */

export type ImportStatus = "created" | "updated" | "unchanged";

/**
 * What `importDocument` would do with this file, without doing it: for the
 * import command's dry run. Reads only.
 */
export async function previewImport(
  db: Db,
  input: { folderNames: string[]; filename: string; bytes: Buffer },
): Promise<ImportStatus> {
  const file = inspectFile({
    filename: input.filename,
    size: input.bytes.length,
  });
  if (!file.ok)
    throw new HubError("INVALID_INPUT", `${input.filename}：${file.reason}`);

  const folder = await findFolderPath(db, input.folderNames);
  if (!folder.exists) return "created";
  const existing = await findDocumentByFilename(
    db,
    folder.folderId,
    file.displayName,
  );
  if (!existing) return "created";
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  return existing.sha256 === sha256 ? "unchanged" : "updated";
}

/**
 * Adds a file the server already has in memory, for the import command. It
 * makes no permission check and is idempotent: a file with the same name in
 * the same folder is left alone when its bytes are identical, and replaced
 * when they differ.
 */
export async function importDocument(
  db: Db,
  storage: DocumentStorage,
  actor: AuditActor,
  input: {
    folderPublicId: string | null;
    filename: string;
    title?: string;
    description?: string | null;
    bytes: Buffer;
  },
  now: Date = new Date(),
): Promise<{ status: ImportStatus; publicId: string }> {
  const file = inspectFile({
    filename: input.filename,
    size: input.bytes.length,
  });
  if (!file.ok)
    throw new HubError("INVALID_INPUT", `${input.filename}：${file.reason}`);

  const folder = input.folderPublicId
    ? await findFolder(db, input.folderPublicId)
    : null;
  if (input.folderPublicId && !folder) {
    throw new HubError("NOT_FOUND", "找不到这个文件夹");
  }

  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await findDocumentByFilename(
    db,
    folder?.id ?? null,
    file.displayName,
  );
  if (existing?.sha256 === sha256) {
    return { status: "unchanged", publicId: existing.publicId };
  }

  const key = storageKeyFor(file.ext, randomUUID());
  await storage.put({ key, body: input.bytes, contentType: file.contentType });

  try {
    if (existing) {
      const oldKey = existing.storageKey;
      await withAudit(
        db,
        (tx) =>
          updateDocumentRow(
            tx,
            existing.id,
            {
              filename: file.displayName,
              ext: file.ext,
              contentType: file.contentType,
              size: input.bytes.length,
              sha256,
              storageKey: key,
            },
            now,
          ),
        () => ({
          actor,
          action: "document.file_replaced",
          entityType: "document",
          entityId: existing.publicId,
          summary: `导入时替换了「${existing.title}」的文件：${file.displayName}`,
        }),
      );
      await discardObject(storage, oldKey);
      return { status: "updated", publicId: existing.publicId };
    }

    const title =
      normaliseName(
        input.title ?? file.displayName.replace(/\.[^.]+$/, ""),
        TITLE_MAX_LENGTH,
      ) ?? file.displayName;
    const created = await withAudit(
      db,
      async (tx) => {
        const row = await insertDocument(tx, {
          publicId: generateUID(),
          folderId: folder?.id ?? null,
          title,
          description: input.description ?? null,
          filename: file.displayName,
          ext: file.ext,
          contentType: file.contentType,
          size: input.bytes.length,
          sha256,
          storageKey: key,
          readable: true,
          uploadedBy: actor.userId,
          now,
        });
        if (actor.userId) {
          await addEditor(tx, {
            documentId: row.id,
            userId: actor.userId,
            grantedBy: actor.userId,
          });
        }
        return row;
      },
      (row) => ({
        actor,
        action: "document.created",
        entityType: "document",
        entityId: row.publicId,
        summary: `导入了「${title}」（${file.displayName}）`,
      }),
    );
    return { status: "created", publicId: created.publicId };
  } catch (error) {
    await discardObject(storage, key);
    throw error;
  }
}
