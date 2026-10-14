import type { SQL } from "drizzle-orm";
import { asc, count, desc, eq, sql } from "drizzle-orm";

import type { SiteDb } from "./site.db";
import type {
  ReviewDecision,
  ReviewStatus,
  VolunteerStatus,
} from "./site.policy";
import {
  siteJoinSubmissions,
  siteProjects,
  siteProjectUpdates,
  siteVolunteerApplications,
} from "./site.tables";

/**
 * Queries against the official website's database. The role the Hub signs in
 * with can only run what is here: select on four tables, and update the
 * review and follow-up columns.
 */

export type SiteProjectRow = typeof siteProjects.$inferSelect;
export type SiteVolunteerRow = typeof siteVolunteerApplications.$inferSelect;
export type SiteJoinRow = typeof siteJoinSubmissions.$inferSelect;

export interface SiteUpdateRow {
  id: string;
  projectId: string;
  projectName: string | null;
  kind: string;
  body: string;
  url: string | null;
  occurredAt: Date;
  reviewStatus: ReviewStatus;
  createdAt: Date;
}

export interface Paging {
  limit: number;
  offset: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

const countWhere = (condition: SQL) =>
  sql<number>`count(*) filter (where ${condition})`.mapWith(Number);

export interface ReviewCounts {
  pendingProjects: number;
  pendingUpdates: number;
}

export async function countPendingReviews(db: SiteDb): Promise<ReviewCounts> {
  const [[projects], [updates]] = await Promise.all([
    db
      .select({ pending: count() })
      .from(siteProjects)
      .where(eq(siteProjects.reviewStatus, "pending")),
    db
      .select({ pending: count() })
      .from(siteProjectUpdates)
      .where(eq(siteProjectUpdates.reviewStatus, "pending")),
  ]);
  return {
    pendingProjects: projects?.pending ?? 0,
    pendingUpdates: updates?.pending ?? 0,
  };
}

export interface PeopleCounts {
  volunteers: number;
  newVolunteers: number;
  joins: number;
  recentJoins: number;
  supporters: number;
}

/** Sizes of the two lists; `since` bounds `recentJoins`. */
export async function countPeople(
  db: SiteDb,
  since: Date,
): Promise<PeopleCounts> {
  const [[volunteers], [joins]] = await Promise.all([
    db
      .select({
        all: count(),
        fresh: countWhere(sql`${siteVolunteerApplications.status} = 'new'`),
      })
      .from(siteVolunteerApplications),
    db
      .select({
        all: count(),
        recent: countWhere(
          sql`${siteJoinSubmissions.createdAt} >= ${since.toISOString()}`,
        ),
        supporters: countWhere(sql`${siteJoinSubmissions.affiliationSupport}`),
      })
      .from(siteJoinSubmissions),
  ]);
  return {
    volunteers: volunteers?.all ?? 0,
    newVolunteers: volunteers?.fresh ?? 0,
    joins: joins?.all ?? 0,
    recentJoins: joins?.recent ?? 0,
    supporters: joins?.supporters ?? 0,
  };
}

/**
 * Project cards in one review state. The pending queue runs oldest first, so
 * nobody waits longest; decided ones show the latest decision first.
 */
export async function listProjects(
  db: SiteDb,
  review: ReviewStatus,
  paging: Paging,
): Promise<Page<SiteProjectRow>> {
  const where = eq(siteProjects.reviewStatus, review);
  const [items, [counted]] = await Promise.all([
    db
      .select()
      .from(siteProjects)
      .where(where)
      .orderBy(
        review === "pending"
          ? asc(siteProjects.createdAt)
          : desc(siteProjects.updatedAt),
        asc(siteProjects.id),
      )
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(siteProjects).where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}

/** Progress updates in one review state, with their project's name. */
export async function listUpdates(
  db: SiteDb,
  review: ReviewStatus,
  paging: Paging,
): Promise<Page<SiteUpdateRow>> {
  const where = eq(siteProjectUpdates.reviewStatus, review);
  const [items, [counted]] = await Promise.all([
    db
      .select({
        id: siteProjectUpdates.id,
        projectId: siteProjectUpdates.projectId,
        projectName: siteProjects.name,
        kind: siteProjectUpdates.kind,
        body: siteProjectUpdates.body,
        url: siteProjectUpdates.url,
        occurredAt: siteProjectUpdates.occurredAt,
        reviewStatus: siteProjectUpdates.reviewStatus,
        createdAt: siteProjectUpdates.createdAt,
      })
      .from(siteProjectUpdates)
      .leftJoin(siteProjects, eq(siteProjects.id, siteProjectUpdates.projectId))
      .where(where)
      .orderBy(
        review === "pending"
          ? asc(siteProjectUpdates.createdAt)
          : desc(siteProjectUpdates.createdAt),
        asc(siteProjectUpdates.id),
      )
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(siteProjectUpdates).where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}

export interface ReviewChange {
  /** What the person reviewing would recognise: the project's name. */
  name: string;
  from: ReviewStatus;
}

/**
 * Sets a project card's review state. Returns what it was, or null when there
 * is no such card. The row is locked first, so two reviewers deciding at once
 * are applied one after the other and the log shows both.
 */
export async function setProjectReview(
  db: SiteDb,
  projectId: string,
  decision: ReviewDecision,
): Promise<ReviewChange | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ name: siteProjects.name, from: siteProjects.reviewStatus })
      .from(siteProjects)
      .where(eq(siteProjects.id, projectId))
      .for("update");
    if (!row) return null;
    if (row.from !== decision) {
      await tx
        .update(siteProjects)
        .set({ reviewStatus: decision })
        .where(eq(siteProjects.id, projectId));
    }
    return row;
  });
}

