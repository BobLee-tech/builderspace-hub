import { z } from "zod";

import { generateUID } from "@kan/shared/utils";

import type { AdminActor } from "../accounts/account.service";
import type { Db } from "../db";
import type { ProjectRole } from "../schema";
import type { DepartmentRow } from "./department.repo";
import { withAudit } from "../audit";
import { listProjectMembers } from "../kan/members.gateway";
import { findProjectByPublicId, listProjects } from "../kan/projects.gateway";
import { isUniqueViolation } from "../shared/db-errors";
import { HubError } from "../shared/errors";
import {
  canManageDepartments,
  DEPARTMENT_NAME_MAX_LENGTH,
  normaliseDepartmentName,
  swapForMove,
} from "./department.policy";
import {
  addDepartmentMember,
  findDepartment,
  insertDepartment,
  listDepartmentMembers,
  listDepartments,
  removeDepartmentMember,
  renameDepartment as renameDepartmentRow,
  setDepartmentPosition,
} from "./department.repo";

/**
 * The club's departments and who is in which, per project. Kept in the back
 * office; documents can then be shared with a department of a project.
 */

export interface DepartmentDirectory {
  departments: {
    publicId: string;
    name: string;
    /** People in it, counting each project they are in it for once. */
    memberCount: number;
  }[];
  projects: {
    publicId: string;
    name: string;
    members: {
      userId: string;
      name: string;
      email: string;
      role: ProjectRole;
      /** Public ids of the departments they are in, in this project. */
      departments: string[];
    }[];
  }[];
  canManage: boolean;
}

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new HubError(
      "INVALID_INPUT",
      result.error.issues[0]?.message ?? "输入不对",
    );
  }
  return result.data;
}

function requireManage(actor: AdminActor): void {
  if (!canManageDepartments(actor.role)) {
    throw new HubError("FORBIDDEN", "只有能管理账号的人可以调整部门");
  }
}

async function requireDepartment(
  db: Db,
  publicId: string,
): Promise<DepartmentRow> {
  const department = await findDepartment(db, publicId);
  if (!department) throw new HubError("NOT_FOUND", "找不到这个部门");
  return department;
}

const idSchema = z.string().min(1).max(32);

const nameSchema = z
  .string()
  .transform(normaliseDepartmentName)
  .refine((value): value is string => value !== null, {
    message: `部门名要填写，最多 ${DEPARTMENT_NAME_MAX_LENGTH} 个字`,
  });

const duplicateName = (name: string) =>
  new HubError("CONFLICT", `已经有叫「${name}」的部门了`);

/** Every department, every project with its members, and who is where. */
export async function getDepartmentDirectory(
  db: Db,
  actor: AdminActor,
): Promise<DepartmentDirectory> {
  const [departments, projects, members, placements] = await Promise.all([
    listDepartments(db),
    listProjects(db),
    listProjectMembers(db),
    listDepartmentMembers(db),
  ]);

  // Only placements of people still in the project count.
  const active = new Set(members.map((m) => `${m.workspaceId}:${m.userId}`));
  const placed = new Map<string, Set<number>>();
  const counts = new Map<number, number>();
  for (const row of placements) {
    const key = `${row.workspaceId}:${row.userId}`;
    if (!active.has(key)) continue;
    placed.set(key, (placed.get(key) ?? new Set()).add(row.departmentId));
    counts.set(row.departmentId, (counts.get(row.departmentId) ?? 0) + 1);
  }

  return {
    departments: departments.map((d) => ({
      publicId: d.publicId,
      name: d.name,
      memberCount: counts.get(d.id) ?? 0,
    })),
    projects: projects.map((project) => ({
      publicId: project.publicId,
      name: project.name,
      members: members
        .filter((member) => member.workspaceId === project.id)
        .map((member) => {
          const mine = placed.get(`${project.id}:${member.userId}`);
          return {
            userId: member.userId,
            name: member.name,
            email: member.email,
            role: member.role,
            departments: departments
              .filter((d) => mine?.has(d.id))
              .map((d) => d.publicId),
          };
        }),
    })),
    canManage: canManageDepartments(actor.role),
  };
}

