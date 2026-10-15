import { and, eq, inArray } from "drizzle-orm";

import { cardActivities, cards, lists } from "@kan/db/schema";

import type { DbOrTx } from "../db";

export interface CardHistoryRow {
  cardPublicId: string;
  kind: "created" | "moved";
  /** The list a move went to; null for creation. */
  toListName: string | null;
  by: string | null;
  at: Date;
}

/**
 * The entries of the cards' activity logs that can mark them finished: their
 * creation and every move between lists. Read-only.
 */
export async function listFinishHistory(
  db: DbOrTx,
  cardPublicIds: readonly string[],
): Promise<CardHistoryRow[]> {
  if (cardPublicIds.length === 0) return [];

  const rows = await db
    .select({
      cardPublicId: cards.publicId,
      type: cardActivities.type,
      toListName: lists.name,
      by: cardActivities.createdBy,
      at: cardActivities.createdAt,
    })
    .from(cardActivities)
    .innerJoin(cards, eq(cards.id, cardActivities.cardId))
    .leftJoin(lists, eq(lists.id, cardActivities.toListId))
    .where(
      and(
        inArray(cards.publicId, [...cardPublicIds]),
        inArray(cardActivities.type, ["card.created", "card.updated.list"]),
      ),
    );

  return rows.map(({ type, ...row }) => ({
    ...row,
    kind: type === "card.created" ? "created" : "moved",
    toListName: type === "card.created" ? null : row.toListName,
  }));
}

/** When each card was created, for cards whose activity log says nothing. */
export async function cardCreationTimes(
  db: DbOrTx,
  cardPublicIds: readonly string[],
): Promise<Map<string, Date>> {
  if (cardPublicIds.length === 0) return new Map();
  const rows = await db
    .select({ publicId: cards.publicId, createdAt: cards.createdAt })
    .from(cards)
    .where(inArray(cards.publicId, [...cardPublicIds]));
  return new Map(rows.map((row) => [row.publicId, row.createdAt]));
}
