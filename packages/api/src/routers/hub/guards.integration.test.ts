import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "@kan/hub/testing";

import { assertCanCreateProject, assertCanCreateTemplate } from "./guards";
import { ensureProjectMemberForTests } from "./test-helpers";

vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

let db: dbClient;
let owner: { id: string; email: string };

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
  await seedHubAccount(db, owner.id, { role: "owner" });
});

describe("assertCanCreateProject", () => {
  it("lets back-office admins create projects", async () => {
    const admin = await seedUser(db);
    await seedHubAccount(db, admin.id, { role: "admin" });

    await expect(assertCanCreateProject(db, owner.id)).resolves.toBeUndefined();
    await expect(assertCanCreateProject(db, admin.id)).resolves.toBeUndefined();
  });

  it("refuses ordinary members and viewers", async () => {
    const member = await seedUser(db);
    const viewer = await seedUser(db);
    await seedHubAccount(db, viewer.id, { role: "viewer" });

    for (const user of [member, viewer]) {
      await expect(assertCanCreateProject(db, user.id)).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
  });
});

describe("assertCanCreateTemplate", () => {
  it("lets a project admin create templates but not a member or guest", async () => {
    const project = await seedProject(db, owner);
    const member = await seedUser(db);
    const guest = await seedUser(db);
    await ensureProjectMemberForTests(db, member, project.id, "member");
    await ensureProjectMemberForTests(db, guest, project.id, "guest");

    await expect(
      assertCanCreateTemplate(db, owner.id, project.id),
    ).resolves.toBeUndefined();
    for (const user of [member, guest]) {
      await expect(
        assertCanCreateTemplate(db, user.id, project.id),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});
