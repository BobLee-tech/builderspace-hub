import { and, asc, count, eq, inArray } from "drizzle-orm";

import { generateUID } from "@kan/shared/utils";

import type { DbOrTx } from "../db";
import { hubProjectRepos } from "../schema";

export type ProjectRepoRow = typeof hubProjectRepos.$inferSelect;

/** Repositories of the given projects, alphabetically. */
export async function listRepos(
  db: DbOrTx,
  workspaceIds: readonly number[],
): Promise<ProjectRepoRow[]> {
  if (workspaceIds.length === 0) return [];
  return db
    .select()
    .from(hubProjectRepos)
    .where(inArray(hubProjectRepos.workspaceId, [...workspaceIds]))
    .orderBy(asc(hubProjectRepos.fullName));
}

export async function findRepo(
  db: DbOrTx,
  workspaceId: number,
  fullName: string,
): Promise<ProjectRepoRow | undefined> {
  const [row] = await db
    .select()
    .from(hubProjectRepos)
    .where(
      and(
        eq(hubProjectRepos.workspaceId, workspaceId),
        eq(hubProjectRepos.fullName, fullName),
      ),
    )
    .limit(1);
  return row;
}

export async function findRepoByPublicId(
  db: DbOrTx,
  publicId: string,
): Promise<ProjectRepoRow | undefined> {
  const [row] = await db
    .select()
    .from(hubProjectRepos)
    .where(eq(hubProjectRepos.publicId, publicId))
    .limit(1);
  return row;
}

export async function countRepos(
  db: DbOrTx,
  workspaceId: number,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(hubProjectRepos)
    .where(eq(hubProjectRepos.workspaceId, workspaceId));
  return row?.total ?? 0;
}

export async function insertRepo(
  db: DbOrTx,
  repo: { workspaceId: number; fullName: string; createdBy: string | null },
): Promise<ProjectRepoRow> {
  const [row] = await db
    .insert(hubProjectRepos)
    .values({ ...repo, publicId: generateUID() })
    .returning();
  if (!row) throw new Error("insertRepo: insert returned no row");
  return row;
}

export async function deleteRepo(db: DbOrTx, id: number): Promise<void> {
  await db.delete(hubProjectRepos).where(eq(hubProjectRepos.id, id));
}
