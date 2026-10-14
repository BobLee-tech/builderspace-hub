import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";

import type { DbOrTx } from "../db";
import type { NewEvent } from "./activity.policy";
import { hubGitHubAccounts, hubGitHubEvents } from "../schema";

export type ConnectionRow = typeof hubGitHubAccounts.$inferSelect;
export type EventRow = typeof hubGitHubEvents.$inferSelect;

export async function findConnection(
  db: DbOrTx,
  userId: string,
): Promise<ConnectionRow | undefined> {
  const [row] = await db
    .select()
    .from(hubGitHubAccounts)
    .where(eq(hubGitHubAccounts.userId, userId))
    .limit(1);
  return row;
}

/** Connecting again replaces the earlier connection and its tokens. */
export async function saveConnection(
  db: DbOrTx,
  row: Omit<ConnectionRow, "connectedAt" | "lastSyncedAt"> & {
    connectedAt: Date;
  },
): Promise<void> {
  await db
    .insert(hubGitHubAccounts)
    .values({ ...row, lastSyncedAt: null })
    .onConflictDoUpdate({
      target: hubGitHubAccounts.userId,
      set: { ...row, lastSyncedAt: null },
    });
}

export async function updateTokens(
  db: DbOrTx,
  userId: string,
  tokens: Pick<
    ConnectionRow,
    | "accessToken"
    | "accessTokenExpiresAt"
    | "refreshToken"
    | "refreshTokenExpiresAt"
  >,
): Promise<void> {
  await db
    .update(hubGitHubAccounts)
    .set(tokens)
    .where(eq(hubGitHubAccounts.userId, userId));
}

export async function markSynced(
  db: DbOrTx,
  userId: string,
  at: Date,
): Promise<void> {
  await db
    .update(hubGitHubAccounts)
    .set({ lastSyncedAt: at })
    .where(eq(hubGitHubAccounts.userId, userId));
}

/** Removes the connection and everything synced through it. */
export async function deleteConnection(
  db: DbOrTx,
  userId: string,
): Promise<void> {
  await db.delete(hubGitHubEvents).where(eq(hubGitHubEvents.userId, userId));
  await db
    .delete(hubGitHubAccounts)
    .where(eq(hubGitHubAccounts.userId, userId));
}

/** Adds new events; one already stored keeps its row but takes the new title. */
export async function upsertEvents(
  db: DbOrTx,
  userId: string,
  events: readonly NewEvent[],
): Promise<void> {
  if (events.length === 0) return;
  await db
    .insert(hubGitHubEvents)
    .values(events.map((event) => ({ ...event, userId })))
    .onConflictDoUpdate({
      target: [
        hubGitHubEvents.userId,
        hubGitHubEvents.repoFullName,
        hubGitHubEvents.kind,
        hubGitHubEvents.ref,
      ],
      set: {
        title: sql`excluded."title"`,
        url: sql`excluded."url"`,
        occurredAt: sql`excluded."occurredAt"`,
      },
    });
}

/** A person's events in the given repositories since `from`, newest first. */
export async function listEvents(
  db: DbOrTx,
  userId: string,
  repos: readonly string[],
  from: Date,
): Promise<EventRow[]> {
  if (repos.length === 0) return [];
  return db
    .select()
    .from(hubGitHubEvents)
    .where(
      and(
        eq(hubGitHubEvents.userId, userId),
        inArray(hubGitHubEvents.repoFullName, [...repos]),
        gte(hubGitHubEvents.occurredAt, from),
      ),
    )
    .orderBy(desc(hubGitHubEvents.occurredAt), desc(hubGitHubEvents.id));
}
