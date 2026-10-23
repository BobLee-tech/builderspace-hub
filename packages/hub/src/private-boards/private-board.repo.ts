import { eq } from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubPrivateBoards } from "../schema";

export async function insertPrivateBoard(
  db: DbOrTx,
  boardId: number,
  ownerUserId: string,
): Promise<void> {
  await db
    .insert(hubPrivateBoards)
    .values({ boardId, ownerUserId })
    .onConflictDoNothing();
}

export async function deletePrivateBoard(
  db: DbOrTx,
  boardId: number,
): Promise<void> {
  await db
    .delete(hubPrivateBoards)
    .where(eq(hubPrivateBoards.boardId, boardId));
}
