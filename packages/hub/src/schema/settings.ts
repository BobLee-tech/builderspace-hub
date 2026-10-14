import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

/**
 * Small instance-wide settings, one JSON value per key (for example the
 * colours of the three functions). Each key's shape is validated by the
 * module that owns it, never trusted as stored.
 */
export const hubSettings = pgTable("hub_setting", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  updatedBy: uuid("updatedBy").references(() => users.id, {
    onDelete: "set null",
  }),
}).enableRLS();
