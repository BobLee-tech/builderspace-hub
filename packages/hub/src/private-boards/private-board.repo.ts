import { and, eq } from "drizzle-orm";

import type { DbOrTx } from "../db";
import type { BoardAudience } from "./private-board.policy";
import { hubPrivateBoards } from "../schema";

/**
 * Moves the board from `from` to `to` (null: every project member), but only
 * if it is still at `from`, the setting the caller was allowed to leave. False
 * when someone else changed it in the meantime; nothing is written then.
 *
 * Each write is one statement whose condition Postgres re-checks after waiting
 * for a concurrent writer of the same row, so of two changes made from the
 * same reading only the first lands.
 */
export async function switchPrivateBoard(
  db: DbOrTx,
  boardId: number,
  change: {
    from: BoardAudience | null;
    to: BoardAudience | null;
    ownerUserId: string;
  },
): Promise<boolean> {
  const { from, to, ownerUserId } = change;
  if (from === to) return true;
  const stillAt = (audience: BoardAudience) =>
    and(
      eq(hubPrivateBoards.boardId, boardId),
      eq(hubPrivateBoards.audience, audience),
    );
  const written = { boardId: hubPrivateBoards.boardId };

  const rows =
    from === null
      ? await db
          .insert(hubPrivateBoards)
          .values({ boardId, audience: to ?? "owner", ownerUserId })
          .onConflictDoNothing()
          .returning(written)
      : to === null
        ? await db
            .delete(hubPrivateBoards)
            .where(stillAt(from))
            .returning(written)
        : await db
            .update(hubPrivateBoards)
            .set({ audience: to, ownerUserId })
            .where(stillAt(from))
            .returning(written);
  return rows.length > 0;
}
