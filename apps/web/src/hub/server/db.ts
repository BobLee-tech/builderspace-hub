import type { dbClient } from "@kan/db/client";
import { createDrizzleClient } from "@kan/db/client";

const globalForHub = globalThis as unknown as { hubDb?: dbClient };

/**
 * Database client for the Hub's own API routes. Server only.
 *
 * Cached on `globalThis` so development hot reloads reuse one pool instead of
 * opening a new one on every edit.
 */
export function getHubDb(): dbClient {
  globalForHub.hubDb ??= createDrizzleClient();
  return globalForHub.hubDb;
}
