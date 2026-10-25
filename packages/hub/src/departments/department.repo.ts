import { and, asc, eq, inArray, sql } from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubDepartmentMembers, hubDepartments } from "../schema";

export type DepartmentRow = typeof hubDepartments.$inferSelect;

/** Every department, in display order. */
export async function listDepartments(db: DbOrTx): Promise<DepartmentRow[]> {
  return db
    .select()
    .from(hubDepartments)
    .orderBy(asc(hubDepartments.position), asc(hubDepartments.id));
}

export async function findDepartment(
  db: DbOrTx,
  publicId: string,
): Promise<DepartmentRow | null> {
  const [row] = await db
    .select()
    .from(hubDepartments)
    .where(eq(hubDepartments.publicId, publicId))
    .limit(1);
  return row ?? null;
}

/** Adds a department after the last one. */
export async function insertDepartment(
  db: DbOrTx,
  row: { publicId: string; name: string; createdBy: string | null },
): Promise<DepartmentRow> {
  const [created] = await db
    .insert(hubDepartments)
    .values({
      ...row,
      position: sql`(SELECT coalesce(max(${hubDepartments.position}), 0) + 1 FROM ${hubDepartments})`,
    })
    .returning();
  if (!created) throw new Error("insertDepartment: no row returned");
  return created;
}

export async function renameDepartment(
  db: DbOrTx,
  id: number,
  name: string,
): Promise<void> {
  await db
    .update(hubDepartments)
    .set({ name })
    .where(eq(hubDepartments.id, id));
}

export async function setDepartmentPosition(
  db: DbOrTx,
  id: number,
  position: number,
): Promise<void> {
  await db
    .update(hubDepartments)
    .set({ position })
    .where(eq(hubDepartments.id, id));
}

/* ── members ─────────────────────────────────────────────────────────── */

export interface DepartmentMemberRow {
  departmentId: number;
  workspaceId: number;
  userId: string;
}

const memberColumns = {
  departmentId: hubDepartmentMembers.departmentId,
  workspaceId: hubDepartmentMembers.workspaceId,
  userId: hubDepartmentMembers.userId,
};

/** Every placement in a department, or those in the given projects. */
export async function listDepartmentMembers(
  db: DbOrTx,
  workspaceIds?: number[],
): Promise<DepartmentMemberRow[]> {
  if (workspaceIds && workspaceIds.length === 0) return [];
  return db
    .select(memberColumns)
    .from(hubDepartmentMembers)
    .where(
      workspaceIds
        ? inArray(hubDepartmentMembers.workspaceId, workspaceIds)
        : undefined,
    );
}

/** The departments one person was put in, in any project. */
export async function departmentsOfUser(
  db: DbOrTx,
  userId: string,
): Promise<DepartmentMemberRow[]> {
  return db
    .select(memberColumns)
    .from(hubDepartmentMembers)
    .where(eq(hubDepartmentMembers.userId, userId));
}

/** Returns false when the person already was in the department. */
export async function addDepartmentMember(
  db: DbOrTx,
  row: DepartmentMemberRow & { addedBy: string | null },
): Promise<boolean> {
  const inserted = await db
    .insert(hubDepartmentMembers)
    .values(row)
    .onConflictDoNothing()
    .returning({ userId: hubDepartmentMembers.userId });
  return inserted.length > 0;
}

/** Returns false when the person was not in the department. */
export async function removeDepartmentMember(
  db: DbOrTx,
  row: DepartmentMemberRow,
): Promise<boolean> {
  const removed = await db
    .delete(hubDepartmentMembers)
    .where(
      and(
        eq(hubDepartmentMembers.departmentId, row.departmentId),
        eq(hubDepartmentMembers.workspaceId, row.workspaceId),
        eq(hubDepartmentMembers.userId, row.userId),
      ),
    )
    .returning({ userId: hubDepartmentMembers.userId });
  return removed.length > 0;
}
