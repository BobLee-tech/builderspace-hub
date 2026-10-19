import { z } from "zod";

import type { Db } from "../db";
import type { SiteDb } from "./site.db";
import type {
  OnboardingActor,
  OnboardingDeps,
  OnboardingOutcome,
  VolunteerHubAccess,
} from "./site.onboarding";
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
import { normalizeEmail } from "../shared/email";
import { HubError, isHubError } from "../shared/errors";
import {
  describeHubAccess,
  onboardApplicant,
  onboardingDeps,
} from "./site.onboarding";
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

/**
 * Someone using the 官网 section: who they are, their website access, and
 * their back-office role (which decides whether they may issue links).
 */
export interface SiteActor extends OnboardingActor {
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
  sendLink: z.object({ id }),
  mailAccepted: z.object({
    email: z.string().max(320).nullable(),
    dryRun: z.boolean(),
  }),
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

/** An application with where its address stands in the Hub. */
export type SiteVolunteerItem = SiteVolunteerRow & {
  hubAccess: VolunteerHubAccess;
};

export async function listSiteVolunteers(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.volunteers>,
  now: Date = new Date(),
): Promise<Page<SiteVolunteerItem> & { pageSize: number }> {
  requireAccess(actor, "site.people");
  const { status, page: pageNumber } = parseInput(siteInputs.volunteers, input);
  const result = await onSite(() =>
    repo.listVolunteers(site, status, paging(pageNumber)),
  );
  const access = await describeHubAccess(
    db,
    result.items.map((item) => item.email),
    now,
  );
  return withPageSize({
    ...result,
    items: result.items.map((item) => {
      const email = normalizeEmail(item.email);
      return {
        ...item,
        hubAccess: (email ? access.get(email) : undefined) ?? {
          state: "none",
        },
      };
    }),
  });
}

/**
 * Moves an application along (新申请 → 已联系 → …) and/or replaces its notes.
 * The log says that the notes changed, never what they say: anyone who reads
 * the log would otherwise read the notes too.
 *
 * Moving an application to 已录取 also mails the applicant a registration
 * link (see `site.onboarding.ts`). That comes after the change is saved and
 * never undoes it; `onboarding` says how it went, and is null when nothing
 * was moved to 已录取.
 */
export async function updateSiteVolunteer(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.volunteer>,
  deps: OnboardingDeps = onboardingDeps(),
  now: Date = new Date(),
): Promise<{ onboarding: OnboardingOutcome | null }> {
  requireAccess(actor, "site.people");
  const parsed = parseInput(siteInputs.volunteer, input);
  const { id: applicationId, status } = parsed;
  const notes =
    parsed.notes === undefined ? undefined : blankToNull(parsed.notes);

  const before = await withAudit(
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

  if (status !== "accepted" || before.status === "accepted") {
    return { onboarding: null };
  }
  return {
    onboarding: await onboardApplicant(db, actor, before, deps, {
      replace: false,
      now,
    }),
  };
}

/**
 * Mails an accepted applicant a new registration link, replacing any link
 * they still have: for a mail that never arrived, a link that ran out, or
 * an applicant accepted before mail was set up.
 */
export async function sendVolunteerLink(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.sendLink>,
  deps: OnboardingDeps = onboardingDeps(),
  now: Date = new Date(),
): Promise<OnboardingOutcome> {
  requireAccess(actor, "site.people");
  const { id: applicationId } = parseInput(siteInputs.sendLink, input);
  const volunteer = await onSite(() => repo.findVolunteer(site, applicationId));
  if (!volunteer) throw new HubError("NOT_FOUND", "找不到这份志愿者申请");
  if (volunteer.status !== "accepted") {
    throw new HubError("CONFLICT", "先把申请改成「已录取」再发注册链接");
  }
  return onboardApplicant(db, actor, volunteer, deps, { replace: true, now });
}

/** Resend takes two mails a second per team; a run of many stays under that. */
export const MAIL_GAP_MS = 600;

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One accepted applicant, where their address stood, and what was sent. */
export interface AcceptedApplicant {
  nickname: string;
  /** Normalised; null when the application has no usable address. */
  email: string | null;
  /** Where the address stood in the Hub before this run; null without one. */
  before: VolunteerHubAccess | null;
  /** Whether this run mails them a link (or, on a dry run, would). */
  due: boolean;
  /** What mailing came to; null when nothing was sent. */
  outcome: OnboardingOutcome | null;
}

/**
 * Mails a registration link to everyone accepted who never got one: accepted
 * by someone with 名单 alone, straight in the website's database, or before
 * mail was set up. Someone whose link ran out is listed, not mailed again:
 * they had their mail, and another is a decision. With `email`, only that
 * applicant, replacing any link they still have (the card's button).
 *
 * One mail per address, greeting them by their latest application. A mail
 * that is refused leaves them as they were, so the next run tries again.
 */
export async function mailAcceptedApplicants(
  db: Db,
  site: SiteDb,
  actor: SiteActor,
  input: z.input<typeof siteInputs.mailAccepted>,
  deps: OnboardingDeps = onboardingDeps(),
  now: Date = new Date(),
  gapMs: number = MAIL_GAP_MS,
): Promise<AcceptedApplicant[]> {
  requireAccess(actor, "site.people");
  const { email: rawTarget, dryRun } = parseInput(
    siteInputs.mailAccepted,
    input,
  );
  const target = rawTarget === null ? null : normalizeEmail(rawTarget);
  if (rawTarget !== null && target === null) {
    throw new HubError("INVALID_INPUT", `邮箱格式不对：${rawTarget}`);
  }

  const { items } = await onSite(() =>
    repo.listVolunteers(site, "accepted", {
      limit: SITE_EXPORT_LIMIT,
      offset: 0,
    }),
  );
  // Newest first, so the first application seen for an address is the latest.
  const seen = new Set<string>();
  const applicants = items.flatMap((item) => {
    const email = normalizeEmail(item.email);
    if (target !== null && email !== target) return [];
    if (email !== null) {
      if (seen.has(email)) return [];
      seen.add(email);
    }
    return [{ nickname: item.nickname, email }];
  });
  if (target !== null && applicants.length === 0) {
    throw new HubError("NOT_FOUND", `没有 ${target} 的已录取申请`);
  }

  const access = await describeHubAccess(
    db,
    applicants.map((applicant) => applicant.email),
    now,
  );
  const results: AcceptedApplicant[] = [];
  let mailed = 0;
  for (const applicant of applicants) {
    const before = applicant.email
      ? (access.get(applicant.email) ?? { state: "none" })
      : null;
    const due =
      before !== null &&
      (target !== null
        ? before.state !== "registered"
        : before.state === "none");
    let outcome: OnboardingOutcome | null = null;
    if (due && !dryRun) {
      if (mailed > 0 && gapMs > 0) await pause(gapMs);
      mailed += 1;
      outcome = await onboardApplicant(db, actor, applicant, deps, {
        replace: target !== null,
        now,
      });
    }
    results.push({ ...applicant, before, due, outcome });
  }
  return results;
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
