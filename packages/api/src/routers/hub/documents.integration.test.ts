import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import { createHubTestDb, seedHubAccount, seedUser } from "@kan/hub/testing";

import { createHubCaller } from "./test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The document library through the real router: who is let in, and how the
 * use cases' refusals reach the caller. The rules themselves, and the upload
 * flow, are tested in @kan/hub where file storage can be played by a stand-in.
 */

let db: dbClient;
let admin: { id: string; email: string };
let member: { id: string; email: string };

beforeEach(async () => {
  db = await createHubTestDb();
  admin = await seedUser(db, { email: "admin@example.test", name: "Adam" });
  member = await seedUser(db, { email: "member@example.test", name: "Mia" });
  await seedHubAccount(db, admin.id, { role: "admin" });
});

describe("hub.documents", () => {
  it("is closed to signed-out visitors and to API keys", async () => {
    await expect(
      createHubCaller(db, null).documents.library({}),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createHubCaller(db, member, { "x-api-key": "k" }).documents.library({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is closed to suspended accounts", async () => {
    await seedHubAccount(db, member.id, { status: "suspended" });
    await expect(
      createHubCaller(db, member).documents.library({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets any member browse, but only admins make folders", async () => {
    const asMember = createHubCaller(db, member);
    const asAdmin = createHubCaller(db, admin);

    await expect(
      asMember.documents.createFolder({ name: "合同" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await asAdmin.documents.createFolder({ name: "合同" });

    const library = await asMember.documents.library({});
    expect(library.folders.map((f) => f.name)).toEqual(["合同"]);
    expect(library.canCreate).toBe(false);
    expect((await asAdmin.documents.library({})).canCreate).toBe(true);
  });

  it("says plainly that uploads need a bucket, while text documents already work", async () => {
    // No bucket and no folder are configured in the test environment, so the
    // database holds the text.
    await expect(
      createHubCaller(db, admin).documents.prepareUpload({
        filename: "a.pdf",
        size: 10,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("对象存储") as string,
    });
    const library = await createHubCaller(db, admin).documents.library({});
    expect(library.uploadsAvailable).toBe(false);
    expect(library.textAvailable).toBe(true);
  });

  it("keeps the text-document procedures behind the same doors", async () => {
    const input = { title: "讲稿", filename: "讲稿.md", content: "# 讲稿" };
    await expect(
      createHubCaller(db, null).documents.createText(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createHubCaller(db, admin, { "x-api-key": "k" }).documents.createText(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createHubCaller(db, admin, { "x-api-key": "k" }).documents.content({
        documentPublicId: "nope",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("writes, reads and edits a text document without any bucket", async () => {
    const asAdmin = createHubCaller(db, admin);
    const created = await asAdmin.documents.createText({
      title: "讲稿",
      filename: "讲稿.md",
      content: "# 讲稿",
      readable: false,
    });
    const opened = await asAdmin.documents.content({ documentPublicId: created.publicId });
    expect(opened.content).toBe("# 讲稿");

    await asAdmin.documents.replaceText({
      documentPublicId: created.publicId,
      content: "# 新稿",
      expectedUpdatedAt: new Date(opened.updatedAt).toISOString(),
    });
    expect((await asAdmin.documents.content({ documentPublicId: created.publicId })).content).toBe("# 新稿");

    // Hidden: a member who is not assigned to it neither lists nor opens it.
    const asMember = createHubCaller(db, member);
    expect((await asMember.documents.library({})).documents).toHaveLength(0);
    await expect(
      asMember.documents.content({ documentPublicId: created.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("rejects an oversized or malformed text body before it reaches a use case", async () => {
    await expect(
      createHubCaller(db, admin).documents.replaceText({
        documentPublicId: "x",
        content: "x".repeat(410_001),
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      createHubCaller(db, admin).documents.createText({
        title: "t",
        filename: "",
        content: "x",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("answers an unknown document with not-found, for members and admins alike", async () => {
    for (const who of [member, admin]) {
      await expect(
        createHubCaller(db, who).documents.get({ documentPublicId: "nope" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("has nothing for a member to decide", async () => {
    expect(await createHubCaller(db, member).documents.requests()).toEqual([]);
  });

  it("rejects malformed input before it reaches a use case", async () => {
    await expect(
      createHubCaller(db, admin).documents.grantEditor({
        documentPublicId: "x",
        userId: "not-a-uuid",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
