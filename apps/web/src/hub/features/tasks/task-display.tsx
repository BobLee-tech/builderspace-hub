import { TbCalendarDue } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import { functionNames } from "@kan/hub/public";

import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { cardHref } from "~/hub/lib/routes";
import { useOpenInProject } from "~/hub/lib/use-open-in-project";

/**
 * How a task looks wherever the Hub lists one: the home page and the task
 * board. Clicking it opens Kan's card page in the task's own project.
 */

export type HubTask = RouterOutputs["hub"]["tasks"]["home"]["myTasks"][number];

const text = copy.tasks;

const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
});

function isSameDay(a: Date, b: Date) {
  return a.toDateString() === b.toDateString();
}

export function DueBadge({ task }: { task: HubTask }) {
  if (!task.dueDate) return null;
  const due = new Date(task.dueDate);
  const label =
    task.dueState === "overdue"
      ? `${text.due.overdue} · ${dayFormat.format(due)}`
      : isSameDay(due, new Date())
        ? text.due.today
        : dayFormat.format(due);

  return (
    <span
      className={twMerge(
        "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-light-900 dark:text-dark-900",
        task.dueState === "soon" && "text-amber-700 dark:text-amber-400",
        task.dueState === "overdue" &&
          "font-medium text-red-600 dark:text-red-400",
      )}
    >
      <TbCalendarDue className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

/** "CourseMate · 开发", or the board's own name when it is not a function. */
export function taskWhere(task: HubTask): string {
  const where = task.functionKey
    ? functionNames[task.functionKey]
    : task.board.name;
  return `${task.project.name} · ${where}`;
}

function Labels({ task }: { task: HubTask }) {
  if (task.labels.length === 0) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {task.labels.map((label) => (
        <span
          key={label.name}
          className="inline-flex items-center gap-1 rounded border border-light-300 px-1.5 text-[11px] leading-5 text-light-1000 dark:border-dark-300 dark:text-dark-1000"
        >
          <span
            className="h-1.5 w-1.5 rounded-full bg-light-700 dark:bg-dark-700"
            style={
              label.colourCode
                ? { backgroundColor: label.colourCode }
                : undefined
            }
            aria-hidden="true"
          />
          {label.name}
        </span>
      ))}
    </span>
  );
}

function useOpenTask(task: HubTask) {
  const openInProject = useOpenInProject();
  return () => openInProject(task.project.publicId, cardHref(task.publicId));
}

/** One row in a list (the home page). */
export function TaskRow({ task }: { task: HubTask }) {
  const open = useOpenTask(task);
  return (
    <button
      type="button"
      onClick={open}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-light-200 dark:hover:bg-dark-200"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
          {task.title}
        </span>
        <span className="mt-0.5 block truncate text-xs text-light-900 dark:text-dark-900">
          {taskWhere(task)} · {task.listName}
        </span>
      </span>
      <DueBadge task={task} />
    </button>
  );
}

/** One card in a column (the task board). */
export function TaskCard({ task }: { task: HubTask }) {
  const open = useOpenTask(task);
  return (
    <button
      type="button"
      onClick={open}
      className="block w-full rounded-lg border border-light-300 bg-light-50 p-3 text-left shadow-sm transition hover:border-light-600 dark:border-dark-300 dark:bg-dark-100 dark:hover:border-dark-600"
    >
      <span className="block text-xs text-light-900 dark:text-dark-900">
        {taskWhere(task)}
      </span>
      <span className="mt-1 block text-sm font-medium leading-5 text-light-1000 dark:text-dark-1000">
        {task.title}
      </span>
      <span className="mt-2 flex flex-wrap items-center gap-2">
        <Labels task={task} />
        <DueBadge task={task} />
        {task.assignedToMe && (
          <span className="ml-auto rounded-full bg-light-1000 px-1.5 text-[11px] leading-5 text-light-50 dark:bg-dark-1000 dark:text-dark-50">
            {text.assignedToMe}
          </span>
        )}
      </span>
    </button>
  );
}
