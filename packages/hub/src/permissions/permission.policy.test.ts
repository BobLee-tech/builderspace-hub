import { describe, expect, it } from "vitest";

import { allPermissions } from "@kan/shared";

import {
  checkRolePermissionChange,
  editablePermissions,
  permissionGroupLabels,
  permissionGroups,
  permissionLabels,
} from "./permission.policy";

describe("which permissions the back office edits", () => {
  it("lists every Kan permission except the admin-only ones", () => {
    expect([...editablePermissions].sort()).toEqual(
      allPermissions
        .filter((p) => p !== "workspace:delete" && p !== "workspace:manage")
        .sort(),
    );
  });

  it("names every permission and every group", () => {
    for (const permission of allPermissions) {
      expect(permissionLabels[permission]).toBeTruthy();
    }
    for (const group of permissionGroups) {
      expect(permissionGroupLabels[group.key]).toBeTruthy();
    }
  });
});

describe("checkRolePermissionChange", () => {
  it("allows editable permissions on members and guests", () => {
    expect(
      checkRolePermissionChange({ role: "member", permission: "card:delete" }),
    ).toEqual({ allowed: true });
    expect(
      checkRolePermissionChange({ role: "guest", permission: "card:create" }),
    ).toEqual({ allowed: true });
  });

  it("never touches the admin role", () => {
    expect(
      checkRolePermissionChange({ role: "admin", permission: "card:view" }),
    ).toEqual({ allowed: false, reason: "管理员总是拥有全部权限，不能修改" });
  });

  it("keeps deleting a project and billing with admins", () => {
    for (const permission of ["workspace:delete", "workspace:manage", "x:y"]) {
      expect(
        checkRolePermissionChange({ role: "member", permission }).allowed,
      ).toBe(false);
    }
  });
});
