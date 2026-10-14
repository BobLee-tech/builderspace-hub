import { beforeEach, describe, expect, it } from "vitest";

import * as permissionRepo from "@kan/db/repository/permission.repo";

import type { Db } from "../db";
import { CLI_ACTOR, listAudit } from "../audit";
import { HubError } from "../shared/errors";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import {
  getPermissionMatrix,
  setProjectRolePermission,
} from "./permission.service";

let db: Db;
let first: { id: number; publicId: string; name: string };
let second: { id: number; publicId: string; name: string };

beforeEach(async () => {
  db = await createHubTestDb();
  const owner = await seedUser(db);
  first = await seedProject(db, owner, { name: "CourseMate" });
  second = await seedProject(db, owner, { name: "EchoAgent" });
});

const memberCan = async (projectId: number, permission: string) => {
  const role = await permissionRepo.getRoleByWorkspaceIdAndName(
    db,
    projectId,
    "member",
  );
  if (!role) throw new Error("no member role");
  return (await permissionRepo.getPermissionsByRoleId(db, role.id)).includes(
    permission as never,
  );
};

describe("getPermissionMatrix", () => {
  it("shows Kan's defaults for members and guests in every project", async () => {
    const { projects } = await getPermissionMatrix(db);

    expect(projects.map((p) => p.project.name)).toEqual([
      "CourseMate",
      "EchoAgent",
    ]);
    expect(projects[0]?.roles.member).toContain("card:create");
    expect(projects[0]?.roles.member).not.toContain("member:invite");
    expect(projects[0]?.roles.guest).toContain("card:view");
    expect(projects[0]?.roles.guest).not.toContain("card:create");
  });
});

describe("setProjectRolePermission", () => {
  it("changes one project and logs it", async () => {
    await setProjectRolePermission(db, CLI_ACTOR, {
      projectPublicId: first.publicId,
      role: "member",
      permission: "card:delete",
      granted: false,
    });

    expect(await memberCan(first.id, "card:delete")).toBe(false);
    expect(await memberCan(second.id, "card:delete")).toBe(true);

    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "project.permission_changed",
      summary: "CourseMate：成员不能删除任务",
    });
  });

  it("changes every project at once", async () => {
    const result = await setProjectRolePermission(db, CLI_ACTOR, {
      projectPublicId: null,
      role: "member",
      permission: "member:invite",
      granted: true,
    });

    expect(result).toEqual({ projects: 2 });
    expect(await memberCan(first.id, "member:invite")).toBe(true);
    expect(await memberCan(second.id, "member:invite")).toBe(true);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry?.summary).toBe("所有项目：成员可以邀请成员");
  });

  it("refuses the admin role, admin-only permissions and unknown projects", async () => {
    const attempt = (change: {
      projectPublicId: string | null;
      role: string;
      permission: string;
    }) => setProjectRolePermission(db, CLI_ACTOR, { ...change, granted: true });

    await expect(
      attempt({
        projectPublicId: null,
        role: "admin",
        permission: "card:view",
      }),
    ).rejects.toEqual(
      new HubError("INVALID_INPUT", "管理员总是拥有全部权限，不能修改"),
    );
    await expect(
      attempt({
        projectPublicId: null,
        role: "member",
        permission: "workspace:delete",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      attempt({
        projectPublicId: "nope",
        role: "member",
        permission: "card:view",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listAudit(db, { limit: 5, offset: 0 })).toEqual([]);
  });
});
