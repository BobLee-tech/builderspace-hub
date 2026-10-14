import { eq } from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubSettings } from "../schema";

/** The stored value for a key, or undefined when it was never set. */
export async function readSetting(db: DbOrTx, key: string): Promise<unknown> {
  const [row] = await db
    .select({ value: hubSettings.value })
    .from(hubSettings)
    .where(eq(hubSettings.key, key))
    .limit(1);
  return row?.value;
}

export async function writeSetting(
  db: DbOrTx,
  key: string,
  value: unknown,
  by: { userId: string | null; at: Date },
): Promise<void> {
  await db
    .insert(hubSettings)
    .values({ key, value, updatedAt: by.at, updatedBy: by.userId })
    .onConflictDoUpdate({
      target: hubSettings.key,
      set: { value, updatedAt: by.at, updatedBy: by.userId },
    });
}