export async function createDepartment(
  db: Db,
  actor: AdminActor,
  rawInput: { name: string },
): Promise<{ publicId: string; name: string }> {
  requireManage(actor);
  const { name } = parse(z.object({ name: nameSchema }), rawInput);

  return withAudit(
    db,
    async (tx) => {
      try {
        const created = await insertDepartment(tx, {
          publicId: generateUID(),
          name,
          createdBy: actor.userId,
        });
        return { publicId: created.publicId, name: created.name };
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateName(name);
        throw error;
      }
    },
    (result) => ({
      actor,
      action: "department.created",
      entityType: "department",
      entityId: result.publicId,
      summary: `新建部门「${name}」`,
    }),
  );
}

export async function renameDepartment(
  db: Db,
  actor: AdminActor,
  rawInput: { departmentPublicId: string; name: string },
): Promise<void> {
  requireManage(actor);
  const input = parse(
    z.object({ departmentPublicId: idSchema, name: nameSchema }),
    rawInput,
  );
  const department = await requireDepartment(db, input.departmentPublicId);
  if (department.name === input.name) return;

  await withAudit(
    db,
    async (tx) => {
      try {
        await renameDepartmentRow(tx, department.id, input.name);
      } catch (error) {
        if (isUniqueViolation(error)) throw duplicateName(input.name);
        throw error;
      }
    },
    () => ({
      actor,
      action: "department.renamed",
      entityType: "department",
      entityId: department.publicId,
      summary: `部门「${department.name}」改名为「${input.name}」`,
    }),
  );
}

/** Moves a department one place up or down the list. */
export async function moveDepartment(
  db: Db,
  actor: AdminActor,
  rawInput: { departmentPublicId: string; direction: "up" | "down" },
): Promise<void> {
  requireManage(actor);
  const input = parse(
    z.object({
      departmentPublicId: idSchema,
      direction: z.enum(["up", "down"]),
    }),
    rawInput,
  );
  const department = await requireDepartment(db, input.departmentPublicId);

  await withAudit(
    db,
    async (tx) => {
      // Read the order inside the transaction, so two moves at once cannot
      // leave two departments on the same place.
      const swap = swapForMove(
        await listDepartments(tx),
        department.id,
        input.direction,
      );
      if (!swap) {
        throw new HubError(
          "CONFLICT",
          input.direction === "up" ? "已经在最前面了" : "已经在最后面了",
        );
      }
      for (const { id, position } of swap) {
        await setDepartmentPosition(tx, id, position);
      }
    },
    () => ({
      actor,
      action: "department.reordered",
      entityType: "department",
      entityId: department.publicId,
      summary: `部门「${department.name}」${input.direction === "up" ? "上移" : "下移"}一位`,
    }),
  );
}

const setMemberSchema = z.object({
  departmentPublicId: idSchema,
  projectPublicId: idSchema,
  userId: z.string().uuid(),
  /** True puts them in the department, false takes them out. */
  member: z.boolean(),
});

/** Puts someone in a department of a project, or takes them out of it. */
export async function setDepartmentMember(
  db: Db,
  actor: AdminActor,
  rawInput: z.input<typeof setMemberSchema>,
): Promise<void> {
  requireManage(actor);
  const input = parse(setMemberSchema, rawInput);
  const department = await requireDepartment(db, input.departmentPublicId);
  const project = await findProjectByPublicId(db, input.projectPublicId);
  if (!project) throw new HubError("NOT_FOUND", "找不到这个项目");

  const person = (await listProjectMembers(db, [project.id])).find(
    (member) => member.userId === input.userId,
  );
  // Leaving a project does not clear the rows, so taking someone who already
  // left out of a department still has to work.
  if (!person && input.member) {
    throw new HubError("NOT_FOUND", "这个人不在该项目里，先把这个人加进项目");
  }
  const row = {
    departmentId: department.id,
    workspaceId: project.id,
    userId: input.userId,
  };
  const who = person?.name ?? "一位成员";

  await withAudit(
    db,
    async (tx) => {
      if (input.member) {
        await addDepartmentMember(tx, { ...row, addedBy: actor.userId });
      } else if (!(await removeDepartmentMember(tx, row))) {
        throw new HubError("NOT_FOUND", "这个人本来就不在这个部门");
      }
    },
    () => ({
      actor,
      action: input.member
        ? "department.member_added"
        : "department.member_removed",
      entityType: "account",
      entityId: input.userId,
      summary: input.member
        ? `把 ${who} 加入 ${project.name} 的${department.name}`
        : `把 ${who} 移出 ${project.name} 的${department.name}`,
      detail: {
        project: project.publicId,
        department: department.publicId,
      },
    }),
  );
}
