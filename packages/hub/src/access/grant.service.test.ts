import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { HubErrorCode } from "../shared/errors";
import type { IssueGrantInput } from "./grant.service";
import { listAudit } from "../audit";
import { hubAccessGrantProjects, hubAccessGrants } from "../schema";
import { hashGrantToken } from "../shared/token";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import { describeGrantForJoin, issueGrant, revokeGrant } from "./grant.service";

const now = new Date("2026-10-13T12:00:00Z");
const weekLater = new Date("2026-10-20T12:00:00Z");

let db: Db;
let admin: { id: string; email: string };
let actor: AuditActor;
let project: { id: number; publicId: string; name: string };

beforeEach(async () => {
  db = await createHubTestDb();
  admin = await seedUser(db, { email: "admin@example.test" });
  actor = { userId: admin.id, email: admin.email };
  project = await seedProject(db, admin, { name: "社群" });
});

const allGrants = () => db.select().from(hubAccessGrants);
const auditActions = async () =>
  (await listAudit(db, { limit: 50, offset: 0 })).map((e) => e.action);

describe("issueGrant", () => {
  it("stores the grant and returns a link token once", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      note: "运营志愿者",
      projects: [{ projectPublicId: project.publicId, role: "member" }],
      now,
    });

    expect(issued.email).toBe("new@example.test");
    expect(issued.expiresAt).toEqual(weekLater);
    expect(issued.token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const [row] = await allGrants();
    expect(row).toMatchObject({
      publicId: issued.publicId,
      email: "new@example.test",
      source: "direct",
      note: "运营志愿者",
      hubRole: null,
      createdBy: admin.id,
      consumedAt: null,
      revokedAt: null,
    });

    const projects = await db.select().from(hubAccessGrantProjects);
    expect(projects).toMatchObject([
      { grantId: row?.id, workspaceId: project.id, role: "member" },
    ]);
  });

  it("keeps only the token's hash", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });

    const [row] = await allGrants();
    expect(row?.tokenHash).toBe(hashGrantToken(issued.token));
    expect(JSON.stringify(row)).not.toContain(issued.token);
  });

  it("writes an audit entry that names the address but not the token", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [{ projectPublicId: project.publicId, role: "guest" }],
      now,
    });

    const [entry] = await listAudit(db, { limit: 10, offset: 0 });
    expect(entry).toMatchObject({
      actorUserId: admin.id,
      actorEmail: "admin@example.test",
      action: "grant.issued",
      entityType: "grant",
      entityId: issued.publicId,
    });
    expect(entry?.summary).toContain("new@example.test");
    expect(JSON.stringify(entry)).not.toContain(issued.token);
  });

  it("normalises the address", async () => {
    const issued = await issueGrant(db, actor, {
      email: "  New.Person@Example.TEST ",
      source: "direct",
      projects: [],
      now,
    });

    expect(issued.email).toBe("new.person@example.test");
  });

  it("can carry a back-office role for the new account", async () => {
    await issueGrant(db, actor, {
      email: "owner@example.test",
      source: "cli",
      hubRole: "owner",
      projects: [],
      now,
    });

    const [row] = await allGrants();
    expect(row).toMatchObject({ hubRole: "owner", source: "cli" });
  });

  it("replaces an earlier unused grant for the same address", async () => {
    const first = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });
    const second = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });

    expect(await describeGrantForJoin(db, first.token, now)).toEqual({
      state: "revoked",
    });
    expect(await describeGrantForJoin(db, second.token, now)).toMatchObject({
      state: "valid",
    });
    expect(await auditActions()).toEqual([
      "grant.issued",
      "grant.revoked",
      "grant.issued",
    ]);
  });

  const refusals: [string, Partial<IssueGrantInput>, HubErrorCode][] = [
    ["an unusable address", { email: "not-an-email" }, "INVALID_INPUT"],
    [
      "an address that already has an account",
      { email: "ADMIN@example.test" },
      "CONFLICT",
    ],
    [
      "a project that does not exist",
      { projects: [{ projectPublicId: "missing12345", role: "member" }] },
      "NOT_FOUND",
    ],
    ["a note that is too long", { note: "长".repeat(281) }, "INVALID_INPUT"],
  ];

  it.each(refusals)(
    "refuses %s and changes nothing",
    async (_, overrides, code) => {
      const attempt = issueGrant(db, actor, {
        email: "new@example.test",
        source: "direct",
        projects: [],
        now,
        ...overrides,
      });

      await expect(attempt).rejects.toMatchObject({ name: "HubError", code });
      expect(await allGrants()).toEqual([]);
      expect(await auditActions()).toEqual([]);
    },
  );

  it("refuses the same project twice", async () => {
    const attempt = issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [
        { projectPublicId: project.publicId, role: "member" },
        { projectPublicId: project.publicId, role: "guest" },
      ],
      now,
    });

    await expect(attempt).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await allGrants()).toEqual([]);
  });
});

describe("revokeGrant", () => {
  it("closes an unused grant and logs it", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });

    await revokeGrant(db, actor, issued.publicId, now);

    const [row] = await allGrants();
    expect(row).toMatchObject({ revokedAt: now, revokedBy: admin.id });
    expect(await auditActions()).toEqual(["grant.revoked", "grant.issued"]);
  });

  it("reports a grant that does not exist", async () => {
    await expect(
      revokeGrant(db, actor, "missing12345", now),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a grant that is no longer open, and logs nothing more", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });
    await revokeGrant(db, actor, issued.publicId, now);

    await expect(
      revokeGrant(db, actor, issued.publicId, now),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await auditActions()).toEqual(["grant.revoked", "grant.issued"]);
  });
});

describe("describeGrantForJoin", () => {
  it("shows the invited address for a live link", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });

    expect(await describeGrantForJoin(db, issued.token, now)).toEqual({
      state: "valid",
      email: "new@example.test",
      expiresAt: weekLater,
    });
  });

  it.each([undefined, "", "junk", "a".repeat(43)])(
    "treats %j as invalid without revealing anything",
    async (token) => {
      expect(await describeGrantForJoin(db, token, now)).toEqual({
        state: "invalid",
      });
    },
  );

  it("says so when the link has run out", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });

    expect(await describeGrantForJoin(db, issued.token, weekLater)).toEqual({
      state: "expired",
    });
  });

  it("says so when the link was already used", async () => {
    const issued = await issueGrant(db, actor, {
      email: "new@example.test",
      source: "direct",
      projects: [],
      now,
    });
    await db
      .update(hubAccessGrants)
      .set({ consumedAt: now })
      .where(eq(hubAccessGrants.publicId, issued.publicId));

    expect(await describeGrantForJoin(db, issued.token, now)).toEqual({
      state: "consumed",
    });
  });
});
