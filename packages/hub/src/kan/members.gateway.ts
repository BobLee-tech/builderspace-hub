import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";

import * as memberRepo from "@kan/db/repository/member.repo";
import * as permissionRepo from "@kan/db/repository/permission.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { users, workspaceMembers, workspaces } from "@kan/db/schema";

import type { Db, DbOrTx } from "../db";
import type { ProjectRole } from "../schema";
import { hubAccounts } from "../schema";

export type EnsureMemberResult = "added" | "already_member";

/**
 * Makes a user an active member of a project, once.
 *
 * `workspace_members` has no unique constraint on (workspace, user), so the
 * membership is checked first; calling this twice does not create a second row.
 */
export async function ensureProjectMember(
  db: Db,
  input: {
    userId: string;
    email: string;
    workspaceId: number;
    role: ProjectRole;
    /** Who granted the access; the new member themselves when unknown. */
    addedBy: string;
  },
): Promise<EnsureMemberResult> {
  const alreadyMember = await workspaceRepo.isUserInWorkspace(
    db,
    input.userId,
    input.workspaceId,
  );
  if (alreadyMember) return "already_member";

  const role = await permissionRepo.getRoleByWorkspaceIdAndName(
    db,
    input.workspaceId,
    input.role,
  );

  await memberRepo.create(db, {
    userId: input.userId,
    email: input.email,
    workspaceId: input.workspaceId,
    createdBy: input.addedBy,
    role: input.role,
    roleId: role?.id ?? null,
    status: "active",
  });

  return "added";
}

export interface ProjectMemberRow {
  workspaceId: number;
  projectPublicId: string;
  projectName: string;
  userId: string;
  /** Their name, or their e-mail when they never set one. */
  name: string;
  email: string;
  role: ProjectRole;
}

/**
 * The active members of live projects (all of them, or the given ones),
 * leaving out accounts suspended in the back office. Ordered by project, then
 * by name.
 *
 * Kan only lists the members of one workspace at a time, with far more than
 * this needs, so this reads its tables directly.
 */
export async function listProjectMembers(
  db: DbOrTx,
  workspaceIds?: number[],
): Promise<ProjectMemberRow[]> {
  if (workspaceIds && workspaceIds.length === 0) return [];
  const rows = await db
    .select({
      workspaceId: workspaces.id,
      projectPublicId: workspaces.publicId,
      projectName: workspaces.name,
      userId: workspaceMembers.userId,
      name: sql<string>`coalesce(${users.name}, ${users.email})`,
      email: users.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .leftJoin(hubAccounts, eq(hubAccounts.userId, users.id))
    .where(
      and(
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt),
        or(isNull(hubAccounts.status), eq(hubAccounts.status, "active")),
        workspaceIds ? inArray(workspaces.id, workspaceIds) : undefined,
      ),
    )
    .orderBy(asc(workspaces.id), asc(users.name), asc(users.email));

  // A membership row with no user is an invitation nobody accepted.
  return rows.flatMap((row) =>
    row.userId ? [{ ...row, userId: row.userId }] : [],
  );
}
