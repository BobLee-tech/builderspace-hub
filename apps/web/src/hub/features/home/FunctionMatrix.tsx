import Link from "next/link";

import type { FunctionKey } from "@kan/hub/public";
import { functionKeys, functionNames, stageNames } from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { homeHref, taskBoardHref } from "~/hub/lib/routes";

type MatrixRow = RouterOutputs["hub"]["tasks"]["home"]["matrix"][number];
type StageCounts = MatrixRow["functions"][FunctionKey];

const text = copy.home.matrix;

const openCount = (counts: StageCounts) =>
  counts.todo + counts.doing + counts.review + counts.other;

const stageLabel = (stage: "todo" | "doing" | "review" | "other") =>
  stage === "other" ? copy.tasks.otherStage : stageNames[stage];

/** "待办 2 · 进行中 1", leaving out empty columns. */
function breakdown(counts: StageCounts): string {
  return (["todo", "doing", "review", "other"] as const)
    .filter((stage) => counts[stage] > 0)
    .map((stage) => `${stageLabel(stage)} ${counts[stage]}`)
    .join(" · ");
}

/**
 * Projects down the side, functions across the top. Each cell opens the task
 * board for that function in that project; each heading opens it across the
 * whole scope.
 */
export function FunctionMatrix({
  rows,
  scopeId,
}: {
  rows: MatrixRow[];
  scopeId: string | null;
}) {
  return (
    <section>
      <div className="mb-2">
        <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
          {text.title}
        </h2>
        <p className="mt-0.5 text-xs text-light-900 dark:text-dark-900">
          {text.hint}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-light-300 dark:border-dark-300">
        <table className="w-full min-w-[560px] table-fixed border-collapse text-sm">
          <thead>
            <tr className="bg-light-100 dark:bg-dark-100">
              <th className="w-48 px-4 py-2.5 text-left text-xs font-medium text-light-900 dark:text-dark-900">
                {text.project}
              </th>
              {functionKeys.map((key) => (
                <th key={key} className="px-4 py-2.5 text-left">
                  <Link
                    href={taskBoardHref(key, scopeId)}
                    className="text-xs font-semibold text-light-1000 hover:underline dark:text-dark-1000"
                  >
                    {functionNames[key]}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.project.publicId}
                className="border-t border-light-200 align-top dark:border-dark-200"
              >
                <th className="px-4 py-3 text-left font-medium">
                  <Link
                    href={homeHref(row.project.publicId)}
                    className="text-light-1000 hover:underline dark:text-dark-1000"
                  >
                    {row.project.name}
                  </Link>
                  {row.otherBoards > 0 && (
                    <span className="mt-1 block text-xs font-normal text-light-900 dark:text-dark-900">
                      {text.otherBoards(row.otherBoards)}
                    </span>
                  )}
                </th>
                {functionKeys.map((key) => {
                  const counts = row.functions[key];
                  const open = openCount(counts);
                  return (
                    <td key={key} className="p-1.5">
                      <Link
                        href={taskBoardHref(key, row.project.publicId)}
                        className="block rounded-lg px-2.5 py-2 transition-colors hover:bg-light-200 dark:hover:bg-dark-200"
                      >
                        <span
                          className={
                            open === 0
                              ? "text-xl font-semibold tabular-nums text-light-700 dark:text-dark-700"
                              : "text-xl font-semibold tabular-nums text-light-1000 dark:text-dark-1000"
                          }
                        >
                          {open}
                        </span>
                        {open > 0 && (
                          <span className="mt-0.5 block text-xs text-light-900 dark:text-dark-900">
                            {breakdown(counts)}
                          </span>
                        )}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
