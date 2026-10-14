import type { Db } from "../db";
import { CLI_ACTOR, recordAudit } from "../audit";
import {
  createBoard,
  createProject,
  findProjectBySlug,
  listBoardNames,
} from "../kan/structure.gateway";
import { findUserByEmail } from "../kan/users.gateway";
import { normalizeEmail } from "../shared/email";
import { HubError } from "../shared/errors";

/** The parts of the BuilderSpace structure that become projects and boards. */
export interface StandardStructure {
  lists: string[];
  labels: string[];
  functions: { key: string; name: string }[];
  projects: {
    key: string;
    name: string;
    slug: string;
    description?: string;
  }[];
}

export interface StructureReport {
  projectsCreated: string[];
  projectsExisting: string[];
  boardsCreated: string[];
  boardsExisting: string[];
}

/**
 * Makes sure every standard project exists with one board per function.
 *
 * Projects are recognised by slug and boards by name, so this only adds what
 * is missing and can be run again safely. New projects and boards belong to
 * `ownerEmail`, which must already have an account: Kan records a creator and
 * makes them the project's admin.
 *
 * Each creation is logged on its own rather than in one transaction: Kan's
 * repositories cannot join an outer transaction, and a half-finished run is
 * completed by running it again.
 */
export async function ensureStandardProjects(
  db: Db,
  input: { ownerEmail: string; structure: StandardStructure },
): Promise<StructureReport> {
  const email = normalizeEmail(input.ownerEmail);
  const owner = email ? await findUserByEmail(db, email) : null;
  if (!owner) {
    throw new HubError(
      "NOT_FOUND",
      `${input.ownerEmail} 还没有注册账号，先注册再建项目`,
    );
  }

  const report: StructureReport = {
    projectsCreated: [],
    projectsExisting: [],
    boardsCreated: [],
    boardsExisting: [],
  };
  const { structure } = input;

  for (const spec of structure.projects) {
    let project = await findProjectBySlug(db, spec.slug);

    if (project) {
      report.projectsExisting.push(spec.name);
    } else {
      project = await createProject(db, {
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        owner,
      });
      await recordAudit(db, {
        actor: CLI_ACTOR,
        action: "project.created",
        entityType: "project",
        entityId: project.publicId,
        summary: `新建项目 ${spec.name}，管理员 ${owner.email}`,
      });
      report.projectsCreated.push(spec.name);
    }

    const existingBoards = new Set(await listBoardNames(db, project.id));

    for (const fn of structure.functions) {
      const label = `${spec.name} / ${fn.name}`;

      if (existingBoards.has(fn.name)) {
        report.boardsExisting.push(label);
        continue;
      }

      await createBoard(db, {
        workspaceId: project.id,
        name: fn.name,
        slug: fn.key,
        lists: structure.lists,
        labels: structure.labels,
        createdBy: owner.id,
      });
      await recordAudit(db, {
        actor: CLI_ACTOR,
        action: "board.created",
        entityType: "project",
        entityId: project.publicId,
        summary: `在 ${spec.name} 新建看板 ${fn.name}`,
      });
      report.boardsCreated.push(label);
    }
  }

  return report;
}
