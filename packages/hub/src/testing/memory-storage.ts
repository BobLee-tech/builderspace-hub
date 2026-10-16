import { Readable } from "node:stream";

import type { DocumentSource, DocumentStorage } from "../documents/storage";

/**
 * Storage that keeps content in a Map, for tests that want to look at what was
 * stored (`files`) without going through the database.
 */
export class MemoryDocumentStorage implements DocumentStorage {
  readonly name = "db" as const;
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  stat(key: string): Promise<{ size: number } | null> {
    const file = this.files.get(key);
    return Promise.resolve(file ? { size: file.body.length } : null);
  }

  put(input: {
    key: string;
    body: Buffer;
    contentType: string;
  }): Promise<void> {
    this.files.set(input.key, {
      body: input.body,
      contentType: input.contentType,
    });
    return Promise.resolve();
  }

  read(key: string): Promise<Buffer> {
    const file = this.files.get(key);
    return file
      ? Promise.resolve(file.body)
      : Promise.reject(new Error("No such object"));
  }

  open(input: { key: string }): Promise<DocumentSource> {
    const file = this.files.get(input.key);
    if (!file) return Promise.reject(new Error("No such object"));
    return Promise.resolve({
      kind: "stream",
      body: Readable.from([file.body]),
      size: file.body.length,
    });
  }

  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }
}
