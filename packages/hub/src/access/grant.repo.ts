import { and, eq, isNull } from "drizzle-orm";

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
