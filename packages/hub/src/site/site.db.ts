import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { siteTables } from "./site.tables";

/**
 * The connection to the official website's database. Server only.
 *
 * The website keeps its data in its own Supabase project. The Hub connects
 * with a Postgres role made for it (`hub_site_admin`, created by the website's
 * migration `…_hub_site_admin.sql`) that can read four tables and change a few
 * columns, nothing else — not Supabase's service key, which can do anything.
 */

export type SiteDb = NodePgDatabase<typeof siteTables>;

export interface SiteDbConfig {
  url: string;
  /** PEM of the CA that signed the server's certificate (Supabase's root CA). */
  ca: string | null;
}

/** The connection settings, or null while the website is not connected. */
export function siteDbConfig(
  env: Record<string, string | undefined> = process.env,
): SiteDbConfig | null {
  const url = env.HUB_SITE_DATABASE_URL?.trim();
  if (!url) return null;
  // A PEM pasted into a single-line field arrives with literal "\n"s.
  const ca = env.HUB_SITE_DATABASE_CA?.trim().replace(/\\n/g, "\n") ?? "";
  return { url, ca: ca.length > 0 ? ca : null };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const SSL_PARAMS = [
  "sslmode",
  "sslrootcert",
  "sslcert",
  "sslkey",
  "uselibpqcompat",
];

/**
 * Pool settings for a config. Anything but a local database is reached over
 * TLS with the certificate verified (against `ca` when given, otherwise the
 * system's roots), whatever `sslmode` the URL carries: node-postgres lets the
 * URL override the `ssl` option, so the URL's TLS parameters are dropped.
 */
export function sitePoolConfig(config: SiteDbConfig): PoolConfig {
  const base: PoolConfig = {
    // Each server instance needs very few; the website's pooler does the rest.
    max: 2,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 5_000,
  };
  const url = new URL(config.url);
  if (LOCAL_HOSTS.has(url.hostname)) {
    return { ...base, connectionString: config.url };
  }
  for (const param of SSL_PARAMS) url.searchParams.delete(param);
  return {
    ...base,
    connectionString: url.toString(),
    ssl: config.ca
      ? { ca: config.ca, rejectUnauthorized: true }
      : { rejectUnauthorized: true },
  };
}

let cached: { key: string; pool: Pool; db: SiteDb } | null = null;
let override: SiteDb | null = null;

/**
 * The website's database, or null while it is not connected. The pool is made
 * once per server instance and reused.
 */
export function connectSiteDb(
  config: SiteDbConfig | null = siteDbConfig(),
): SiteDb | null {
  if (override) return override;
  if (!config) return null;
  const key = `${config.url}\n${config.ca ?? ""}`;
  if (cached?.key !== key) {
    void cached?.pool.end();
    const pool = new Pool(sitePoolConfig(config));
    cached = { key, pool, db: drizzle(pool, { schema: siteTables }) };
  }
  return cached.db;
}

/** Closes the pool, for a process about to exit (the command line). */
export async function closeSiteDb(): Promise<void> {
  const open = cached;
  cached = null;
  await open?.pool.end();
}

/** Tests only: answer every `connectSiteDb()` with this database (null undoes it). */
export function overrideSiteDbForTests(db: SiteDb | null): void {
  override = db;
}
