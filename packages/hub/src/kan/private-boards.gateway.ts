import type { SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { and, eq, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";

import * as boardRepo from "@kan/db/repository/board.repo";
import {
  boards,
  cardAttachments,
  cards,
  checklistItems,
  checklists,
  comments,
  labels,
  lists,
} from "@kan/db/schema";

import type { Db, DbOrTx } from "../db";
import type {
  BoardRefKind,
  BoardRefs,
} from "../private-boards/private-board.policy";
import { boardRefKinds } from "../private-boards/private-board.policy";
import { hubPrivateBoards } from "../schema";

export interface PrivacyBoard {
  id: number;
  publicId: string;
  workspaceId: number;
  createdBy: string | null;
  /** Null when the board is not set to 仅自己可见. */
  privateTo: { ownerUserId: string | null } | null;
}

/** One live board and whether it is set to 仅自己可见, or undefined. */
export async function findPrivacyBoard(
  db: DbOrTx,
  boardPublicId: string,
): Promise<PrivacyBoard | undefined> {
  const [row] = await db
    .select({
      id: boards.id,
      publicId: boards.publicId,
      workspaceId: boards.workspaceId,
      createdBy: boards.createdBy,
      isPrivate: sql<boolean>`${hubPrivateBoards.boardId} IS NOT NULL`,
      ownerUserId: hubPrivateBoards.ownerUserId,
    })
    .from(boards)
    .leftJoin(hubPrivateBoards, eq(hubPrivateBoards.boardId, boards.id))
    .where(and(eq(boards.publicId, boardPublicId), isNull(boards.deletedAt)))
    .limit(1);
  if (!row) return undefined;
  const { isPrivate, ownerUserId, ...board } = row;
  return { ...board, privateTo: isPrivate ? { ownerUserId } : null };
}

/**
 * The owners of the 仅自己可见 boards that the given ids live in. Boards
 * without the setting are left out, so an empty answer means every id is in
 * an ordinary board (or does not exist). Soft-deleted rows count: Kan answers
 * NOT_FOUND for those itself, and a deleted card is still the owner's.
 */
export async function ownersOfPrivateBoards(
  db: DbOrTx,
  refs: BoardRefs,
): Promise<(string | null)[]> {
  const found = await Promise.all(
    boardRefKinds
      .filter((kind) => refs[kind].length > 0)
      .map((kind) => ownersVia(db, kind, refs[kind])),
  );
  return found.flat().map((row) => row.ownerUserId);
}

/** The 仅自己可见 boards among these, with their owners. */
export async function privateBoardOwners(
  db: DbOrTx,
  boardPublicIds: readonly string[],
): Promise<Map<string, string | null>> {
  if (boardPublicIds.length === 0) return new Map();
  const rows = await db
    .select({
      publicId: boards.publicId,
      ownerUserId: hubPrivateBoards.ownerUserId,
    })
    .from(boards)
    .innerJoin(hubPrivateBoards, eq(hubPrivateBoards.boardId, boards.id))
    .where(inArray(boards.publicId, [...new Set(boardPublicIds)]));
  return new Map(rows.map((row) => [row.publicId, row.ownerUserId]));
}

/**
 * A condition for queries over Kan's `board` table: the board is not set to
 * 仅自己可见, or `viewerId` owns it.
 */
export function boardVisibleTo(db: DbOrTx, viewerId: string): SQL {
  return notExists(
    db
      .select({ one: sql`1` })
      .from(hubPrivateBoards)
      .where(
        and(
          eq(hubPrivateBoards.boardId, boards.id),
          or(
            isNull(hubPrivateBoards.ownerUserId),
            ne(hubPrivateBoards.ownerUserId, viewerId),
          ),
        ),
      ),
  );
}

/**
 * Sets Kan's own visibility to private, so the board's public link stops
 * working. Goes through Kan's repository because the Hub never writes Kan's
 * tables itself.
 */
export async function makeKanBoardPrivate(
  db: Db,
  boardPublicId: string,
): Promise<void> {
  await boardRepo.update(db, {
    boardPublicId,
    name: undefined,
    slug: undefined,
    visibility: "private",
  });
}

function ownersVia(db: DbOrTx, kind: BoardRefKind, publicIds: string[]) {
  const owner = { ownerUserId: hubPrivateBoards.ownerUserId };
  const ids = [...new Set(publicIds)];
  const privateBoard = (boardId: AnyPgColumn) =>
    eq(hubPrivateBoards.boardId, boardId);

  switch (kind) {
    case "board":
      return db
        .select(owner)
        .from(boards)
        .innerJoin(hubPrivateBoards, privateBoard(boards.id))
        .where(inArray(boards.publicId, ids));
    case "list":
      return db
        .select(owner)
        .from(lists)
        .innerJoin(hubPrivateBoards, privateBoard(lists.boardId))
        .where(inArray(lists.publicId, ids));
    case "label":
      return db
        .select(owner)
        .from(labels)
        .innerJoin(hubPrivateBoards, privateBoard(labels.boardId))
        .where(inArray(labels.publicId, ids));
    case "card":
      return db
        .select(owner)
        .from(cards)
        .innerJoin(lists, eq(lists.id, cards.listId))
        .innerJoin(hubPrivateBoards, privateBoard(lists.boardId))
        .where(inArray(cards.publicId, ids));
    case "checklist":
      return db
        .select(owner)
        .from(checklists)
        .innerJoin(cards, eq(cards.id, checklists.cardId))
        .innerJoin(lists, eq(lists.id, cards.listId))
        .innerJoin(hubPrivateBoards, privateBoard(lists.boardId))
        .where(inArray(checklists.publicId, ids));
    case "checklistItem":
      return db
        .select(owner)
        .from(checklistItems)
        .innerJoin(checklists, eq(checklists.id, checklistItems.checklistId))
        .innerJoin(cards, eq(cards.id, checklists.cardId))
        .innerJoin(lists, eq(lists.id, cards.listId))
        .innerJoin(hubPrivateBoards, privateBoard(lists.boardId))
        .where(inArray(checklistItems.publicId, ids));
    case "comment":
      return db
        .select(owner)
        .from(comments)
        .innerJoin(cards, eq(cards.id, comments.cardId))
        .innerJoin(lists, eq(lists.id, cards.listId))
        .innerJoin(hubPrivateBoards, privateBoard(lists.boardId))
        .where(inArray(comments.publicId, ids));
    case "attachment":
      return db
        .select(owner)
        .from(cardAttachments)
        .innerJoin(cards, eq(cards.id, cardAttachments.cardId))
        .innerJoin(lists, eq(lists.id, cards.listId))
        .innerJoin(hubPrivateBoards, privateBoard(lists.boardId))
        .where(inArray(cardAttachments.publicId, ids));
  }
}
