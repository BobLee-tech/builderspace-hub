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
 * 我完成的: every signed-in member can read their own. The counting rules are
 * tested in @kan/hub; this checks the gate, the wiring and the error mapping.
 */

let db: dbClient;
let member: { id: string; email: string };

beforeEach(async () => {
  db = await createHubTestDb();
  const owner = await seedUser(db, { email: "owner@example.test" });
  member = await seedUser(db, { email: "member@example.test" });
  const project = await seedProject(db, owner);
  await ensureProjectMemberForTests(db, member, project.id, "member");
});

describe("hub.archive", () => {
  it("answers an ordinary member with empty counts to start with", async () => {
    const archive = await createHubCaller(db, member).archive.get({
      timeZone: "Australia/Sydney",
    });

    expect(archive.total).toBe(0);
    expect(archive.recent).toEqual([]);
    expect(archive.months).toHaveLength(12);
  });

  it("maps an unknown time zone to BAD_REQUEST", async () => {
    await expect(
      createHubCaller(db, member).archive.get({ timeZone: "Nowhere/Land" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses visitors, API keys and suspended accounts", async () => {
    const input = { timeZone: "UTC" };
    await expect(
      createHubCaller(db, null).archive.get(input),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createHubCaller(db, member, { "x-api-key": "anything" }).archive.get(
        input,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await seedHubAccount(db, member.id, { status: "suspended" });
    await expect(
      createHubCaller(db, member).archive.get(input),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
