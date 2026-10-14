import Link from "next/link";

import { functionKeys, functionNames } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { taskBoardHref } from "~/hub/lib/routes";
import { useFunctionColors } from "~/hub/lib/use-function-colors";
import { useWorkspace } from "~/providers/workspace";

const text = copy.tasks.overallTile;

/**
 * The first tile on a project's boards page: its 总版, the board that shows
 * every task of 开发 / 运营 / 营销 together, coloured by function.
 */
export function OverallBoardTile() {
  const { workspace } = useWorkspace();
  const colors = useFunctionColors();
  if (!workspace.publicId) return null;

  return (
    <Link href={taskBoardHref("all", workspace.publicId)}>
      <div className="flex h-[150px] w-full flex-col items-center justify-center gap-2 rounded-md border border-light-600 bg-light-50 shadow-sm transition-colors hover:bg-light-200 dark:border-dark-600 dark:bg-dark-50 dark:hover:bg-dark-100">
        <p className="text-[14px] font-bold text-neutral-900 dark:text-dark-1000">
          {text.title}
        </p>
        <p className="flex items-center gap-3 text-xs text-light-900 dark:text-dark-900">
          {functionKeys.map((key) => (
            <span key={key} className="inline-flex items-center gap-1">
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colors[key] }}
              />
              {functionNames[key]}
            </span>
          ))}
        </p>
        <p className="text-xs text-light-800 dark:text-dark-800">{text.hint}</p>
      </div>
    </Link>
  );
}
