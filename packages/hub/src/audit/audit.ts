import { count, desc } from "drizzle-orm";

import { generateUID } from "@kan/shared/utils";

import type { Db, DbOrTx, Tx } from "../db";
import { hubAuditLog } from "../schema";

/**
 * Every kind of change the log can hold. Add a member here when a feature gains
 * a new mutation; the name is `<entity>.<past-tense verb>`.
 */
export type AuditAction =
  | "grant.issued"
  | "grant.revoked"
  | "grant.role_changed"
  | "grant.consumed"
  | "project.created"
  | "board.created"
  | "account.created"
  | "account.renamed"
  | "account.password_reset"
  | "account.role_changed"
  | "account.suspended"
  | "account.restored"
  | "account.project_role_changed"
  | "account.project_removed";

export interface AuditActor {
  userId: string | null;
  email: string;
}

/** The actor for changes made from the operations command line. */
export const CLI_ACTOR: AuditActor = { userId: null, email: "cli" };

export interface AuditEntry {
  actor: AuditActor;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  /** One sentence a person can read in the log, in Chinese. */
  summary: string;
  detail?: Record<string, unknown>;
}

export type AuditLogRow = typeof hubAuditLog.$inferSelect;

export async function recordAudit(
  db: DbOrTx,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(hubAuditLog).values({
    publicId: generateUID(),
    actorUserId: entry.actor.userId,
    actorEmail: entry.actor.email,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    summary: entry.summary,
    detail: entry.detail ?? null,
  });
}

/**
 * Runs a change and its audit entry in one transaction, so the log can never
 * disagree with the data: either both are written or neither is.
 *
 * @param work     the change itself; use `tx` for every query
 * @param describe builds the entry from the work's result
 */
export async function withAudit<T>(
  db: Db,
  work: (tx: Tx) => Promise<T>,
  describe: (result: T) => AuditEntry,
): Promise<T> {
  return db.transaction(async (tx) => {
    const result = await work(tx);
    await recordAudit(tx, describe(result));
    return result;
  });
}

export async function listAudit(
  db: DbOrTx,
  page: { limit: number; offset: number },
): Promise<AuditLogRow[]> {
  return db
    .select()
    .from(hubAuditLog)
    .orderBy(desc(hubAuditLog.at), desc(hubAuditLog.id))
    .limit(page.limit)
    .offset(page.offset);
}

export async function countAudit(db: DbOrTx): Promise<number> {
  const [row] = await db.select({ total: count() }).from(hubAuditLog);
  return row?.total ?? 0;
}