/** Sets a progress update's review state; `name` is its project's name. */
export async function setUpdateReview(
  db: SiteDb,
  updateId: string,
  decision: ReviewDecision,
): Promise<ReviewChange | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        projectId: siteProjectUpdates.projectId,
        from: siteProjectUpdates.reviewStatus,
      })
      .from(siteProjectUpdates)
      .where(eq(siteProjectUpdates.id, updateId))
      .for("update");
    if (!row) return null;
    if (row.from !== decision) {
      await tx
        .update(siteProjectUpdates)
        .set({ reviewStatus: decision })
        .where(eq(siteProjectUpdates.id, updateId));
    }
    const [project] = await tx
      .select({ name: siteProjects.name })
      .from(siteProjects)
      .where(eq(siteProjects.id, row.projectId));
    return { name: project?.name ?? "", from: row.from };
  });
}

/** Volunteer applications, newest first, optionally in one state only. */
export async function listVolunteers(
  db: SiteDb,
  status: VolunteerStatus | null,
  paging: Paging,
): Promise<Page<SiteVolunteerRow>> {
  const where = status
    ? eq(siteVolunteerApplications.status, status)
    : undefined;
  const [items, [counted]] = await Promise.all([
    db
      .select()
      .from(siteVolunteerApplications)
      .where(where)
      .orderBy(
        desc(siteVolunteerApplications.createdAt),
        asc(siteVolunteerApplications.id),
      )
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(siteVolunteerApplications).where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}

export interface VolunteerChange {
  nickname: string;
  status: VolunteerStatus;
  notes: string | null;
}

/**
 * Updates the follow-up columns of one application and returns them as they
 * were before, or null when there is no such application.
 */
export async function updateVolunteer(
  db: SiteDb,
  applicationId: string,
  change: { status?: VolunteerStatus; notes?: string | null },
): Promise<VolunteerChange | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        nickname: siteVolunteerApplications.nickname,
        status: siteVolunteerApplications.status,
        notes: siteVolunteerApplications.opsNotes,
      })
      .from(siteVolunteerApplications)
      .where(eq(siteVolunteerApplications.id, applicationId))
      .for("update");
    if (!row) return null;
    await tx
      .update(siteVolunteerApplications)
      .set({
        ...(change.status !== undefined && { status: change.status }),
        ...(change.notes !== undefined && { opsNotes: change.notes }),
      })
      .where(eq(siteVolunteerApplications.id, applicationId));
    return row;
  });
}

/** Join-form submissions, newest first; `supportersOnly` keeps those who back the club's application. */
export async function listJoins(
  db: SiteDb,
  supportersOnly: boolean,
  paging: Paging,
): Promise<Page<SiteJoinRow>> {
  const where = supportersOnly
    ? eq(siteJoinSubmissions.affiliationSupport, true)
    : undefined;
  const [items, [counted]] = await Promise.all([
    db
      .select()
      .from(siteJoinSubmissions)
      .where(where)
      .orderBy(desc(siteJoinSubmissions.createdAt), asc(siteJoinSubmissions.id))
      .limit(paging.limit)
      .offset(paging.offset),
    db.select({ total: count() }).from(siteJoinSubmissions).where(where),
  ]);
  return { items, total: counted?.total ?? 0 };
}
