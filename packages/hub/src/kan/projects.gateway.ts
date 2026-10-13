import { asc, isNull } from "drizzle-orm";

import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { workspaces } from "@kan/db/schema";

import type { Db } from "../db";

export interface ProjectRef {
  id: number;
  publicId: string;
  name: string;
}

/** A project is a Kan workspace. Deleted workspaces are treated as absent. */
export async function findProjectByPublicId(
  db: Db,
  publicId: string,
): Promise<ProjectRef | null> {
  const workspace = await workspaceRepo.getByPublicId(db, publicId);
  if (!workspace || workspace.deletedAt) return null;

  return {
    id: workspace.id,
    publicId: workspace.publicId,
    name: workspace.name,
  };
}

/**
 * Every project on the instance, oldest first.
 *
 * Kan has no repository function for this (it only lists a user's own
 * workspaces), so this reads the table directly. Gateways may read Kan's tables
 * when nothing upstream fits; they never write to them.
 */
export async function listProjects(db: Db): Promise<ProjectRef[]> {
  return db
    .select({
      id: workspaces.id,
      publicId: workspaces.publicId,
      name: workspaces.name,
    })
    .from(workspaces)
    .where(isNull(workspaces.deletedAt))
    .orderBy(asc(workspaces.id));
}
