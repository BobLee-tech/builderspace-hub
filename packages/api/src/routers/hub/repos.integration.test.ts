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
 * Linking GitHub repositories to projects: the back office reads them, owners
 * and admins change them. The rules are tested in @kan/hub.
 */

let db: dbClient;
let project: { publicId: string };

const withRole = async (
  email: string,
  role: "owner" | "admin" | "viewer" | null,
) => {
  const user = await seedUser(db, { email });
  if (role) await seedHubAccount(db, user.id, { role });
  return user;
};

beforeEach(async () => {
  db = await createHubTestDb();
  const owner = await withRole("owner@example.test", "owner");
  project = await seedProject(db, owner, { name: "CourseMate" });
});

describe("hub.repos", () => {
  it("lets an admin link and unlink, and a viewer only look", async () => {
    const admin = createHubCaller(
      db,
      await withRole("a@example.test", "admin"),
    );
    const viewer = createHubCaller(
      db,
      await withRole("v@example.test", "viewer"),
    );

    const linked = await admin.repos.add({
      projectPublicId: project.publicId,
      repo: "club/app",
    });
    expect(await viewer.repos.list()).toMatchObject([
      { project: { name: "CourseMate" }, repos: [{ fullName: "club/app" }] },
    ]);

    await expect(
      viewer.repos.add({ projectPublicId: project.publicId, repo: "club/x" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      viewer.repos.remove({ repoPublicId: linked.publicId }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await admin.repos.remove({ repoPublicId: linked.publicId });
    expect((await viewer.repos.list())[0]?.repos).toEqual([]);
  });

  it("keeps ordinary members out entirely", async () => {
    const member = createHubCaller(db, await withRole("m@example.test", null));
    await expect(member.repos.list()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("maps the use case's refusals", async () => {
    const admin = createHubCaller(
      db,
      await withRole("a@example.test", "admin"),
    );
    await expect(
      admin.repos.add({ projectPublicId: project.publicId, repo: "nope" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await admin.repos.add({ projectPublicId: project.publicId, repo: "c/app" });
    await expect(
      admin.repos.add({ projectPublicId: project.publicId, repo: "C/App" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
