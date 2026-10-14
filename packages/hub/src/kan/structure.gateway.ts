import { and, eq, isNull } from "drizzle-orm";

import * as boardRepo from "@kan/db/repository/board.repo";
import * as labelRepo from "@kan/db/repository/label.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { boards, workspaces } from "@kan/db/schema";
import { colours } from "@kan/shared/constants";
import { generateUID } from "@kan/shared/utils";

import type { Db } from "../db";
import type { ProjectRef } from "./projects.gateway";

/** A live project (Kan workspace) by its URL slug, or null. */
export async function findProjectBySlug(
  db: Db,
  slug: string,
): Promise<ProjectRef | null> {
  const [row] = await db
    .select({
      id: workspaces.id,
      publicId: workspaces.publicId,
      name: workspaces.name,
    })
    .from(workspaces)
    .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
    .limit(1);

  return row ?? null;
}

/**
 * Creates a project through Kan's own repository, so it gets the system roles
 * and makes `owner` its admin, exactly as creating one in the app does.
 */
export async function createProject(
  db: Db,
  input: {
    name: string;
    slug: string;
    description?: string;
    owner: { id: string; email: string };
  },
): Promise<ProjectRef> {
  const created = await workspaceRepo.create(db, {
    name: input.name,
    slug: input.slug,
    createdBy: input.owner.id,
    createdByEmail: input.owner.email,
    ...(input.description && { description: input.description }),
  });

  const project = created.publicId
    ? await findProjectBySlug(db, input.slug)
    : null;
  if (!project) throw new Error(`createProject: ${input.slug} not created`);
  return project;
}

/** Names of the live boards in a project. */
export async function listBoardNames(
  db: Db,
  workspaceId: number,
): Promise<string[]> {
  const rows = await db
    .select({ name: boards.name })
    .from(boards)
    .where(and(eq(boards.workspaceId, workspaceId), isNull(boards.deletedAt)));

  return rows.map((row) => row.name);
}

/**
 * Creates a board with its lists and labels the way Kan's `board.create`
 * procedure does, including its colour rotation for labels.
 */
export async function createBoard(
  db: Db,
  input: {
    workspaceId: number;
    name: string;
    /** Preferred URL slug; made unique within the project if taken. */
    slug: string;
    lists: string[];
    labels: string[];
    createdBy: string;
  },
): Promise<void> {
  const slugIsFree = await boardRepo.isSlugUnique(db, {
    slug: input.slug,
    workspaceId: input.workspaceId,
  });

  const board = await boardRepo.create(db, {
    name: input.name,
    slug: slugIsFree ? input.slug : `${input.slug}-${generateUID()}`,
    workspaceId: input.workspaceId,
    createdBy: input.createdBy,
  });
  if (!board) throw new Error(`createBoard: ${input.name} not created`);

  await listRepo.bulkCreate(
    db,
    input.lists.map((name, index) => ({
      publicId: generateUID(),
      name,
      boardId: board.id,
      createdBy: input.createdBy,
      index,
    })),
  );

  if (input.labels.length > 0) {
    await labelRepo.bulkCreate(
      db,
      input.labels.map((name, index) => ({
        publicId: generateUID(),
        name,
        boardId: board.id,
        createdBy: input.createdBy,
        colourCode: colours[index % colours.length]?.code ?? "#0d9488",
      })),
    );
  }
}
