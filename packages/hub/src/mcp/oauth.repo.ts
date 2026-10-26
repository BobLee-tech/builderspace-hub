import {
  and,
  count,
  desc,
  eq,
  gt,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubMcpConnections, hubOauthClients, hubOauthCodes } from "../schema";

export interface ClientRow {
  id: number;
  clientId: string;
  name: string;
  redirectUris: string[];
}

export async function insertClient(
  db: DbOrTx,
  values: { clientId: string; name: string; redirectUris: string[] },
): Promise<void> {
  await db.insert(hubOauthClients).values(values);
}

export async function findClient(
  db: DbOrTx,
  clientId: string,
): Promise<ClientRow | null> {
  const [row] = await db
    .select({
      id: hubOauthClients.id,
      clientId: hubOauthClients.clientId,
      name: hubOauthClients.name,
      redirectUris: hubOauthClients.redirectUris,
    })
    .from(hubOauthClients)
    .where(eq(hubOauthClients.clientId, clientId))
    .limit(1);
  return row ?? null;
}

export async function insertCode(
  db: DbOrTx,
  values: typeof hubOauthCodes.$inferInsert,
): Promise<void> {
  await db.insert(hubOauthCodes).values(values);
}

/** Deletes the code and returns it: a code can be taken once, even by two requests at once. */
export async function takeCode(db: DbOrTx, codeHash: string) {
  const [row] = await db
    .delete(hubOauthCodes)
    .where(eq(hubOauthCodes.codeHash, codeHash))
    .returning();
  return row ?? null;
}

export async function deleteExpiredCodes(db: DbOrTx, now: Date): Promise<void> {
  await db.delete(hubOauthCodes).where(lt(hubOauthCodes.expiresAt, now));
}

export interface TokenHashes {
  accessTokenHash: string;
  accessExpiresAt: Date;
  refreshTokenHash: string;
  refreshExpiresAt: Date;
}

/** An OAuth connection (`clientId`), or a generated token (`name`, access token only). */
export async function insertConnection(
  db: DbOrTx,
  values: { publicId: string; userId: string; now: Date } & (
    | (TokenHashes & { clientId: number })
    | { name: string; accessTokenHash: string; accessExpiresAt: Date }
  ),
): Promise<void> {
  const { now, ...row } = values;
  await db
    .insert(hubMcpConnections)
    .values({ ...row, createdAt: now, lastUsedAt: now });
}

/** A new sign-in from the same app replaces the old one instead of piling up. */
export async function deleteClientConnections(
  db: DbOrTx,
  userId: string,
  clientId: number,
): Promise<void> {
  await db
    .delete(hubMcpConnections)
    .where(
      and(
        eq(hubMcpConnections.userId, userId),
        eq(hubMcpConnections.clientId, clientId),
      ),
    );
}

/** Live: an OAuth connection that can still refresh, or a token not yet expired. */
const isLive = (now: Date) =>
  or(
    and(
      isNotNull(hubMcpConnections.clientId),
      gt(hubMcpConnections.refreshExpiresAt, now),
    ),
    and(
      isNull(hubMcpConnections.clientId),
      gt(hubMcpConnections.accessExpiresAt, now),
    ),
  );

