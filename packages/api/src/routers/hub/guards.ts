import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { can, getAccessFacts } from "@kan/hub/accounts";

/**
 * Hub rules enforced inside Kan's own procedures. Each is called from one
 * registered seam (docs/hub/UPSTREAM_SEAMS.md).
 */

/** Projects (Kan workspaces) are created by back-office admins only. */
export async function assertCanCreateProject(
  db: dbClient,
  userId: string,
): Promise<void> {
  const facts = await getAccessFacts(db, userId);
  if (!can(facts.role, "projects.create")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只有后台管理员能新建项目，请联系管理员。",
    });
  }
}

/**
 * Templates are reusable structure for the whole project, so only the
 * project's admins may create them; members create ordinary boards.
 */
export async function assertCanCreateTemplate(
  db: dbClient,
  userId: string,
  workspaceId: number,
): Promise<void> {
  const isProjectAdmin = await workspaceRepo.isUserInWorkspace(
    db,
    userId,
    workspaceId,
    "admin",
  );
  if (!isProjectAdmin) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "只有项目管理员能新建模板。",
    });
  }
}
