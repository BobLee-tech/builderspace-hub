import { z } from "zod";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import { withAudit } from "../audit";
import { findProjectByPublicId, listProjects } from "../kan/projects.gateway";
import { listViewableProjects } from "../kan/tasks.gateway";
import { HubError } from "../shared/errors";
import { MAX_REPOS_PER_PROJECT, parseRepo, repoUrl } from "./repo.policy";
import {
  countRepos,
  deleteRepo,
  findRepo,
  findRepoByPublicId,
  insertRepo,
  listRepos,
} from "./repo.repo";

/**
 * The GitHub repositories each project is made of. Set in the back office;
 * read when someone's GitHub activity is gathered, and then only for the
 * projects that person can see.
 */

export interface LinkedRepo {
  publicId: string;
  fullName: string;
  url: string;
}

export interface ProjectRepos {
  project: { publicId: string; name: string };
  repos: LinkedRepo[];
}

export interface RepoForUser {
  project: { publicId: string; name: string };
  fullName: string;
}

const addSchema = z.object({
  projectPublicId: z.string().min(1).max(32),
  repo: z.string().max(300),
});

const toLinked = (row: { publicId: string; fullName: string }): LinkedRepo => ({
  publicId: row.publicId,
  fullName: row.fullName,
  url: repoUrl(row.fullName),
});

/** Every project with its repositories, for the back office. */
export async function listProjectRepos(db: Db): Promise<ProjectRepos[]> {
  const projects = await listProjects(db);
  const rows = await listRepos(
    db,
    projects.map((p) => p.id),
  );
  return projects.map((project) => ({
    project: { publicId: project.publicId, name: project.name },
    repos: rows.filter((row) => row.workspaceId === project.id).map(toLinked),
  }));
}

export async function addProjectRepo(
  db: Db,
  actor: AuditActor,
  input: z.input<typeof addSchema>,
): Promise<LinkedRepo> {
  const data = addSchema.safeParse(input);
  if (!data.success) throw new HubError("INVALID_INPUT", "输入不对");
  const parsed = parseRepo(data.data.repo);
  if (!parsed.ok) throw new HubError("INVALID_INPUT", parsed.reason);

  const project = await findProjectByPublicId(db, data.data.projectPublicId);
  if (!project) throw new HubError("NOT_FOUND", "没有这个项目。");
  if (await findRepo(db, project.id, parsed.fullName)) {
    throw new HubError("CONFLICT", "这个仓库已经关联到这个项目了。");
  }
  if ((await countRepos(db, project.id)) >= MAX_REPOS_PER_PROJECT) {
    throw new HubError(
      "INVALID_INPUT",
      `一个项目最多关联 ${MAX_REPOS_PER_PROJECT} 个仓库。`,
    );
  }

  const row = await withAudit(
    db,
    (tx) =>
      insertRepo(tx, {
        workspaceId: project.id,
        fullName: parsed.fullName,
        createdBy: actor.userId,
      }),
    () => ({
      actor,
      action: "project.repo_linked",
      entityType: "project",
      entityId: project.publicId,
      summary: `给「${project.name}」关联仓库 ${parsed.fullName}`,
      detail: { repo: parsed.fullName },
    }),
  );
  return toLinked(row);
}

export async function removeProjectRepo(
  db: Db,
  actor: AuditActor,
  repoPublicId: string,
): Promise<void> {
  const row = await findRepoByPublicId(db, repoPublicId);
  if (!row) throw new HubError("NOT_FOUND", "没有这个仓库关联。");
  const project = (await listProjects(db)).find(
    (p) => p.id === row.workspaceId,
  );

  await withAudit(
    db,
    (tx) => deleteRepo(tx, row.id),
    () => ({
      actor,
      action: "project.repo_unlinked",
      entityType: "project",
      entityId: project?.publicId ?? null,
      summary: `取消「${project?.name ?? "已删除的项目"}」和仓库 ${row.fullName} 的关联`,
      detail: { repo: row.fullName },
    }),
  );
}

/**
 * The repositories whose activity may be read for this person: those of the
 * projects they can see, by the same rule as the home page. A repository
 * linked to several of their projects appears once per project.
 */
export async function listReposForUser(
  db: Db,
  userId: string,
): Promise<RepoForUser[]> {
  const projects = await listViewableProjects(db, userId);
  const rows = await listRepos(
    db,
    projects.map((p) => p.id),
  );
  const byId = new Map(projects.map((p) => [p.id, p]));
  return rows.flatMap((row) => {
    const project = byId.get(row.workspaceId);
    return project
      ? [
          {
            project: { publicId: project.publicId, name: project.name },
            fullName: row.fullName,
          },
        ]
      : [];
  });
}
