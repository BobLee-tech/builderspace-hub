import { beforeEach, describe, expect, it } from "vitest";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "../testing/test-db";
import {
  createDepartment,
  getDepartmentDirectory,
  moveDepartment,
  renameDepartment,
  setDepartmentMember,
} from "./department.service";

let db: Db;
let admin: AdminActor;
let member: AdminActor;
let project: { id: number; publicId: string; name: string };

const actorOf = (
  user: { id: string; email: string },
  role: AdminActor["role"],
): AdminActor => ({ userId: user.id, email: user.email, role });

beforeEach(async () => {
  db = await createHubTestDb();
  const [a, m] = await Promise.all([
    seedUser(db, { name: "Adam" }),
    seedUser(db, { name: "Mia" }),
  ]);
  await seedHubAccount(db, a.id, { role: "admin" });
  admin = actorOf(a, "admin");
  member = actorOf(m, null);
  project = await seedProject(db, a, { name: "CourseMate" });
  await ensureProjectMember(db, {
    workspaceId: project.id,
    userId: m.id,
    email: m.email,
    role: "member",
    addedBy: a.id,
  });
});

const names = async () =>
  (await getDepartmentDirectory(db, admin)).departments.map((d) => d.name);
const departmentNamed = async (name: string) => {
  const found = (await getDepartmentDirectory(db, admin)).departments.find(
    (d) => d.name === name,
  );
  if (!found) throw new Error(`no department ${name}`);
  return found;
};

describe("the department list", () => {
  it("starts with the club's three departments", async () => {
    expect(await names()).toEqual(["技术", "活动", "运营"]);
  });

  it("adds a department at the end and logs it", async () => {
    const created = await createDepartment(db, admin, { name: "  设计 " });
    expect(created.name).toBe("设计");
    expect(await names()).toEqual(["技术", "活动", "运营", "设计"]);

    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "department.created",
      entityId: created.publicId,
      summary: "新建部门「设计」",
    });
  });

  it("refuses an empty name, a too long one, and one already taken", async () => {
    await expect(
      createDepartment(db, admin, { name: "  " }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createDepartment(db, admin, { name: "部".repeat(21) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createDepartment(db, admin, { name: "技术" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("renames a department, but not onto another's name", async () => {
    const ops = await departmentNamed("活动");
    await renameDepartment(db, admin, {
      departmentPublicId: ops.publicId,
      name: "外联",
    });
    expect(await names()).toEqual(["技术", "外联", "运营"]);
    await expect(
      renameDepartment(db, admin, {
        departmentPublicId: ops.publicId,
        name: "运营",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry?.summary).toBe("部门「活动」改名为「外联」");
  });

  it("moves a department up and down, but not past either end", async () => {
    const marketing = await departmentNamed("运营");
    await moveDepartment(db, admin, {
      departmentPublicId: marketing.publicId,
      direction: "up",
    });
    expect(await names()).toEqual(["技术", "运营", "活动"]);
    await moveDepartment(db, admin, {
      departmentPublicId: marketing.publicId,
      direction: "up",
    });
    expect(await names()).toEqual(["运营", "技术", "活动"]);
    await expect(
      moveDepartment(db, admin, {
        departmentPublicId: marketing.publicId,
        direction: "up",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("is kept by account managers only", async () => {
    await expect(
      createDepartment(db, member, { name: "设计" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const dev = await departmentNamed("技术");
    await expect(
      renameDepartment(db, member, {
        departmentPublicId: dev.publicId,
        name: "研发",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      moveDepartment(db, member, {
        departmentPublicId: dev.publicId,
        direction: "down",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getDepartmentDirectory(db, member)).canManage).toBe(false);
  });
});

describe("people in departments", () => {
  const place = async (
    actor: AdminActor,
    departmentPublicId: string,
    userId: string,
    inIt = true,
  ) =>
    setDepartmentMember(db, actor, {
      departmentPublicId,
      projectPublicId: project.publicId,
      userId,
      member: inIt,
    });

  it("puts a project member in departments and takes them out again", async () => {
    const dev = await departmentNamed("技术");
    const ops = await departmentNamed("活动");
    await place(admin, dev.publicId, member.userId);
    await place(admin, ops.publicId, member.userId);
    // Again is fine: they are already in it.
    await place(admin, dev.publicId, member.userId);

    const directory = await getDepartmentDirectory(db, admin);
    const mia = directory.projects[0]?.members.find(
      (m) => m.userId === member.userId,
    );
    expect(mia?.departments).toEqual([dev.publicId, ops.publicId]);
    expect(directory.departments.find((d) => d.name === "技术")).toMatchObject({
      memberCount: 1,
    });

    await place(admin, dev.publicId, member.userId, false);
    const after = await getDepartmentDirectory(db, admin);
    expect(
      after.projects[0]?.members.find((m) => m.userId === member.userId)
        ?.departments,
    ).toEqual([ops.publicId]);
    await expect(
      place(admin, dev.publicId, member.userId, false),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const entries = await listAudit(db, { limit: 10, offset: 0 });
    expect(entries.map((e) => e.summary)).toContain(
      "把 Mia 移出 CourseMate 的技术",
    );
    expect(entries.map((e) => e.summary)).toContain(
      "把 Mia 加入 CourseMate 的活动",
    );
  });

  it("only takes people who are in the project", async () => {
    const outsider = await seedUser(db, { name: "Oscar" });
    const dev = await departmentNamed("技术");
    await expect(place(admin, dev.publicId, outsider.id)).rejects.toMatchObject(
      { code: "NOT_FOUND" },
    );
  });

  it("is for account managers only", async () => {
    const dev = await departmentNamed("技术");
    await expect(
      place(member, dev.publicId, member.userId),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("puts a new department in every project", async () => {
    const other = await seedProject(
      db,
      { id: admin.userId, email: admin.email },
      { name: "EchoAgent" },
    );
    const design = await createDepartment(db, admin, { name: "设计" });
    await setDepartmentMember(db, admin, {
      departmentPublicId: design.publicId,
      projectPublicId: other.publicId,
      userId: admin.userId,
      member: true,
    });
    const directory = await getDepartmentDirectory(db, admin);
    const adam = (publicId: string) =>
      directory.projects
        .find((p) => p.publicId === publicId)
        ?.members.find((m) => m.userId === admin.userId);
    expect(adam(other.publicId)?.departments).toEqual([design.publicId]);
    expect(adam(project.publicId)?.departments).toEqual([]);
  });
});
