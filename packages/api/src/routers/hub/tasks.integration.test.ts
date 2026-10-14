import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "@kan/hub/testing";

import { createHubCaller, ensureProjectMemberForTests } from "./test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The home page and task board API: every signed-in member may call it, and
 * it only ever shows projects the caller is in. The rules themselves are
 * tested in @kan/hub; this checks the gate and the wiring.
 */

let db: dbClient;
let owner: { id: string; email: string };
let member: { id: string; email: string };
let joined: { id: number; publicId: string };
let other: { id: number; publicId: string };

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
  member = await seedUser(db, { email: "member@example.test" });
  joined = await seedProject(db, owner, { name: "CourseMate" });
  other = await seedProject(db, owner, { name: "EchoAgent" });
  await ensureProjectMemberForTests(db, member, joined.id, "member");
});

describe("hub.tasks", () => {
  it("lets an ordinary member see the projects they are in, and only those", async () => {
    const caller = createHubCaller(db, member);

    const home = await caller.tasks.home({});
    expect(home.scope.projects.map((p) => p.name)).toEqual(["CourseMate"]);

    const board = await caller.tasks.board({ view: "all" });
    expect(board.scope.projects).toEqual(home.scope.projects);
    expect(board.columns.map((c) => c.stage)).toEqual([
      "todo",
      "doing",
      "review",
      "done",
    ]);
  });

  it("answers NOT_FOUND for a project the caller is not in", async () => {
    await expect(
      createHubCaller(db, member).tasks.home({ project: other.publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses visitors, API keys and suspended accounts", async () => {
    await expect(
      createHubCaller(db, null).tasks.home({}),
    ).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      createHubCaller(db, member, { "x-api-key": "anything" }).tasks.home({}),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await seedHubAccount(db, member.id, { status: "suspended" });
    await expect(
      createHubCaller(db, member).tasks.board({ view: "mine" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a view that does not exist", async () => {
    await expect(
      createHubCaller(db, member).tasks.board({ view: "everything" as "all" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
