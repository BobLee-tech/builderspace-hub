import { sql } from "drizzle-orm";
import {
  bigint,
  bigserial,
  check,
  index,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { cards, users } from "@kan/db/schema";

export const timeBlockKinds = ["free", "busy", "meeting", "task"] as const;
export type TimeBlockKind = (typeof timeBlockKinds)[number];

/**
 * One stretch of someone's own calendar: time they marked free, busy, spent in
 * a meeting, or set aside for a task.
 *
 * A `task` block stores only which card it is for. Its title and state are
 * read from the card every time, so the board and the calendar cannot drift
 * apart. The other kinds carry their own optional title.
 *
 * Times are instants; which day a block falls on is decided by the viewer's
 * clock. Private to `userId`: nothing outside the owner's own page reads it.
 */
export const hubTimeBlocks = pgTable(
  "hub_time_block",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    publicId: varchar("publicId", { length: 12 }).notNull().unique(),
    userId: uuid("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 16 }).$type<TimeBlockKind>().notNull(),
    title: varchar("title", { length: 80 }),
    startsAt: timestamp("startsAt").notNull(),
    endsAt: timestamp("endsAt").notNull(),
    cardId: bigint("cardId", { mode: "number" }).references(() => cards.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [
    index("hub_time_block_user_starts_idx").on(table.userId, table.startsAt),
    check(
      "hub_time_block_kind_check",
      sql`${table.kind} IN ('free', 'busy', 'meeting', 'task')`,
    ),
    check(
      "hub_time_block_range_check",
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check(
      "hub_time_block_card_check",
      sql`(${table.kind} = 'task') = (${table.cardId} IS NOT NULL)`,
    ),
  ],
).enableRLS();
