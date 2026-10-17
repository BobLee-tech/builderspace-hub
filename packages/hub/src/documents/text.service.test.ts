import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { listAudit } from "../audit";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { MAX_TEXT_BYTES } from "./document.policy";
import {
  findDocument,
  updateDocument as updateDocumentRow,
} from "./document.repo";
import { openDocument, updateDocument } from "./document.service";
import { getDocumentDetail, getLibrary } from "./library.service";
import {
  createTextDocument,
  readTextContent,
  replaceTextContent,
} from "./text.service";

let db: Db;
let storage: MemoryDocumentStorage;
let owner: AdminActor;
let admin: AdminActor;
let member: AdminActor;

const actorOf = (
  user: { id: string; email: string },
  role: AdminActor["role"],
): AdminActor => ({ userId: user.id, email: user.email, role });

beforeEach(async () => {
  db = await createHubTestDb();
  storage = new MemoryDocumentStorage();
  const [o, a, m] = await Promise.all([
    seedUser(db, { name: "Olivia" }),
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Mia" }),
  ]);
  await seedHubAccount(db, o.id, { role: "owner" });
  await seedHubAccount(db, a.id, { role: "admin" });
  owner = actorOf(o, "owner");
  admin = actorOf(a, "admin");
  member = actorOf(m, null);
});

const make = (actor: AdminActor, extra: Record<string, unknown> = {}) =>
  createTextDocument(db, storage, actor, {
    title: "讲稿",
    filename: "讲稿.md",
    content: "# 讲稿\n\n大家好",
    ...extra,
  });

