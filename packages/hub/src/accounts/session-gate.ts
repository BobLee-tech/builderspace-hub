import type { Db } from "../db";
import { findAccount } from "./account.repo";

/**
 * May this user start a new session? Only a suspended account is refused.
 * Existing sessions are deleted when an account is suspended, so checking at
 * session creation is enough to keep it out.
 */
export async function isSessionAllowed(
  db: Db,
  userId: string,
): Promise<boolean> {
  const account = await findAccount(db, userId);
  return account?.status !== "suspended";
}
