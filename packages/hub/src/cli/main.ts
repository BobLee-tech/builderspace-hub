/**
 * Operations command line for the Hub. Run `pnpm --filter @kan/hub cli help`.
 *
 * Reads `POSTGRES_URL` and `NEXT_PUBLIC_BASE_URL` from the environment (the
 * `cli` script also loads the repository's `.env`). To act on production, set
 * both inline; values already in the environment win over `.env`.
 */
import { createDrizzleClient } from "@kan/db/client";

import { getPrimaryDocumentStorage } from "../documents/storage.config";
import { isHubError } from "../shared/errors";
import { parseCli } from "./args";
import { runCommand, USAGE } from "./commands";

const main = async (): Promise<number> => {
  const parsed = parseCli(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(`✗ ${parsed.error}\n\n${USAGE.join("\n")}`);
    return 1;
  }

  if (parsed.command.name === "help") {
    console.log(USAGE.join("\n"));
    return 0;
  }

  // Without a connection string Kan's client silently opens an embedded
  // database on disk; every command would then "succeed" against nothing.
  if (!process.env.POSTGRES_URL) {
    console.error("✗ 没有设置 POSTGRES_URL，拒绝运行。");
    return 1;
  }

  const db = createDrizzleClient();
  try {
    const lines = await runCommand(db, parsed.command, {
      // Not a turbo task input: the CLI is run by hand, never cached.
      // eslint-disable-next-line turbo/no-undeclared-env-vars
      baseUrl: process.env.NEXT_PUBLIC_BASE_URL ?? null,
      now: new Date(),
      // The bucket or folder only: bulk imports take every format, and the
      // database holds text documents, not PDFs and decks.
      storage: getPrimaryDocumentStorage(),
    });
    console.log(lines.join("\n"));
    return lines[0]?.startsWith("✗") ? 1 : 0;
  } catch (error) {
    if (!isHubError(error)) throw error;
    console.error(`✗ ${error.message}`);
    return 1;
  } finally {
    await db.$client.end();
  }
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
