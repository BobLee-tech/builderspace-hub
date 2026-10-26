import type { AuditActor } from "../audit";
import type { Db, DbOrTx } from "../db";
import type { PrivacyBoard } from "../kan/private-boards.gateway";
import type {
  BoardAudience,
  BoardViewer,
  PrivateBoard,
} from "./private-board.policy";
import { withAudit } from "../audit";
import {
  findPrivacyBoard,
  makeKanBoardPrivate,
  privateBoardsAmong,
  privateBoardsOf,
  projectsAdministeredBy,
} from "../kan/private-boards.gateway";
import { listViewableProjects } from "../kan/tasks.gateway";
import { HubError } from "../shared/errors";
import {
  boardBeingPublished,
  canSeePrivateBoard,
  canSwitchAudience,
  collectBoardRefs,
  countBoardRefs,
  MAX_BOARD_REFS,
} from "./private-board.policy";
import { switchPrivateBoard } from "./private-board.repo";

export interface BoardPrivacy {
  /** Null when every project member may see it, by Kan's own rules. */
  audience: BoardAudience | null;
  /**
   * Where the viewer may move the board from here; `members` is back to
   * every project member. False for where it already is.
   */
  canSwitchTo: Record<"members" | BoardAudience, boolean>;
}

const LABELS: Record<BoardAudience, string> = {
  owner: "仅自己可见",
  admins: "仅管理员可见",
};

// The same answer for something that does not exist and something the caller
// may not see, so nobody can probe for other people's private boards.
const NOT_FOUND = "没有这个看板，或者你看不到它。";
// The request may have named a card, a list, a comment… not only a board.
const NOT_FOUND_ANYTHING = "没有找到，或者你看不到它。";

/**
 * Refuses a request that names anything inside a private board its caller may
 * not see: the board itself, or one of its lists, cards, labels, checklists,
 * comments or attachments. Runs before every Kan and Hub procedure, so Kan's
 * own handlers never see such a request.
 *
 * Also refuses putting a private board on Kan's public link: a board hidden
 * from the project must not be readable by anyone with the URL.
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

  const found = await privateBoardsOf(db, refs);
  const viewer = await viewerOf(db, request.viewerId, found);
  if (found.some((board) => !canSeePrivateBoard(board, viewer))) {
    throw new HubError("NOT_FOUND", NOT_FOUND_ANYTHING);
  }

  const published = boardBeingPublished(request.path, request.input);
  const [hidden] = found;
  if (published && hidden) {
    throw new HubError(
      "CONFLICT",
      `这个看板${LABELS[hidden.audience]}。要公开，先把它改回社团成员可见。`,
    );
  }
}

/**
 * Drops the items that live in a private board the viewer may not see. For
 * lists Kan builds itself (all boards of a project, search results).
 */
export async function onlyVisibleBoards<T>(
  db: DbOrTx,
  viewerId: string,
  items: readonly T[],
  boardPublicIdOf: (item: T) => string,
): Promise<T[]> {
  const found = await privateBoardsAmong(db, items.map(boardPublicIdOf));
  if (found.size === 0) return [...items];
  const viewer = await viewerOf(db, viewerId, [...found.values()]);
  return items.filter((item) => {
    const board = found.get(boardPublicIdOf(item));
    return !board || canSeePrivateBoard(board, viewer);
  });
}

export async function getBoardPrivacy(
  db: Db,
  viewerId: string,
  boardPublicId: string,
): Promise<BoardPrivacy> {
  const { board, viewer } = await findVisibleBoard(db, viewerId, boardPublicId);
  return privacyOf(board, viewer);
}

/**
 * Moves a board between every project member (`null`), 仅自己可见 (`owner`)
 * and 仅管理员可见 (`admins`), as `canSwitchAudience` allows. Hiding it also
 * makes it private in Kan's sense, so its public link stops working. Back to
 * every member, it stays off the public link until someone makes it public
 * again.
 */
