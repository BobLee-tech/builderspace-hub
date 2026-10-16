import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { getDocumentDetail, getLibrary } from "./library.service";
import { getDocumentStorage } from "./storage.config";
import { DatabaseDocumentStorage, DB_STORAGE_MAX_BYTES } from "./storage.db";
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
  it("stores, sizes, reads, replaces and deletes content", async () => {
    const storage = new DatabaseDocumentStorage(db);
    expect(await storage.stat(KEY)).toBeNull();

    await storage.put({
      key: KEY,
      body: bytes("你好"),
      contentType: "text/markdown",
    });
    expect(await storage.stat(KEY)).toEqual({ size: 6 }); // bytes, not characters
    expect((await storage.read(KEY)).toString("utf8")).toBe("你好");

    await storage.put({
      key: KEY,
      body: bytes("改了"),
      contentType: "text/markdown",
    });
    expect((await storage.read(KEY)).toString("utf8")).toBe("改了");

    await storage.delete(KEY);
    expect(await storage.stat(KEY)).toBeNull();
    await expect(storage.read(KEY)).rejects.toThrow("No such object");
  });

  it("hands a reader the bytes to stream", async () => {
    const storage = new DatabaseDocumentStorage(db);
    await storage.put({
      key: KEY,
      body: bytes("abc"),
      contentType: "text/plain",
    });
    const source = await storage.open({ key: KEY });
    expect(source).toMatchObject({ kind: "stream", size: 3 });
    const chunks: Buffer[] = [];
    for await (const chunk of source.body) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe("abc");
  });

  it("refuses content over the limit and stores nothing", async () => {
    const storage = new DatabaseDocumentStorage(db);
    await expect(
      storage.put({
        key: KEY,
        body: Buffer.alloc(DB_STORAGE_MAX_BYTES + 1),
        contentType: "x/y",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await storage.stat(KEY)).toBeNull();
  });
});

describe("getDocumentStorage", () => {
  it("is the database, with nothing to configure", () => {
    expect(getDocumentStorage(db).name).toBe("db");
  });
});

describe("documents without any object storage", () => {
  it("are written, read and edited in the database", async () => {
    const storage = getDocumentStorage(db);
    const created = await createTextDocument(db, storage, owner, {
      title: "讲稿",
      filename: "讲稿.md",
      content: "# 讲稿",
      readable: false,
    });
    expect(
      (await readTextContent(db, storage, owner, created.publicId)).content,
    ).toBe("# 讲稿");
    await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "# 新稿",
    });
    expect(
      (await readTextContent(db, storage, owner, created.publicId)).content,
    ).toBe("# 新稿");

    const library = await getLibrary(db, storage, owner, {});
    expect(library.canCreate).toBe(true);
    const detail = await getDocumentDetail(
      db,
      storage,
      owner,
      created.publicId,
    );
    expect(detail).toMatchObject({ canEditText: true, preview: "markdown" });
  });
});
