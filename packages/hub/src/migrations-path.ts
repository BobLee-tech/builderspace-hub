import { fileURLToPath } from "node:url";

/** Kan's migration files, as shipped in `packages/db`. */
export const kanMigrationsFolder = fileURLToPath(
  new URL("../../db/migrations", import.meta.url),
);

/** The Hub's own migration files. */
export const hubMigrationsFolder = fileURLToPath(
  new URL("../migrations", import.meta.url),
);
