/**
 * Seeds a running Hub with the BuilderSpace structure.
 *
 *   HUB_URL=http://localhost:3000 HUB_API_KEY=... pnpm --filter @kan/builderspace seed --dry-run
 *
 * Set HUB_TASKS_FILE to a private JSON file to also create starter tasks.
 * See BUILDERSPACE.md at the repository root.
 */
import { readFile } from "node:fs/promises";

import { createHubClient } from "./client";
import { parseOptions } from "./options";
import { formatReport } from "./report";
import { seedHub } from "./seed";
import { hubStructure } from "./structure";
import { parseTasksFile } from "./tasks-file";

const main = async (): Promise<number> => {
  // This is a standalone admin script, not part of the Next.js app, so it
  // reads its variables directly rather than through the app's t3-env.
  const parsed = parseOptions(process.env, process.argv.slice(2));

  if (!parsed.ok) {
    console.error(parsed.errors.map((error) => `✗ ${error}`).join("\n"));
    return 1;
  }

  const { baseUrl, apiKey, dryRun, tasksFile } = parsed.options;
  const client = createHubClient({ baseUrl, apiKey });

  const extraTasks = tasksFile
    ? parseTasksFile(await readFile(tasksFile, "utf8"), tasksFile)
    : [];
  const structure = {
    ...hubStructure,
    tasks: [...hubStructure.tasks, ...extraTasks],
  };

  console.log(`Hub: ${baseUrl}`);
  if (tasksFile)
    console.log(`任务文件: ${tasksFile}（${extraTasks.length} 个）`);
  const report = await seedHub(client, structure, { dryRun });
  console.log(formatReport(report));
  return 0;
};

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(
      `✗ ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  });
