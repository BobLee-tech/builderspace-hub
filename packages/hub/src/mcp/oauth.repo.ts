import { and, desc, eq, gt, lt, or } from "drizzle-orm";

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

export async function insertConnection(
  db: DbOrTx,
  values: TokenHashes & {
    publicId: string;
    clientId: number;
    userId: string;
    now: Date;
  },
): Promise<void> {
  const { now, ...row } = values;
  await db
    .insert(hubMcpConnections)
    .values({ ...row, createdAt: now, lastUsedAt: now });
}

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
      clientName: hubOauthClients.name,
    })
    .from(hubMcpConnections)
    .innerJoin(
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

export async function listUserConnections(db: DbOrTx, userId: string) {
  return db
    .select({
      publicId: hubMcpConnections.publicId,
      clientName: hubOauthClients.name,
      createdAt: hubMcpConnections.createdAt,
      lastUsedAt: hubMcpConnections.lastUsedAt,
    })
    .from(hubMcpConnections)
    .innerJoin(
      hubOauthClients,
      eq(hubOauthClients.id, hubMcpConnections.clientId),
    )
    .where(eq(hubMcpConnections.userId, userId))
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
      clientName: hubOauthClients.name,
    })
    .from(hubMcpConnections)
    .innerJoin(
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
