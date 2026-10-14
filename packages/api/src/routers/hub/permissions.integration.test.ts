import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "@kan/hub/testing";

import { createHubCaller } from "./test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The back office's permissions page and link-role changes: who may read and
 * who may change. The rules themselves are tested in @kan/hub.
 */

let db: dbClient;
let owner: { id: string; email: string };
let admin: { id: string; email: string };
let viewer: { id: string; email: string };
let project: { publicId: string };

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
  admin = await seedUser(db, { email: "admin@example.test" });
  viewer = await seedUser(db, { email: "viewer@example.test" });
  await seedHubAccount(db, owner.id, { role: "owner" });
  await seedHubAccount(db, admin.id, { role: "admin" });
  await seedHubAccount(db, viewer.id, { role: "viewer" });
  project = await seedProject(db, owner, { name: "CourseMate" });
});

describe("hub.permissions", () => {
  it("lets an admin change what members may do, and a viewer only look", async () => {
    const change = {
      projectPublicId: project.publicId,
      role: "member" as const,
      permission: "card:delete",
      granted: false,
    };

    await expect(
      createHubCaller(db, viewer).permissions.set(change),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createHubCaller(db, admin).permissions.set(change),
    ).resolves.toEqual({ projects: 1 });

    const { projects } = await createHubCaller(db, viewer).permissions.get();
    expect(projects[0]?.roles.member).not.toContain("card:delete");
  });

  it("rejects permissions that only project admins may hold", async () => {
    await expect(
      createHubCaller(db, owner).permissions.set({
        projectPublicId: null,
        role: "member",
        permission: "workspace:delete",
        granted: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is closed to ordinary members", async () => {
    const member = await seedUser(db, { email: "member@example.test" });
    await expect(
      createHubCaller(db, member).permissions.get(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("hub.grants.setRole", () => {
  it("lets only an owner change the role an unused link gives", async () => {
    await createHubCaller(db, owner).grants.issue({
      email: "partner@example.test",
      hubRole: "admin",
      note: null,
      projects: [],
    });
    const { items } = await createHubCaller(db, owner).grants.list({ page: 1 });
    const grantPublicId = items[0]?.publicId ?? "";

    await expect(
      createHubCaller(db, admin).grants.setRole({
        grantPublicId,
        hubRole: "owner",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await createHubCaller(db, owner).grants.setRole({
      grantPublicId,
      hubRole: "owner",
    });
    const after = await createHubCaller(db, owner).grants.list({ page: 1 });
    expect(after.items[0]?.hubRole).toBe("owner");
  });
});

describe("hub.settings", () => {
  it("lets every member read the colours but only admins change them", async () => {
    const member = await seedUser(db, { email: "member@example.test" });
    const colors = { dev: "#9A86D1", ops: "#4FA3A5", marketing: "#C77F95" };

    await expect(
      createHubCaller(db, viewer).settings.setFunctionColors(colors),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createHubCaller(db, admin).settings.setFunctionColors({
        ...colors,
        dev: "javascript:alert(1)",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await createHubCaller(db, admin).settings.setFunctionColors(colors);

    await expect(
      createHubCaller(db, member).settings.functionColors(),
    ).resolves.toEqual(colors);
  });
});
