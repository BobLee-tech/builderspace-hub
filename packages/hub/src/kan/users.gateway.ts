import { inArray } from "drizzle-orm";

import * as userRepo from "@kan/db/repository/user.repo";
import { users } from "@kan/db/schema";

import type { Db } from "../db";

/**
 * Files in `src/kan/` are the only place the Hub calls Kan's repositories.
 * Everything else goes through these functions, so an upstream change to a
 * repository signature is absorbed here.
 */

/** Looks a user up by an already-normalised e-mail address. */
export async function findUserByEmail(
  db: Db,
  email: string,
): Promise<{ id: string; email: string } | null> {
  const user = await userRepo.getByEmail(db, email);
  return user ? { id: user.id, email: user.email } : null;
}

/** Which of these already-normalised addresses belong to an account. */
export async function findRegisteredEmails(
  db: Db,
  emails: string[],
): Promise<Set<string>> {
  if (emails.length === 0) return new Set();
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, emails));
  return new Set(rows.map((row) => row.email.toLowerCase()));
}

/** The name and address of each of these users; unknown ids are left out. */
export async function findUsersByIds(
  db: Db,
  userIds: readonly string[],
): Promise<{ id: string; name: string | null; email: string }[]> {
  if (userIds.length === 0) return [];
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, [...userIds]));
}
