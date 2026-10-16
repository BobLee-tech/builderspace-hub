import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { listAudit } from "../audit";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import {
  deleteDocument,
  openDocument,
  updateDocument,
} from "./document.service";
import {
  createFolder,
  deleteFolder,
  getLibrary,
  renameFolder,
} from "./library.service";
import { createTextDocument } from "./text.service";

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

const make = (
  actor: AdminActor,
  filename = "a.md",
  extra: { folderPublicId?: string; title?: string; content?: string } = {},
) =>
  createTextDocument(db, storage, actor, {
    title: extra.title ?? filename.replace(/\.[^.]+$/, ""),
    filename,
    content: extra.content ?? "# 内容",
    folderPublicId: extra.folderPublicId,
  });

describe("creating", () => {
  it("makes a readable document owned by whoever wrote it, and logs it", async () => {
    const created = await make(admin, "Proposal.md");

    const library = await getLibrary(db, storage, member, {});
    expect(library.documents).toMatchObject([
      {
        publicId: created.publicId,
        title: "Proposal",
        filename: "Proposal.md",
        label: "Markdown",
        preview: "markdown",
        readable: true,
        canEdit: false,
      },
    ]);
    expect(
      (await getLibrary(db, storage, admin, {})).documents[0]?.canEdit,
    ).toBe(true);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "document.created",
      entityId: created.publicId,
    });
  });

  it("is for owners and admins only", async () => {
    await expect(make(member)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("puts a document in the folder it was written into", async () => {
    const { publicId: folder } = await createFolder(db, admin, {
      name: "方案",
    });
    await make(admin, "a.md", { folderPublicId: folder });

    expect((await getLibrary(db, storage, member, {})).documents).toHaveLength(
      0,
    );
    const inside = await getLibrary(db, storage, member, {
      folderPublicId: folder,
    });
    expect(inside.documents).toHaveLength(1);
    expect(inside.breadcrumbs.map((b) => b.name)).toEqual(["方案"]);
  });
});

describe("folders", () => {
  it("is for owners and admins, rejects duplicates and limits depth", async () => {
    await expect(createFolder(db, member, { name: "x" })).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );

    const a = await createFolder(db, admin, { name: "方案" });
    await expect(
      createFolder(db, admin, { name: "方案" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The same name one level down is fine.
    const b = await createFolder(db, admin, {
      name: "方案",
      parentPublicId: a.publicId,
    });
    const c = await createFolder(db, admin, {
      name: "2026",
      parentPublicId: b.publicId,
    });
    await expect(
      createFolder(db, admin, { name: "太深", parentPublicId: c.publicId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("counts documents below a folder", async () => {
    const top = await createFolder(db, admin, { name: "方案" });
    const sub = await createFolder(db, admin, {
      name: "2026",
      parentPublicId: top.publicId,
    });
    await make(admin, "a.md", { folderPublicId: sub.publicId });

    const library = await getLibrary(db, storage, member, {});
    expect(library.folders).toMatchObject([
      { name: "方案", documentCount: 1, folderCount: 1 },
    ]);
  });

  it("renames a folder, but not to a name already taken beside it", async () => {
    const a = await createFolder(db, admin, { name: "方案" });
    await createFolder(db, admin, { name: "笔记" });

    await renameFolder(db, admin, {
      folderPublicId: a.publicId,
      name: " 提案 ",
    });
    expect(
      (await getLibrary(db, storage, member, {})).folders.map((f) => f.name),
    ).toContain("提案");
    await expect(
      renameFolder(db, admin, { folderPublicId: a.publicId, name: "笔记" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      renameFolder(db, member, { folderPublicId: a.publicId, name: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      renameFolder(db, admin, { folderPublicId: "nope", name: "x" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("removes only a folder with nothing in it", async () => {
    const full = await createFolder(db, admin, { name: "有内容" });
    await make(admin, "a.md", { folderPublicId: full.publicId });
    await expect(deleteFolder(db, admin, full.publicId)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const empty = await createFolder(db, admin, { name: "空的" });
    await deleteFolder(db, admin, empty.publicId);
    await expect(
      getLibrary(db, storage, admin, { folderPublicId: empty.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFolder(db, member, full.publicId)).rejects.toMatchObject(
      {
        code: "FORBIDDEN",
      },
    );
  });
});

describe("searching", () => {
  it("finds documents anywhere by title or file name", async () => {
    const folder = await createFolder(db, admin, { name: "方案" });
    await make(admin, "founder-brief.md", { folderPublicId: folder.publicId });
    await make(admin, "other.md");

    const found = await getLibrary(db, storage, member, { search: "BRIEF" });
    expect(found.documents.map((d) => d.filename)).toEqual([
      "founder-brief.md",
    ]);
    expect(found.documents[0]?.folderPath).toBe("方案");
    expect(found.folders).toEqual([]);
  });
});

describe("changing a document", () => {
  it("lets an editor rename, describe, move and hide it, each logged", async () => {
    const { publicId } = await make(admin);
    const folder = await createFolder(db, admin, { name: "方案" });

    await updateDocument(db, admin, {
      documentPublicId: publicId,
      title: "  新标题 ",
      description: "说明",
      folderPublicId: folder.publicId,
      readable: false,
    });

    const [doc] = (
      await getLibrary(db, storage, admin, { folderPublicId: folder.publicId })
    ).documents;
    expect(doc).toMatchObject({
      title: "新标题",
      description: "说明",
      readable: false,
    });
    const actions = (await listAudit(db, { limit: 4, offset: 0 })).map(
      (e) => e.action,
    );
    expect(actions).toContain("document.updated");
    expect(actions).toContain("document.readable_changed");
  });

  it("changes nothing, and logs nothing, when nothing differs", async () => {
    const { publicId } = await make(admin);
    const before = await listAudit(db, { limit: 50, offset: 0 });
    await updateDocument(db, admin, {
      documentPublicId: publicId,
      title: "a",
      readable: true,
    });
    expect(await listAudit(db, { limit: 50, offset: 0 })).toHaveLength(
      before.length,
    );
  });

  it("is refused for someone who was not assigned, even an admin", async () => {
    const { publicId } = await make(owner);
    await expect(
      updateDocument(db, admin, { documentPublicId: publicId, title: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateDocument(db, member, { documentPublicId: publicId, title: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an owner change any document", async () => {
    const { publicId } = await make(admin);
    await expect(
      updateDocument(db, owner, { documentPublicId: publicId, title: "x" }),
    ).resolves.toBeUndefined();
  });

  it("hides an unreadable document from people who cannot edit it", async () => {
    const { publicId } = await make(admin);
    await updateDocument(db, admin, {
      documentPublicId: publicId,
      readable: false,
    });

    expect((await getLibrary(db, storage, member, {})).documents).toHaveLength(
      0,
    );
    expect((await getLibrary(db, storage, owner, {})).documents).toHaveLength(
      1,
    );
    await expect(
      openDocument(db, storage, member, {
        documentPublicId: publicId,
        mode: "download",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("deletes the row and the stored content", async () => {
    const { publicId } = await make(admin);
    expect(storage.files.size).toBe(1);
    await deleteDocument(db, storage, admin, publicId);

    expect((await getLibrary(db, storage, admin, {})).documents).toHaveLength(
      0,
    );
    expect(storage.files.size).toBe(0);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry?.action).toBe("document.deleted");
  });

  it("will not delete for someone who cannot edit", async () => {
    const { publicId } = await make(admin);
    await expect(
      deleteDocument(db, storage, member, publicId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.files.size).toBe(1);
  });
});

describe("opening a document", () => {
  it("serves HTML inline as the type we decide", async () => {
    const { publicId } = await make(admin, "page.html", {
      content: "<h1>hi</h1>",
    });
    const opened = await openDocument(db, storage, member, {
      documentPublicId: publicId,
      mode: "view",
    });
    expect(opened).toMatchObject({
      contentType: "text/html; charset=utf-8",
      mode: "view",
      source: { kind: "stream" },
    });
    expect(opened.disposition.startsWith("inline;")).toBe(true);
  });

  it("serves Markdown as plain text when viewed, and as an attachment when downloaded", async () => {
    const { publicId } = await make(admin);
    const viewed = await openDocument(db, storage, member, {
      documentPublicId: publicId,
      mode: "view",
    });
    expect(viewed.contentType).toBe("text/plain; charset=utf-8");
    const saved = await openDocument(db, storage, member, {
      documentPublicId: publicId,
      mode: "download",
    });
    expect(saved.disposition.startsWith("attachment;")).toBe(true);
  });

  it("answers an unknown document with not-found", async () => {
    await expect(
      openDocument(db, storage, member, {
        documentPublicId: "nope",
        mode: "view",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
