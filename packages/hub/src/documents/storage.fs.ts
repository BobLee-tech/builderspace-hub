import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

import type { DocumentSource, DocumentStorage, UploadTarget } from "./storage";

/** The only shape of key this driver touches: no separators, no dots to climb. */
const KEY_PATTERN = /^documents\/[A-Za-z0-9-]{8,64}\.[a-z0-9]{1,8}$/;

/** Path the browser sends a file to when storage is a folder on disk. */
export const FS_UPLOAD_PATH = "/api/hub/documents/uploads";

/**
 * A folder on disk standing in for a bucket, for development on a machine with
 * none. The server itself receives and serves the bytes, so it must never be
 * used in production: a serverless function has no disk worth keeping and
 * cannot take large bodies.
 */
export class FsDocumentStorage implements DocumentStorage {
  readonly name = "fs" as const;
  readonly canUpload = true;
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private pathOf(key: string): string {
    if (!KEY_PATTERN.test(key)) throw new Error("Bad document storage key");
    return path.join(this.root, key);
  }

  createUpload(input: {
    uploadId: string;
    contentType: string;
  }): Promise<UploadTarget> {
    return Promise.resolve({
      method: "PUT",
      url: `${FS_UPLOAD_PATH}/${encodeURIComponent(input.uploadId)}`,
      headers: { "Content-Type": input.contentType },
    });
  }

  /**
   * Writes an incoming body to `key`, giving up (and leaving nothing behind)
   * when it runs past `maxBytes`.
   */
  async writeStream(key: string, body: Readable, maxBytes: number) {
    const target = this.pathOf(key);
    await mkdir(path.dirname(target), { recursive: true });
    let written = 0;
    body.on("data", (chunk: Buffer) => {
      written += chunk.length;
      if (written > maxBytes) body.destroy(new Error("Body too large"));
    });
    try {
      await pipeline(body, createWriteStream(target));
    } catch (error) {
      await rm(target, { force: true });
      throw error;
    }
  }

  async stat(key: string): Promise<{ size: number } | null> {
    try {
      const info = await stat(this.pathOf(key));
      return { size: info.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async put(input: { key: string; body: Buffer }): Promise<void> {
    const target = this.pathOf(input.key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, input.body);
  }

  read(key: string): Promise<Buffer> {
    return readFile(this.pathOf(key));
  }

  async open(input: { key: string }): Promise<DocumentSource> {
    const target = this.pathOf(input.key);
    const info = await stat(target);
    return { kind: "stream", body: createReadStream(target), size: info.size };
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
  }
}
