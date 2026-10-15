import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { listAudit } from "../audit";
import { MemoryDocumentStorage } from "../testing/memory-storage";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import {
  decideEditRequest,
  findEditorCandidates,
  grantEditor,
  listDecidableRequests,
  requestEdit,
  revokeEditor,
} from "./access.service";
import {
  completeUpload,
  prepareUpload,
  updateDocument,
} from "./document.service";
import { getDocumentDetail, getLibrary } from "./library.service";

let db: Db;
let storage: MemoryDocumentStorage;
let owner: AdminActor;
let admin: AdminActor;
let otherAdmin: AdminActor;
let member: AdminActor;
let memberId: string;
let adminId: string;
let documentId: string;

const actorOf = (
  user: { id: string; email: string },
  role: AdminActor["role"],
): AdminActor => ({ userId: user.id, email: user.email, role });

beforeEach(async () => {
  db = await createHubTestDb();
  storage = new MemoryDocumentStorage();
  const [o, a, b, m] = await Promise.all([
    seedUser(db, { name: "Olivia" }),
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Beth" }),
    seedUser(db, { name: "Mia" }),
  ]);
  await seedHubAccount(db, o.id, { role: "owner" });
  await seedHubAccount(db, a.id, { role: "admin" });
  await seedHubAccount(db, b.id, { role: "admin" });
  owner = actorOf(o, "owner");
  admin = actorOf(a, "admin");
  otherAdmin = actorOf(b, "admin");
  member = actorOf(m, null);
  memberId = m.id;
  adminId = a.id;

  // Adam adds the document, so he is its editor.
  const prepared = await prepareUpload(db, storage, admin, {
    filename: "contract.pdf",
    size: 10,
  });
  storage.uploadFromBrowser(
    new URL(prepared.target.url).pathname.replace(/^\//, ""),
    Buffer.alloc(10),
  );
  documentId = (
    await completeUpload(db, storage, admin, { uploadId: prepared.uploadId })
  ).publicId;
});

describe("asking for the right to edit", () => {
  it("lets a member ask once, with a note, and shows the request to the people who decide", async () => {
    await requestEdit(db, member, {
      documentPublicId: documentId,
      note: " 要改日期 ",
    });
    await expect(
      requestEdit(db, member, { documentPublicId: documentId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const detail = await getDocumentDetail(db, storage, member, documentId);
    expect(detail).toMatchObject({
      canRequestEdit: false,
      canEdit: false,
      myRequest: { status: "pending", note: "要改日期" },
    });

    const pending = await listDecidableRequests(db, admin);
    expect(pending).toMatchObject([
      {
        note: "要改日期",
        requester: { name: "Mia" },
        document: { publicId: documentId },
      },
    ]);
  });

  it("is not offered to someone who can already edit", async () => {
    await expect(
      requestEdit(db, admin, { documentPublicId: documentId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      requestEdit(db, owner, { documentPublicId: documentId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("cannot be made for a document the person cannot see", async () => {
    await updateDocument(db, admin, {
      documentPublicId: documentId,
      readable: false,
    });
    await expect(
      requestEdit(db, member, { documentPublicId: documentId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("makes the member an editor when approved, and not when denied", async () => {
    const first = await requestEdit(db, member, {
      documentPublicId: documentId,
    });
    await decideEditRequest(db, admin, {
      requestPublicId: first.publicId,
      approve: false,
    });
    expect(
      (await getDocumentDetail(db, storage, member, documentId)).canEdit,
    ).toBe(false);
    // After a denial they may ask again.
    const second = await requestEdit(db, member, {
      documentPublicId: documentId,
    });
    await decideEditRequest(db, owner, {
      requestPublicId: second.publicId,
      approve: true,
    });

    const detail = await getDocumentDetail(db, storage, member, documentId);
    expect(detail.canEdit).toBe(true);
    expect(detail.canManageEditors).toBe(false);
    expect(
      (await getLibrary(db, storage, member, {})).documents[0]?.canEdit,
    ).toBe(true);

    const actions = (await listAudit(db, { limit: 6, offset: 0 })).map(
      (e) => e.action,
    );
    expect(actions).toEqual(
      expect.arrayContaining([
        "document.edit_requested",
        "document.edit_request_denied",
        "document.edit_request_approved",
      ]),
    );
  });

  it("is decided once", async () => {
    const request = await requestEdit(db, member, {
      documentPublicId: documentId,
    });
    await decideEditRequest(db, admin, {
      requestPublicId: request.publicId,
      approve: true,
    });
    await expect(
      decideEditRequest(db, admin, {
        requestPublicId: request.publicId,
        approve: false,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("is decided only by owners and by admins who edit that document", async () => {
    const request = await requestEdit(db, member, {
      documentPublicId: documentId,
    });

    await expect(
      decideEditRequest(db, otherAdmin, {
        requestPublicId: request.publicId,
        approve: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      decideEditRequest(db, member, {
        requestPublicId: request.publicId,
        approve: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(await listDecidableRequests(db, otherAdmin)).toEqual([]);
    expect(await listDecidableRequests(db, member)).toEqual([]);
    expect(await listDecidableRequests(db, owner)).toHaveLength(1);
  });
});

describe("handing out edit rights", () => {
  it("lets an owner or the document's admin-editor add and remove editors", async () => {
    await grantEditor(db, owner, {
      documentPublicId: documentId,
      userId: memberId,
    });
    expect(
      (await getDocumentDetail(db, storage, member, documentId)).canEdit,
    ).toBe(true);

    await revokeEditor(db, admin, {
      documentPublicId: documentId,
      userId: memberId,
    });
    expect(
      (await getDocumentDetail(db, storage, member, documentId)).canEdit,
    ).toBe(false);
  });

  it("settles the person's open request when granting", async () => {
    await requestEdit(db, member, { documentPublicId: documentId });
    await grantEditor(db, admin, {
      documentPublicId: documentId,
      userId: memberId,
    });
    expect(await listDecidableRequests(db, admin)).toEqual([]);
  });

  it("is refused to an admin who was not assigned, and to a member editor", async () => {
    await expect(
      grantEditor(db, otherAdmin, {
        documentPublicId: documentId,
        userId: memberId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await grantEditor(db, owner, {
      documentPublicId: documentId,
      userId: memberId,
    });
    await expect(
      grantEditor(db, member, {
        documentPublicId: documentId,
        userId: memberId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      revokeEditor(db, member, {
        documentPublicId: documentId,
        userId: adminId,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("can assign another admin, who then edits that document", async () => {
    await grantEditor(db, owner, {
      documentPublicId: documentId,
      userId: otherAdmin.userId,
    });
    await expect(
      updateDocument(db, otherAdmin, {
        documentPublicId: documentId,
        title: "新",
      }),
    ).resolves.toBeUndefined();
  });

  it("refuses a suspended or unknown account", async () => {
    const gone = await seedUser(db);
    await seedHubAccount(db, gone.id, { status: "suspended" });
    await expect(
      grantEditor(db, owner, { documentPublicId: documentId, userId: gone.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      grantEditor(db, owner, {
        documentPublicId: documentId,
        userId: "00000000-0000-4000-8000-000000000000",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("says when removing someone who was never an editor", async () => {
    await expect(
      revokeEditor(db, owner, {
        documentPublicId: documentId,
        userId: memberId,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("logs every grant and revocation", async () => {
    await grantEditor(db, owner, {
      documentPublicId: documentId,
      userId: memberId,
    });
    await revokeEditor(db, owner, {
      documentPublicId: documentId,
      userId: memberId,
    });
    const actions = (await listAudit(db, { limit: 2, offset: 0 })).map(
      (e) => e.action,
    );
    expect(actions).toEqual([
      "document.editor_revoked",
      "document.editor_granted",
    ]);
  });
});

describe("who is shown", () => {
  it("shows editors' names to everyone and their e-mails only to managers", async () => {
    const asMember = await getDocumentDetail(db, storage, member, documentId);
    expect(asMember.editors).toMatchObject([{ name: "Adam", email: null }]);
    expect(asMember.pendingRequests).toEqual([]);

    const asOwner = await getDocumentDetail(db, storage, owner, documentId);
    expect(asOwner.editors[0]?.email).toMatch(/@/);
    expect(asOwner.canManageEditors).toBe(true);
  });

  it("finds accounts to assign, minus those already assigned", async () => {
    const found = await findEditorCandidates(db, owner, {
      documentPublicId: documentId,
      search: "mi",
    });
    expect(found.map((c) => c.name)).toEqual(["Mia"]);

    const none = await findEditorCandidates(db, owner, {
      documentPublicId: documentId,
      search: "adam",
    });
    expect(none).toEqual([]);

    await expect(
      findEditorCandidates(db, member, {
        documentPublicId: documentId,
        search: "mi",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
