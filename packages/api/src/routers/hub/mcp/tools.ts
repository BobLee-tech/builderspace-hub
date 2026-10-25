import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { dbClient } from "@kan/db/client";
import type { mcpTools } from "@kan/hub/mcp";
import { projectRoles } from "@kan/hub/schema";
import { volunteerStatuses } from "@kan/hub/site";
import { stageNames, stageOf, taskViews } from "@kan/hub/tasks";

import type { createInnerTRPCContext, User } from "../../../trpc-context";
import { appRouter } from "../../../root";

/**
 * What each MCP tool does. Every tool is a call to the same procedures the web
 * app uses, as the signed-in person, so the permission checks, the private
 * board guard and the audit log are exactly the web app's. A tool only
 * reshapes: finds the list for a column, trims what an AI does not need.
 *
 * Which tools exist and who gets them is `mcpTools` in `@kan/hub/mcp`; the
 * protocol itself is served by apps/web/src/hub/server/mcp-server.ts.
 */

export type HubCaller = ReturnType<typeof appRouter.createCaller>;

type Auth = Parameters<typeof createInnerTRPCContext>[0]["auth"];

const notOverMcp = () =>
  Promise.reject(new Error("Not available to MCP callers"));

/** Nothing an MCP tool calls needs the browser session's auth helpers. */
const noSessionAuth: Auth = {
  api: {
    getSession: notOverMcp,
    signInMagicLink: notOverMcp,
    listActiveSubscriptions: notOverMcp,
    setPassword: notOverMcp,
  },
};

/**
 * The procedures, called as `user`. The headers carry no cookie and no API
 * key: the person proved who they are with an OAuth token they approved on
 * the consent page, so `hubProcedure` treats the call like the web app's.
 */
export function createMcpCaller(db: dbClient, user: User): HubCaller {
  return appRouter.createCaller({
    user,
    db,
    auth: noSessionAuth,
    headers: new Headers(),
    transport: "trpc",
    requestId: randomUUID(),
  });
}

// --- Arguments ----------------------------------------------------------------

const publicId = (what: string) =>
  z.string().min(1).max(32).describe(`${what}的 publicId`);
const project = z
  .string()
  .min(1)
  .max(32)
  .optional()
  .describe("项目 publicId；不传就是能看到的全部项目");
const stage = z
  .enum(["todo", "doing", "review", "done"])
  .describe("todo 待办、doing 进行中、review 待验收、done 已完成");
const page = z
  .number()
  .int()
  .min(1)
  .max(10_000)
  .default(1)
  .describe("第几页，从 1 开始");

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const dueDate = z
  .string()
  .max(40)
  .refine(
    (value) => !Number.isNaN(toDueDate(value).getTime()),
    "日期要写成 YYYY-MM-DD，或带时区的完整时间",
  )
  .describe("YYYY-MM-DD，或带时区的 ISO 8601 时间");

/**
 * A date alone is stored at noon UTC, which is that same calendar day from
 * UTC−11 to UTC+11: everyone sees the date they were told.
 */
function toDueDate(value: string): Date {
  return new Date(DATE_ONLY.test(value) ? `${value}T12:00:00Z` : value);
}

// --- Results ------------------------------------------------------------------

type Board = Awaited<ReturnType<HubCaller["hub"]["tasks"]["board"]>>;
type Task = Board["columns"][number]["tasks"][number];

const taskOut = (task: Task) => ({
  publicId: task.publicId,
  title: task.title,
  stage: task.stage,
  dueDate: task.dueDate,
  dueState: task.dueState,
  project: task.project,
  board: task.board,
  assignees: task.assignees,
  assignedToMe: task.assignedToMe,
  labels: task.labels.map((label) => label.name),
});

/** The list on a board that stands for a column, by the same names the boards use. */
function listForStage(
  lists: readonly { publicId: string; name: string }[],
  wanted: string,
): string | null {
  return lists.find((list) => stageOf(list.name) === wanted)?.publicId ?? null;
}

function noList(boardName: string, wanted: keyof typeof stageNames): never {
  throw new TRPCError({
    code: "BAD_REQUEST",
    message: `看板「${boardName}」没有「${stageNames[wanted]}」这一列`,
  });
}

