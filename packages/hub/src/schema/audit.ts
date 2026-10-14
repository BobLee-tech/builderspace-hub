import {
  bigserial,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { users } from "@kan/db/schema";

/**
 * Append-only record of every change made through the back office or the CLI.
 *
 * `actorEmail` is copied in rather than joined so an entry still says who did
 * it after that account is deleted. `entityType` + `entityId` are structured so
 * the log can be filtered; `summary` is the sentence shown to people.
 */
export const hubAuditLog = pgTable(
  "hub_audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    at: timestamp("at").defaultNow().notNull(),
    actorUserId: uuid("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    actorEmail: varchar("actorEmail", { length: 255 }).notNull(),
    action: varchar("action", { length: 64 }).notNull(),
    entityType: varchar("entityType", { length: 32 }).notNull(),
    entityId: varchar("entityId", { length: 64 }),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (table) => [
    index("hub_audit_log_at_idx").on(table.at),
    index("hub_audit_log_entity_idx").on(table.entityType, table.entityId),
  ],
).enableRLS();
