import * as memberRepo from "@kan/db/repository/member.repo";
import * as permissionRepo from "@kan/db/repository/permission.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

import type { Db } from "../db";
import type { ProjectRole } from "../schema";

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
