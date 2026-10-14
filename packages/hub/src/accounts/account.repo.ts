import { and, count, eq, inArray } from "drizzle-orm";

import type { DbOrTx } from "../db";
import type { AccountStatus, HubRole } from "../schema";
import { hubAccounts } from "../schema";

export interface AccountFacts {
  role: HubRole | null;
  status: AccountStatus;
}

/** No row means an ordinary, active account. */
export const ORDINARY_ACCOUNT: AccountFacts = { role: null, status: "active" };

export async function findAccount(
  db: DbOrTx,
  userId: string,
): Promise<AccountFacts | null> {
  const [row] = await db
    .select({ role: hubAccounts.role, status: hubAccounts.status })
    .from(hubAccounts)
    .where(eq(hubAccounts.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function findAccounts(
  db: DbOrTx,
  userIds: string[],
): Promise<Map<string, AccountFacts>> {
  const map = new Map<string, AccountFacts>();
  if (userIds.length === 0) return map;
  const rows = await db
    .select({
      userId: hubAccounts.userId,
      role: hubAccounts.role,
      status: hubAccounts.status,
    })
    .from(hubAccounts)
    .where(inArray(hubAccounts.userId, userIds));
  for (const row of rows) {
    map.set(row.userId, { role: row.role, status: row.status });
  }
  return map;
}

/** Creates the row if needed and applies the change. */
export async function upsertAccount(
  db: DbOrTx,
  userId: string,
  change: {
    role?: HubRole | null;
    status?: AccountStatus;
    suspendedAt?: Date | null;
    suspendedBy?: string | null;
    now: Date;
  },
): Promise<void> {
  const { now, ...patch } = change;
  await db
    .insert(hubAccounts)
    .values({ userId, ...patch, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: hubAccounts.userId,
      set: { ...patch, updatedAt: now },
    });
}

export async function countOwners(
  db: DbOrTx,
  options: { activeOnly: boolean },
): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(hubAccounts)
    .where(
      and(
        eq(hubAccounts.role, "owner"),
        options.activeOnly ? eq(hubAccounts.status, "active") : undefined,
      ),
    );
  return row?.total ?? 0;
}
