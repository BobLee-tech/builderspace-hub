import { and, eq, inArray, isNull } from "drizzle-orm";

import { cards } from "@kan/db/schema";

import type { DbOrTx } from "../db";

/** Public ids of cards, keyed by their row ids. Soft-deleted cards are skipped. */
export async function publicIdsOfCards(
  db: DbOrTx,
  cardIds: readonly number[],
): Promise<Map<number, string>> {
  if (cardIds.length === 0) return new Map();
  const rows = await db
    .select({ id: cards.id, publicId: cards.publicId })
    .from(cards)
    .where(and(inArray(cards.id, [...cardIds]), isNull(cards.deletedAt)));
  return new Map(rows.map((row) => [row.id, row.publicId]));
}

/** The row id of one live card, or undefined. */
export async function cardIdOf(
  db: DbOrTx,
  cardPublicId: string,
): Promise<number | undefined> {
  const [row] = await db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.publicId, cardPublicId), isNull(cards.deletedAt)))
    .limit(1);
  return row?.id;
}
