import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { findDocument } from "./document.repo";
import { prepareUpload } from "./document.service";
import { getDocumentDetail, getLibrary } from "./library.service";
import {
  DatabaseDocumentStorage,
  DatabaseFirstDocumentStorage,
  DB_STORAGE_MAX_BYTES,
} from "./storage.db";
import { getDocumentStorage } from "./storage.config";
import {
  createTextDocument,
  readTextContent,
  replaceTextContent,
} from "./text.service";

let db: Db;
let owner: AdminActor;

beforeEach(async () => {
  db = await createHubTestDb();
  const user = await seedUser(db, { name: "Olivia" });
  await seedHubAccount(db, user.id, { role: "owner" });
  owner = { userId: user.id, email: user.email, role: "owner" };
});

const bytes = (text: string) => Buffer.from(text, "utf8");
const KEY = "documents/abcdef12-0000.md";

describe("DatabaseDocumentStorage", () => {
  it("stores, sizes, reads, replaces and deletes a file", async () => {
    const storage = new DatabaseDocumentStorage(db);
    expect(await storage.stat(KEY)).toBeNull();

    await storage.put({ key: KEY, body: bytes("你好"), contentType: "text/markdown" });
    expect(await storage.stat(KEY)).toEqual({ size: 6 }); // bytes, not characters
    expect((await storage.read(KEY)).toString("utf8")).toBe("你好");

    await storage.put({ key: KEY, body: bytes("改了"), contentType: "text/markdown" });
    expect((await storage.read(KEY)).toString("utf8")).toBe("改了");

    await storage.delete(KEY);
    expect(await storage.stat(KEY)).toBeNull();
    await expect(storage.read(KEY)).rejects.toThrow("No such object");
  });

  it("hands a reader the bytes to stream, not a link", async () => {
    const storage = new DatabaseDocumentStorage(db);
    await storage.put({ key: KEY, body: bytes("abc"), contentType: "text/plain" });
    const source = await storage.open({ key: KEY });
    expect(source).toMatchObject({ kind: "stream", size: 3 });
    const chunks: Buffer[] = [];
    if (source.kind === "stream") for await (const chunk of source.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("abc");
  });

  it("refuses a file too big for the database, and offers no upload address", async () => {
    const storage = new DatabaseDocumentStorage(db);
    await expect(
      storage.put({ key: KEY, body: Buffer.alloc(DB_STORAGE_MAX_BYTES + 1), contentType: "x/y" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await storage.stat(KEY)).toBeNull();
    expect(storage.canUpload).toBe(false);
    await expect(
      storage.createUpload({ key: KEY, uploadId: "u", contentType: "x/y", size: 1, expiresInSeconds: 60 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("with a bucket behind it", () => {
  it("writes to the bucket, but still reads what is already in the database", async () => {
    const database = new DatabaseDocumentStorage(db);
    const bucket = new MemoryDocumentStorage();
    const storage = new DatabaseFirstDocumentStorage(database, bucket);
    expect(storage.canUpload).toBe(true);
    expect(storage.name).toBe("memory");

    await database.put({ key: "documents/old.md", body: bytes("在数据库里"), contentType: "text/markdown" });
    await storage.put({ key: "documents/new.md", body: bytes("在桶里"), contentType: "text/markdown" });

    expect(bucket.files.has("documents/new.md")).toBe(true);
    expect(bucket.files.has("documents/old.md")).toBe(false);
    expect((await storage.read("documents/old.md")).toString()).toBe("在数据库里");
    expect((await storage.read("documents/new.md")).toString()).toBe("在桶里");
    expect(await storage.stat("documents/old.md")).toEqual({ size: 15 });
    expect(await storage.stat("documents/new.md")).toEqual({ size: 9 });
    expect(await storage.stat("documents/none.md")).toBeNull();

    const old = await storage.open({ key: "documents/old.md", contentType: "x/y", disposition: "inline", expiresInSeconds: 60 });
    expect(old.kind).toBe("stream");
    const fresh = await storage.open({ key: "documents/new.md", contentType: "x/y", disposition: "inline", expiresInSeconds: 60 });
    expect(fresh.kind).toBe("redirect");

    await storage.delete("documents/old.md");
    await storage.delete("documents/new.md");
    expect(await database.stat("documents/old.md")).toBeNull();
    expect(bucket.files.size).toBe(0);
  });

  it("takes uploads through the bucket", async () => {
    const storage = new DatabaseFirstDocumentStorage(new DatabaseDocumentStorage(db), new MemoryDocumentStorage());
    const target = await storage.createUpload({ key: "documents/x.pdf", uploadId: "u", contentType: "application/pdf", size: 4, expiresInSeconds: 60 });
    expect(target.url).toContain("memory://upload/");
  });
});

describe("getDocumentStorage", () => {
  it("is never missing: the database holds text documents when no bucket is configured", () => {
    const storage = getDocumentStorage(db);
    expect(storage.name).toBe("db");
    expect(storage.canUpload).toBe(false);
  });
});

describe("a Hub without a bucket", () => {
  it("lets text documents be written, read and edited, and says plainly that uploads need a bucket", async () => {
    const storage = getDocumentStorage(db);
    const created = await createTextDocument(db, storage, owner, {
      title: "讲稿",
      filename: "讲稿.md",
      content: "# 讲稿",
      readable: false,
    });
    expect((await readTextContent(db, storage, owner, created.publicId)).content).toBe("# 讲稿");
    await replaceTextContent(db, storage, owner, { documentPublicId: created.publicId, content: "# 新稿" });
    expect((await readTextContent(db, storage, owner, created.publicId)).content).toBe("# 新稿");

    const library = await getLibrary(db, storage, owner, {});
    expect(library).toMatchObject({ textAvailable: true, uploadsAvailable: false });
    const detail = await getDocumentDetail(db, storage, owner, created.publicId);
    expect(detail).toMatchObject({ canEditText: true, canReplace: false });

    await expect(
      prepareUpload(db, storage, owner, { filename: "合同.pdf", size: 10 }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("对象存储") as string,
    });
  });

  it("keeps working after a bucket is added: old text stays readable, new files go to the bucket", async () => {
    const withoutBucket = getDocumentStorage(db);
    const created = await createTextDocument(db, withoutBucket, owner, { title: "旧", filename: "旧.md", content: "老内容" });

    const bucket = new MemoryDocumentStorage();
    const withBucket = new DatabaseFirstDocumentStorage(new DatabaseDocumentStorage(db), bucket);
    expect((await readTextContent(db, withBucket, owner, created.publicId)).content).toBe("老内容");

    const before = await findDocument(db, created.publicId);
    if (!before) throw new Error("document missing");
    const database = new DatabaseDocumentStorage(db);
    expect(await database.stat(before.storageKey)).not.toBeNull();

    await replaceTextContent(db, withBucket, owner, { documentPublicId: created.publicId, content: "新内容" });
    expect((await readTextContent(db, withBucket, owner, created.publicId)).content).toBe("新内容");
    expect(bucket.files.size).toBe(1); // the new text went to the bucket
    expect(await database.stat(before.storageKey)).toBeNull(); // and the old copy left the database
  });
});
