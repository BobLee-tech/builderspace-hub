import { Readable } from "node:stream";
import { eq, sql } from "drizzle-orm";

import type { Db } from "../db";
import type { DocumentSource, DocumentStorage } from "./storage";
import { hubDocumentBlobs } from "../schema/documents";
import { HubError } from "../shared/errors";
import { MAX_TEXT_BYTES } from "./document.policy";

/** The largest content the database will hold: the same cap as the editor. */
export const DB_STORAGE_MAX_BYTES = MAX_TEXT_BYTES;

/** Keeps document content in the `hub_document_blob` table. */
export class DatabaseDocumentStorage implements DocumentStorage {
  readonly name = "db" as const;

  constructor(private readonly db: Db) {}

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
        "INVALID_INPUT",
        `内容有 ${Math.ceil(input.body.length / 1024)} KB，超过了 ${DB_STORAGE_MAX_BYTES / 1024} KB 的上限`,
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

  async read(key: string): Promise<Buffer> {
    const [row] = await this.db
      .select({ body: hubDocumentBlobs.body })
      .from(hubDocumentBlobs)
      .where(eq(hubDocumentBlobs.storageKey, key));
    if (!row) throw new Error("No such object");
    return Buffer.from(row.body);
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
