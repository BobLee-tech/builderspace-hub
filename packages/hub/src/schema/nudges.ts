import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

/**
 * People who turned off 催一下 mail. Everyone gets it unless they say no
 * (decided 2026-10-24), so only the exceptions are stored: a person without a
 * row here gets the mail.
 *
 * Nothing records who nudged whom. The once-an-hour limit per recipient lives
 * in `hub_rate_limit`, keyed by the recipient alone, so the sender stays
 * anonymous even to someone reading the database.
 */
export const hubNudgeOptOuts = pgTable("hub_nudge_opt_out", {
  userId: uuid("userId")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();
