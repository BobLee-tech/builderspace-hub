import { z } from "zod";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { SiteDb } from "./site.db";
import type { SiteAccess, SitePermission } from "./site.policy";
import type {
  Page,
  PeopleCounts,
  ReviewChange,
  ReviewCounts,
  SiteJoinRow,
  SiteProjectRow,
  SiteUpdateRow,
  SiteVolunteerRow,
} from "./site.repo";
import { withAudit } from "../audit";
import { HubError, isHubError } from "../shared/errors";
import {
  canOnSite,
  reviewDecisions,
  reviewStatuses,
  reviewStatusLabels,
  VOLUNTEER_NOTES_MAX,
  volunteerStatuses,
  volunteerStatusLabels,
} from "./site.policy";
import * as repo from "./site.repo";

/**
 * The back office's 官网 section: reviewing what visitors submit on the
 * official website and following up on the people who signed up there.
 *
 * Reads and writes go to the website's database (`site`); the audit entry for
 * a change goes to the Hub's (`db`). The two cannot share a transaction, so the
 * website change runs inside the Hub transaction that writes the entry: if the
 * change fails nothing is logged, and only a Hub failure after the website
 * committed could leave a change unlogged.
 */

/** Someone using the 官网 section: who they are and their website access. */
export interface SiteActor extends AuditActor {
  siteAccess: SiteAccess | null;
}

export const SITE_PAGE_SIZE = 30;
/** An export holds at most this many rows; more than the club will have soon. */
export const SITE_EXPORT_LIMIT = 5_000;
const RECENT_DAYS = 7;

const id = z.string().uuid();
const page = z.number().int().min(1).max(10_000);

/** What the API accepts, shared so the router and the use cases agree. */
export const siteInputs = {
  projects: z.object({ review: z.enum(reviewStatuses), page }),
  review: z.object({ id, decision: z.enum(reviewDecisions) }),
  volunteers: z.object({ status: z.enum(volunteerStatuses).nullable(), page }),
  volunteer: z
    .object({
      id,
      status: z.enum(volunteerStatuses).optional(),
      notes: z.string().max(VOLUNTEER_NOTES_MAX).nullable().optional(),
    })
    .refine(
      (input) => input.status !== undefined || input.notes !== undefined,
      "没有要修改的内容",
    ),
  joins: z.object({ supportersOnly: z.boolean(), page }),
};

/** Parses an input, turning a refusal into the first message the schema gives. */
function parseInput<Out>(
  schema: z.ZodType<Out, z.ZodTypeDef, unknown>,
  input: unknown,
): Out {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new HubError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "输入不正确",
    );
  }
  return parsed.data;
}

/** Blank notes are stored as none, so clearing the box clears the column. */
function blankToNull(text: string | null): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function requireAccess(actor: SiteActor, permission: SitePermission): void {
  if (!canOnSite(actor.siteAccess, permission)) {
    throw new HubError("FORBIDDEN", "没有查看或处理官网数据的权限");
  }
}

/**
 * Runs work against the website's database. Its failures (unreachable,
 * refused, a column that is not there yet) are logged here and reach the page
 * as one plain sentence; HubErrors pass through.
 */
async function onSite<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isHubError(error)) throw error;
    console.error("[hub/site] website database query failed", error);
    throw new HubError("UNAVAILABLE", "暂时连不上官网数据库，请稍后再试");
  }
}

const paging = (pageNumber: number) => ({
  limit: SITE_PAGE_SIZE,
  offset: (pageNumber - 1) * SITE_PAGE_SIZE,
});

const withPageSize = <T>(result: Page<T>) => ({
  ...result,
  pageSize: SITE_PAGE_SIZE,
});

export interface SiteSummary {
  /** Only for those who may review. */
  reviews: ReviewCounts | null;
  people: PeopleCounts;
  recentDays: number;
}

export async function getSiteSummary(
  site: SiteDb,
  actor: SiteActor,
  now: Date = new Date(),
): Promise<SiteSummary> {
  requireAccess(actor, "site.people");
  const since = new Date(now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000);
  return onSite(async () => {
    const [reviews, people] = await Promise.all([
      canOnSite(actor.siteAccess, "site.review")
        ? repo.countPendingReviews(site)
        : null,
      repo.countPeople(site, since),
    ]);
    return { reviews, people, recentDays: RECENT_DAYS };
  });
}

export async function listSiteProjects(
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.projects>,
): Promise<Page<SiteProjectRow> & { pageSize: number }> {
  requireAccess(actor, "site.review");
  const { review, page: pageNumber } = parseInput(siteInputs.projects, input);
  return withPageSize(
    await onSite(() => repo.listProjects(site, review, paging(pageNumber))),
  );
}

export async function listSiteUpdates(
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.projects>,
): Promise<Page<SiteUpdateRow> & { pageSize: number }> {
  requireAccess(actor, "site.review");
  const { review, page: pageNumber } = parseInput(siteInputs.projects, input);
  return withPageSize(
    await onSite(() => repo.listUpdates(site, review, paging(pageNumber))),
  );
}

const reviewSummary = (subject: string, change: ReviewChange, to: string) =>
  `${subject}：${reviewStatusLabels[change.from]} → ${to}`;

