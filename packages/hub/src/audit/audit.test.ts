import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { users } from "@kan/db/schema";

import type { Db } from "../db";
import { createHubTestDb, seedUser } from "../testing/test-db";
import { CLI_ACTOR, listAudit, recordAudit, withAudit } from "./audit";

let db: Db;

beforeEach(async () => {
  db = await createHubTestDb();
});

describe("recordAudit", () => {
  it("stores who did what to which entity", async () => {
    const admin = await seedUser(db, { email: "admin@example.test" });

    await recordAudit(db, {
      actor: { userId: admin.id, email: admin.email },
      action: "grant.issued",
      entityType: "grant",
      entityId: "grant1234567",
      summary: "为 new@example.test 开通注册",
      detail: { projects: 2 },
    });

    const [entry] = await listAudit(db, { limit: 10, offset: 0 });
    expect(entry).toMatchObject({
      actorUserId: admin.id,
      actorEmail: "admin@example.test",
      action: "grant.issued",
      entityType: "grant",
      entityId: "grant1234567",
      summary: "为 new@example.test 开通注册",
      detail: { projects: 2 },
    });
    expect(entry?.publicId).toHaveLength(12);
    expect(entry?.at).toBeInstanceOf(Date);
  });

  it("records command-line actions without a user", async () => {
    await recordAudit(db, {
      actor: CLI_ACTOR,
      action: "grant.issued",
      entityType: "grant",
      summary: "命令行开通",
    });

    const [entry] = await listAudit(db, { limit: 10, offset: 0 });
    expect(entry).toMatchObject({
      actorUserId: null,
      actorEmail: "cli",
      entityId: null,
      detail: null,
    });
  });

  it("keeps the entry, with the e-mail, after the actor's account is deleted", async () => {
    const admin = await seedUser(db, { email: "gone@example.test" });
    await recordAudit(db, {
      actor: { userId: admin.id, email: admin.email },
      action: "grant.revoked",
      entityType: "grant",
      summary: "撤销",
    });

    await db.delete(users).where(eq(users.id, admin.id));

    const [entry] = await listAudit(db, { limit: 10, offset: 0 });
    expect(entry).toMatchObject({
      actorUserId: null,
      actorEmail: "gone@example.test",
    });
  });
});

describe("listAudit", () => {
  it("returns newest first and pages", async () => {
    for (const n of [1, 2, 3]) {
      await recordAudit(db, {
        actor: CLI_ACTOR,
        action: "grant.issued",
        entityType: "grant",
        summary: `第 ${n} 条`,
      });
    }

    const firstPage = await listAudit(db, { limit: 2, offset: 0 });
    const secondPage = await listAudit(db, { limit: 2, offset: 2 });

    expect(firstPage.map((e) => e.summary)).toEqual(["第 3 条", "第 2 条"]);
    expect(secondPage.map((e) => e.summary)).toEqual(["第 1 条"]);
  });
});

describe("withAudit", () => {
  const entry = {
    actor: CLI_ACTOR,
    action: "grant.issued" as const,
    entityType: "grant",
    summary: "开通",
  };

  it("returns the work's result and writes the entry it describes", async () => {
    const result = await withAudit(
      db,
      () => Promise.resolve("grant1234567"),
      (value) => ({ ...entry, entityId: value }),
    );

    expect(result).toBe("grant1234567");
    const [logged] = await listAudit(db, { limit: 10, offset: 0 });
    expect(logged?.entityId).toBe("grant1234567");
  });

  it("writes nothing when the work fails, and undoes the work's own writes", async () => {
    const work = withAudit(
      db,
      async (tx) => {
        await recordAudit(tx, { ...entry, summary: "事务内写入" });
        throw new Error("boom");
      },
      () => entry,
    );

    await expect(work).rejects.toThrow("boom");
    expect(await listAudit(db, { limit: 10, offset: 0 })).toEqual([]);
  });
});
