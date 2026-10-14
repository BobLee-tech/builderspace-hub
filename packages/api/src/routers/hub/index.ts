import { z } from "zod";

import {
  countOpenGrants,
  issueGrant,
  listGrants,
  provisionUser,
  revokeGrant,
} from "@kan/hub/access";
import {
  changeHubRole,
  createAccount,
  getAccount,
  hubRoles,
  listAccounts,
  permissionsOf,
  renameAccount,
  resetPassword,
  restoreAccount,
  setProjectRole,
  suspendAccount,
} from "@kan/hub/accounts";
import { countAudit, listAudit } from "@kan/hub/audit";
import { can } from "@kan/hub/public";
import {
  blockInputs,
  createBlock,
  editBlock,
  getSchedule,
  planTask,
  removeBlock,
} from "@kan/hub/schedule";
import { projectRoles } from "@kan/hub/schema";
import { HubError } from "@kan/hub/shared";
import { listProjects } from "@kan/hub/structure";
import { getHome, getTaskBoard, taskViews } from "@kan/hub/tasks";

import { createTRPCRouter } from "../../trpc";
import { hubAdminProcedure, hubProcedure, runHub } from "./procedures";

/**
 * The Hub's own API, mounted at `hub.*`: the back office, plus the home page
 * and the task board every member uses. Thin by design: validate the
 * input, call a use case from `@kan/hub`, map its errors. Every procedure is
 * left out of the public REST API (no `openapi` meta).
 *
 * No input here ever carries a secret: Kan's logging middleware records every
 * procedure's input. Temporary passwords and link tokens only appear in
 * outputs, once.
 */

const userIdInput = z.object({ userId: z.string().uuid() });
const pageInput = z.object({ page: z.number().int().min(1).max(10_000) });
const projectInput = z.object({
  projectPublicId: z.string().min(1).max(32),
  role: z.enum(projectRoles),
});

const meRouter = createTRPCRouter({
  get: hubProcedure.query(async ({ ctx }) => {
    // Finishes a registration whose after-hook failed; a no-op otherwise.
    await provisionUser(ctx.db, {
      userId: ctx.actor.userId,
      email: ctx.actor.email,
      now: new Date(),
    }).catch(() => undefined);

    return {
      userId: ctx.actor.userId,
      email: ctx.actor.email,
      role: ctx.actor.role,
      permissions: permissionsOf(ctx.actor.role),
    };
  }),
});

const accountsRouter = createTRPCRouter({
  list: hubAdminProcedure("admin.view")
    .input(pageInput.extend({ search: z.string().max(100).optional() }))
    .query(({ ctx, input }) => runHub(() => listAccounts(ctx.db, input))),

  get: hubAdminProcedure("admin.view")
    .input(userIdInput)
    .query(({ ctx, input }) => runHub(() => getAccount(ctx.db, input.userId))),

  create: hubAdminProcedure("accounts.manage")
    .input(
      z.object({
        name: z.string().max(64),
        email: z.string().max(255),
        hubRole: z.enum(hubRoles).nullable(),
        projects: z.array(projectInput).max(20),
      }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() => createAccount(ctx.db, ctx.actor, input)),
    ),

  resetPassword: hubAdminProcedure("accounts.manage")
    .input(userIdInput)
    .mutation(({ ctx, input }) =>
      runHub(() => resetPassword(ctx.db, ctx.actor, input.userId)),
    ),

  rename: hubAdminProcedure("accounts.manage")
    .input(userIdInput.extend({ name: z.string().max(64) }))
    .mutation(({ ctx, input }) =>
      runHub(() => renameAccount(ctx.db, ctx.actor, input.userId, input.name)),
    ),

  setRole: hubAdminProcedure("admins.manage")
    .input(userIdInput.extend({ role: z.enum(hubRoles).nullable() }))
    .mutation(({ ctx, input }) =>
      runHub(() => changeHubRole(ctx.db, ctx.actor, input.userId, input.role)),
    ),

  suspend: hubAdminProcedure("accounts.manage")
    .input(userIdInput)
    .mutation(({ ctx, input }) =>
      runHub(() => suspendAccount(ctx.db, ctx.actor, input.userId)),
    ),

  restore: hubAdminProcedure("accounts.manage")
    .input(userIdInput)
    .mutation(({ ctx, input }) =>
      runHub(() => restoreAccount(ctx.db, ctx.actor, input.userId)),
    ),

  setProjectRole: hubAdminProcedure("accounts.manage")
    .input(
      userIdInput.extend({
        projectPublicId: z.string().min(1).max(32),
        role: z.enum(projectRoles).nullable(),
      }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() =>
        setProjectRole(
          ctx.db,
          ctx.actor,
          input.userId,
          input.projectPublicId,
          input.role,
        ),
      ),
    ),
});

