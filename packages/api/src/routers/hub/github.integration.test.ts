import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
 * The GitHub tab's API. Connecting itself goes through the redirect routes and
 * the use cases are tested in @kan/hub with a fake GitHub; this checks the
 * gate, whether the App counts as set up, and the refusal when it is not.
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

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hub.github", () => {
  it("says the App is not set up until its HUB_ settings exist", async () => {
    vi.stubEnv("HUB_GITHUB_CLIENT_ID", "");
    const before = await createHubCaller(db, member).github.summary();
    expect(before).toMatchObject({ configured: false, connection: null });

    vi.stubEnv("HUB_GITHUB_CLIENT_ID", "Iv1.test");
    vi.stubEnv("HUB_GITHUB_CLIENT_SECRET", "shh");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://hub.example");
    const after = await createHubCaller(db, member).github.summary();
    expect(after.configured).toBe(true);
  });

  it("refuses to sync or disconnect while the App is not set up", async () => {
    vi.stubEnv("HUB_GITHUB_CLIENT_ID", "");
    const caller = createHubCaller(db, member);
    await expect(caller.github.sync()).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(caller.github.disconnect()).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("answers NOT_FOUND to a sync before connecting", async () => {
    vi.stubEnv("HUB_GITHUB_CLIENT_ID", "Iv1.test");
    vi.stubEnv("HUB_GITHUB_CLIENT_SECRET", "shh");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://hub.example");
    await expect(createHubCaller(db, member).github.sync()).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("refuses visitors, API keys and suspended accounts", async () => {
    await expect(createHubCaller(db, null).github.summary()).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    await expect(
      createHubCaller(db, member, { "x-api-key": "anything" }).github.summary(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await seedHubAccount(db, member.id, { status: "suspended" });
    await expect(createHubCaller(db, member).github.sync()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
