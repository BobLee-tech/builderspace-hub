import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { CLI_ACTOR, listAudit } from "../audit";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { MAX_FILE_BYTES } from "./document.policy";
import {
  completeUpload,
  deleteDocument,
  importDocument,
  openDocument,
  prepareUpload,
  updateDocument,
} from "./document.service";
import {
  createFolder,
  deleteFolder,
  ensureFolderPath,
  getLibrary,
  renameFolder,
} from "./library.service";

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

/** The whole two-step upload, with the browser's part played by the test. */
async function upload(
  actor: AdminActor,
  filename: string,
  extra: { folderPublicId?: string; title?: string; size?: number } = {},
) {
  const bytes = Buffer.from("x".repeat(extra.size ?? 20));
  const prepared = await prepareUpload(db, storage, actor, {
    filename,
    size: bytes.length,
  });
  const key = new URL(prepared.target.url).pathname.replace(/^\//, "");
  storage.uploadFromBrowser(key, bytes);
  const done = await completeUpload(db, storage, actor, {
    uploadId: prepared.uploadId,
    folderPublicId: extra.folderPublicId,
    title: extra.title,
  });
  return { ...done, key, uploadId: prepared.uploadId };
}

describe("uploading", () => {
  it("creates a readable document owned by whoever added it, and logs it", async () => {
    const created = await upload(admin, "Proposal.pdf");

    const library = await getLibrary(db, storage, member, {});
    expect(library.documents).toMatchObject([
      {
        publicId: created.publicId,
        title: "Proposal",
        filename: "Proposal.pdf",
        label: "PDF",
        preview: "pdf",
        readable: true,
        canEdit: false,
      },
    ]);
    // The uploader can change it; a member who merely reads it cannot.
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
    await expect(
      prepareUpload(db, storage, member, { filename: "a.pdf", size: 10 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses unknown formats and empty or huge files before storing anything", async () => {
    for (const input of [
      { filename: "run.exe", size: 10 },
      { filename: "a.pdf", size: 0 },
      { filename: "a.pdf", size: MAX_FILE_BYTES + 1 },
    ]) {
      await expect(
        prepareUpload(db, storage, admin, input),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
  });

  it("says so when storage is not configured", async () => {
    await expect(
      prepareUpload(db, null, admin, { filename: "a.pdf", size: 10 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("does not create a document until the bytes arrived", async () => {
    const prepared = await prepareUpload(db, storage, admin, {
      filename: "a.pdf",
      size: 10,
    });
    await expect(
      completeUpload(db, storage, admin, { uploadId: prepared.uploadId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await getLibrary(db, storage, admin, {})).documents).toHaveLength(
      0,
    );
  });

  it("rejects bytes whose size is not what was signed, and removes them", async () => {
    const prepared = await prepareUpload(db, storage, admin, {
      filename: "a.pdf",
      size: 10,
    });
    const key = new URL(prepared.target.url).pathname.replace(/^\//, "");
    storage.uploadFromBrowser(key, Buffer.alloc(11));

    await expect(
      completeUpload(db, storage, admin, { uploadId: prepared.uploadId }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.files.has(key)).toBe(false);
  });

  it("registers an upload once, only for the person who started it, before it expires", async () => {
    const { uploadId } = await upload(admin, "a.pdf");
    await expect(
      completeUpload(db, storage, admin, { uploadId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const prepared = await prepareUpload(db, storage, admin, {
      filename: "b.pdf",
      size: 5,
    });
    const key = new URL(prepared.target.url).pathname.replace(/^\//, "");
    storage.uploadFromBrowser(key, Buffer.alloc(5));
    await expect(
      completeUpload(db, storage, owner, { uploadId: prepared.uploadId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      completeUpload(
        db,
        storage,
        admin,
        { uploadId: prepared.uploadId },
        new Date(Date.now() + 60 * 60 * 1000),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("puts a document in the folder it was uploaded to", async () => {
    const { publicId: folder } = await createFolder(db, admin, {
      name: "合同",
    });
    await upload(admin, "a.pdf", { folderPublicId: folder });

    expect((await getLibrary(db, storage, member, {})).documents).toHaveLength(
      0,
    );
    const inside = await getLibrary(db, storage, member, {
      folderPublicId: folder,
    });
    expect(inside.documents).toHaveLength(1);
    expect(inside.breadcrumbs.map((b) => b.name)).toEqual(["合同"]);
  });

  it("replaces a document's file and removes the old one", async () => {
    const created = await upload(admin, "a.pdf");
    const oldKey = created.key;

    const prepared = await prepareUpload(db, storage, admin, {
      filename: "a-v2.pdf",
      size: 7,
      documentPublicId: created.publicId,
    });
    const key = new URL(prepared.target.url).pathname.replace(/^\//, "");
    storage.uploadFromBrowser(key, Buffer.alloc(7));
    await completeUpload(db, storage, admin, { uploadId: prepared.uploadId });

    const [doc] = (await getLibrary(db, storage, admin, {})).documents;
    expect(doc).toMatchObject({ publicId: created.publicId, size: 7 });
    expect(storage.files.has(oldKey)).toBe(false);
    expect(storage.files.has(key)).toBe(true);
  });

  it("will not let someone replace a file they cannot edit", async () => {
    const created = await upload(owner, "a.pdf");
    await expect(
      prepareUpload(db, storage, admin, {
        filename: "b.pdf",
        size: 5,
        documentPublicId: created.publicId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("folders", () => {
  it("is for owners and admins, rejects duplicates and limits depth", async () => {
    await expect(createFolder(db, member, { name: "x" })).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );

    const a = await createFolder(db, admin, { name: "合同" });
    await expect(
      createFolder(db, admin, { name: "合同" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // The same name one level down is fine.
    const b = await createFolder(db, admin, {
      name: "合同",
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
    const top = await createFolder(db, admin, { name: "合同" });
    const sub = await createFolder(db, admin, {
      name: "2026",
      parentPublicId: top.publicId,
    });
    await upload(admin, "a.pdf", { folderPublicId: sub.publicId });

    const library = await getLibrary(db, storage, member, {});
    expect(library.folders).toMatchObject([
      { name: "合同", documentCount: 1, folderCount: 1 },
    ]);
  });

  it("is built from a path, again and again, by the import", async () => {
    const first = await ensureFolderPath(db, CLI_ACTOR, ["合同", "2026"]);
    const second = await ensureFolderPath(db, CLI_ACTOR, ["合同", "2026"]);
    expect(first).toBe(second);
    expect(await ensureFolderPath(db, CLI_ACTOR, [])).toBeNull();
  });
});

describe("renaming and removing folders", () => {
  it("renames a folder, but not to a name already taken beside it", async () => {
    const a = await createFolder(db, admin, { name: "合同" });
    await createFolder(db, admin, { name: "方案" });

    await renameFolder(db, admin, {
      folderPublicId: a.publicId,
      name: " 协议 ",
    });
    expect(
      (await getLibrary(db, storage, member, {})).folders.map((f) => f.name),
    ).toContain("协议");
    await expect(
      renameFolder(db, admin, { folderPublicId: a.publicId, name: "方案" }),
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
    await upload(admin, "a.pdf", { folderPublicId: full.publicId });
    await expect(deleteFolder(db, admin, full.publicId)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const empty = await createFolder(db, admin, { name: "空的" });
    await deleteFolder(db, admin, empty.publicId);
    await expect(
      getLibrary(db, storage, admin, { folderPublicId: empty.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(deleteFolder(db, member, full.publicId)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
  });
});

describe("searching", () => {
  it("finds documents anywhere by title or file name", async () => {
    const folder = await createFolder(db, admin, { name: "方案" });
    await upload(admin, "founder-brief.pdf", {
      folderPublicId: folder.publicId,
    });
    await upload(admin, "other.pdf");

    const found = await getLibrary(db, storage, member, { search: "BRIEF" });
    expect(found.documents.map((d) => d.filename)).toEqual([
      "founder-brief.pdf",
    ]);
    expect(found.documents[0]?.folderPath).toBe("方案");
    expect(found.folders).toEqual([]);
  });
});

describe("changing a document", () => {
  it("lets an editor rename, describe, move and hide it, each logged", async () => {
    const { publicId } = await upload(admin, "a.pdf");
    const folder = await createFolder(db, admin, { name: "合同" });

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
    const { publicId } = await upload(admin, "a.pdf");
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
    const { publicId } = await upload(owner, "a.pdf");
    await expect(
      updateDocument(db, admin, { documentPublicId: publicId, title: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      updateDocument(db, member, { documentPublicId: publicId, title: "x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets an owner change any document", async () => {
    const { publicId } = await upload(admin, "a.pdf");
    await expect(
      updateDocument(db, owner, { documentPublicId: publicId, title: "x" }),
    ).resolves.toBeUndefined();
  });

  it("hides an unreadable document from people who cannot edit it", async () => {
    const { publicId } = await upload(admin, "a.pdf");
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

  it("deletes the row and the stored file", async () => {
    const { publicId, key } = await upload(admin, "a.pdf");
    await deleteDocument(db, storage, admin, publicId);

    expect((await getLibrary(db, storage, admin, {})).documents).toHaveLength(
      0,
    );
    expect(storage.files.has(key)).toBe(false);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry?.action).toBe("document.deleted");
  });

  it("will not delete for someone who cannot edit", async () => {
    const { publicId, key } = await upload(admin, "a.pdf");
    await expect(
      deleteDocument(db, storage, member, publicId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(storage.files.has(key)).toBe(true);
  });
});

describe("opening a document", () => {
  it("shows previewable formats inline as the type we decide", async () => {
    const { publicId } = await upload(admin, "page.html");
    const opened = await openDocument(db, storage, member, {
      documentPublicId: publicId,
      mode: "view",
    });
    expect(opened).toMatchObject({
      contentType: "text/html; charset=utf-8",
      mode: "view",
    });
    expect(opened.disposition.startsWith("inline;")).toBe(true);
    expect(opened.source.kind).toBe("redirect");
  });

  it("serves a download as an attachment", async () => {
    const { publicId } = await upload(admin, "deck.pptx");
    const opened = await openDocument(db, storage, member, {
      documentPublicId: publicId,
      mode: "download",
    });
    expect(opened.disposition.startsWith("attachment;")).toBe(true);
  });

  it("has no preview for Office files", async () => {
    const { publicId } = await upload(admin, "deck.pptx");
    await expect(
      openDocument(db, storage, member, {
        documentPublicId: publicId,
        mode: "view",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
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

describe("importing", () => {
  const bytes = Buffer.from("hello");

  it("creates, leaves identical files alone, and replaces changed ones", async () => {
    const folder = await ensureFolderPath(db, CLI_ACTOR, ["方案"]);
    const first = await importDocument(db, storage, CLI_ACTOR, {
      folderPublicId: folder,
      filename: "brief.pdf",
      bytes,
    });
    expect(first.status).toBe("created");
    expect(storage.files.size).toBe(1);

    const again = await importDocument(db, storage, CLI_ACTOR, {
      folderPublicId: folder,
      filename: "brief.pdf",
      bytes,
    });
    expect(again).toEqual({ status: "unchanged", publicId: first.publicId });
    expect(storage.files.size).toBe(1);

    const changed = await importDocument(db, storage, CLI_ACTOR, {
      folderPublicId: folder,
      filename: "brief.pdf",
      bytes: Buffer.from("hello, again"),
    });
    expect(changed).toEqual({ status: "updated", publicId: first.publicId });
    expect(storage.files.size).toBe(1);
  });

  it("refuses a format that is not allowed", async () => {
    await expect(
      importDocument(db, storage, CLI_ACTOR, {
        folderPublicId: null,
        filename: "run.sh",
        bytes,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(storage.files.size).toBe(0);
  });
});
