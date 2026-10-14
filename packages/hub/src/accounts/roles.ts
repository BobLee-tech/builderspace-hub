/**
 * Back-office roles and what each may do. Pure: shared by the server, which
 * enforces it, and the browser, which only uses it to hide buttons.
 */

export const hubRoles = ["owner", "admin", "viewer"] as const;
export type HubRole = (typeof hubRoles)[number];

export const hubPermissions = [
  /** Open the back office and read its lists. */
  "admin.view",
  /** Add accounts, edit them, reset passwords, suspend, set project roles. */
  "accounts.manage",
  /** Issue and revoke registration links; review applications. */
  "access.manage",
  /** Appoint and remove owners, admins and viewers. */
  "admins.manage",
  "audit.view",
  /** Create projects (Kan workspaces). */
  "projects.create",
] as const;
export type HubPermission = (typeof hubPermissions)[number];

const ROLE_PERMISSIONS: Record<HubRole, readonly HubPermission[]> = {
  owner: hubPermissions,
  admin: [
    "admin.view",
    "accounts.manage",
    "access.manage",
    "audit.view",
    "projects.create",
  ],
  viewer: ["admin.view"],
};

export const roleLabels: Record<HubRole, string> = {
  owner: "所有者",
  admin: "管理员",
  viewer: "只读",
};

/** The single permission check. `null` is an ordinary account. */
export function can(role: HubRole | null, permission: HubPermission): boolean {
  return role !== null && ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: HubRole | null): HubPermission[] {
  return role === null ? [] : [...ROLE_PERMISSIONS[role]];
}

export type Decision = { allowed: true } | { allowed: false; reason: string };

const deny = (reason: string): Decision => ({ allowed: false, reason });

/** May `actorRole` change someone's back-office role from `targetRole` to `newRole`? */
export function canChangeRole(input: {
  actorRole: HubRole | null;
  isSelf: boolean;
  targetRole: HubRole | null;
  newRole: HubRole | null;
  ownerCount: number;
}): Decision {
  if (!can(input.actorRole, "admins.manage")) {
    return deny("只有所有者能任命或撤销后台成员");
  }
  if (input.isSelf) return deny("不能修改自己的后台角色");
  if (input.targetRole === input.newRole) return { allowed: true };
  if (input.targetRole === "owner" && input.ownerCount <= 1) {
    return deny("至少要保留一位所有者");
  }
  return { allowed: true };
}

/** May `actorRole` suspend or restore this account? */
export function canManageStatus(input: {
  actorRole: HubRole | null;
  isSelf: boolean;
  targetRole: HubRole | null;
  targetIsLastActiveOwner: boolean;
}): Decision {
  if (!can(input.actorRole, "accounts.manage")) {
    return deny("没有管理账号的权限");
  }
  if (input.isSelf) return deny("不能停用自己");
  if (input.targetRole !== null && !can(input.actorRole, "admins.manage")) {
    return deny("只有所有者能停用后台成员");
  }
  if (input.targetIsLastActiveOwner) return deny("至少要保留一位可用的所有者");
  return { allowed: true };
}
