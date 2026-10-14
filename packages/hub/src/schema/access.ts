import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users, workspaces } from "@kan/db/schema";

import type { HubRole } from "../accounts/roles";

export const grantSources = ["direct", "application", "cli"] as const;
export type GrantSource = (typeof grantSources)[number];

export { hubRoles } from "../accounts/roles";
export type { HubRole } from "../accounts/roles";

export const projectRoles = ["admin", "member", "guest"] as const;
export type ProjectRole = (typeof projectRoles)[number];

/**
 * Permission for one e-mail address to register, redeemed with a one-time link.
 *
 * Only the SHA-256 of the link's token is stored. A grant is "open" until it is
 * consumed or revoked; the partial unique index allows one open grant per
 * address, so issuing a new one must close the old one first.
 *
 * Enumerations are text + CHECK rather than pgEnum because Kan already owns a
 * Postgres enum literally named "role".
 */
export const hubAccessGrants = pgTable(
  "hub_access_grant",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    email: varchar("email", { length: 255 }).notNull(),
    tokenHash: varchar("tokenHash", { length: 64 }).notNull().unique(),
    hubRole: varchar("hubRole", { length: 16 }).$type<HubRole>(),
    note: varchar("note", { length: 280 }),
    source: varchar("source", { length: 16 }).$type<GrantSource>().notNull(),
    expiresAt: timestamp("expiresAt").notNull(),
    consumedAt: timestamp("consumedAt"),
    consumedBy: uuid("consumedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revokedAt"),
    revokedBy: uuid("revokedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_access_grant_email_idx").on(table.email),
    uniqueIndex("hub_access_grant_open_email_idx")
      .on(table.email)
      .where(sql`${table.consumedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    check(
      "hub_access_grant_source_check",
      sql`${table.source} IN ('direct', 'application', 'cli')`,
    ),
    check(
      "hub_access_grant_hub_role_check",
      sql`${table.hubRole} IS NULL OR ${table.hubRole} IN ('owner', 'admin', 'viewer')`,
    ),
    check(
      "hub_access_grant_email_lowercase_check",
      sql`${table.email} = lower(${table.email})`,
    ),
  ],
).enableRLS();

/** A project the new account is added to, and with which role, on registration. */
export const hubAccessGrantProjects = pgTable(
  "hub_access_grant_project",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    grantId: bigint("grantId", { mode: "number" })
      .notNull()
      .references(() => hubAccessGrants.id, { onDelete: "cascade" }),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).$type<ProjectRole>().notNull(),
  },
  (table) => [
    uniqueIndex("hub_access_grant_project_unique_idx").on(
      table.grantId,
      table.workspaceId,
    ),
    check(
      "hub_access_grant_project_role_check",
      sql`${table.role} IN ('admin', 'member', 'guest')`,
    ),
  ],
).enableRLS();
