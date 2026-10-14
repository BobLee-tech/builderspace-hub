import { and, asc, eq, gt, lt } from "drizzle-orm";

import { generateUID } from "@kan/shared/utils";

import type { DbOrTx } from "../db";
import type { TimeBlockKind } from "../schema";
import { hubTimeBlocks } from "../schema";

export type TimeBlockRow = typeof hubTimeBlocks.$inferSelect;

/** Blocks of one person that share any time with `[from, to)`, earliest first. */
export async function listBlocksInWindow(
  db: DbOrTx,
  userId: string,
  from: Date,
  to: Date,
): Promise<TimeBlockRow[]> {
  return db
    .select()
    .from(hubTimeBlocks)
    .where(
      and(
        eq(hubTimeBlocks.userId, userId),
        lt(hubTimeBlocks.startsAt, to),
        gt(hubTimeBlocks.endsAt, from),
      ),
    )
    .orderBy(asc(hubTimeBlocks.startsAt), asc(hubTimeBlocks.id));
}

/** The card ids this person has set time aside for, from `since` onwards. */
export async function listPlannedCardIds(
  db: DbOrTx,
  userId: string,
  since: Date,
): Promise<number[]> {
  const rows = await db
    .select({ cardId: hubTimeBlocks.cardId })
    .from(hubTimeBlocks)
    .where(
      and(
        eq(hubTimeBlocks.userId, userId),
        eq(hubTimeBlocks.kind, "task"),
        gt(hubTimeBlocks.endsAt, since),
      ),
    );
  return rows.flatMap((row) => (row.cardId === null ? [] : [row.cardId]));
}

/** Looks a block up by its public id, only among this person's own. */
export async function findOwnBlock(
  db: DbOrTx,
  userId: string,
  publicId: string,
): Promise<TimeBlockRow | undefined> {
  const [row] = await db
    .select()
    .from(hubTimeBlocks)
    .where(
      and(
        eq(hubTimeBlocks.userId, userId),
        eq(hubTimeBlocks.publicId, publicId),
      ),
    )
    .limit(1);
  return row;
}

export interface NewBlock {
  userId: string;
  kind: TimeBlockKind;
  title: string | null;
  startsAt: Date;
  endsAt: Date;
  cardId: number | null;
}

export async function insertBlock(
  db: DbOrTx,
  block: NewBlock,
): Promise<TimeBlockRow> {
  const [row] = await db
    .insert(hubTimeBlocks)
    .values({ ...block, publicId: generateUID() })
    .returning();
  if (!row) throw new Error("insertBlock: insert returned no row");
  return row;
}

export interface BlockPatch {
  kind?: TimeBlockKind;
  title?: string | null;
  startsAt?: Date;
  endsAt?: Date;
}

export async function updateBlock(
  db: DbOrTx,
  id: number,
  patch: BlockPatch,
): Promise<TimeBlockRow> {
  const [row] = await db
    .update(hubTimeBlocks)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(hubTimeBlocks.id, id))
    .returning();
  if (!row) throw new Error("updateBlock: no such block");
  return row;
}

export async function deleteBlock(db: DbOrTx, id: number): Promise<void> {
  await db.delete(hubTimeBlocks).where(eq(hubTimeBlocks.id, id));
}
