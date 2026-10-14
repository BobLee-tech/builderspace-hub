import { and, eq, inArray, isNull } from "drizzle-orm";

import * as permissionRepo from "@kan/db/repository/permission.repo";
import {
  boards,
  cards,
  cardsToLabels,
  cardToWorkspaceMembers,
  labels,
  lists,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import type { Db } from "../db";

export interface ViewableProject {
  id: number;
  publicId: string;
  name: string;
  slug: string;
}

/**
 * The projects whose tasks this person may see: they are an active member
 * and their effective permissions (role plus per-member overrides, resolved by
 * Kan) include viewing boards and cards. This is the only gate for the home
 * page and the task board, so it reuses Kan's own rules instead of guessing.
 */
export async function listViewableProjects(
  db: Db,
  userId: string,
): Promise<ViewableProject[]> {
  const memberships = await db
    .select({
      memberId: workspaceMembers.id,
      role: workspaceMembers.role,
      roleId: workspaceMembers.roleId,
      id: workspaces.id,
      publicId: workspaces.publicId,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    );

  const viewable: ViewableProject[] = [];
  for (const membership of memberships) {
    const permissions = await permissionRepo.getMemberEffectivePermissions(
      db,
      membership.memberId,
      membership.roleId,
      membership.role,
    );
    if (
      permissions.includes("board:view") &&
      permissions.includes("card:view")
    ) {
      viewable.push({
        id: membership.id,
        publicId: membership.publicId,
        name: membership.name,
        slug: membership.slug,
      });
    }
  }
  return viewable;
}

export interface TaskRow {
  publicId: string;
  title: string;
  dueDate: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
  listName: string;
  boardPublicId: string;
  boardName: string;
  projectId: number;
  assigneeUserIds: string[];
  labels: { name: string; colourCode: string | null }[];
}

/**
 * Every live card on the ordinary boards of the given projects. Templates,
 * archived boards and anything soft-deleted are left out.
 *
 * Loads everything in three queries and lets the caller filter in memory.
 * That is plenty for a team's worth of cards; if it ever is not, push the
 * filters from `task.policy.ts` down into SQL here.
 */
export async function listTaskRows(
  db: Db,
  projectIds: readonly number[],
): Promise<TaskRow[]> {
  if (projectIds.length === 0) return [];

  const rows = await db
    .select({
      id: cards.id,
      publicId: cards.publicId,
      title: cards.title,
      dueDate: cards.dueDate,
      createdAt: cards.createdAt,
      updatedAt: cards.updatedAt,
      listName: lists.name,
      boardPublicId: boards.publicId,
      boardName: boards.name,
      projectId: boards.workspaceId,
    })
    .from(cards)
    .innerJoin(lists, eq(lists.id, cards.listId))
    .innerJoin(boards, eq(boards.id, lists.boardId))
    .where(
      and(
        inArray(boards.workspaceId, [...projectIds]),
        eq(boards.type, "regular"),
        eq(boards.isArchived, false),
        isNull(boards.deletedAt),
        isNull(lists.deletedAt),
        isNull(cards.deletedAt),
      ),
    );
  if (rows.length === 0) return [];

  const cardIds = rows.map((row) => row.id);
  const [assignees, cardLabels] = await Promise.all([
    db
      .select({
        cardId: cardToWorkspaceMembers.cardId,
        userId: workspaceMembers.userId,
      })
      .from(cardToWorkspaceMembers)
      .innerJoin(
        workspaceMembers,
        eq(workspaceMembers.id, cardToWorkspaceMembers.workspaceMemberId),
      )
      .where(
        and(
          inArray(cardToWorkspaceMembers.cardId, cardIds),
          isNull(workspaceMembers.deletedAt),
        ),
      ),
    db
      .select({
        cardId: cardsToLabels.cardId,
        name: labels.name,
        colourCode: labels.colourCode,
      })
      .from(cardsToLabels)
      .innerJoin(labels, eq(labels.id, cardsToLabels.labelId))
      .where(
        and(inArray(cardsToLabels.cardId, cardIds), isNull(labels.deletedAt)),
      ),
  ]);

  const assigneesByCard = groupBy(assignees, (row) => row.cardId);
  const labelsByCard = groupBy(cardLabels, (row) => row.cardId);

  return rows.map(({ id, ...row }) => ({
    ...row,
    assigneeUserIds: (assigneesByCard.get(id) ?? []).flatMap((a) =>
      a.userId ? [a.userId] : [],
    ),
    labels: (labelsByCard.get(id) ?? []).map(({ name, colourCode }) => ({
      name,
      colourCode,
    })),
  }));
}

function groupBy<T, K>(
  items: readonly T[],
  keyOf: (item: T) => K,
): Map<K, T[]> {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
}
