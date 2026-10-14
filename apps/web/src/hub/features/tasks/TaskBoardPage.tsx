import Link from "next/link";
import { useRouter } from "next/router";
import { TbArrowLeft } from "react-icons/tb";

import type { TaskView } from "@kan/hub/public";
import { functionNames, taskViews } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { homeHref, taskBoardHref } from "~/hub/lib/routes";
import { Card } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import {
  ScopeSwitcher,
  useFollowScope,
  useProjectParam,
} from "./ScopeSwitcher";
import { ColumnsSkeleton, TaskBoardBody } from "./TaskBoardBody";

const text = copy.tasks;

function isTaskView(value: unknown): value is TaskView {
  return (taskViews as readonly unknown[]).includes(value);
}

export function viewTitle(view: TaskView): string {
  return view in text.views
    ? text.views[view as keyof typeof text.views]
    : functionNames[view as keyof typeof functionNames];
}

/**
 * One view (mine, due soon, a function, or 总版 = all) across every project
 * in scope, filling the page. The board itself is `TaskBoardBody`, the same
 * one the home page embeds.
 */
export function TaskBoardPage() {
  const router = useRouter();
  const { projectPublicId, isReady } = useProjectParam();
  const view = router.query.view;
  const valid = isTaskView(view);
  const query = {
    view: valid ? view : ("all" as const),
    project: projectPublicId,
  };

  const board = api.hub.tasks.board.useQuery(query, {
    enabled: isReady && valid,
    retry: false,
  });
  useFollowScope(board.data?.scope.current);
  const scopeName = board.data?.scope.current?.name;

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-8 md:px-10 md:py-10">
      <header className="mb-5 space-y-4">
        <Link
          href={homeHref(projectPublicId)}
          className="inline-flex items-center gap-1 text-xs text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
        >
          <TbArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {text.backHome}
        </Link>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
              {valid ? viewTitle(view) : ""}
              {scopeName && (
                <span className="ml-2 text-base font-medium text-light-900 dark:text-dark-900">
                  · {scopeName}
                </span>
              )}
            </h1>
            {view === "all" && (
              <p className="mt-1 max-w-xl text-xs leading-5 text-light-900 dark:text-dark-900">
                {text.overallHint}
              </p>
            )}
          </div>
          {board.data && valid && (
            <ScopeSwitcher
              projects={board.data.scope.projects}
              current={board.data.scope.current}
              hrefFor={(id) => taskBoardHref(view, id)}
            />
          )}
        </div>
      </header>

      {!valid && isReady ? (
        <Notice>{text.emptyBoard}</Notice>
      ) : board.error?.data?.code === "NOT_FOUND" ? (
        <Notice>
          {copy.home.scopeMissing}{" "}
          <Link
            href={taskBoardHref(valid ? view : "all")}
            className="underline"
          >
            {copy.home.scopeMissingBack}
          </Link>
        </Notice>
      ) : !board.data ? (
        <ColumnsSkeleton />
      ) : (
        <TaskBoardBody board={board.data} query={query} fill />
      )}
    </div>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card className="max-w-xl">
      <p className="text-sm text-light-1000 dark:text-dark-1000">{children}</p>
    </Card>
  );
}
