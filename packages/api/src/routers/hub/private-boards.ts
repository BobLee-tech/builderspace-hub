import type { dbClient } from "@kan/db/client";
import {
  assertRequestAllowed,
  boardVisibleTo,
  onlyVisibleBoards,
} from "@kan/hub/private-boards";

import { runHub } from "./run-hub";

// The three places Kan's own API meets 仅自己可见 boards. Each is called from a
// one-line hub-seam in an upstream file (docs/hub/UPSTREAM_SEAMS.md); the rules
// live in @kan/hub/private-boards.

/**
 * Runs before every Kan and Hub procedure, signed in or not. Refuses, with
 * NOT_FOUND, any request whose input names something inside a private board
 * the caller does not own. Requests that name no board cost no query.
 */
export function guardPrivateBoards(
  db: dbClient,
  viewerId: string | null,
  path: string,
  input: unknown,
): Promise<void> {
  return runHub(() => assertRequestAllowed(db, { viewerId, path, input }));
}

/** `board.all`: a project's boards, minus other people's private ones. */
export function visibleBoardsOnly<T extends { publicId: string }>(
  db: dbClient,
  viewerId: string,
  boards: readonly T[],
): Promise<T[]> {
  return onlyVisibleBoards(db, viewerId, boards, (board) => board.publicId);
}

/**
 * `workspace.search`: a condition Kan's search query adds to its own, so
 * other people's private boards and their cards never take up its limits.
 */
export function boardsVisibleTo(db: dbClient, viewerId: string) {
  return boardVisibleTo(db, viewerId);
}
