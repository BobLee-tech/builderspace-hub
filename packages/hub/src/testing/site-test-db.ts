import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import type { SiteDb } from "../site/site.db";
import { siteTables } from "../site/site.tables";

/**
 * The website tables the back office uses, as the website's migrations create
 * them (the website repository's `supabase/migrations/`), minus
 * Supabase's roles, policies and triggers. Enums are real enums, so the tests
 * catch a value the website would refuse.
 */
const SITE_SCHEMA = /* sql */ `
  create type project_status as enum ('recruiting', 'building', 'demoed', 'paused');
  create type review_status as enum ('pending', 'approved', 'rejected');
  create type update_kind as enum ('commit', 'demo', 'post');
  create type weekly_hours as enum ('lt2', '2to5', 'gt5');
  create type volunteer_status as enum
    ('new', 'contacted', 'interviewing', 'accepted', 'declined');

  create table projects (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null,
    problem text not null,
    target_user text not null,
    status project_status not null default 'recruiting',
    needed_roles text[] not null default '{}',
    next_step text,
    contact text not null,
    owner_name text not null,
    repo_url text,
    demo_url text,
    cover_path text,
    video_path text,
    video_seconds real,
    review_status review_status not null default 'pending',
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table project_updates (
    id uuid primary key default gen_random_uuid(),
    project_id uuid not null references projects (id) on delete cascade,
    kind update_kind not null,
    body text not null,
    url text,
    occurred_at timestamptz not null default now(),
    review_status review_status not null default 'pending',
    created_at timestamptz not null default now()
  );

  create table volunteer_applications (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    contact text not null,
    school_degree text not null,
    positions text[] not null,
    weekly_hours weekly_hours not null,
    about text not null,
    portfolio_url text,
    channel text,
    data_consent boolean not null default true,
    created_at timestamptz not null default now(),
    status volunteer_status not null default 'new',
    ops_notes text check (char_length(ops_notes) <= 1000)
  );

  create table join_submissions (
    id uuid primary key default gen_random_uuid(),
    nickname text not null,
    school_degree text not null,
    major text not null,
    skills text[] not null default '{}',
    idea text,
    weekly_hours weekly_hours not null,
    referral_source text not null,
    showcase_consent boolean not null default false,
    created_at timestamptz not null default now(),
    stalled_project boolean,
    blockers text[] not null default '{}',
    channel text,
    next_event_interest text,
    availability text[] not null default '{}',
    affiliation_support boolean not null default false,
    full_name text,
    zid text,
    affiliation_consent boolean not null default false
  );
`;

/** A fresh in-memory copy of the website's tables, empty. */
export async function createSiteTestDb(): Promise<SiteDb> {
  const client = new PGlite();
  await client.exec(SITE_SCHEMA);
  return drizzle(client, { schema: siteTables }) as unknown as SiteDb;
}

let seq = 0;

export async function seedSiteProject(
  site: SiteDb,
  overrides: {
    name?: string;
    reviewStatus?: "pending" | "approved" | "rejected";
    createdAt?: Date;
  } = {},
): Promise<{ id: string; name: string }> {
  seq += 1;
  const [row] = await site
    .insert(siteTables.siteProjects)
    .values({
      slug: `project-${seq}`,
      name: overrides.name ?? `Project ${seq}`,
      problem: "A problem worth solving",
      targetUser: "Students",
      status: "recruiting",
      neededRoles: ["frontend"],
      contact: "wechat-id",
      ownerName: "Owner",
      reviewStatus: overrides.reviewStatus ?? "pending",
      createdAt: overrides.createdAt ?? new Date(),
      updatedAt: overrides.createdAt ?? new Date(),
    })
    .returning({ id: siteTables.siteProjects.id });
  if (!row) throw new Error("seedSiteProject: insert returned no row");
  return { id: row.id, name: overrides.name ?? `Project ${seq}` };
}

export async function seedSiteUpdate(
  site: SiteDb,
  projectId: string,
  overrides: { reviewStatus?: "pending" | "approved" | "rejected" } = {},
): Promise<{ id: string }> {
  const [row] = await site
    .insert(siteTables.siteProjectUpdates)
    .values({
      projectId,
      kind: "demo",
      body: "Shipped a demo",
      reviewStatus: overrides.reviewStatus ?? "pending",
    })
    .returning({ id: siteTables.siteProjectUpdates.id });
  if (!row) throw new Error("seedSiteUpdate: insert returned no row");
  return row;
}

export async function seedSiteVolunteer(
  site: SiteDb,
  overrides: { nickname?: string; createdAt?: Date } = {},
): Promise<{ id: string }> {
  seq += 1;
  const [row] = await site
    .insert(siteTables.siteVolunteerApplications)
    .values({
      nickname: overrides.nickname ?? `Volunteer ${seq}`,
      contact: `wechat-${seq}`,
      schoolDegree: "UNSW · Bachelor",
      positions: ["events", "web_tools"],
      weeklyHours: "2to5",
      about: "I like building things",
      createdAt: overrides.createdAt ?? new Date(),
    })
    .returning({ id: siteTables.siteVolunteerApplications.id });
  if (!row) throw new Error("seedSiteVolunteer: insert returned no row");
  return row;
}

export async function seedSiteJoin(
  site: SiteDb,
  overrides: { supporter?: boolean; createdAt?: Date } = {},
): Promise<{ id: string }> {
  seq += 1;
  const supporter = overrides.supporter ?? false;
  const [row] = await site
    .insert(siteTables.siteJoinSubmissions)
    .values({
      nickname: `Member ${seq}`,
      schoolDegree: "UNSW · Master",
      major: "IT",
      skills: ["frontend"],
      weeklyHours: "lt2",
      referralSource: "wechat",
      blockers: [],
      availability: ["online"],
      affiliationSupport: supporter,
      fullName: supporter ? "Full Name" : null,
      zid: supporter ? `z${String(5_000_000 + seq)}` : null,
      createdAt: overrides.createdAt ?? new Date(),
    })
    .returning({ id: siteTables.siteJoinSubmissions.id });
  if (!row) throw new Error("seedSiteJoin: insert returned no row");
  return row;
}