export async function setBoardAudience(
  db: Db,
  actor: AuditActor & { userId: string },
  input: { boardPublicId: string; audience: BoardAudience | null },
): Promise<BoardPrivacy> {
  const { board, viewer } = await findVisibleBoard(
    db,
    actor.userId,
    input.boardPublicId,
  );
  const from = board.private?.audience ?? null;
  const to = input.audience;
  if (to === from) return privacyOf(board, viewer);
  if (!canSwitchAudience(board, viewer, to)) {
    throw new HubError(
      "FORBIDDEN",
      to === "owner"
        ? "只有建这个看板的人能设置仅自己可见。"
        : to === "admins"
          ? "只有项目管理员能设置仅管理员可见。"
          : "你不能修改这个看板的可见范围。",
    );
  }

  if (from === null) {
    // Before the Hub's own row, and outside its transaction (Kan's repository
    // cannot join one). If what follows fails, the board is merely private,
    // which is the safe way round.
    await makeKanBoardPrivate(db, board.publicId);
  }
  await withAudit(
    db,
    async (tx) => {
      // The check above read the board before this transaction. If someone
      // changed it since, this change was never checked against the new
      // setting, so it is refused rather than written over it.
      const switched = await switchPrivateBoard(tx, board.id, {
        from,
        to,
        ownerUserId: actor.userId,
      });
      if (!switched) {
        throw new HubError(
          "CONFLICT",
          "这个看板的可见范围刚被别人改过，刷新后再试。",
        );
      }
    },
    () => ({
      actor,
      action: "board.privacy_changed",
      entityType: "board",
      entityId: board.publicId,
      // No board name: back-office admins read this log, and the name is part
      // of what was hidden.
      summary: auditSummary(from, to),
      detail: { from, to },
    }),
  );
  return privacyOf(
    {
      ...board,
      private: to === null ? null : { audience: to, ownerUserId: actor.userId },
    },
    viewer,
  );
}

function auditSummary(
  from: BoardAudience | null,
  to: BoardAudience | null,
): string {
  if (from === null) {
    return to === "owner"
      ? "把自己建的一个看板设为仅自己可见"
      : "把一个看板设为仅管理员可见";
  }
  return to === null
    ? `把一个${LABELS[from]}的看板改回社团成员可见`
    : `把一个看板从${LABELS[from]}改为${LABELS[to]}`;
}

function privacyOf(
  board: PrivacyBoard,
  viewer: { id: string; adminOf: ReadonlySet<number> },
): BoardPrivacy {
  return {
    audience: board.private?.audience ?? null,
    canSwitchTo: {
      members: canSwitchAudience(board, viewer, null),
      owner: canSwitchAudience(board, viewer, "owner"),
      admins: canSwitchAudience(board, viewer, "admins"),
    },
  };
}

/**
 * Who is asking, with the projects they run looked up only when one of the
 * boards in question is 仅管理员可见.
 */
async function viewerOf(
  db: DbOrTx,
  viewerId: string | null,
  boards: readonly PrivateBoard[],
): Promise<BoardViewer> {
  const needsRoles =
    viewerId !== null && boards.some((board) => board.audience === "admins");
  return {
    id: viewerId,
    adminOf: needsRoles
      ? await projectsAdministeredBy(db, viewerId)
      : new Set<number>(),
  };
}

async function findVisibleBoard(
  db: Db,
  viewerId: string,
  boardPublicId: string,
): Promise<{
  board: PrivacyBoard;
  viewer: { id: string; adminOf: ReadonlySet<number> };
}> {
  const board = await findPrivacyBoard(db, boardPublicId);
  if (!board) throw new HubError("NOT_FOUND", NOT_FOUND);

  const [projects, adminOf] = await Promise.all([
    listViewableProjects(db, viewerId),
    projectsAdministeredBy(db, viewerId),
  ]);
  const viewer = { id: viewerId, adminOf };
  const inProject = projects.some(
    (project) => project.id === board.workspaceId,
  );
  const hidden =
    board.private !== null &&
    !canSeePrivateBoard(
      { ...board.private, workspaceId: board.workspaceId },
      viewer,
    );
  if (!inProject || hidden) throw new HubError("NOT_FOUND", NOT_FOUND);
  return { board, viewer };
}
