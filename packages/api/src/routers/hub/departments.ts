import { z } from "zod";

import {
  createDepartment,
  getDepartmentDirectory,
  moveDepartment,
  renameDepartment,
  setDepartmentMember,
} from "@kan/hub/departments";

import { createTRPCRouter } from "../../trpc";
import { hubAdminProcedure, runHub } from "./procedures";

/**
 * The club's departments and who is in which, mounted at `hub.departments.*`.
 * Read in the back office; changed by those who manage accounts (the use
 * cases check that again).
 */

const id = z.string().min(1).max(32);
const name = z.string().max(200);

export const departmentsRouter = createTRPCRouter({
  directory: hubAdminProcedure("admin.view").query(({ ctx }) =>
    runHub(() => getDepartmentDirectory(ctx.db, ctx.actor)),
  ),

  create: hubAdminProcedure("accounts.manage")
    .input(z.object({ name }))
    .mutation(({ ctx, input }) =>
      runHub(() => createDepartment(ctx.db, ctx.actor, input)),
    ),

  rename: hubAdminProcedure("accounts.manage")
    .input(z.object({ departmentPublicId: id, name }))
    .mutation(({ ctx, input }) =>
      runHub(() => renameDepartment(ctx.db, ctx.actor, input)),
    ),

  move: hubAdminProcedure("accounts.manage")
    .input(
      z.object({ departmentPublicId: id, direction: z.enum(["up", "down"]) }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() => moveDepartment(ctx.db, ctx.actor, input)),
    ),

  setMember: hubAdminProcedure("accounts.manage")
    .input(
      z.object({
        departmentPublicId: id,
        projectPublicId: id,
        userId: z.string().uuid(),
        member: z.boolean(),
      }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() => setDepartmentMember(ctx.db, ctx.actor, input)),
    ),
});
