import { TRPCError } from "@trpc/server";

import type { dbClient } from "@kan/db/client";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";

/**
 * Hub rules enforced inside Kan's own procedures. Each is called from one
 * registered seam (docs/hub/UPSTREAM_SEAMS.md).
 *
 * `@kan/hub` is imported inside the function, not at the top: Kan's own
 * router unit tests mock `@kan/shared/utils` wholesale, and loading the Hub
 * (and with it the database schema) when the router module loads would break
 * them. Importing on first use keeps Kan's module graph exactly as upstream.
 */

/** Projects (Kan workspaces) are created by back-office admins only. */
export async function assertCanCreateProject(
  db: dbClient,
  userId: string,
): Promise<void> {
  const { can, getAccessFacts } = await import("@kan/hub/accounts");
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
