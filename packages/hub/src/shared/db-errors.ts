const UNIQUE_VIOLATION = "23505";

/**
 * True when Postgres rejected a write because a unique index already holds
 * that value. The driver's error carries the code directly or, once drizzle
 * wraps it, in `cause`.
 */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code === UNIQUE_VIOLATION || e?.cause?.code === UNIQUE_VIOLATION;
}
