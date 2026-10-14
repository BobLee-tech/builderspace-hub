import type { Permission } from "@kan/shared";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { EditableProjectRole } from "./permission.policy";
import { recordAudit } from "../audit";
import {
  listProjectRoles,
  setRolePermission,
} from "../kan/permissions.gateway";
import { listProjects } from "../kan/projects.gateway";
import { HubError } from "../shared/errors";
import {
  checkRolePermissionChange,
  editablePermissions,
  permissionLabels,
  projectRoleLabels,
} from "./permission.policy";

/**
 * What members and guests may do in each project, read and changed from the
 * back office. The data is Kan's own role permissions, so Kan's pages, its
 * API and the Hub's home page all follow a change immediately.
 */

export interface ProjectPermissions {
  project: { publicId: string; name: string };
  /** The editable permissions each role currently has. */
  roles: Record<EditableProjectRole, Permission[]>;
}

export async function getPermissionMatrix(
  db: Db,
): Promise<{ projects: ProjectPermissions[] }> {
  const projects = await listProjects(db);
  return {
    projects: await Promise.all(
      projects.map(async (project) => {
        const roles = await listProjectRoles(db, project.id);
        const permissionsOf = (name: EditableProjectRole) =>
          (roles.find((role) => role.name === name)?.permissions ?? []).filter(
            (permission) => editablePermissions.includes(permission),
          );
        return {
          project: { publicId: project.publicId, name: project.name },
          roles: {
            member: permissionsOf("member"),
            guest: permissionsOf("guest"),
          },
        };
      }),
    ),
  };
}

export interface RolePermissionChange {
  /** One project, or null for every project. */
  projectPublicId: string | null;
  role: string;
  permission: string;
  granted: boolean;
}

/** Turns one permission on or off for a role, in one project or all of them. */
export async function setProjectRolePermission(
  db: Db,
  actor: AuditActor,
  change: RolePermissionChange,
): Promise<{ projects: number }> {
  const decision = checkRolePermissionChange(change);
  if (!decision.allowed) throw new HubError("INVALID_INPUT", decision.reason);
  const role = change.role as EditableProjectRole;
  const permission = change.permission as Permission;

  const all = await listProjects(db);
  const targets = change.projectPublicId
    ? all.filter((project) => project.publicId === change.projectPublicId)
    : all;
  if (targets.length === 0) throw new HubError("NOT_FOUND", "找不到这个项目");

  for (const project of targets) {
    const roles = await listProjectRoles(db, project.id);
    const target = roles.find((candidate) => candidate.name === role);
    if (!target) {
      throw new HubError("NOT_FOUND", `${project.name} 里没有这个角色`);
    }
    await setRolePermission(db, target.id, permission, change.granted);
  }

  const where = change.projectPublicId
    ? (targets[0]?.name ?? change.projectPublicId)
    : "所有项目";
  await recordAudit(db, {
    actor,
    action: "project.permission_changed",
    entityType: "project",
    entityId: change.projectPublicId,
    summary: `${where}：${projectRoleLabels[role]}${change.granted ? "可以" : "不能"}${permissionLabels[permission]}`,
    detail: {
      projects: targets.map((project) => project.publicId),
      role,
      permission,
      granted: change.granted,
    },
  });

  return { projects: targets.length };
}