// --- The tools ----------------------------------------------------------------

interface ToolImpl<Shape extends z.ZodRawShape> {
  input: Shape;
  // Method syntax on purpose: it lets every tool sit in one record typed by
  // the widest shape, while each `run` still sees its own arguments.
  run(hub: HubCaller, args: z.output<z.ZodObject<Shape>>): Promise<unknown>;
}

const tool = <Shape extends z.ZodRawShape>(
  input: Shape,
  run: (hub: HubCaller, args: z.output<z.ZodObject<Shape>>) => Promise<unknown>,
): ToolImpl<Shape> => ({ input, run });

export const mcpToolImplementations = {
  whoami: tool({}, async (hub) => {
    const [me, home] = await Promise.all([
      hub.hub.me.get(),
      hub.hub.tasks.home({}),
    ]);
    return { ...me, projects: home.scope.projects };
  }),

  home_summary: tool({ project }, async (hub, args) => {
    const home = await hub.hub.tasks.home({ project: args.project });
    return {
      scope: home.scope.current ?? "全部项目",
      counts: home.tiles,
      myOpenTasks: home.myTasks.map(taskOut),
    };
  }),

  task_board: tool(
    {
      view: z
        .enum(taskViews)
        .default("all")
        .describe(
          "mine 指派给我的、due-soon 快到期、overdue 已逾期、all 全部；dev 技术、ops 活动、marketing 运营",
        ),
      project,
      only_mine: z.boolean().optional().describe("只看指派给我的"),
    },
    async (hub, args) => {
      const board = await hub.hub.tasks.board({
        view: args.view,
        project: args.project,
        onlyMine: args.only_mine,
      });
      return {
        scope: board.scope.current ?? "全部项目",
        columns: board.columns.map((column) => ({
          stage: column.stage,
          total: column.total,
          tasks: column.tasks.map(taskOut),
        })),
        boards: board.boards.map((target) => ({
          publicId: target.publicId,
          name: target.name,
          function: target.functionKey,
          project: target.project,
          stages: Object.keys(target.listsByStage),
          canCreate: board.access[target.project.publicId]?.canCreate ?? false,
        })),
      };
    },
  ),

  task_get: tool({ task: publicId("任务") }, async (hub, args) => {
    const card = await hub.card.byId({ cardPublicId: args.task });
    return {
      publicId: card.publicId,
      title: card.title,
      description: card.description,
      stage: stageOf(card.list.name),
      list: card.list.name,
      board: { publicId: card.list.board.publicId, name: card.list.board.name },
      project: card.list.board.workspace.publicId,
      dueDate: card.dueDate,
      assignees: card.members.map((member) => ({
        name: member.user?.name ?? null,
        email: member.email,
      })),
      labels: card.labels.map((label) => label.name),
      checklists: card.checklists.map((checklist) => ({
        name: checklist.name,
        items: checklist.items.map((item) => ({
          title: item.title,
          done: item.completed,
        })),
      })),
      comments: card.activities.flatMap((activity) =>
        activity.comment && !activity.comment.deletedAt
          ? [
              {
                by: activity.user?.name ?? activity.user?.email ?? null,
                at: activity.createdAt,
                text: activity.comment.comment,
              },
            ]
          : [],
      ),
    };
  }),

  task_create: tool(
    {
      board: publicId("看板"),
      stage: stage.default("todo"),
      title: z.string().trim().min(1).max(500).describe("任务标题"),
      description: z.string().max(10_000).optional().describe("说明，Markdown"),
      due_date: dueDate.optional(),
      assign_to_me: z.boolean().optional().describe("指派给自己"),
    },
    async (hub, args) => {
      const board = await hub.hub.tasks.board({ view: "all" });
      const target = board.boards.find((b) => b.publicId === args.board);
      if (!target) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "找不到这块看板，先用 task_board 看看有哪些",
        });
      }
      const listPublicId = target.listsByStage[args.stage];
      if (!listPublicId) noList(target.name, args.stage);
      const access = board.access[target.project.publicId];

      const created = await hub.card.create({
        title: args.title,
        description: args.description ?? "",
        listPublicId,
        labelPublicIds: [],
        memberPublicIds:
          args.assign_to_me && access ? [access.memberPublicId] : [],
        position: "end",
        dueDate: args.due_date ? toDueDate(args.due_date) : null,
      });
      return { publicId: created.publicId, title: args.title };
    },
  ),

  task_move: tool({ task: publicId("任务"), stage }, async (hub, args) => {
    const card = await hub.card.byId({ cardPublicId: args.task });
    const listPublicId = listForStage(card.list.board.lists, args.stage);
    if (!listPublicId) noList(card.list.board.name, args.stage);
    await hub.card.update({ cardPublicId: args.task, listPublicId });
    return { publicId: args.task, stage: args.stage };
  }),

  task_update: tool(
    {
      task: publicId("任务"),
      title: z.string().trim().min(1).max(500).optional(),
      description: z.string().max(10_000).optional(),
      due_date: dueDate.nullable().optional().describe("null 清除截止日期"),
    },
    async (hub, args) => {
      await hub.card.update({
        cardPublicId: args.task,
        title: args.title,
        description: args.description,
        dueDate:
          args.due_date === undefined
            ? undefined
            : args.due_date === null
              ? null
              : toDueDate(args.due_date),
      });
      return { publicId: args.task, updated: true };
    },
  ),

  task_comment: tool(
    {
      task: publicId("任务"),
      comment: z.string().trim().min(1).max(5000),
    },
    async (hub, args) => {
      await hub.card.addComment({
        cardPublicId: args.task,
        comment: args.comment,
      });
      return { publicId: args.task, commented: true };
    },
  ),

  doc_list: tool(
    {
      folder: publicId("文件夹").optional(),
      search: z.string().max(100).optional().describe("按标题搜索"),
    },
    async (hub, args) => {
      const library = await hub.hub.documents.library({
        folderPublicId: args.folder,
        search: args.search,
      });
      return {
        folder: library.folder?.name ?? null,
        folders: library.folders.map((folder) => ({
          publicId: folder.publicId,
          name: folder.name,
        })),
        documents: library.documents.map((document) => ({
          publicId: document.publicId,
          title: document.title,
          filename: document.filename,
          folderPath: document.folderPath,
          visibleToEveryone: document.readable,
          canEdit: document.canEdit,
          updatedAt: document.updatedAt,
        })),
        canCreate: library.canCreate,
      };
    },
  ),

  doc_read: tool({ document: publicId("文档") }, async (hub, args) => {
    const input = { documentPublicId: args.document };
    const [detail, text] = await Promise.all([
      hub.hub.documents.get(input),
      hub.hub.documents.content(input),
    ]);
    return {
      publicId: detail.publicId,
      title: detail.title,
      description: detail.description,
      filename: detail.filename,
      folderPath: detail.folderPath,
      visibleToEveryone: detail.readable,
      canEditText: detail.canEditText,
      updatedAt: text.updatedAt.toISOString(),
      content: text.content,
    };
  }),

  doc_create: tool(
    {
      title: z.string().trim().min(1).max(120),
      filename: z
        .string()
        .max(200)
        .regex(/\.(md|markdown|html|htm)$/i, "文件名要以 .md 或 .html 结尾")
        .optional()
        .describe("决定格式；不传就是「标题.md」"),
      content: z.string().max(400_000).describe("全文"),
      description: z.string().max(2000).optional(),
      folder: publicId("文件夹").optional(),
      visible_to_everyone: z
        .boolean()
        .default(false)
        .describe("所有成员都能看；默认只有所有者和编辑者"),
    },
    async (hub, args) => {
      const created = await hub.hub.documents.createText({
        title: args.title,
        filename: args.filename ?? `${args.title}.md`,
        content: args.content,
        description: args.description,
        folderPublicId: args.folder,
        readable: args.visible_to_everyone,
      });
      return created;
    },
  ),

  doc_update: tool(
    {
      document: publicId("文档"),
      content: z.string().max(400_000).optional().describe("新的全文"),
      expected_updated_at: z
        .string()
        .max(40)
        .optional()
        .describe("doc_read 返回的 updatedAt；文档在那之后被改过就拒绝"),
      title: z.string().trim().min(1).max(120).optional(),
    },
    async (hub, args) => {
      if (args.content === undefined && args.title === undefined) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "没有要改的内容" });
      }
      // The content first: changing the title moves updatedAt on.
      const replaced =
        args.content === undefined
          ? null
          : await hub.hub.documents.replaceText({
              documentPublicId: args.document,
              content: args.content,
              expectedUpdatedAt: args.expected_updated_at,
            });
      if (args.title !== undefined) {
        await hub.hub.documents.update({
          documentPublicId: args.document,
          title: args.title,
        });
      }
      return {
        publicId: args.document,
        contentChanged: replaced?.changed ?? false,
        titleChanged: args.title !== undefined,
      };
    },
  ),

  admin_overview: tool({}, (hub) => hub.hub.overview()),

  project_list: tool({}, (hub) => hub.hub.projects()),

  account_list: tool(
    {
      page,
      search: z.string().max(100).optional().describe("名字或邮箱"),
    },
    (hub, args) => hub.hub.accounts.list(args),
  ),

  account_get: tool(
    { user_id: z.string().uuid().describe("账号的 userId") },
    (hub, args) => hub.hub.accounts.get({ userId: args.user_id }),
  ),

  account_set_project_role: tool(
    {
      user_id: z.string().uuid().describe("账号的 userId"),
      project: publicId("项目"),
      role: z
        .enum(projectRoles)
        .nullable()
        .describe("admin 项目管理员、member 成员、guest 访客；null 移出项目"),
    },
    async (hub, args) => {
      await hub.hub.accounts.setProjectRole({
        userId: args.user_id,
        projectPublicId: args.project,
        role: args.role,
      });
      return { userId: args.user_id, project: args.project, role: args.role };
    },
  ),

  grant_list: tool({ page }, (hub, args) => hub.hub.grants.list(args)),

  grant_revoke: tool({ grant: publicId("注册链接") }, async (hub, args) => {
    await hub.hub.grants.revoke({ grantPublicId: args.grant });
    return { grant: args.grant, revoked: true };
  }),

  audit_list: tool({ page }, (hub, args) => hub.hub.audit.list(args)),

  volunteer_list: tool(
    {
      status: z
        .enum(volunteerStatuses)
        .optional()
        .describe(
          "new 新申请、contacted 已联系、interviewing 面试中、accepted 已录取、declined 未录取；不传是全部",
        ),
      page,
    },
    (hub, args) =>
      hub.hub.site.volunteers({ status: args.status ?? null, page: args.page }),
  ),

  volunteer_update: tool(
    {
      id: z.string().uuid().describe("申请的 id"),
      status: z.enum(volunteerStatuses).optional(),
      notes: z
        .string()
        .max(1000)
        .nullable()
        .optional()
        .describe("备注；null 清空"),
    },
    (hub, args) =>
      hub.hub.site.updateVolunteer({
        id: args.id,
        status: args.status,
        notes: args.notes,
      }),
  ),
} satisfies Record<(typeof mcpTools)[number]["name"], ToolImpl<z.ZodRawShape>>;

export type McpToolName = keyof typeof mcpToolImplementations;

export type McpToolOutcome =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** Errors a person caused come back as the procedure's own message; bugs do not leak. */
export async function runMcpTool(
  name: McpToolName,
  hub: HubCaller,
  args: unknown,
): Promise<McpToolOutcome> {
  const implementation = mcpToolImplementations[
    name
  ] as ToolImpl<z.ZodRawShape>;
  try {
    const parsed = z.object(implementation.input).parse(args ?? {});
    return { ok: true, value: await implementation.run(hub, parsed) };
  } catch (error) {
    if (error instanceof z.ZodError) {
      return { ok: false, message: error.issues[0]?.message ?? "参数不对" };
    }
    if (error instanceof TRPCError && error.code !== "INTERNAL_SERVER_ERROR") {
      return { ok: false, message: error.message };
    }
    throw error;
  }
}
