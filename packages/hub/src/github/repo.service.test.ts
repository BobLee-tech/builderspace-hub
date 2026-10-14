import { beforeEach, describe, expect, it } from "vitest";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { hubProjectRepos } from "../schema";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import { MAX_REPOS_PER_PROJECT } from "./repo.policy";
import {
  addProjectRepo,
  listProjectRepos,
  listReposForUser,
  removeProjectRepo,
} from "./repo.service";

let db: Db;
let owner: { id: string; email: string };
let actor: AuditActor;
let coursemate: { id: number; publicId: string; name: string };
let echo: { id: number; publicId: string; name: string };

const repoCount = async () => (await db.select().from(hubProjectRepos)).length;
const auditActions = async () =>
  (await listAudit(db, { limit: 50, offset: 0 })).map((e) => e.action);

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
  actor = { userId: owner.id, email: owner.email };
  coursemate = await seedProject(db, owner, { name: "CourseMate" });
  echo = await seedProject(db, owner, { name: "EchoAgent" });
});

describe("addProjectRepo", () => {
  it("links a repository in its normal form and logs it", async () => {
    const linked = await addProjectRepo(db, actor, {
      projectPublicId: coursemate.publicId,
      repo: "https://github.com/Club/CourseMate-App.git",
    });

    expect(linked).toMatchObject({
      fullName: "club/coursemate-app",
      url: "https://github.com/club/coursemate-app",
    });
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "project.repo_linked",
      entityId: coursemate.publicId,
      summary: "给「CourseMate」关联仓库 club/coursemate-app",
    });
  });

  it("treats a different spelling of the same repository as a duplicate", async () => {
    await addProjectRepo(db, actor, {
      projectPublicId: coursemate.publicId,
      repo: "club/app",
    });

    await expect(
      addProjectRepo(db, actor, {
        projectPublicId: coursemate.publicId,
        repo: "github.com/CLUB/App",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    // Another project may share it.
    await addProjectRepo(db, actor, {
      projectPublicId: echo.publicId,
      repo: "club/app",
    });
    expect(await repoCount()).toBe(2);
  });

  it("refuses a bad name or an unknown project, and writes nothing", async () => {
    await expect(
      addProjectRepo(db, actor, {
        projectPublicId: coursemate.publicId,
        repo: "not a repo",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      addProjectRepo(db, actor, {
        projectPublicId: "nonexistent01",
        repo: "club/app",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await repoCount()).toBe(0);
    expect(await auditActions()).toEqual([]);
  });

  it("stops at the per-project limit", async () => {
    for (let i = 0; i < MAX_REPOS_PER_PROJECT; i++) {
      await addProjectRepo(db, actor, {
        projectPublicId: coursemate.publicId,
        repo: `club/repo-${i}`,
      });
    }

    await expect(
      addProjectRepo(db, actor, {
        projectPublicId: coursemate.publicId,
        repo: "club/one-too-many",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
});

describe("removeProjectRepo", () => {
  it("unlinks and logs it", async () => {
    const linked = await addProjectRepo(db, actor, {
      projectPublicId: coursemate.publicId,
      repo: "club/app",
    });

    await removeProjectRepo(db, actor, linked.publicId);

    expect(await repoCount()).toBe(0);
    expect(await auditActions()).toEqual([
      "project.repo_unlinked",
      "project.repo_linked",
    ]);
  });

  it("answers NOT_FOUND for a link that does not exist", async () => {
    await expect(
      removeProjectRepo(db, actor, "nonexistent01"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("listProjectRepos", () => {
  it("lists every project, with or without repositories", async () => {
    await addProjectRepo(db, actor, {
      projectPublicId: coursemate.publicId,
      repo: "club/web",
    });
    await addProjectRepo(db, actor, {
      projectPublicId: coursemate.publicId,
      repo: "club/api",
    });

    const projects = await listProjectRepos(db);

    expect(
      projects.map((p) => [p.project.name, p.repos.map((r) => r.fullName)]),
    ).toEqual([
      ["CourseMate", ["club/api", "club/web"]],
      ["EchoAgent", []],
    ]);
  });
});

describe("listReposForUser", () => {
  it("gives only repositories of projects the person can see", async () => {
    const member = await seedUser(db, { email: "member@example.test" });
    await ensureProjectMember(db, {
      userId: member.id,
      email: member.email,
      workspaceId: coursemate.id,
      role: "member",
      addedBy: owner.id,
    });
    await addProjectRepo(db, actor, {
      projectPublicId: coursemate.publicId,
      repo: "club/coursemate",
    });
    await addProjectRepo(db, actor, {
      projectPublicId: echo.publicId,
      repo: "club/echoagent",
    });

    expect(await listReposForUser(db, member.id)).toEqual([
      {
        project: { publicId: coursemate.publicId, name: "CourseMate" },
        fullName: "club/coursemate",
      },
    ]);
    const outsider = await seedUser(db);
    expect(await listReposForUser(db, outsider.id)).toEqual([]);
  });
});
