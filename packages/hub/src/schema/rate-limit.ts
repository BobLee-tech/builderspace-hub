import { bigint, integer, pgTable, varchar } from "drizzle-orm/pg-core";

/**
 * Request counters for rate limiting, one row per key (typically client IP
 * plus path). Kept in the database rather than in memory because the app runs
 * as many short-lived serverless instances: an in-memory counter would let an
 * attacker spread attempts across them. Same shape as Better Auth's own
 * rate-limit record, so it can back Better Auth directly.
 */
export const hubRateLimits = pgTable("hub_rate_limit", {
  key: varchar("key", { length: 255 }).primaryKey(),
  count: integer("count").notNull(),
  /**
   * Milliseconds since the epoch: the latest request for Better Auth's keys,
   * the start of the current window for the Hub's own (`hub:` keys).
   */
  lastRequest: bigint("lastRequest", { mode: "number" }).notNull(),
}).enableRLS();
