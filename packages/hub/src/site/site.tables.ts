import {
  boolean,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import type { ReviewStatus, VolunteerStatus } from "./site.policy";

/**
 * The official website's tables, as far as the back office uses them. They
 * live in the website's own Supabase database and are created by its
 * migrations (the website repository's `supabase/migrations/`), not
 * by ours: this file is deliberately outside `schema/`, so drizzle-kit never
 * puts them in a Hub migration.
 *
 * Postgres enums are read as text. Only the columns listed here are queried,
 * so a column the website adds later does not break anything. Defaults are
 * declared only so tests can insert rows the way the website does.
 */

export const siteProjects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  problem: text("problem").notNull(),
  targetUser: text("target_user").notNull(),
  status: text("status").notNull(),
  neededRoles: text("needed_roles").array().notNull(),
  nextStep: text("next_step"),
  contact: text("contact").notNull(),
  ownerName: text("owner_name").notNull(),
  repoUrl: text("repo_url"),
  demoUrl: text("demo_url"),
  coverPath: text("cover_path"),
  videoPath: text("video_path"),
  videoSeconds: real("video_seconds"),
  reviewStatus: text("review_status")
    .$type<ReviewStatus>()
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const siteProjectUpdates = pgTable("project_updates", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull(),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  url: text("url"),
  occurredAt: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  reviewStatus: text("review_status")
    .$type<ReviewStatus>()
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * Since the website's migration 20261015030000_volunteer_email only the
 * nickname and positions are required; older rows have `contact` and no
 * `email`. `email` is read in `site.repo.ts`, not declared here, so the Hub
 * works whether or not that migration has run.
 */
export const siteVolunteerApplications = pgTable("volunteer_applications", {
  id: uuid("id").primaryKey().defaultRandom(),
  nickname: text("nickname").notNull(),
  contact: text("contact"),
  schoolDegree: text("school_degree"),
  positions: text("positions").array().notNull(),
  weeklyHours: text("weekly_hours"),
  about: text("about"),
  portfolioUrl: text("portfolio_url"),
  channel: text("channel"),
  status: text("status").$type<VolunteerStatus>().notNull().default("new"),
  opsNotes: text("ops_notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const siteJoinSubmissions = pgTable("join_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  nickname: text("nickname").notNull(),
  schoolDegree: text("school_degree").notNull(),
  major: text("major").notNull(),
  skills: text("skills").array().notNull(),
  idea: text("idea"),
  weeklyHours: text("weekly_hours").notNull(),
  referralSource: text("referral_source").notNull(),
  channel: text("channel"),
  stalledProject: boolean("stalled_project"),
  blockers: text("blockers").array().notNull(),
  nextEventInterest: text("next_event_interest"),
  availability: text("availability").array().notNull(),
  affiliationSupport: boolean("affiliation_support").notNull(),
  fullName: text("full_name"),
  zid: text("zid"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const siteTables = {
  siteProjects,
  siteProjectUpdates,
  siteVolunteerApplications,
  siteJoinSubmissions,
};
