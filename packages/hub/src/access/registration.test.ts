import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { workspaceMembers, workspaceRoles } from "@kan/db/schema";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { hubAccessGrants } from "../schema";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import { issueGrant } from "./grant.service";
import { decideUserCreate, provisionUser } from "./registration";

const now = new Date("2026-10-13T12:00:00Z");
const weekLater = new Date("2026-10-20T12:00:00Z");

let db: Db;
let admin: { id: string; email: string };
let actor: AuditActor;
let community: { id: number; publicId: string };
let coursemate: { id: number; publicId: string };

beforeEach(async () => {
  db = await createHubTestDb();
  admin = await seedUser(db, { email: "admin@example.test" });
  actor = { userId: admin.id, email: admin.email };
  community = await seedProject(db, admin, { name: "社群" });
  coursemate = await seedProject(db, admin, { name: "CourseMate" });
});

const issue = (email = "new@example.test") =>
  issueGrant(db, actor, {
    email,
    source: "direct",
    projects: [
      { projectPublicId: community.publicId, role: "member" },
      { projectPublicId: coursemate.publicId, role: "guest" },
    ],
    now,
  });

const membershipsOf = (userId: string) =>
  db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      roleId: workspaceMembers.roleId,
      status: workspaceMembers.status,
      email: workspaceMembers.email,
    })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, userId))
    .orderBy(workspaceMembers.workspaceId);

describe("decideUserCreate", () => {
  it("allows the invited address with its link token", async () => {
    const { token } = await issue();

    expect(
      await decideUserCreate(db, { email: "new@example.test", token, now }),
    ).toEqual({ allowed: true });
  });

  it("allows the address however it is capitalised", async () => {
    const { token } = await issue();

    expect(
      await decideUserCreate(db, { email: "New@Example.Test", token, now }),
    ).toEqual({ allowed: true });
  });

  it.each([undefined, null, "", "junk", "a".repeat(43)])(
    "refuses when the token is %j",
    async (token) => {
      await issue();

      expect(
        await decideUserCreate(db, { email: "new@example.test", token, now }),
      ).toEqual({ allowed: false, reason: "no_grant" });
    },
  );

  it("refuses someone else's address even with a real token", async () => {
    const { token } = await issue();

    expect(
      await decideUserCreate(db, { email: "thief@example.test", token, now }),
    ).toEqual({ allowed: false, reason: "email_mismatch" });
  });

  it("refuses an expired link", async () => {
    const { token } = await issue();

    expect(
      await decideUserCreate(db, {
        email: "new@example.test",
        token,
        now: weekLater,
      }),
    ).toEqual({ allowed: false, reason: "expired" });
  });
});

describe("provisionUser", () => {
  it("adds the new account to the preset projects and uses up the grant", async () => {
    const issued = await issue();
    const user = await seedUser(db, { email: "new@example.test" });

    const result = await provisionUser(db, {
      userId: user.id,
      email: user.email,
      now,
    });

    expect(result).toEqual({ provisioned: true, projectsAdded: 2 });

    const memberships = await membershipsOf(user.id);
    expect(memberships).toMatchObject([
      { workspaceId: community.id, role: "member", status: "active" },
      { workspaceId: coursemate.id, role: "guest", status: "active" },
    ]);
    expect(memberships.every((m) => m.email === "new@example.test")).toBe(true);

    const [memberRole] = await db
      .select({ id: workspaceRoles.id })
      .from(workspaceRoles)
      .where(
        and(
          eq(workspaceRoles.workspaceId, community.id),
          eq(workspaceRoles.name, "member"),
        ),
      );
    expect(memberships[0]?.roleId).toBe(memberRole?.id);

    const [grant] = await db
      .select()
      .from(hubAccessGrants)
      .where(eq(hubAccessGrants.publicId, issued.publicId));
    expect(grant).toMatchObject({ consumedAt: now, consumedBy: user.id });
  });

  it("logs the registration under the new member's own name", async () => {
    const issued = await issue();
    const user = await seedUser(db, { email: "new@example.test" });

    await provisionUser(db, { userId: user.id, email: user.email, now });

    const [entry] = await listAudit(db, { limit: 10, offset: 0 });
    expect(entry).toMatchObject({
      action: "grant.consumed",
      actorUserId: user.id,
      actorEmail: "new@example.test",
      entityType: "grant",
      entityId: issued.publicId,
    });
  });

  it("does nothing the second time", async () => {
    await issue();
    const user = await seedUser(db, { email: "new@example.test" });
    await provisionUser(db, { userId: user.id, email: user.email, now });
    const auditBefore = await listAudit(db, { limit: 50, offset: 0 });

    const again = await provisionUser(db, {
      userId: user.id,
      email: user.email,
      now,
    });

    expect(again).toEqual({ provisioned: false, projectsAdded: 0 });
    expect(await membershipsOf(user.id)).toHaveLength(2);
    expect(await listAudit(db, { limit: 50, offset: 0 })).toEqual(auditBefore);
  });

  it("does nothing for an account that never had a grant", async () => {
    const legacy = await seedUser(db, { email: "legacy@example.test" });

    expect(
      await provisionUser(db, { userId: legacy.id, email: legacy.email, now }),
    ).toEqual({ provisioned: false, projectsAdded: 0 });
    expect(await membershipsOf(legacy.id)).toEqual([]);
  });

  it("finishes the job after an interrupted first attempt", async () => {
    await issue();
    const user = await seedUser(db, { email: "new@example.test" });
    // The first attempt got as far as one membership, then the process died.
    await ensureProjectMember(db, {
      userId: user.id,
      email: user.email,
      workspaceId: community.id,
      role: "member",
      addedBy: admin.id,
    });

    const result = await provisionUser(db, {
      userId: user.id,
      email: user.email,
      now,
    });

    expect(result).toEqual({ provisioned: true, projectsAdded: 1 });
    expect(await membershipsOf(user.id)).toHaveLength(2);
  });

  it("matches the grant however the account's address is capitalised", async () => {
    await issue("new@example.test");
    const user = await seedUser(db, { email: "new@example.test" });

    const result = await provisionUser(db, {
      userId: user.id,
      email: "New@Example.TEST",
      now,
    });

    expect(result.provisioned).toBe(true);
  });

  it("still completes when the link's deadline passed after sign-up", async () => {
    // The account exists, so it passed the gate while the link was good; a
    // retry that happens to run later must not leave it without projects.
    await issue();
    const user = await seedUser(db, { email: "new@example.test" });

    const result = await provisionUser(db, {
      userId: user.id,
      email: user.email,
      now: weekLater,
    });

    expect(result).toEqual({ provisioned: true, projectsAdded: 2 });
  });

  it("ignores a grant that was revoked", async () => {
    const issued = await issue();
    const user = await seedUser(db, { email: "new@example.test" });
    await db
      .update(hubAccessGrants)
      .set({ revokedAt: now })
      .where(eq(hubAccessGrants.publicId, issued.publicId));

    expect(
      await provisionUser(db, { userId: user.id, email: user.email, now }),
    ).toEqual({ provisioned: false, projectsAdded: 0 });
    expect(await membershipsOf(user.id)).toEqual([]);
  });
});
