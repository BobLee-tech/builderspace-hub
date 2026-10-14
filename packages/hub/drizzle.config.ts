import { type Config } from "drizzle-kit";

import {
  HUB_MIGRATIONS_SCHEMA,
  HUB_MIGRATIONS_TABLE,
} from "./src/migration-table";

/**
 * Hub tables have their own migration stream.
 *
 * drizzle only applies journal entries newer than the last migration it ran,
 * so sharing Kan's `packages/db/migrations` would let an upstream migration be
 * skipped silently after a sync. Keeping a separate folder and bookkeeping
 * table means the two streams never interleave.
 */
export default {
  schema: "./src/schema",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.POSTGRES_URL ?? "",
    ssl: process.env.NODE_ENV === "production" ? true : false,
  },
  migrations: {
    prefix: "timestamp",
    table: HUB_MIGRATIONS_TABLE,
    schema: HUB_MIGRATIONS_SCHEMA,
  },
  // Never let `push` or `generate` look at Kan's own tables.
  tablesFilter: ["hub_*"],
} satisfies Config;
