import type { AuditActor } from "../audit";
import type { Db, DbOrTx } from "../db";
import type { PrivacyBoard } from "../kan/private-boards.gateway";
import { withAudit } from "../audit";
import {
  findPrivacyBoard,
  makeKanBoardPrivate,
  ownersOfPrivateBoards,
  privateBoardOwners,
} from "../kan/private-boards.gateway";
import { listViewableProjects } from "../kan/tasks.gateway";
import { HubError } from "../shared/errors";
import {
  boardBeingPublished,
  canChangeOnlyMe,
  canSeePrivateBoard,
  collectBoardRefs,
  countBoardRefs,
  MAX_BOARD_REFS,
} from "./private-board.policy";
import { deletePrivateBoard, insertPrivateBoard } from "./private-board.repo";

export interface BoardPrivacy {
  onlyMe: boolean;
  /** Whether the viewer may turn 仅自己可见 on (or off). */
  canChange: boolean;
}

// The same answer for something that does not exist and something the caller
// may not see, so nobody can probe for other people's private boards.
const NOT_FOUND = "没有这个看板，或者你看不到它。";
// The request may have named a card, a list, a comment… not only a board.
const NOT_FOUND_ANYTHING = "没有找到，或者你看不到它。";

/**
 * Refuses a request that names anything inside a 仅自己可见 board its caller
 * does not own: the board itself, or one of its lists, cards, labels,
 * checklists, comments or attachments. Runs before every Kan and Hub
 * procedure, so Kan's own handlers never see such a request.
 *
 * Also refuses putting such a board on Kan's public link: a board hidden from
 * the project must not be readable by anyone with the URL.
 *
 * It reads the raw input, before the procedure validates it, so a request
 * naming more than `MAX_BOARD_REFS` things is refused without any query.
 */
export async function assertRequestAllowed(
  db: DbOrTx,
  request: { viewerId: string | null; path: string; input: unknown },
): Promise<void> {
  const refs = collectBoardRefs(request.input);
  const count = countBoardRefs(refs);
  if (count > MAX_BOARD_REFS) {
    throw new HubError("INVALID_INPUT", "一次请求里的 ID 太多了。");
  }
  if (count === 0) return;

  const owners = await ownersOfPrivateBoards(db, refs);
  if (owners.some((owner) => !canSeePrivateBoard(owner, request.viewerId))) {
    throw new HubError("NOT_FOUND", NOT_FOUND_ANYTHING);
  }

  const published = boardBeingPublished(request.path, request.input);
  if (published && owners.length > 0) {
    throw new HubError(
      "CONFLICT",
      "这个看板仅自己可见。要公开，先把它改回社团成员可见。",
    );
  }
}

/**
 * Drops the items that live in a 仅自己可见 board the viewer does not own.
 * For lists Kan builds itself (all boards of a project, search results).
 */
export async function onlyVisibleBoards<T>(
  db: DbOrTx,
  viewerId: string,
  items: readonly T[],
  boardPublicIdOf: (item: T) => string,
): Promise<T[]> {
  const owners = await privateBoardOwners(db, items.map(boardPublicIdOf));
  if (owners.size === 0) return [...items];
  return items.filter((item) => {
    const boardPublicId = boardPublicIdOf(item);
    return (
      !owners.has(boardPublicId) ||
      canSeePrivateBoard(owners.get(boardPublicId) ?? null, viewerId)
    );
  });
}

export async function getBoardPrivacy(
  db: Db,
  viewerId: string,
  boardPublicId: string,
): Promise<BoardPrivacy> {
  const board = await findVisibleBoard(db, viewerId, boardPublicId);
  return {
    onlyMe: board.privateTo !== null,
    canChange: canChangeOnlyMe(board, viewerId),
  };
}

/**
 * Turns 仅自己可见 on or off. On: only the board's creator may, and it also
 * becomes private in Kan's sense, so its public link stops working. Off: only
 * its owner may, and the board goes back to every project member; it stays off
 * the public link until someone makes it public again.
 */
export async function setBoardOnlyMe(
  db: Db,
  actor: AuditActor & { userId: string },
  input: { boardPublicId: string; onlyMe: boolean },
): Promise<BoardPrivacy> {
  const board = await findVisibleBoard(db, actor.userId, input.boardPublicId);
  if (!canChangeOnlyMe(board, actor.userId)) {
    throw new HubError("FORBIDDEN", "只有建这个看板的人能设置仅自己可见。");
  }
  if (input.onlyMe === (board.privateTo !== null)) {
    return { onlyMe: input.onlyMe, canChange: true };
  }

  if (input.onlyMe) {
    // Before the Hub's own row, and outside its transaction (Kan's repository
    // cannot join one). If what follows fails, the board is merely private,
    // which is the safe way round.
    await makeKanBoardPrivate(db, board.publicId);
  }
  await withAudit(
    db,
    (tx) =>
      input.onlyMe
        ? insertPrivateBoard(tx, board.id, actor.userId)
        : deletePrivateBoard(tx, board.id),
    () => ({
      actor,
      action: "board.privacy_changed",
      entityType: "board",
      entityId: board.publicId,
      // No board name: back-office admins read this log, and the name is part
      // of what its owner wanted to keep to themselves.
      summary: input.onlyMe
        ? "把自己建的一个看板设为仅自己可见"
        : "把一个仅自己可见的看板改回社团成员可见",
      detail: { onlyMe: input.onlyMe },
    }),
  );
  return { onlyMe: input.onlyMe, canChange: true };
}

async function findVisibleBoard(
  db: Db,
  viewerId: string,
  boardPublicId: string,
): Promise<PrivacyBoard> {
  const board = await findPrivacyBoard(db, boardPublicId);
  if (!board) throw new HubError("NOT_FOUND", NOT_FOUND);

  const inProject = (await listViewableProjects(db, viewerId)).some(
    (project) => project.id === board.workspaceId,
  );
  const hidden =
    board.privateTo !== null &&
    !canSeePrivateBoard(board.privateTo.ownerUserId, viewerId);
  if (!inProject || hidden) throw new HubError("NOT_FOUND", NOT_FOUND);
  return board;
}
