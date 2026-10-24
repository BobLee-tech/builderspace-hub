import Link from "next/link";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { twMerge } from "tailwind-merge";

import { copy } from "~/hub/copy/zh";
import { useSelectProject } from "~/hub/lib/use-open-in-project";

/**
 * Where people switch between projects: 全部 plus every project they are in.
 * Projects they are not in are never offered. The choice lives in the URL
 * (`?project=`), so a scoped page can be bookmarked and shared.
 */

interface ProjectChip {
  publicId: string;
  name: string;
}

/** The `?project=` of the current URL, once the router knows it. */
export function useProjectParam(): {
  projectPublicId: string | undefined;
  isReady: boolean;
} {
  const { query, isReady } = useRouter();
  const value = query.project;
  return {
    projectPublicId: typeof value === "string" && value ? value : undefined,
    isReady,
  };
}

/**
 * Keeps the app's current project in step with the scope being looked at, so
 * the sidebar's boards link and Kan's pages follow what was chosen here.
 */
export function useFollowScope(current: ProjectChip | null | undefined) {
  const selectProject = useSelectProject();
  const publicId = current?.publicId;
  useEffect(() => {
    if (publicId) selectProject(publicId);
  }, [publicId, selectProject]);
}

export function ScopeSwitcher({
  projects,
  current,
  hrefFor,
}: {
  projects: ProjectChip[];
  current: ProjectChip | null;
  hrefFor: (projectPublicId: string | null) => string;
}) {
  const options = [
    { publicId: null, name: copy.home.scope.all },
    ...projects.map((p) => ({ publicId: p.publicId, name: p.name })),
  ];

  return (
    <nav
      aria-label={copy.home.scope.label}
      className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1"
    >
      {options.map((option) => {
        const selected = (current?.publicId ?? null) === option.publicId;
        return (
          <Link
            key={option.publicId ?? "all"}
            href={hrefFor(option.publicId)}
            aria-current={selected ? "page" : undefined}
            title={option.publicId ? undefined : copy.home.scope.allHint}
            className={chipClass(selected)}
          >
            {option.name}
          </Link>
        );
      })}
    </nav>
  );
}

/** The pill these choices are drawn as, dark when chosen. 只看我的 uses it too. */
export function chipClass(selected: boolean): string {
  return twMerge(
    "shrink-0 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
    selected
      ? "border-light-1000 bg-light-1000 text-light-50 dark:border-dark-1000 dark:bg-dark-1000 dark:text-dark-50"
      : "border-light-300 text-light-1000 hover:border-light-600 dark:border-dark-300 dark:text-dark-1000 dark:hover:border-dark-600",
  );
}
