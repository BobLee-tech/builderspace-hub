import { eq } from "drizzle-orm";

import type { DbOrTx } from "../db";
import type { BoardAudience } from "./private-board.policy";
import { hubPrivateBoards } from "../schema";

/** Makes the board private to `audience`, or moves it to that audience. */
export async function upsertPrivateBoard(
  db: DbOrTx,
  boardId: number,
  setting: { audience: BoardAudience; ownerUserId: string },
): Promise<void> {
  await db
    .insert(hubPrivateBoards)
    .values({ boardId, ...setting })
    .onConflictDoUpdate({ target: hubPrivateBoards.boardId, set: setting });
}

export async function deletePrivateBoard(
  db: DbOrTx,
  boardId: number,
): Promise<void> {
  await db
    .delete(hubPrivateBoards)
    .where(eq(hubPrivateBoards.boardId, boardId));
}
