import {
  bigint,
  bigserial,
  pgTable,
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