/** Connections nothing can use any more: no refresh left, or a token past its date. */
export async function deleteDeadConnections(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<void> {
  await db
    .delete(hubMcpConnections)
    .where(
      and(
        eq(hubMcpConnections.userId, userId),
        or(
          lte(hubMcpConnections.refreshExpiresAt, now),
          and(
            isNull(hubMcpConnections.clientId),
            lte(hubMcpConnections.accessExpiresAt, now),
          ),
        ),
      ),
    );
}

export async function countLiveTokens(
  db: DbOrTx,
  userId: string,
  now: Date,
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(hubMcpConnections)
    .where(
      and(
        eq(hubMcpConnections.userId, userId),
        isNull(hubMcpConnections.clientId),
        gt(hubMcpConnections.accessExpiresAt, now),
      ),
    );
  return row?.total ?? 0;
}

/** The app's own name for an OAuth connection, the person's label for a token. */
const displayName = sql<string>`coalesce(${hubOauthClients.name}, ${hubMcpConnections.name}, '')`;

/**
 * Swaps a live refresh token for new tokens in one statement, so of two
 * requests with the same refresh token only one gets through.
 */
export async function rotateConnection(
  db: DbOrTx,
  input: {
    refreshTokenHash: string;
    clientId: number;
    now: Date;
    next: TokenHashes;
  },
): Promise<{ userId: string } | null> {
  const [row] = await db
    .update(hubMcpConnections)
    .set({ ...input.next, lastUsedAt: input.now })
    .where(
      and(
        eq(hubMcpConnections.refreshTokenHash, input.refreshTokenHash),
        eq(hubMcpConnections.clientId, input.clientId),
        gt(hubMcpConnections.refreshExpiresAt, input.now),
      ),
    )
    .returning({ userId: hubMcpConnections.userId });
  return row ?? null;
}

export async function findLiveConnection(
  db: DbOrTx,
  accessTokenHash: string,
  now: Date,
) {
  const [row] = await db
    .select({
      id: hubMcpConnections.id,
      publicId: hubMcpConnections.publicId,
      userId: hubMcpConnections.userId,
      lastUsedAt: hubMcpConnections.lastUsedAt,
      clientName: displayName,
    })
    .from(hubMcpConnections)
    .leftJoin(
      hubOauthClients,
      eq(hubOauthClients.id, hubMcpConnections.clientId),
    )
    .where(
      and(
        eq(hubMcpConnections.accessTokenHash, accessTokenHash),
        gt(hubMcpConnections.accessExpiresAt, now),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function touchConnection(
  db: DbOrTx,
  id: number,
  now: Date,
): Promise<void> {
  await db
    .update(hubMcpConnections)
    .set({ lastUsedAt: now })
    .where(eq(hubMcpConnections.id, id));
}

export async function listLiveConnections(
  db: DbOrTx,
  userId: string,
  now: Date,
) {
  return db
    .select({
      publicId: hubMcpConnections.publicId,
      name: displayName,
      clientId: hubMcpConnections.clientId,
      createdAt: hubMcpConnections.createdAt,
      lastUsedAt: hubMcpConnections.lastUsedAt,
      accessExpiresAt: hubMcpConnections.accessExpiresAt,
      refreshExpiresAt: hubMcpConnections.refreshExpiresAt,
    })
    .from(hubMcpConnections)
    .leftJoin(
      hubOauthClients,
      eq(hubOauthClients.id, hubMcpConnections.clientId),
    )
    .where(and(eq(hubMcpConnections.userId, userId), isLive(now)))
    .orderBy(desc(hubMcpConnections.lastUsedAt), desc(hubMcpConnections.id));
}

/** The connection a token belongs to: its access token or its refresh token. */
export async function findConnectionByToken(
  db: DbOrTx,
  tokenHash: string,
  clientId: number,
) {
  const [row] = await db
    .select({
      id: hubMcpConnections.id,
      publicId: hubMcpConnections.publicId,
      userId: hubMcpConnections.userId,
    })
    .from(hubMcpConnections)
    .where(
      and(
        eq(hubMcpConnections.clientId, clientId),
        or(
          eq(hubMcpConnections.accessTokenHash, tokenHash),
          eq(hubMcpConnections.refreshTokenHash, tokenHash),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function findUserConnection(
  db: DbOrTx,
  userId: string,
  publicId: string,
) {
  const [row] = await db
    .select({
      id: hubMcpConnections.id,
      publicId: hubMcpConnections.publicId,
      clientName: displayName,
      clientId: hubMcpConnections.clientId,
    })
    .from(hubMcpConnections)
    .leftJoin(
      hubOauthClients,
      eq(hubOauthClients.id, hubMcpConnections.clientId),
    )
    .where(
      and(
        eq(hubMcpConnections.userId, userId),
        eq(hubMcpConnections.publicId, publicId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function deleteConnection(db: DbOrTx, id: number): Promise<void> {
  await db.delete(hubMcpConnections).where(eq(hubMcpConnections.id, id));
}
