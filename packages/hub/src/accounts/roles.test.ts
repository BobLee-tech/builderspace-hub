import { describe, expect, it } from "vitest";

import type { HubPermission, HubRole } from "./roles";
import {
  can,
  canChangeRole,
  canManageStatus,
  hubPermissions,
  hubRoles,
  permissionsOf,
} from "./roles";

describe("can", () => {
  const matrix: Record<HubRole, HubPermission[]> = {
    owner: [...hubPermissions],
    admin: [
      "admin.view",
      "accounts.manage",
      "access.manage",
      "audit.view",
      "projects.create",
    ],
    viewer: ["admin.view"],
  };

  it.each(hubRoles.flatMap((role) => hubPermissions.map((p) => [role, p])))(
    "%s → %s follows the matrix",
    (role, permission) => {
      expect(can(role as HubRole, permission as HubPermission)).toBe(
        matrix[role as HubRole].includes(permission as HubPermission),
      );
    },
  );

  it("gives an ordinary account (no back-office role) nothing", () => {
    for (const permission of hubPermissions) {
      expect(can(null, permission)).toBe(false);
    }
    expect(permissionsOf(null)).toEqual([]);
  });

  it("lists a role's permissions", () => {
    expect(permissionsOf("viewer")).toEqual(["admin.view"]);
  });
});

describe("canChangeRole", () => {
  const base = {
    actorRole: "owner" as HubRole | null,
    isSelf: false,
    targetRole: null as HubRole | null,
    newRole: "admin" as HubRole | null,
    ownerCount: 1,
  };

  it("lets an owner appoint and remove back-office roles", () => {
    expect(canChangeRole(base)).toEqual({ allowed: true });
    expect(
      canChangeRole({ ...base, targetRole: "admin", newRole: null }),
    ).toEqual({ allowed: true });
  });

  it("does not let an admin touch back-office roles", () => {
    expect(canChangeRole({ ...base, actorRole: "admin" })).toEqual({
      allowed: false,
      reason: "只有所有者能任命或撤销后台成员",
    });
  });

  it("does not let anyone change their own role", () => {
    expect(canChangeRole({ ...base, isSelf: true })).toEqual({
      allowed: false,
      reason: "不能修改自己的后台角色",
    });
  });

  it("protects the last owner", () => {
    expect(
      canChangeRole({ ...base, targetRole: "owner", newRole: "admin" }),
    ).toEqual({ allowed: false, reason: "至少要保留一位所有者" });
    expect(
      canChangeRole({
        ...base,
        targetRole: "owner",
        newRole: "admin",
        ownerCount: 2,
      }),
    ).toEqual({ allowed: true });
  });

  it("treats a no-op as allowed", () => {
    expect(
      canChangeRole({ ...base, targetRole: "admin", newRole: "admin" }),
    ).toEqual({ allowed: true });
  });
});

describe("canManageStatus", () => {
  const base = {
    actorRole: "admin" as HubRole | null,
    isSelf: false,
    targetRole: null as HubRole | null,
    targetIsLastActiveOwner: false,
  };

  it("lets an admin suspend an ordinary account", () => {
    expect(canManageStatus(base)).toEqual({ allowed: true });
  });

  it("needs an owner to suspend someone with a back-office role", () => {
    expect(canManageStatus({ ...base, targetRole: "viewer" })).toEqual({
      allowed: false,
      reason: "只有所有者能停用后台成员",
    });
    expect(
      canManageStatus({ ...base, actorRole: "owner", targetRole: "admin" }),
    ).toEqual({ allowed: true });
  });

  it("never lets someone suspend themselves", () => {
    expect(canManageStatus({ ...base, isSelf: true })).toEqual({
      allowed: false,
      reason: "不能停用自己",
    });
  });

  it("protects the last active owner", () => {
    expect(
      canManageStatus({
        ...base,
        actorRole: "owner",
        targetRole: "owner",
        targetIsLastActiveOwner: true,
      }),
    ).toEqual({ allowed: false, reason: "至少要保留一位可用的所有者" });
  });

  it("refuses an actor without account management", () => {
    expect(canManageStatus({ ...base, actorRole: "viewer" })).toEqual({
      allowed: false,
      reason: "没有管理账号的权限",
    });
  });
});
