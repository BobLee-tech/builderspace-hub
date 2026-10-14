import Link from "next/link";
import { useRouter } from "next/router";
import { TbArrowLeft } from "react-icons/tb";

import type { Stage, TaskView } from "@kan/hub/public";
import { functionNames, stageNames, taskViews } from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { homeHref, taskBoardHref } from "~/hub/lib/routes";
import { Card } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import {
  ScopeSwitcher,
  useFollowScope,
  useProjectParam,
} from "./ScopeSwitcher";
import { TaskCard } from "./task-display";

type Column = RouterOutputs["hub"]["tasks"]["board"]["columns"][number];

const text = copy.tasks;

function isTaskView(value: unknown): value is TaskView {
  return (taskViews as readonly unknown[]).includes(value);
}

export function viewTitle(view: TaskView): string {
  return view in text.views
    ? text.views[view as keyof typeof text.views]
    : functionNames[view as keyof typeof functionNames];
}

function stageTitle(stage: Stage): string {
  return stage === "other" ? text.otherStage : stageNames[stage];
}

/**
 * One view (mine, due soon, a function…) across every project in scope,
 * split into the standard columns. Read-only: cards open in their project.
 */
export function TaskBoardPage() {
  const router = useRouter();
  const { projectPublicId, isReady } = useProjectParam();
  const view = router.query.view;
  const valid = isTaskView(view);

  const board = api.hub.tasks.board.useQuery(
    { view: valid ? view : "all", project: projectPublicId },
    { enabled: isReady && valid, retry: false },
  );
  useFollowScope(board.data?.scope.current);

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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
            {valid ? viewTitle(view) : ""}
          </h1>
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
      ) : board.data.columns.every((column) => column.total === 0) ? (
        <Notice>{text.emptyBoard}</Notice>
      ) : (
        <div className="-mx-5 flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-4 md:-mx-10 md:px-10">
          {board.data.columns.map((column) => (
            <TaskColumn key={column.stage} column={column} />
          ))}
        </div>
      )}
    </div>
  );
}

function TaskColumn({ column }: { column: Column }) {
  const limited = column.total > column.tasks.length;
  return (
    <section className="flex min-w-[15rem] flex-1 basis-0 flex-col rounded-xl bg-light-100 p-2 dark:bg-dark-100">
      <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold text-light-1000 dark:text-dark-1000">
        {stageTitle(column.stage)}
        <span className="text-xs font-normal tabular-nums text-light-900 dark:text-dark-900">
          {column.total}
        </span>
      </h2>
      {limited && (
        <p className="px-2 pb-1 text-xs text-light-900 dark:text-dark-900">
          {text.doneLimited(column.tasks.length, column.total)}
        </p>
      )}
      <div className="mt-1 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {column.tasks.length === 0 ? (
          <p className="px-2 py-3 text-xs text-light-800 dark:text-dark-800">
            {text.emptyColumn}
          </p>
        ) : (
          column.tasks.map((task) => (
            <TaskCard key={task.publicId} task={task} />
          ))
        )}
      </div>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card className="max-w-xl">
      <p className="text-sm text-light-1000 dark:text-dark-1000">{children}</p>
    </Card>
  );
}

function ColumnsSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-80 w-72 shrink-0 animate-pulse rounded-xl bg-light-200 dark:bg-dark-200"
        />
      ))}
    </div>
  );
}
