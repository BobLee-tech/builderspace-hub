import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  index,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users, workspaces } from "@kan/db/schema";

/**
 * The club's departments (技术, 活动, 运营 to start with). One list for every
 * project: each project has every department, with its own people in it.
 * Departments are made and renamed in the back office and never deleted, so
 * documents shared with one can never lose it; hence `restrict` below.
 *
 * Departments are not the functions (boards): adding one does not add a board.
 * The first three share the functions' names because that is how the club is
 * organised, not because one follows the other.
 */
export const hubDepartments = pgTable(
  "hub_department",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    name: varchar("name", { length: 40 }).notNull(),
    /** Display order, lowest first. */
    position: integer("position").notNull(),
    createdBy: uuid("createdBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("hub_department_name_idx").on(sql`lower(${table.name})`),
  ],
).enableRLS();

/**
 * Who is in which department of which project. A person can be in several
 * departments of a project, or in none.
 *
 * A row only counts while the person is still an active member of the
 * project: leaving the project takes them out of its departments without
 * this table having to follow Kan's membership changes.
 */
export const hubDepartmentMembers = pgTable(
  "hub_department_member",
  {
    departmentId: bigint("departmentId", { mode: "number" })
      .notNull()
      .references(() => hubDepartments.id, { onDelete: "restrict" }),
    workspaceId: bigint("workspaceId", { mode: "number" })
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: uuid("addedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    addedAt: timestamp("addedAt").defaultNow().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.departmentId, table.workspaceId, table.userId],
    }),
    index("hub_department_member_user_idx").on(table.userId),
  ],
).enableRLS();
