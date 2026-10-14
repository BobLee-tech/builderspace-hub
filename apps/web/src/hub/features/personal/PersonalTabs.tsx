import Link from "next/link";
import { useRouter } from "next/router";
import { twMerge } from "tailwind-merge";

import { copy } from "~/hub/copy/zh";
import { hubRoutes } from "~/hub/lib/routes";

const tabs = [
  { href: hubRoutes.personal, label: copy.personal.tabs.schedule },
  { href: hubRoutes.personalDone, label: copy.personal.tabs.done },
] as const;

/** The sections of 个人, under the page heading. */
export function PersonalTabs() {
  const { pathname } = useRouter();

  return (
    <nav className="mb-6 flex gap-1 border-b border-light-300 dark:border-dark-300">
      {tabs.map((tab) => {
        const current = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={twMerge(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              current
                ? "border-light-1000 text-light-1000 dark:border-dark-1000 dark:text-dark-1000"
                : "border-transparent text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
