import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { workspaceMembers, workspaces } from "@kan/db/schema";

import type { Db } from "../db";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import { ensureProjectMember } from "./members.gateway";
import { findProjectByPublicId, listProjects } from "./projects.gateway";
import { findUserByEmail } from "./users.gateway";

let db: Db;
let owner: { id: string; email: string };

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
});

describe("findUserByEmail", () => {
  it("finds an account by its normalised address", async () => {
    expect(await findUserByEmail(db, "owner@example.test")).toEqual({
      id: owner.id,
      email: "owner@example.test",
    });
  });

  it("returns null when nobody has that address", async () => {
    expect(await findUserByEmail(db, "nobody@example.test")).toBeNull();
  });
});

describe("projects gateway", () => {
  it("lists live projects oldest first and finds one by id", async () => {
    const first = await seedProject(db, owner, { name: "社群" });
    const second = await seedProject(db, owner, { name: "CourseMate" });

    expect(await listProjects(db)).toEqual([first, second]);
    expect(await findProjectByPublicId(db, second.publicId)).toEqual(second);
  });

  it("treats a deleted project as absent", async () => {
    const project = await seedProject(db, owner);
    await db
      .update(workspaces)
      .set({ deletedAt: new Date() })
      .where(eq(workspaces.id, project.id));

    expect(await listProjects(db)).toEqual([]);
    expect(await findProjectByPublicId(db, project.publicId)).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await findProjectByPublicId(db, "missing12345")).toBeNull();
  });
});

describe("ensureProjectMember", () => {
  it("adds a member once, however often it is called", async () => {
    const project = await seedProject(db, owner);
    const user = await seedUser(db, { email: "new@example.test" });
    const input = {
      userId: user.id,
      email: user.email,
      workspaceId: project.id,
      role: "guest" as const,
      addedBy: owner.id,
    };

    expect(await ensureProjectMember(db, input)).toBe("added");
    expect(await ensureProjectMember(db, input)).toBe("already_member");

    const rows = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      role: "guest",
      status: "active",
      createdBy: owner.id,
    });
  });

  it("leaves the project's creator as they are", async () => {
    const project = await seedProject(db, owner);

    expect(
      await ensureProjectMember(db, {
        userId: owner.id,
        email: owner.email,
        workspaceId: project.id,
        role: "guest",
        addedBy: owner.id,
      }),
    ).toBe("already_member");
  });
});