const grantsRouter = createTRPCRouter({
  list: hubAdminProcedure("admin.view")
    .input(pageInput)
    .query(({ ctx, input }) => runHub(() => listGrants(ctx.db, input))),

  /** Returns the link token once; the page builds the link from it. */
  issue: hubAdminProcedure("access.manage")
    .input(
      z.object({
        email: z.string().max(255),
        hubRole: z.enum(hubRoles).nullable(),
        note: z.string().max(280).nullable(),
        projects: z.array(projectInput).max(20),
      }),
    )
    .mutation(({ ctx, input }) =>
      runHub(() => {
        // A link that makes someone an owner or admin is itself an
        // appointment, so it needs the same permission.
        if (input.hubRole !== null && !can(ctx.actor.role, "admins.manage")) {
          throw new HubError("FORBIDDEN", "只有所有者能为后台成员发放注册链接");
        }
        return issueGrant(ctx.db, ctx.actor, { ...input, source: "direct" });
      }),
    ),

  revoke: hubAdminProcedure("access.manage")
    .input(z.object({ grantPublicId: z.string().min(1).max(32) }))
    .mutation(({ ctx, input }) =>
      runHub(() => revokeGrant(ctx.db, ctx.actor, input.grantPublicId)),
    ),
});

/** 全部 when `project` is left out, otherwise one project the caller is in. */
const scopeInput = z.object({ project: z.string().min(1).max(32).optional() });

const tasksRouter = createTRPCRouter({
  /** The home page: tile counts, my open tasks, the project × function grid. */
  home: hubProcedure.input(scopeInput).query(({ ctx, input }) =>
    runHub(() =>
      getHome(ctx.db, {
        userId: ctx.actor.userId,
        projectPublicId: input.project,
        now: new Date(),
      }),
    ),
  ),

  /** The cross-project task board for one view, split into columns. */
  board: hubProcedure
    .input(scopeInput.extend({ view: z.enum(taskViews) }))
    .query(({ ctx, input }) =>
      runHub(() =>
        getTaskBoard(ctx.db, {
          userId: ctx.actor.userId,
          projectPublicId: input.project,
          view: input.view,
          now: new Date(),
        }),
      ),
    ),
});

const scheduleRouter = createTRPCRouter({
  /** My calendar for a window: my blocks plus my unfinished tasks. */
  get: hubProcedure
    .input(z.object({ from: z.date(), to: z.date() }))
    .query(({ ctx, input }) =>
      runHub(() =>
        getSchedule(ctx.db, {
          userId: ctx.actor.userId,
          ...input,
          now: new Date(),
        }),
      ),
    ),

  create: hubProcedure
    .input(blockInputs.manual)
    .mutation(({ ctx, input }) =>
      runHub(() => createBlock(ctx.db, ctx.actor.userId, input)),
    ),

  planTask: hubProcedure
    .input(blockInputs.task)
    .mutation(({ ctx, input }) =>
      runHub(() => planTask(ctx.db, ctx.actor.userId, input, new Date())),
    ),

  edit: hubProcedure
    .input(blockInputs.edit)
    .mutation(({ ctx, input }) =>
      runHub(() => editBlock(ctx.db, ctx.actor.userId, input)),
    ),

  remove: hubProcedure
    .input(z.object({ blockPublicId: z.string().min(1).max(32) }))
    .mutation(({ ctx, input }) =>
      runHub(() => removeBlock(ctx.db, ctx.actor.userId, input.blockPublicId)),
    ),
});

const AUDIT_PAGE_SIZE = 50;

const auditRouter = createTRPCRouter({
  list: hubAdminProcedure("audit.view")
    .input(pageInput)
    .query(async ({ ctx, input }) => {
      const [items, total] = await Promise.all([
        listAudit(ctx.db, {
          limit: AUDIT_PAGE_SIZE,
          offset: (input.page - 1) * AUDIT_PAGE_SIZE,
        }),
        countAudit(ctx.db),
      ]);
      return { items, total, pageSize: AUDIT_PAGE_SIZE };
    }),
});

export const hubRouter = createTRPCRouter({
  me: meRouter,
  accounts: accountsRouter,
  grants: grantsRouter,
  audit: auditRouter,
  tasks: tasksRouter,
  schedule: scheduleRouter,

  projects: hubAdminProcedure("admin.view").query(({ ctx }) =>
    listProjects(ctx.db),
  ),

  overview: hubAdminProcedure("admin.view").query(async ({ ctx }) => {
    const [accounts, projects, openGrants] = await Promise.all([
      listAccounts(ctx.db, { page: 1 }),
      listProjects(ctx.db),
      countOpenGrants(ctx.db),
    ]);
    return {
      accounts: accounts.total,
      projects: projects.length,
      openGrants,
    };
  }),
});
