import { twMerge } from "tailwind-merge";

import type { PlanTask } from "./schedule-display";
import { copy } from "~/hub/copy/zh";
import { Pill } from "~/hub/ui/admin-primitives";
import { DueBadge, taskWhere } from "../tasks/task-display";

const text = copy.schedule.tasks;

/** My unfinished tasks. Picking one makes it what the next drag on the table paints. */
export function TaskPanel({
  tasks,
  isLoading,
  pickedId,
  onPick,
}: {
  tasks: PlanTask[];
  isLoading: boolean;
  pickedId: string | null;
  onPick: (task: PlanTask["task"] | null) => void;
}) {
  const toPlan = tasks.filter((item) => !item.planned).sort(bySoonestDue);
  const planned = tasks.filter((item) => item.planned).sort(bySoonestDue);

  return (
    <aside className="rounded-xl border border-light-300 bg-light-50 p-4 dark:border-dark-300 dark:bg-dark-100">
      <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
        {text.title}
      </h2>
      <p className="mt-1 text-xs leading-5 text-light-900 dark:text-dark-900">
        {text.hint}
      </p>

      {isLoading ? (
        <div className="mt-4 space-y-2" aria-hidden="true">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="h-14 animate-pulse rounded-lg bg-light-200 dark:bg-dark-200"
            />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <p className="mt-4 text-sm text-light-900 dark:text-dark-900">
          {text.empty}
        </p>
      ) : (
        <div className="mt-3 space-y-4">
          <Group
            label={text.toPlan}
            items={toPlan}
            pickedId={pickedId}
            onPick={onPick}
          />
          <Group
            label={text.planned}
            items={planned}
            pickedId={pickedId}
            onPick={onPick}
          />
        </div>
      )}
    </aside>
  );
}

function Group({
  label,
  items,
  pickedId,
  onPick,
}: {
  label: string;
  items: PlanTask[];
  pickedId: string | null;
  onPick: (task: PlanTask["task"] | null) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-light-900 dark:text-dark-900">
        {label} · {items.length}
      </h3>
      <ul className="space-y-1">
        {items.map(({ task, planned }) => {
          const picked = task.publicId === pickedId;
          return (
            <li key={task.publicId}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() => onPick(picked ? null : task)}
                className={twMerge(
                  "block w-full rounded-lg border px-3 py-2 text-left transition-colors",
                  picked
                    ? "border-light-1000 bg-light-200 dark:border-dark-1000 dark:bg-dark-200"
                    : "border-transparent hover:bg-light-200 dark:hover:bg-dark-200",
                )}
              >
                <span className="block truncate text-sm font-medium text-light-1000 dark:text-dark-1000">
                  {task.title}
                </span>
                <span className="mt-0.5 block truncate text-xs text-light-900 dark:text-dark-900">
                  {taskWhere(task)}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <DueBadge task={task} />
                  {planned && <Pill>{text.planned}</Pill>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function bySoonestDue(a: PlanTask, b: PlanTask) {
  const dueA = a.task.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const dueB = b.task.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return dueA - dueB;
}
