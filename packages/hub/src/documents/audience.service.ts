import { z } from "zod";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { ReaderGroupChoice, ReaderTarget } from "./document.policy";
import {
  listDepartmentMembers,
  listDepartments,
} from "../departments/department.repo";
import { listProjectMembers } from "../kan/members.gateway";
import { listProjects } from "../kan/projects.gateway";
import { HubError } from "../shared/errors";
import { requireUserId } from "./document.guard";
import {
  canCreateDocument,
  MAX_READER_GROUPS,
  MAX_READER_USERS,
  normaliseSelection,
} from "./document.policy";
import {
  findActiveUsers,
  listEditedDocumentIds,
  namesOf,
} from "./document.repo";

/**
 * Who can read a document: every member, 指定的人, or only the people who can
 * edit it. 指定的人 are any mix of single members, whole projects and
 * departments of a project; the people who can edit it always can read it.
 */

export const audienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("editors") }),
  z.object({
    kind: z.literal("selected"),
    userIds: z
      .array(z.string().uuid())
      .max(MAX_READER_USERS, `最多选 ${MAX_READER_USERS} 个人`)
      .default([]),
    groups: z
      .array(
        z.object({
          projectPublicId: z.string().min(1).max(32),
          /** Null for the whole project. */
          departmentPublicId: z.string().min(1).max(32).nullable(),
        }),
      )
      .max(MAX_READER_GROUPS, `项目和部门最多选 ${MAX_READER_GROUPS} 个`)
      .default([]),
  }),
]);

export type AudienceChoice = z.output<typeof audienceSchema>;

export interface ResolvedAudience {
  readable: boolean;
  targets: ReaderTarget[];
  /** How the change reads in the audit log. */
  summary: string;
  /** The 指定的人 by public id, for the audit log's detail. */
  chosen: { userIds: string[]; groups: ReaderGroupChoice[] };
}

const groupLabel = (projectName: string, departmentName: string | null) =>
  departmentName === null ? projectName : `${projectName} · ${departmentName}`;

/** At most this many names in the log line; the rest are counted. */
const SUMMARY_NAMES = 5;

/**
 * Checks a choice against the database (the people exist and are active, the
 * projects exist) and turns it into what is stored.
 */
export async function resolveAudience(
  db: Db,
  choice: AudienceChoice,
): Promise<ResolvedAudience> {
  if (choice.kind === "all") {
    return {
      readable: true,
      targets: [],
      summary: "设为所有成员可读",
      chosen: { userIds: [], groups: [] },
    };
  }
  if (choice.kind === "editors") {
    return {
      readable: false,
      targets: [],
      summary: "设为仅编辑者可见",
      chosen: { userIds: [], groups: [] },
    };
  }

  const { userIds, groups } = normaliseSelection(choice);
  if (userIds.length === 0 && groups.length === 0) {
    throw new HubError(
      "INVALID_INPUT",
      "选了「指定的人」，至少要选一个人、项目或部门",
    );
  }

  const [people, projects, departments] = await Promise.all([
    findActiveUsers(db, userIds),
    groups.length > 0 ? listProjects(db) : Promise.resolve([]),
    groups.length > 0 ? listDepartments(db) : Promise.resolve([]),
  ]);
  if (people.length !== userIds.length) {
    throw new HubError("NOT_FOUND", "有的账号找不到，或已停用");
  }
  const projectOf = new Map(projects.map((p) => [p.publicId, p]));
  const departmentOf = new Map(departments.map((d) => [d.publicId, d]));
  const groupTargets = groups.map((group) => {
    const project = projectOf.get(group.projectPublicId);
    if (!project) throw new HubError("NOT_FOUND", "找不到选中的项目");
    const department =
      group.departmentPublicId === null
        ? null
        : departmentOf.get(group.departmentPublicId);
    if (department === undefined) {
      throw new HubError("NOT_FOUND", "找不到选中的部门");
    }
    return {
      target: {
        userId: null,
        workspaceId: project.id,
        departmentId: department?.id ?? null,
      },
      label: groupLabel(project.name, department?.name ?? null),
    };
  });
  const nameOf = new Map(people.map((p) => [p.id, p.name]));

  const labels = [
    ...groupTargets.map((g) => g.label),
    ...userIds.map((id) => nameOf.get(id) ?? id),
  ];
  const shown = labels.slice(0, SUMMARY_NAMES).join("、");
  return {
    readable: false,
    targets: [
      ...groupTargets.map((g) => g.target),
      ...userIds.map((userId) => ({
        userId,
        workspaceId: null,
        departmentId: null,
      })),
    ],
    summary:
      labels.length > SUMMARY_NAMES
        ? `设为指定的人可读：${shown} 等 ${labels.length} 项`
        : `设为指定的人可读：${shown}`,
    chosen: { userIds, groups },
  };
}

