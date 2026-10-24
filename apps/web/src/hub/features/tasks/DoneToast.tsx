import Link from "next/link";
import { useEffect } from "react";
import { TbCircleCheck, TbX } from "react-icons/tb";

import { copy } from "~/hub/copy/zh";
import { taskBoardHref } from "~/hub/lib/routes";

/** My open tasks right after I finished one: how many, and the next few. */
export interface WhatIsLeft {
  left: number;
  next: string[];
}

const text = copy.tasks.doneToast;
const SHOW_FOR_MS = 8000;

/**
 * Pops up in the corner when a task is dragged to 已完成 on the overall board,
 * listing what the person still has to do. Goes away on its own.
 */
export function DoneToast({
  toast,
  onClose,
}: {
  toast: WhatIsLeft | null;
  /** Must keep its identity between renders, or the timer restarts. */
  onClose: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, SHOW_FOR_MS);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 right-4 z-30 w-[min(22rem,calc(100vw-2rem))] rounded-xl border border-light-300 bg-light-50 p-4 shadow-lg dark:border-dark-300 dark:bg-dark-100"
    >
      <div className="flex items-start gap-2.5">
        <TbCircleCheck
          className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-light-1000 dark:text-dark-1000">
            {text.title(toast.left)}
          </p>
          {toast.next.length > 0 && (
            <ol className="mt-1.5 space-y-0.5 text-xs text-light-900 dark:text-dark-900">
              {toast.next.map((title, index) => (
                <li key={`${index}-${title}`} className="truncate">
                  {index + 1}. {title}
                </li>
              ))}
            </ol>
          )}
          {toast.left > 0 && (
            <Link
              href={taskBoardHref("mine")}
              className="mt-2 inline-block text-xs font-medium text-light-1000 underline underline-offset-2 dark:text-dark-1000"
            >
              {text.seeMine}
            </Link>
          )}
        </div>
        <button
          type="button"
          aria-label={text.close}
          className="rounded-md p-1 text-light-900 hover:bg-light-200 dark:text-dark-900 dark:hover:bg-dark-200"
          onClick={onClose}
        >
          <TbX className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
