import type { SQL } from "drizzle-orm";
import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  not,
  notExists,
  or,
  sql,
} from "drizzle-orm";

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
  workspaceMembers,
} from "@kan/db/schema";

import type { Db, DbOrTx } from "../db";
import type {
  BoardAudience,
  BoardRefKind,
  BoardRefs,
  PrivateBoard,
} from "../private-boards/private-board.policy";
import { boardRefKinds } from "../private-boards/private-board.policy";
import { hubPrivateBoards } from "../schema";

export interface PrivacyBoard {
  id: number;
  publicId: string;
  workspaceId: number;
  createdBy: string | null;
  /** Null when every project member may see it. */
  private: { audience: BoardAudience; ownerUserId: string | null } | null;
}

/**
 * One live board and whether it is set to 仅自己可见 or 仅管理员可见, or
 * undefined.
 */
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
      audience: hubPrivateBoards.audience,
    })
    .from(boards)
    .leftJoin(hubPrivateBoards, eq(hubPrivateBoards.boardId, boards.id))
    .where(and(eq(boards.publicId, boardPublicId), isNull(boards.deletedAt)))
    .limit(1);
  if (!row) return undefined;
  const { isPrivate, ownerUserId, audience, ...board } = row;
  return {
    ...board,
    private: isPrivate && audience ? { audience, ownerUserId } : null,
  };
}

/** The projects `userId` is an active admin of. */
export async function projectsAdministeredBy(
  db: DbOrTx,
  userId: string,
): Promise<Set<number>> {
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(adminMembership(userId));
  return new Set(rows.map((row) => row.workspaceId));
}

/**
 * The private boards that the given ids live in. Ordinary boards are left
 * out, so an empty answer means every id is in an ordinary board (or does not
 * exist). Soft-deleted rows count: Kan answers NOT_FOUND for those itself, and
 * a deleted card is still the owner's.
 */
export async function privateBoardsOf(
  db: DbOrTx,
  refs: BoardRefs,
): Promise<PrivateBoard[]> {
  const found = await Promise.all(
    boardRefKinds
      .filter((kind) => refs[kind].length > 0)
      .map((kind) => privateBoardsVia(db, kind, refs[kind])),
  );
  return found.flat();
}

/** The private boards among these, by public id. */
export async function privateBoardsAmong(
  db: DbOrTx,
  boardPublicIds: readonly string[],
): Promise<Map<string, PrivateBoard>> {
  if (boardPublicIds.length === 0) return new Map();
  const rows = await db
    .select({ publicId: boards.publicId, ...privateBoardColumns })
    .from(boards)
    .innerJoin(hubPrivateBoards, eq(hubPrivateBoards.boardId, boards.id))
    .where(inArray(boards.publicId, [...new Set(boardPublicIds)]));
  return new Map(rows.map(({ publicId, ...board }) => [publicId, board]));
}

/**
 * A condition for queries over Kan's `board` table: the board is not private,
 * or `viewerId` may see it (`canSeePrivateBoard`, in SQL): they own a
 * 仅自己可见 board, or are an admin of a 仅管理员可见 board's project.
 */
export function boardVisibleTo(db: DbOrTx, viewerId: string): SQL {
  const viewerIsAdmin = exists(
    db
      .select({ one: sql`1` })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, boards.workspaceId),
          adminMembership(viewerId),
        ),
      ),
  );
  return notExists(
    db
      .select({ one: sql`1` })
      .from(hubPrivateBoards)
      .where(
        and(
          eq(hubPrivateBoards.boardId, boards.id),
          or(
            and(
              eq(hubPrivateBoards.audience, "owner"),
              or(
                isNull(hubPrivateBoards.ownerUserId),
                ne(hubPrivateBoards.ownerUserId, viewerId),
              ),
            ),
            and(eq(hubPrivateBoards.audience, "admins"), not(viewerIsAdmin)),
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

// Kan's legacy role column; it is what the board page's `isAdmin` and Kan's
// own admin-only checks read, and Hub's 项目权限 page keeps admins fixed.
function adminMembership(userId: string): SQL | undefined {
  return and(
    eq(workspaceMembers.userId, userId),
    eq(workspaceMembers.role, "admin"),
    eq(workspaceMembers.status, "active"),
    isNull(workspaceMembers.deletedAt),
  );
}

const privateBoardColumns = {
  audience: hubPrivateBoards.audience,
  ownerUserId: hubPrivateBoards.ownerUserId,
  workspaceId: boards.workspaceId,
};

function privateBoardsVia(db: DbOrTx, kind: BoardRefKind, publicIds: string[]) {
  const ids = [...new Set(publicIds)];
  // Starts from the board, so every kind has its project to hand.
  const privateBoards = () =>
    db
      .select(privateBoardColumns)
      .from(boards)
      .innerJoin(hubPrivateBoards, eq(hubPrivateBoards.boardId, boards.id));

  switch (kind) {
    case "board":
      return privateBoards().where(inArray(boards.publicId, ids));
    case "list":
      return privateBoards()
        .innerJoin(lists, eq(lists.boardId, boards.id))
        .where(inArray(lists.publicId, ids));
    case "label":
      return privateBoards()
        .innerJoin(labels, eq(labels.boardId, boards.id))
        .where(inArray(labels.publicId, ids));
    case "card":
      return privateBoards()
        .innerJoin(lists, eq(lists.boardId, boards.id))
        .innerJoin(cards, eq(cards.listId, lists.id))
        .where(inArray(cards.publicId, ids));
    case "checklist":
      return privateBoards()
        .innerJoin(lists, eq(lists.boardId, boards.id))
        .innerJoin(cards, eq(cards.listId, lists.id))
        .innerJoin(checklists, eq(checklists.cardId, cards.id))
        .where(inArray(checklists.publicId, ids));
    case "checklistItem":
      return privateBoards()
        .innerJoin(lists, eq(lists.boardId, boards.id))
        .innerJoin(cards, eq(cards.listId, lists.id))
        .innerJoin(checklists, eq(checklists.cardId, cards.id))
        .innerJoin(
          checklistItems,
          eq(checklistItems.checklistId, checklists.id),
        )
        .where(inArray(checklistItems.publicId, ids));
    case "comment":
      return privateBoards()
        .innerJoin(lists, eq(lists.boardId, boards.id))
        .innerJoin(cards, eq(cards.listId, lists.id))
        .innerJoin(comments, eq(comments.cardId, cards.id))
        .where(inArray(comments.publicId, ids));
    case "attachment":
      return privateBoards()
        .innerJoin(lists, eq(lists.boardId, boards.id))
        .innerJoin(cards, eq(cards.listId, lists.id))
        .innerJoin(cardAttachments, eq(cardAttachments.cardId, cards.id))
        .where(inArray(cardAttachments.publicId, ids));
  }
}
