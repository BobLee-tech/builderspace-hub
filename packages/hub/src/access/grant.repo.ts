import { and, count, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";

import { workspaces } from "@kan/db/schema";
import { generateUID } from "@kan/shared/utils";

import type { DbOrTx } from "../db";
import type { GrantSource, HubRole, ProjectRole } from "../schema";
import { hubAccessGrantProjects, hubAccessGrants } from "../schema";

export type GrantRow = typeof hubAccessGrants.$inferSelect;

const isOpen = and(
  isNull(hubAccessGrants.consumedAt),
  isNull(hubAccessGrants.revokedAt),
);

export async function insertGrant(
  db: DbOrTx,
  values: {
    email: string;
    tokenHash: string;
    hubRole: HubRole | null;
    note: string | null;
    source: GrantSource;
    expiresAt: Date;
    createdBy: string | null;
    createdAt: Date;
  },
): Promise<GrantRow> {
  const [row] = await db
    .insert(hubAccessGrants)
    .values({ publicId: generateUID(), ...values })
    .returning();

  if (!row) throw new Error("insertGrant: insert returned no row");
  return row;
}

export async function insertGrantProjects(
  db: DbOrTx,
  grantId: number,
  projects: { workspaceId: number; role: ProjectRole }[],
): Promise<void> {
  if (projects.length === 0) return;

  await db
    .insert(hubAccessGrantProjects)
    .values(projects.map((project) => ({ grantId, ...project })));
}

export async function listGrantProjects(
  db: DbOrTx,
  grantId: number,
): Promise<{ workspaceId: number; role: ProjectRole }[]> {
  return db
    .select({
      workspaceId: hubAccessGrantProjects.workspaceId,
      role: hubAccessGrantProjects.role,
    })
    .from(hubAccessGrantProjects)
    .where(eq(hubAccessGrantProjects.grantId, grantId))
    .orderBy(hubAccessGrantProjects.id);
}

export async function findGrantByTokenHash(
  db: DbOrTx,
  tokenHash: string,
): Promise<GrantRow | null> {
  const [row] = await db
    .select()
    .from(hubAccessGrants)
    .where(eq(hubAccessGrants.tokenHash, tokenHash))
    .limit(1);

  return row ?? null;
}

export async function findGrantByPublicId(
  db: DbOrTx,
  publicId: string,
): Promise<GrantRow | null> {
  const [row] = await db
    .select()
    .from(hubAccessGrants)
    .where(eq(hubAccessGrants.publicId, publicId))
    .limit(1);

  return row ?? null;
}

/** The grant for this address that is neither used nor revoked, if any. */
export async function findOpenGrantByEmail(
  db: DbOrTx,
  email: string,
): Promise<GrantRow | null> {
  const [row] = await db
    .select()
    .from(hubAccessGrants)
    .where(and(eq(hubAccessGrants.email, email), isOpen))
    .limit(1);

  return row ?? null;
}

/**
 * Marks an open grant as used. Returns false when it was no longer open, so
 * two concurrent attempts cannot both succeed.
 */
export async function markGrantConsumed(
  db: DbOrTx,
  grantId: number,
  by: { userId: string; at: Date },
): Promise<boolean> {
  const updated = await db
    .update(hubAccessGrants)
    .set({ consumedAt: by.at, consumedBy: by.userId })
    .where(and(eq(hubAccessGrants.id, grantId), isOpen))
    .returning({ id: hubAccessGrants.id });

  return updated.length > 0;
}

/**
 * Changes the back-office role an open grant will give. Returns false when it
 * was no longer open.
 */
export async function setGrantHubRole(
  db: DbOrTx,
  grantId: number,
  hubRole: HubRole | null,
): Promise<boolean> {
  const updated = await db
    .update(hubAccessGrants)
    .set({ hubRole })
    .where(and(eq(hubAccessGrants.id, grantId), isOpen))
    .returning({ id: hubAccessGrants.id });

  return updated.length > 0;
}

/** Marks an open grant as revoked. Returns false when it was no longer open. */
export async function markGrantRevoked(
  db: DbOrTx,
  grantId: number,
  by: { userId: string | null; at: Date },
): Promise<boolean> {
  const updated = await db
    .update(hubAccessGrants)
    .set({ revokedAt: by.at, revokedBy: by.userId })
    .where(and(eq(hubAccessGrants.id, grantId), isOpen))
    .returning({ id: hubAccessGrants.id });

  return updated.length > 0;
}

/**
 * Undoes a revocation, so the grant is open again. Returns false when it was
 * not a revoked, unused grant. Only one grant per address may be open, so the
 * caller closes any other first.
 */
export async function reopenGrant(
  db: DbOrTx,
  grantId: number,
): Promise<boolean> {
  const updated = await db
    .update(hubAccessGrants)
    .set({ revokedAt: null, revokedBy: null })
    .where(
      and(
        eq(hubAccessGrants.id, grantId),
        isNull(hubAccessGrants.consumedAt),
        isNotNull(hubAccessGrants.revokedAt),
      ),
    )
    .returning({ id: hubAccessGrants.id });

  return updated.length > 0;
}

export async function listGrantsPage(
  db: DbOrTx,
  page: { limit: number; offset: number },
): Promise<{ rows: GrantRow[]; total: number }> {
  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(hubAccessGrants)
      .orderBy(desc(hubAccessGrants.createdAt), desc(hubAccessGrants.id))
      .limit(page.limit)
      .offset(page.offset),
    db.select({ total: count() }).from(hubAccessGrants),
  ]);
  return { rows, total: totals[0]?.total ?? 0 };
}

/** Project names and roles preset on each of the given grants. */
export async function listProjectsOfGrants(
  db: DbOrTx,
  grantIds: number[],
): Promise<Map<number, { projectName: string; role: ProjectRole }[]>> {
  const byGrant = new Map<
    number,
    { projectName: string; role: ProjectRole }[]
  >();
  if (grantIds.length === 0) return byGrant;

  const rows = await db
    .select({
      grantId: hubAccessGrantProjects.grantId,
      projectName: workspaces.name,
      role: hubAccessGrantProjects.role,
    })
    .from(hubAccessGrantProjects)
    .innerJoin(
      workspaces,
      eq(workspaces.id, hubAccessGrantProjects.workspaceId),
    )
    .where(inArray(hubAccessGrantProjects.grantId, grantIds))
    .orderBy(hubAccessGrantProjects.id);

  for (const row of rows) {
    const list = byGrant.get(row.grantId) ?? [];
    list.push({ projectName: row.projectName, role: row.role });
    byGrant.set(row.grantId, list);
  }
  return byGrant;
}

export async function countOpenGrants(db: DbOrTx): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(hubAccessGrants)
    .where(isOpen);
  return row?.total ?? 0;
}

/**
 * Every grant ever issued to these addresses, newest first, for telling what
 * happened to each address's latest link. Addresses must be normalised.
 */
export async function listGrantsByEmails(
  db: DbOrTx,
  emails: string[],
): Promise<GrantRow[]> {
  if (emails.length === 0) return [];
  return db
    .select()
    .from(hubAccessGrants)
    .where(inArray(hubAccessGrants.email, emails))
    .orderBy(desc(hubAccessGrants.createdAt), desc(hubAccessGrants.id));
}
