import type { dbClient } from "@kan/db/client";
import {
  assertRequestAllowed,
  boardVisibleTo,
  onlyVisibleBoards,
} from "@kan/hub/private-boards";

import { runHub } from "./run-hub";

// The three places Kan's own API meets private boards (仅自己可见 and
// 仅管理员可见). Each is called from a one-line hub-seam in an upstream file
// (docs/hub/UPSTREAM_SEAMS.md); the rules live in @kan/hub/private-boards.

/**
 * Runs before every Kan and Hub procedure, signed in or not. Refuses, with
 * NOT_FOUND, any request whose input names something inside a private board
 * the caller may not see. Requests that name no board cost no query.
 */
export function guardPrivateBoards(
  db: dbClient,
  viewerId: string | null,
  path: string,
  input: unknown,
): Promise<void> {
  return runHub(() => assertRequestAllowed(db, { viewerId, path, input }));
}

/**
 * `board.all`: a project's boards, minus the private ones the caller may not
 * see.
 */
export function visibleBoardsOnly<T extends { publicId: string }>(
  db: dbClient,
  viewerId: string,
  boards: readonly T[],
): Promise<T[]> {
  return onlyVisibleBoards(db, viewerId, boards, (board) => board.publicId);
}

/**
 * `workspace.search`: a condition Kan's search query adds to its own, so
 * private boards the caller may not see, and their cards, never take up its
 * limits.
 */
export function boardsVisibleTo(db: dbClient, viewerId: string) {
  return boardVisibleTo(db, viewerId);
}
