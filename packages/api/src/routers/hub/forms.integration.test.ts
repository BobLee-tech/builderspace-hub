import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import { createHubTestDb, seedHubAccount, seedUser } from "@kan/hub/testing";

import { createHubCaller } from "./test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * Forms through the real router: who is let in, and how the use cases'
 * refusals reach the caller. The rules are tested in @kan/hub.
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

describe("hub.forms", () => {
  it("is closed to signed-out visitors and to API keys", async () => {
    await expect(createHubCaller(db, null).forms.list()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      createHubCaller(db, member, { "x-api-key": "k" }).forms.list(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets admins build, open and read a form, and hides it from others", async () => {
    const asAdmin = createHubCaller(db, admin);
    const asMember = createHubCaller(db, member);

    await expect(asMember.forms.create({ title: "x" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { publicId } = await asAdmin.forms.create({ title: "个人网站" });
    const detail = await asAdmin.forms.get({ formPublicId: publicId });
    await asAdmin.forms.save({
      formPublicId: publicId,
      title: "个人网站",
      access: "members",
      definition: {
        fields: [
          { id: "site01", type: "short_text", title: "网站", format: "url" },
        ],
      },
      settings: {},
      closesAt: null,
      maxResponses: null,
      expectedUpdatedAt: detail.updatedAt.toISOString(),
    });
    await asAdmin.forms.setStatus({ formPublicId: publicId, status: "open" });

    const list = await asMember.forms.list();
    expect(list.toFill.map((f) => f.publicId)).toEqual([publicId]);
    await expect(
      asMember.forms.responses({ formPublicId: publicId, page: 1 }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asAdmin.forms.responses({ formPublicId: publicId, page: 1 }),
    ).resolves.toMatchObject({ total: 0 });
    await expect(
      asAdmin.forms.summary({ formPublicId: publicId }),
    ).resolves.toMatchObject({
      total: 0,
    });
    await expect(
      asAdmin.forms.export({ formPublicId: publicId }),
    ).resolves.toMatchObject({
      title: "个人网站",
    });
  });

  it("reports a stale save as a conflict", async () => {
    const asAdmin = createHubCaller(db, admin);
    const { publicId } = await asAdmin.forms.create({ title: "x" });
    const detail = await asAdmin.forms.get({ formPublicId: publicId });
    const save = () =>
      asAdmin.forms.save({
        formPublicId: publicId,
        title: "y",
        access: "public",
        definition: detail.definition,
        settings: detail.settings,
        closesAt: null,
        maxResponses: null,
        expectedUpdatedAt: detail.updatedAt.toISOString(),
      });
    await save();
    await expect(save()).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
