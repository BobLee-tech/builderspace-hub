import type { Permission } from "@kan/shared";
import { permissionCategories } from "@kan/shared";

import type { Decision } from "../accounts/roles";

/**
 * Which of Kan's per-project permissions the back office lets people change.
 * Pure: shared by the server, which enforces it, and the browser.
 *
 * Kan gives every project three roles. Admin always has everything and Kan
 * refuses to change it, so only member and guest are editable here. Deleting
 * a project and managing its billing stay with admins, as in Kan itself.
 */

export const editableProjectRoles = ["member", "guest"] as const;
export type EditableProjectRole = (typeof editableProjectRoles)[number];

const ADMIN_ONLY: readonly Permission[] = [
  "workspace:delete",
  "workspace:manage",
];

/** The permissions the page lists, grouped the way Kan groups them. */
export const permissionGroups = (
  Object.keys(permissionCategories) as (keyof typeof permissionCategories)[]
)
  .map((key) => ({
    key,
    permissions: (
      permissionCategories[key].permissions as readonly Permission[]
    ).filter((permission) => !ADMIN_ONLY.includes(permission)),
  }))
  .filter((group) => group.permissions.length > 0);

export const editablePermissions: readonly Permission[] =
  permissionGroups.flatMap((group) => group.permissions);

export function isEditableRole(role: string): role is EditableProjectRole {
  return (editableProjectRoles as readonly string[]).includes(role);
}

export function checkRolePermissionChange(input: {
  role: string;
  permission: string;
}): Decision {
  if (!isEditableRole(input.role)) {
    return { allowed: false, reason: "管理员总是拥有全部权限，不能修改" };
  }
  if (!(editablePermissions as readonly string[]).includes(input.permission)) {
    return { allowed: false, reason: "这项权限只属于项目管理员" };
  }
  return { allowed: true };
}

export const projectRoleLabels: Record<"admin" | EditableProjectRole, string> =
  {
    admin: "管理员",
    member: "成员",
    guest: "访客",
  };

/** What each permission lets someone do, in the words the page uses. */
export const permissionLabels: Record<Permission, string> = {
  "workspace:view": "查看项目",
  "workspace:edit": "修改项目名称和设置",
  "workspace:delete": "删除项目",
  "workspace:manage": "管理计费",
  "board:view": "查看看板",
  "board:create": "新建看板",
  "board:edit": "修改看板",
  "board:delete": "删除看板",
  "list:view": "查看列",
  "list:create": "新建列",
  "list:edit": "修改列",
  "list:delete": "删除列",
  "card:view": "查看任务",
  "card:create": "新建任务",
  "card:edit": "修改任务",
  "card:delete": "删除任务",
  "comment:view": "查看评论",
  "comment:create": "发表评论",
  "comment:edit": "修改评论",
  "comment:delete": "删除评论",
  "member:view": "查看成员",
  "member:invite": "邀请成员",
  "member:edit": "修改成员的角色和权限",
  "member:remove": "移出成员",
};

export const permissionGroupLabels: Record<
  (typeof permissionGroups)[number]["key"],
  string
> = {
  workspace: "项目",
  board: "看板",
  list: "列",
  card: "任务",
  comment: "评论",
  member: "成员",
};
