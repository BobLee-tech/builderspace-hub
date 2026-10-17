import type { Readable } from "node:stream";

/**
 * Where document content lives. Documents are Markdown and HTML written in
 * the page, so the content is small and sits in the database
 * (`storage.db.ts`); the `hub_document` row holds the details and a key, and
 * this interface turns the key into bytes.
 */
export interface DocumentStorage {
  readonly name: "db";

  /** The stored object's size, or null when nothing is stored under `key`. */
  stat(key: string): Promise<{ size: number } | null>;

  /** Stores (or replaces) the bytes under `key`. */
  put(input: { key: string; body: Buffer; contentType: string }): Promise<void>;

  /** The whole object. Documents are small; this is not for large files. */
  read(key: string): Promise<Buffer>;

  /** The bytes, ready to stream to a signed-in reader. */
  open(input: { key: string }): Promise<DocumentSource>;

  delete(key: string): Promise<void>;
}

export interface DocumentSource {
  kind: "stream";
  body: Readable;
  size: number;
}
