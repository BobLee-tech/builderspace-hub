import type { Permission } from "@kan/shared";
import * as permissionRepo from "@kan/db/repository/permission.repo";

import type { Db } from "../db";

export interface ProjectRoleRef {
  id: number;
  name: string;
  permissions: Permission[];
}

/**
 * A project's roles with the permissions each currently grants, as Kan stores
 * them (system roles are created with every project).
 */
export async function listProjectRoles(
  db: Db,
  projectId: number,
): Promise<ProjectRoleRef[]> {
  const roles = await permissionRepo.getRolesByWorkspaceId(db, projectId);
  return Promise.all(
    roles.map(async (role) => ({
      id: role.id,
      name: role.name,
      permissions: await permissionRepo.getPermissionsByRoleId(db, role.id),
    })),
  );
}

/**
 * Grants or withdraws one permission from a role. Idempotent. Takes the
 * database itself, not a transaction: Kan's repositories expect it.
 */
export async function setRolePermission(
  db: Db,
  roleId: number,
  permission: Permission,
  granted: boolean,
): Promise<void> {
  if (granted) {
    await permissionRepo.grantRolePermission(db, roleId, permission);
  } else {
    await permissionRepo.revokeRolePermission(db, roleId, permission);
  }
}
