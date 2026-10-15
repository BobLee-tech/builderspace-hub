import type { Readable } from "node:stream";

/**
 * Where document bytes live. The database never holds file contents; it holds
 * a key, and this interface turns a key into bytes.
 *
 * Production uses an S3-compatible bucket and the browser sends files straight
 * to it (a serverless function cannot take a request body over a few MB).
 * Local development has no bucket, so a folder on disk stands in for one.
 */
export interface DocumentStorage {
  readonly name: "s3" | "fs" | "memory";

  /** A place the browser can send one file to. */
  createUpload(input: CreateUploadInput): Promise<UploadTarget>;

  /** The stored object's size, or null when nothing is stored under `key`. */
  stat(key: string): Promise<{ size: number } | null>;

  /** Stores bytes the server already has (the import command). */
  put(input: { key: string; body: Buffer; contentType: string }): Promise<void>;

  /**
   * The whole object, for the few places the server itself reads a file (text
   * documents opened from the command line or edited in the page). Callers
   * check the size first; this is not for large files.
   */
  read(key: string): Promise<Buffer>;

  /** How to hand a stored file to a signed-in reader. */
  open(input: {
    key: string;
    contentType: string;
    disposition: string;
    expiresInSeconds: number;
  }): Promise<DocumentSource>;

  delete(key: string): Promise<void>;
}

export interface CreateUploadInput {
  key: string;
  /** Public id of the upload record; the disk driver routes by it. */
  uploadId: string;
  contentType: string;
  size: number;
  expiresInSeconds: number;
}

export interface UploadTarget {
  method: "PUT";
  url: string;
  /** Headers the browser must send with the bytes. */
  headers: Record<string, string>;
}

/**
 * A short-lived signed address for the file (bucket storage), or the bytes
 * themselves for the server to stream (disk storage).
 */
export type DocumentSource =
  | { kind: "redirect"; url: string }
  | { kind: "stream"; body: Readable; size: number };
