import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  pgTable,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { boards, users } from "@kan/db/schema";

import type { BoardAudience } from "../private-boards/private-board.policy";

/**
 * A board hidden from most of its project. A board without a row here follows
 * Kan's rules (every project member can see it). With one, `audience` says
 * who still sees the board, its lists and its cards, anywhere in the app:
 *
 * - `owner` (仅自己可见): only `ownerUserId`. It becomes null when the owner's
 *   account is deleted; the board then stays hidden from everyone instead of
 *   falling open to the project, because whoever hid it did not want the
 *   others to read it.
 * - `admins` (仅管理员可见): whoever is a project admin at the time, read from
 *   Kan's memberships on every request. `ownerUserId` only records who set it.
 */
export const hubPrivateBoards = pgTable(
  "hub_private_board",
  {
    boardId: bigint("boardId", { mode: "number" })
      .primaryKey()
      .references(() => boards.id, { onDelete: "cascade" }),
    ownerUserId: uuid("ownerUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    audience: varchar("audience", { length: 16 })
      .$type<BoardAudience>()
      .default("owner")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (table) => [
    check(
      "hub_private_board_audience_check",
      sql`${table.audience} IN ('owner', 'admins')`,
    ),
  ],
).enableRLS();
