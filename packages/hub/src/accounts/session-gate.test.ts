import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { createHubTestDb, seedUser } from "../testing/test-db";
import { upsertAccount } from "./account.repo";
import { isSessionAllowed } from "./session-gate";

const now = new Date("2026-10-14T12:00:00Z");
let db: Db;

beforeEach(async () => {
  db = await createHubTestDb();
});

describe("isSessionAllowed", () => {
  it("allows an account with no hub record", async () => {
    const user = await seedUser(db);
    expect(await isSessionAllowed(db, user.id)).toBe(true);
  });

  it("refuses a suspended account and allows it again once restored", async () => {
    const user = await seedUser(db);
    await upsertAccount(db, user.id, { status: "suspended", now });
    expect(await isSessionAllowed(db, user.id)).toBe(false);

    await upsertAccount(db, user.id, { status: "active", now });
    expect(await isSessionAllowed(db, user.id)).toBe(true);
  });
});
