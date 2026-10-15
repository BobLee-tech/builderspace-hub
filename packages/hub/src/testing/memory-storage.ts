import { Readable } from "node:stream";

import type {
  DocumentSource,
  DocumentStorage,
  UploadTarget,
} from "../documents/storage";

/**
 * Storage that keeps files in a Map, for tests. `uploadFromBrowser` plays the
 * part of the browser sending bytes to the address `createUpload` returned.
 */
export class MemoryDocumentStorage implements DocumentStorage {
  readonly name = "memory" as const;
  readonly canUpload = true;
  readonly files = new Map<string, { body: Buffer; contentType: string }>();

  createUpload(input: {
    key: string;
    contentType: string;
  }): Promise<UploadTarget> {
    return Promise.resolve({
      method: "PUT",
      url: `memory://upload/${input.key}`,
      headers: { "Content-Type": input.contentType },
    });
  }

  uploadFromBrowser(key: string, body: Buffer, contentType = "x/y"): void {
    this.files.set(key, { body, contentType });
  }

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
    return file ? Promise.resolve(file.body) : Promise.reject(new Error("No such object"));
  }

  open(input: {
    key: string;
    contentType: string;
    disposition: string;
  }): Promise<DocumentSource> {
    const file = this.files.get(input.key);
    if (!file) return Promise.reject(new Error("No such object"));
    return Promise.resolve({
      kind: "redirect",
      url: `memory://file/${input.key}?type=${encodeURIComponent(input.contentType)}&disposition=${encodeURIComponent(input.disposition)}`,
    });
  }

  stream(key: string): Readable {
    const file = this.files.get(key);
    if (!file) throw new Error("No such object");
    return Readable.from([file.body]);
  }

  delete(key: string): Promise<void> {
    this.files.delete(key);
    return Promise.resolve();
  }
}
