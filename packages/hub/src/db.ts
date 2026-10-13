import type { dbClient } from "@kan/db/client";

/** Kan's database client. */
export type Db = dbClient;

/** The handle drizzle passes to a `db.transaction(async (tx) => …)` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * What every Hub repository function takes first, so a service can run several
 * of them inside one transaction.
 */
export type DbOrTx = Db | Tx;