export async function reviewSiteProject(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.review>,
): Promise<void> {
  requireAccess(actor, "site.review");
  const { id: projectId, decision } = parseInput(siteInputs.review, input);

  await withAudit(
    db,
    async () => {
      const change = await onSite(() =>
        repo.setProjectReview(site, projectId, decision),
      );
      if (!change) throw new HubError("NOT_FOUND", "找不到这张项目卡");
      return change;
    },
    (change) => ({
      actor,
      action: "site.project_reviewed",
      entityType: "site_project",
      entityId: projectId,
      summary: reviewSummary(
        `官网项目卡「${change.name}」`,
        change,
        reviewStatusLabels[decision],
      ),
      detail: { from: change.from, to: decision },
    }),
  );
}

export async function reviewSiteUpdate(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.review>,
): Promise<void> {
  requireAccess(actor, "site.review");
  const { id: updateId, decision } = parseInput(siteInputs.review, input);

  await withAudit(
    db,
    async () => {
      const change = await onSite(() =>
        repo.setUpdateReview(site, updateId, decision),
      );
      if (!change) throw new HubError("NOT_FOUND", "找不到这条项目进展");
      return change;
    },
    (change) => ({
      actor,
      action: "site.update_reviewed",
      entityType: "site_project_update",
      entityId: updateId,
      summary: reviewSummary(
        `官网项目「${change.name}」的一条进展`,
        change,
        reviewStatusLabels[decision],
      ),
      detail: { from: change.from, to: decision },
    }),
  );
}

export async function listSiteVolunteers(
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.volunteers>,
): Promise<Page<SiteVolunteerRow> & { pageSize: number }> {
  requireAccess(actor, "site.people");
  const { status, page: pageNumber } = parseInput(siteInputs.volunteers, input);
  return withPageSize(
    await onSite(() => repo.listVolunteers(site, status, paging(pageNumber))),
  );
}

/**
 * Moves an application along (新申请 → 已联系 → …) and/or replaces its notes.
 * The log says that the notes changed, never what they say: anyone who reads
 * the log would otherwise read the notes too.
 */
export async function updateSiteVolunteer(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.volunteer>,
): Promise<void> {
  requireAccess(actor, "site.people");
  const parsed = parseInput(siteInputs.volunteer, input);
  const { id: applicationId, status } = parsed;
  const notes =
    parsed.notes === undefined ? undefined : blankToNull(parsed.notes);

  await withAudit(
    db,
    async () => {
      const before = await onSite(() =>
        repo.updateVolunteer(site, applicationId, { status, notes }),
      );
      if (!before) throw new HubError("NOT_FOUND", "找不到这份志愿者申请");
      return before;
    },
    (before) => {
      const parts: string[] = [];
      if (status !== undefined && status !== before.status) {
        parts.push(
          `${volunteerStatusLabels[before.status]} → ${volunteerStatusLabels[status]}`,
        );
      }
      const notesChanged = notes !== undefined && notes !== before.notes;
      if (notesChanged) parts.push("改了备注");
      return {
        actor,
        action: "site.volunteer_updated",
        entityType: "site_volunteer",
        entityId: applicationId,
        summary: `志愿者申请（${before.nickname}）：${parts.join("，") || "没有变化"}`,
        detail: {
          from: before.status,
          to: status ?? before.status,
          notesChanged,
        },
      };
    },
  );
}

export async function listSiteJoins(
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.joins>,
): Promise<Page<SiteJoinRow> & { pageSize: number }> {
  requireAccess(actor, "site.people");
  const { supportersOnly, page: pageNumber } = parseInput(
    siteInputs.joins,
    input,
  );
  return withPageSize(
    await onSite(() =>
      repo.listJoins(site, supportersOnly, paging(pageNumber)),
    ),
  );
}

export const siteExportKinds = ["volunteers", "joins"] as const;
export type SiteExportKind = (typeof siteExportKinds)[number];

/** Which list to export, with the same filter the page has on. */
export const siteExportInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("volunteers"),
    status: z.enum(volunteerStatuses).nullable(),
  }),
  z.object({ kind: z.literal("joins"), supportersOnly: z.boolean() }),
]);
export type SiteExportRequest = z.input<typeof siteExportInput>;

export type SiteExport =
  | { kind: "volunteers"; rows: SiteVolunteerRow[] }
  | { kind: "joins"; rows: SiteJoinRow[] };

/** "志愿者申请（已联系，3 条）": what left the system, for the log. */
function describeExport(request: SiteExportRequest, rows: number): string {
  const filter =
    request.kind === "volunteers"
      ? request.status && volunteerStatusLabels[request.status]
      : request.supportersOnly && "只含支持社团申请的";
  const name = request.kind === "volunteers" ? "志愿者申请" : "加入登记";
  return `导出了官网的${name}（${filter ? `${filter}，` : ""}${rows} 条）`;
}

/**
 * Every row of one list, filtered as on the page, for a spreadsheet. Taking
 * personal details out of the system in bulk is logged, with how many rows
 * left.
 */
export async function exportSiteList(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: SiteExportRequest,
): Promise<SiteExport> {
  requireAccess(actor, "site.people");
  const request = parseInput(siteExportInput, input);
  const all = { limit: SITE_EXPORT_LIMIT, offset: 0 };

  return withAudit(
    db,
    () =>
      onSite<SiteExport>(async () =>
        request.kind === "volunteers"
          ? {
              kind: request.kind,
              rows: (await repo.listVolunteers(site, request.status, all))
                .items,
            }
          : {
              kind: request.kind,
              rows: (await repo.listJoins(site, request.supportersOnly, all))
                .items,
            },
      ),
    (result) => ({
      actor,
      action: "site.list_exported",
      entityType: "site_list",
      entityId: request.kind,
      summary: describeExport(request, result.rows.length),
      detail: { ...request, rows: result.rows.length },
    }),
  );
}
