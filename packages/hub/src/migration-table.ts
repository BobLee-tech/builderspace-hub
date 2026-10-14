/**
 * Where drizzle records which Hub migrations have run. Kan's own stream uses
 * the default `drizzle.__drizzle_migrations`; ours must not share it.
 *
 * Imported by `drizzle.config.ts`, so keep this file free of anything that
 * needs a module runtime (no `import.meta`, no other imports).
 */
export const HUB_MIGRATIONS_TABLE = "__hub_migrations";
export const HUB_MIGRATIONS_SCHEMA = "drizzle";