describe("createTextDocument", () => {
  it("stores the text, makes the creator an editor, and logs it", async () => {
    const created = await make(admin);

    const detail = await getDocumentDetail(
      db,
      storage,
      admin,
      created.publicId,
    );
    expect(detail).toMatchObject({
      title: "讲稿",
      filename: "讲稿.md",
      ext: "md",
      readable: true,
      canEdit: true,
    });
    expect(storage.files.size).toBe(1);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "document.created",
      entityId: created.publicId,
    });
  });

  it("can start out hidden, and then only people who can change it see it", async () => {
    const created = await make(owner, { readable: false });
    expect((await getLibrary(db, storage, member, {})).documents).toHaveLength(
      0,
    );
    await expect(
      getDocumentDetail(db, storage, member, created.publicId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect((await getLibrary(db, storage, owner, {})).documents).toHaveLength(
      1,
    );
  });

  it("is for owners and admins only", async () => {
    await expect(make(member)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.files.size).toBe(0);
  });

  it("refuses formats that are not text, empty or oversized content, and unknown folders", async () => {
    await expect(make(owner, { filename: "合同.pdf" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(make(owner, { filename: "run.exe" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(make(owner, { content: "" })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      make(owner, { content: "x".repeat(MAX_TEXT_BYTES + 1) }),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(make(owner, { title: "   " })).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      make(owner, { folderPublicId: "nope00000000" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(storage.files.size).toBe(0);
  });

  it("needs a storage", async () => {
    await expect(
      createTextDocument(db, null, owner, {
        title: "t",
        filename: "t.md",
        content: "x",
      }),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  });

  it("takes only Markdown and HTML", async () => {
    for (const filename of ["t.pdf", "t.txt", "t.csv", "t.docx", "t"]) {
      await expect(
        createTextDocument(db, storage, owner, {
          title: "t",
          filename,
          content: "x",
        }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    await expect(
      createTextDocument(db, storage, owner, {
        title: "页",
        filename: "p.html",
        content: "<p>hi</p>",
      }),
    ).resolves.toBeDefined();
    expect(storage.files.size).toBe(1);
  });

  it("removes the stored object if the document cannot be recorded", async () => {
    // The file is stored first; a failing insert (here: an unknown uploader) must clean it up.
    const stranger = {
      ...owner,
      userId: "00000000-0000-4000-8000-000000000000",
    };
    await expect(
      createTextDocument(db, storage, stranger, {
        title: "t",
        filename: "t.md",
        content: "x",
      }),
    ).rejects.toBeDefined();
    expect(storage.files.size).toBe(0);
  });
});

describe("readTextContent", () => {
  it("returns the text to anyone who can read the document", async () => {
    const created = await make(owner);
    expect(
      (await readTextContent(db, storage, member, created.publicId)).content,
    ).toBe("# 讲稿\n\n大家好");
  });

  it("answers like a missing document when it is hidden from the reader", async () => {
    const created = await make(owner, { readable: false });
    await expect(
      readTextContent(db, storage, member, created.publicId),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("replaceTextContent", () => {
  it("replaces the content, removes the old object, and logs it", async () => {
    const created = await make(owner);
    const [before] = [...storage.files.keys()];
    if (!before) throw new Error("the document should be stored");

    const result = await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "新的内容",
    });
    expect(result).toEqual({ changed: true });
    expect(
      (await readTextContent(db, storage, owner, created.publicId)).content,
    ).toBe("新的内容");
    expect(storage.files.has(before)).toBe(false);
    expect(storage.files.size).toBe(1);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({ action: "document.file_replaced" });
  });

  it("does nothing when the content is identical", async () => {
    const created = await make(owner);
    const result = await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "# 讲稿\n\n大家好",
    });
    expect(result).toEqual({ changed: false });
  });

  it("is for people who can change the document, not for everyone who can read it", async () => {
    const created = await make(owner);
    await expect(
      replaceTextContent(db, storage, member, {
        documentPublicId: created.publicId,
        content: "x",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // An admin is not an editor of documents they did not create.
    await expect(
      replaceTextContent(db, storage, admin, {
        documentPublicId: created.publicId,
        content: "x",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      (await readTextContent(db, storage, owner, created.publicId)).content,
    ).toBe("# 讲稿\n\n大家好");
  });

  it("does not offer the editor for a document that is over the limit", async () => {
    const big = await make(owner);
    const row = await findDocument(db, big.publicId);
    if (!row) throw new Error("missing");
    await updateDocumentRow(
      db,
      row.id,
      { size: MAX_TEXT_BYTES + 1 },
      new Date(),
    );
    const small = await make(owner);

    expect(
      (await getDocumentDetail(db, storage, owner, big.publicId)).canEditText,
    ).toBe(false);
    expect(
      (await getDocumentDetail(db, storage, owner, small.publicId)).canEditText,
    ).toBe(true);
    expect(
      (await getDocumentDetail(db, storage, member, small.publicId))
        .canEditText,
    ).toBe(false);
  });

  it("refuses to write into a document of a format the library no longer holds", async () => {
    const legacy = await make(owner);
    const row = await findDocument(db, legacy.publicId);
    if (!row) throw new Error("missing");
    await updateDocumentRow(
      db,
      row.id,
      { filename: "notes.txt", ext: "txt", contentType: "text/plain" },
      new Date(),
    );

    await expect(
      replaceTextContent(db, storage, owner, {
        documentPublicId: legacy.publicId,
        content: "new text",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await findDocument(db, legacy.publicId))?.sha256).toBe(row.sha256);
  });

  it("refuses to show content that is not UTF-8, so the editor cannot write replacement characters back", async () => {
    const gbk = await make(owner);
    const [key] = [...storage.files.keys()];
    if (!key) throw new Error("nothing stored");
    // GBK bytes for 你好
    storage.files.set(key, {
      body: Buffer.from([0xc4, 0xe3, 0xba, 0xc3]),
      contentType: "text/markdown",
    });
    await expect(
      readTextContent(db, storage, owner, gbk.publicId),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
      message: expect.stringContaining("UTF-8") as string,
    });
  });

  it("refuses a save made on a stale copy, and leaves the newer text and storage alone", async () => {
    const created = await make(owner);
    const opened = await readTextContent(db, storage, owner, created.publicId);

    // Someone else saves first.
    await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "别人的改动",
    });
    const objects = storage.files.size;

    await expect(
      replaceTextContent(db, storage, owner, {
        documentPublicId: created.publicId,
        content: "我的改动",
        expectedUpdatedAt: opened.updatedAt.toISOString(),
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      (await readTextContent(db, storage, owner, created.publicId)).content,
    ).toBe("别人的改动");
    expect(storage.files.size).toBe(objects);
  });

  it("accepts a save made on the current copy, and a save that names no copy", async () => {
    const created = await make(owner);
    const opened = await readTextContent(db, storage, owner, created.publicId);
    await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "第一次",
      expectedUpdatedAt: opened.updatedAt.toISOString(),
    });
    await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "第二次",
    });
    expect(
      (await readTextContent(db, storage, owner, created.publicId)).content,
    ).toBe("第二次");
  });

  it("rejects a malformed time", async () => {
    const created = await make(owner);
    await expect(
      replaceTextContent(db, storage, owner, {
        documentPublicId: created.publicId,
        content: "x",
        expectedUpdatedAt: "昨天",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("keeps working after the document is hidden and unhidden", async () => {
    const created = await make(owner);
    await updateDocument(db, owner, {
      documentPublicId: created.publicId,
      readable: false,
    });
    await replaceTextContent(db, storage, owner, {
      documentPublicId: created.publicId,
      content: "隐藏中也能改",
    });
    await updateDocument(db, owner, {
      documentPublicId: created.publicId,
      readable: true,
    });
    const opened = await openDocument(db, storage, member, {
      documentPublicId: created.publicId,
      mode: "download",
    });
    expect(opened.source.kind).toBe("stream");
  });
});