/** A document's 指定的人, named, for the people who can change them. */
export interface ReaderList {
  users: { userId: string; name: string }[];
  groups: {
    projectPublicId: string;
    departmentPublicId: string | null;
    label: string;
  }[];
}

export async function describeReaders(
  db: Db,
  targets: readonly ReaderTarget[],
): Promise<ReaderList> {
  const userIds = targets.flatMap((t) => (t.userId ? [t.userId] : []));
  const hasGroups = targets.some((t) => t.workspaceId !== null);
  const [names, projects, departments] = await Promise.all([
    namesOf(db, userIds),
    hasGroups ? listProjects(db) : Promise.resolve([]),
    hasGroups ? listDepartments(db) : Promise.resolve([]),
  ]);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const departmentOf = new Map(departments.map((d) => [d.id, d]));

  return {
    users: userIds.map((userId) => ({
      userId,
      name: names.get(userId) ?? "已删除的账号",
    })),
    // A deleted project matches nobody any more, so it is not shown.
    groups: targets.flatMap((target) => {
      const project =
        target.workspaceId === null ? undefined : byId.get(target.workspaceId);
      const department =
        target.departmentId === null
          ? null
          : departmentOf.get(target.departmentId);
      return project && department !== undefined
        ? [
            {
              projectPublicId: project.publicId,
              departmentPublicId: department?.publicId ?? null,
              label: groupLabel(project.name, department?.name ?? null),
            },
          ]
        : [];
    }),
  };
}

/** What the 指定的人 picker offers: every project, its departments and members. */
export interface AudienceOptions {
  departments: { publicId: string; name: string }[];
  projects: {
    publicId: string;
    name: string;
    members: { userId: string; name: string }[];
    /** Who is in each department of this project, by department public id. */
    departments: { publicId: string; memberIds: string[] }[];
  }[];
}

/**
 * The picker lists who is in which project, so it is only for people who can
 * choose who reads something: those who may create documents or edit one.
 */
export async function getAudienceOptions(
  db: Db,
  actor: AdminActor,
): Promise<AudienceOptions> {
  const userId = requireUserId(actor);
  const allowed =
    canCreateDocument(actor.role) ||
    (await listEditedDocumentIds(db, userId)).size > 0;
  if (!allowed) {
    throw new HubError("FORBIDDEN", "只有能修改文档的人可以选择谁能看");
  }

  const [departments, projects, members, placements] = await Promise.all([
    listDepartments(db),
    listProjects(db),
    listProjectMembers(db),
    listDepartmentMembers(db),
  ]);

  return {
    departments: departments.map((d) => ({
      publicId: d.publicId,
      name: d.name,
    })),
    projects: projects.map((project) => {
      const inProject = members.filter((m) => m.workspaceId === project.id);
      const active = new Set(inProject.map((m) => m.userId));
      return {
        publicId: project.publicId,
        name: project.name,
        members: inProject.map((m) => ({ userId: m.userId, name: m.name })),
        departments: departments.map((d) => ({
          publicId: d.publicId,
          memberIds: placements
            .filter(
              (row) =>
                row.workspaceId === project.id &&
                row.departmentId === d.id &&
                active.has(row.userId),
            )
            .map((row) => row.userId),
        })),
      };
    }),
  };
}
