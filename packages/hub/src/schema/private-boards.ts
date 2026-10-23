import { bigint, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { boards, users } from "@kan/db/schema";

/**
 * A board set to 仅自己可见: only its owner sees the board, its lists and its
 * cards, anywhere in the app. A board without a row here follows Kan's rules
 * (every project member can see it).
 *
 * `ownerUserId` becomes null when the owner's account is deleted. The board
 * then stays hidden from everyone instead of falling open to the project:
 * whoever made it private did not want the others to read it.
 */
export const hubPrivateBoards = pgTable("hub_private_board", {
  boardId: bigint("boardId", { mode: "number" })
    .primaryKey()
    .references(() => boards.id, { onDelete: "cascade" }),
  ownerUserId: uuid("ownerUserId").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}).enableRLS();
