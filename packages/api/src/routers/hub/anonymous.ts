/**
 * Procedures whose caller stays anonymous. Kan's logging middleware records
 * every call with the caller's id and its raw input, which for 催一下 would
 * say exactly who nudged whom (in the server logs, and Axiom where it is
 * configured). Called from that middleware in trpc.ts (a hub-seam).
 */
const ANONYMOUS_PROCEDURES: ReadonlySet<string> = new Set(["hub.nudges.send"]);

interface LogEntry {
  userId?: string;
  email?: string;
  input?: unknown;
  err?: unknown;
}

/**
 * A call's log entry, minus who made it and what they sent when the
 * procedure is anonymous. The error goes too: a database error can quote the
 * query's parameters. What is left (procedure, status, error code, timing)
 * still shows whether the feature works.
 */
export function anonymousLogEntry<T extends LogEntry>(
  path: string,
  entry: T,
): T {
  if (!ANONYMOUS_PROCEDURES.has(path)) return entry;
  return {
    ...entry,
    userId: undefined,
    email: undefined,
    input: undefined,
    err: undefined,
  };
}
