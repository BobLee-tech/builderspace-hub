import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { FS_UPLOAD_PATH, FsDocumentStorage } from "./storage.fs";

let dir: string;
let storage: FsDocumentStorage;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "hub-docs-"));
  storage = new FsDocumentStorage(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const KEY = "documents/0a1b2c3d-4e5f.pdf";

const read = async (body: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of body) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks).toString();
};

describe("FsDocumentStorage", () => {
  it("sends uploads to the server's own route", async () => {
    const target = await storage.createUpload({
      uploadId: "up 1",
      contentType: "application/pdf",
    });
    expect(target).toEqual({
      method: "PUT",
      url: `${FS_UPLOAD_PATH}/up%201`,
      headers: { "Content-Type": "application/pdf" },
    });
  });

  it("stores, finds, serves and deletes a file", async () => {
    await expect(storage.stat(KEY)).resolves.toBeNull();

    await storage.put({ key: KEY, body: Buffer.from("hello") });
    await expect(storage.stat(KEY)).resolves.toEqual({ size: 5 });

    const source = await storage.open({ key: KEY });
    expect(source.kind).toBe("stream");
    if (source.kind === "stream") {
      expect(source.size).toBe(5);
      expect(await read(source.body)).toBe("hello");
    }

    await storage.delete(KEY);
    await expect(storage.stat(KEY)).resolves.toBeNull();
  });

  it("writes an incoming stream, and removes it when it is too big", async () => {
    await storage.writeStream(KEY, Readable.from([Buffer.from("abc")]), 10);
    expect(await readFile(path.join(dir, KEY), "utf8")).toBe("abc");

    const big = "documents/ffffffff-0000.pdf";
    await expect(
      storage.writeStream(big, Readable.from([Buffer.alloc(50)]), 10),
    ).rejects.toThrow();
    await expect(storage.stat(big)).resolves.toBeNull();
  });

  it("refuses keys that could leave the folder", async () => {
    for (const key of [
      "../etc/passwd",
      "documents/../../x.pdf",
      "documents/a/b.pdf",
      "other/0a1b2c3d-4e5f.pdf",
      "documents/short.pdf",
    ]) {
      await expect(storage.stat(key)).rejects.toThrow(
        "Bad document storage key",
      );
    }
  });
});
