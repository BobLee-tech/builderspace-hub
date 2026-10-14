import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { HUB_MIGRATIONS_SCHEMA, HUB_MIGRATIONS_TABLE } from "./migration-table";
import { hubMigrationsFolder } from "./migrations-path";
import { applyAllMigrations, createHubTestDb } from "./testing/test-db";

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

const journal = JSON.parse(
  readFileSync(join(hubMigrationsFolder, "meta", "_journal.json"), "utf8"),
) as { entries: JournalEntry[] };

const tableNames = async (db: Awaited<ReturnType<typeof createHubTestDb>>) => {
  const result = await db.execute<{ table_name: string }>(
    sql`select table_name from information_schema.tables where table_schema = 'public'`,
  );
  return result.rows.map((row) => row.table_name);
};

describe("hub migration journal", () => {
  it("has strictly increasing timestamps", () => {
    // drizzle skips any entry older than the newest one it has already applied,
    // so an out-of-order entry would never run on an existing database.
    const stamps = journal.entries.map((entry) => entry.when);
    const sorted = [...stamps].sort((a, b) => a - b);

    expect(stamps).toEqual(sorted);
    expect(new Set(stamps).size).toBe(stamps.length);
  });

  it("has one SQL file per entry", () => {
    for (const entry of journal.entries) {
      expect(existsSync(join(hubMigrationsFolder, `${entry.tag}.sql`))).toBe(
        true,
      );
    }
  });
});

describe("hub migrations", () => {
  it("apply on top of Kan's schema and create only hub_ tables", async () => {
    const db = await createHubTestDb();
    const names = await tableNames(db);

    expect(names).toContain("user");
    expect(names).toContain("workspace");
    expect(names).toEqual(
      expect.arrayContaining([
        "hub_access_grant",
        "hub_access_grant_project",
        "hub_audit_log",
      ]),
    );
  });

  it("are recorded separately from Kan's migrations", async () => {
    const db = await createHubTestDb();

    const hub = await db.execute<{ count: number }>(
      sql.raw(
        `select count(*)::int as count from "${HUB_MIGRATIONS_SCHEMA}"."${HUB_MIGRATIONS_TABLE}"`,
      ),
    );
    const kan = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from "drizzle"."__drizzle_migrations"`,
    );

    expect(hub.rows[0]?.count).toBe(journal.entries.length);
    expect(kan.rows[0]?.count).toBeGreaterThan(journal.entries.length);
  });

  it("can be applied again without doing anything", async () => {
    const db = await createHubTestDb();
    const before = await tableNames(db);

    await applyAllMigrations(db);

    expect(await tableNames(db)).toEqual(before);
  });
});
