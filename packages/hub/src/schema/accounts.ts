import { sql } from "drizzle-orm";
import { check, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

import type { HubRole } from "../accounts/roles";

export const accountStatuses = ["active", "suspended"] as const;
export type AccountStatus = (typeof accountStatuses)[number];

/**
 * Hub-specific facts about a Kan user: their back-office role, if any, and
 * whether the account is suspended. A user without a row is an ordinary,
 * active account; rows are created only when one of those changes.
 */
export const hubAccounts = pgTable(
  "hub_account",
  {
    userId: uuid("userId")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 16 }).$type<HubRole>(),
    status: varchar("status", { length: 16 })
      .$type<AccountStatus>()
      .notNull()
      .default("active"),
    suspendedAt: timestamp("suspendedAt"),
    suspendedBy: uuid("suspendedBy").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    check(
      "hub_account_role_check",
      sql`${table.role} IS NULL OR ${table.role} IN ('owner', 'admin', 'viewer')`,
    ),
    check(
      "hub_account_status_check",
      sql`${table.status} IN ('active', 'suspended')`,
    ),
  ],
).enableRLS();
