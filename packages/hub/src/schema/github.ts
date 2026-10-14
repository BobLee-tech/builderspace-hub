import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users, workspaces } from "@kan/db/schema";

/**
 * Which GitHub repositories belong to which project, set in the back office.
 * Someone's GitHub activity only ever counts repositories of projects they
 * can see, so this table is also what limits what is read on their behalf.
 *
 * `fullName` is "owner/name" in lower case: GitHub treats names without
 * regard to case, and one spelling keeps the uniqueness check honest.
 */
export const hubProjectRepos = pgTable(
  "hub_project_repo",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    fullName: varchar("fullName", { length: 140 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
  },
  (table) => [
    unique("hub_project_repo_workspace_name_unique").on(
      table.workspaceId,
      table.fullName,
    ),
  ],
).enableRLS();

/**
 * A person's connection to GitHub through the Hub's GitHub App: who they are
 * on GitHub and the user token the App was given for them. Tokens are stored
 * encrypted (see github/token-crypto.ts), never in plain text, and are only
 * ever used to read repositories of projects the person can see.
 */
export const hubGitHubAccounts = pgTable("hub_github_account", {
  userId: uuid("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  githubId: bigint("githubId", { mode: "number" }).notNull(),
  login: varchar("login", { length: 39 }).notNull(),
  avatarUrl: text("avatarUrl"),
  accessToken: text("accessToken").notNull(),
  accessTokenExpiresAt: timestamp("accessTokenExpiresAt"),
  refreshToken: text("refreshToken"),
  refreshTokenExpiresAt: timestamp("refreshTokenExpiresAt"),
  connectedAt: timestamp("connectedAt").defaultNow().notNull(),
  lastSyncedAt: timestamp("lastSyncedAt"),
}).enableRLS();

export const githubEventKinds = [
  "commit",
  "pr_opened",
  "pr_merged",
  "issue_opened",
] as const;
export type GitHubEventKind = (typeof githubEventKinds)[number];

/**
 * Something a person did on GitHub in a linked repository, as last synced.
 * Kept so the counts do not depend on GitHub answering, and so a later
 * decision about rewards has the history to work from. Which of these count
 * is decided when they are read, against the projects the person can see now.
 */
export const hubGitHubEvents = pgTable(
  "hub_github_event",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    repoFullName: varchar("repoFullName", { length: 140 }).notNull(),
    kind: varchar("kind", { length: 16 }).$type<GitHubEventKind>().notNull(),
    /** A commit SHA or a pull request / issue number. */
    ref: varchar("ref", { length: 64 }).notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    occurredAt: timestamp("occurredAt").notNull(),
  },
  (table) => [
    unique("hub_github_event_unique").on(
      table.userId,
      table.repoFullName,
      table.kind,
      table.ref,
    ),
    index("hub_github_event_user_time_idx").on(table.userId, table.occurredAt),
    check(
      "hub_github_event_kind_check",
      sql`${table.kind} IN ('commit', 'pr_opened', 'pr_merged', 'issue_opened')`,
    ),
  ],
).enableRLS();
