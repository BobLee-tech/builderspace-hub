import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db";
import type {
  CreateUploadInput,
  DocumentSource,
  DocumentStorage,
  UploadTarget,
} from "./storage";
import { hubDocumentBlobs } from "../schema/documents";
import { HubError } from "../shared/errors";

/** The largest file the database will hold. Text documents are far smaller. */
export const DB_STORAGE_MAX_BYTES = 1024 * 1024;

const NO_UPLOADS =
  "上传文件需要先配置对象存储（bucket）；现在只能新建和编辑文本文档";

/**
 * Keeps small files in the database. It has no address a browser can send a
 * file to, so uploads are not offered (`canUpload` is false); text documents
 * are written by the server itself, which is all this is for.
 */
export class DatabaseDocumentStorage implements DocumentStorage {
  readonly name = "db" as const;
  readonly canUpload = false;

  constructor(private readonly db: Db) {}

  createUpload(_input: CreateUploadInput): Promise<UploadTarget> {
    return Promise.reject(new HubError("CONFLICT", NO_UPLOADS));
  }

  async stat(key: string): Promise<{ size: number } | null> {
    const [row] = await this.db
      .select({ size: sql<number>`octet_length(${hubDocumentBlobs.body})` })
      .from(hubDocumentBlobs)
      .where(eq(hubDocumentBlobs.storageKey, key));
    return row ? { size: Number(row.size) } : null;
  }

  async put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    if (input.body.length > DB_STORAGE_MAX_BYTES) {
      throw new HubError(
        "CONFLICT",
        `这个文件有 ${Math.ceil(input.body.length / 1024)} KB，太大了，不能存在数据库里；请先配置对象存储（bucket）`,
      );
    }
    await this.db
      .insert(hubDocumentBlobs)
      .values({
        storageKey: input.key,
        body: input.body,
        contentType: input.contentType,
      })
      .onConflictDoUpdate({
        target: hubDocumentBlobs.storageKey,
        set: { body: input.body, contentType: input.contentType },
      });
  }

  /** The bytes, or null when this storage does not hold `key`. */
  async tryRead(key: string): Promise<Buffer | null> {
    const [row] = await this.db
      .select({ body: hubDocumentBlobs.body })
      .from(hubDocumentBlobs)
      .where(eq(hubDocumentBlobs.storageKey, key));
    return row ? Buffer.from(row.body) : null;
  }

  async read(key: string): Promise<Buffer> {
    const body = await this.tryRead(key);
    if (!body) throw new Error("No such object");
    return body;
  }

  async open(input: { key: string }): Promise<DocumentSource> {
    const body = await this.read(input.key);
    return { kind: "stream", body: Readable.from([body]), size: body.length };
  }

  async delete(key: string): Promise<void> {
    await this.db
      .delete(hubDocumentBlobs)
      .where(eq(hubDocumentBlobs.storageKey, key));
  }
}

/**
 * The database in front of an object store, or on its own. Files already in
 * the database stay readable after a bucket is configured; new files go to the
 * bucket when there is one, so nothing needs migrating.
 */
export class DatabaseFirstDocumentStorage implements DocumentStorage {
  readonly name: DocumentStorage["name"];
  readonly canUpload: boolean;

  constructor(
    private readonly database: DatabaseDocumentStorage,
    private readonly primary: DocumentStorage | null,
  ) {
    this.name = primary?.name ?? "db";
    this.canUpload = primary?.canUpload ?? false;
  }

  private get writer(): DocumentStorage {
    return this.primary ?? this.database;
  }

  createUpload(input: CreateUploadInput): Promise<UploadTarget> {
    return this.writer.createUpload(input);
  }

  async stat(key: string): Promise<{ size: number } | null> {
    return (
      (await this.database.stat(key)) ?? (await this.primary?.stat(key)) ?? null
    );
  }

  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    return this.writer.put(input);
  }

  async read(key: string): Promise<Buffer> {
    const own = await this.database.tryRead(key);
    if (own) return own;
    if (!this.primary) throw new Error("No such object");
    return this.primary.read(key);
  }

  async open(input: {
    key: string;
    contentType: string;
    disposition: string;
    expiresInSeconds: number;
  }): Promise<DocumentSource> {
    const own = await this.database.tryRead(input.key);
    if (own) {
      return { kind: "stream", body: Readable.from([own]), size: own.length };
    }
    if (!this.primary) throw new Error("No such object");
    return this.primary.open(input);
  }

  async delete(key: string): Promise<void> {
    await this.database.delete(key);
    await this.primary?.delete(key);
  }
}
