import { eq, lt, sql } from "drizzle-orm";

import type { DbOrTx } from "../db";
import { hubRateLimits } from "../schema";

/**
 * Rate limiting backed by the database, shared by every server instance.
 *
 * Two entry points:
 * - `consumeRateLimit` for the Hub's own routes: one atomic statement counts
 *   the request and says whether it is allowed.
 * - `rateLimitStorage` for Better Auth, which keeps its own counting logic
 *   and only needs somewhere shared to store it.
 */

export interface RateLimitRule {
  /** Length of the window, in seconds. */
  window: number;
  /** Requests allowed per window. */
  max: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Seconds until the window resets; only meaningful when not allowed. */
  retryAfterSeconds: number;
}

/** Counters older than this are of no use to any rule and are removed. */
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Counts one request for `key` and decides it. A window starts with the first
 * request after the previous one expired.
 */
export async function consumeRateLimit(
  db: DbOrTx,
  key: string,
  rule: RateLimitRule,
  now: number = Date.now(),
): Promise<RateLimitDecision> {
  const windowMs = rule.window * 1000;
  const expired = sql`${hubRateLimits.lastRequest} <= ${now - windowMs}`;
  const [row] = await db
    .insert(hubRateLimits)
    .values({ key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: hubRateLimits.key,
      set: {
        // A new window resets the count and its start; otherwise count on
        // and keep the window's start.
        count: sql`case when ${expired} then 1 else ${hubRateLimits.count} + 1 end`,
        lastRequest: sql`case when ${expired} then ${now} else ${hubRateLimits.lastRequest} end`,
      },
    })
    .returning({
      count: hubRateLimits.count,
      lastRequest: hubRateLimits.lastRequest,
    });

  const count = row?.count ?? 1;
  const windowStart = row?.lastRequest ?? now;
  return {
    allowed: count <= rule.max,
    retryAfterSeconds: Math.max(
      1,
      Math.ceil((windowStart + windowMs - now) / 1000),
    ),
  };
}

/** The record Better Auth reads and writes for each key. */
export interface StoredRateLimit {
  key: string;
  count: number;
  lastRequest: number;
}

/**
 * Better Auth's `rateLimit.customStorage`. Errors are swallowed on write, as
 * Better Auth's own database storage does, so a database hiccup never blocks
 * sign-in; a failed read counts as "no record yet". Either way the error is
 * handed to `onError`, so a limit that has silently stopped working shows up
 * in the logs.
 */
export function rateLimitStorage(
  db: DbOrTx,
  options: { random?: () => number; onError?: (error: unknown) => void } = {},
) {
  const random = options.random ?? Math.random;
  const onError = options.onError ?? (() => undefined);
  return {
    async get(key: string): Promise<StoredRateLimit | undefined> {
      try {
        const [row] = await db
          .select()
          .from(hubRateLimits)
          .where(eq(hubRateLimits.key, key))
          .limit(1);
        return row;
      } catch (error) {
        onError(error);
        return undefined;
      }
    },
    async set(key: string, value: StoredRateLimit): Promise<void> {
      try {
        await db
          .insert(hubRateLimits)
          .values({ key, count: value.count, lastRequest: value.lastRequest })
          .onConflictDoUpdate({
            target: hubRateLimits.key,
            set: { count: value.count, lastRequest: value.lastRequest },
          });
        // Now and then, clear out counters nobody has touched for a day.
        if (random() < 0.01) await pruneRateLimits(db, value.lastRequest);
      } catch (error) {
        // Never fail a sign-in because a counter could not be saved.
        onError(error);
      }
    },
  };
}

/** Deletes counters idle for more than a day. Returns how many went. */
export async function pruneRateLimits(
  db: DbOrTx,
  now: number = Date.now(),
): Promise<number> {
  const removed = await db
    .delete(hubRateLimits)
    .where(lt(hubRateLimits.lastRequest, now - STALE_AFTER_MS))
    .returning({ key: hubRateLimits.key });
  return removed.length;
}
