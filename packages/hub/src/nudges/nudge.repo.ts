import { eq, inArray } from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubNudgeOptOuts } from "../schema";

/** Which of these people turned 催一下 mail off. */
export async function optedOutAmong(
  db: DbOrTx,
  userIds: readonly string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await db
    .select({ userId: hubNudgeOptOuts.userId })
    .from(hubNudgeOptOuts)
    .where(inArray(hubNudgeOptOuts.userId, [...userIds]));
  return new Set(rows.map((row) => row.userId));
}

export async function optOut(
  db: DbOrTx,
  userId: string,
  at: Date,
): Promise<void> {
  await db
    .insert(hubNudgeOptOuts)
    .values({ userId, createdAt: at })
    .onConflictDoNothing();
}

export async function optIn(db: DbOrTx, userId: string): Promise<void> {
  await db.delete(hubNudgeOptOuts).where(eq(hubNudgeOptOuts.userId, userId));
}
