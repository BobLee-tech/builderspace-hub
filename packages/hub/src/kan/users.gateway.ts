import * as userRepo from "@kan/db/repository/user.repo";

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
