import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@headlessui/react";
import { useMemo, useState } from "react";
import { HiMagnifyingGlass } from "react-icons/hi2";
import { TbHome, TbSwitchHorizontal } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import CommandPallette from "~/components/CommandPallette";
import { Tooltip } from "~/components/Tooltip";
import { copy } from "~/hub/copy/zh";
import { homeHref, hubRoutes } from "~/hub/lib/routes";
import { useKeyboardShortcut } from "~/providers/keyboard-shortcuts";
import { useWorkspace } from "~/providers/workspace";

/**
 * The top of the sidebar. Stands in for Kan's `WorkspaceMenu`
 * (see docs/hub/UPSTREAM_SEAMS.md, "替身"): projects are switched on the home
 * page now, so the project name links there instead of opening a menu. It
 * keeps the menu's other duties: the search button, the command palette and
 * its ⌘K shortcut. Adds the 首页 link and its G-H shortcut.
 */
export function HubSidebarTop({
  isCollapsed = false,
  onCloseSideNav,
}: {
  isCollapsed?: boolean;
  onCloseSideNav?: () => void;
}) {
  const { workspace, isLoading } = useWorkspace();
  const router = useRouter();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  const paletteShortcut = useMemo(
    () => ({
      type: "PRESS" as const,
      stroke: {
        key: "k",
        modifiers: ["META"] as ("META" | "CONTROL" | "ALT" | "SHIFT")[],
      },
      action: () => setIsPaletteOpen(true),
      description: copy.nav.openSearch,
      group: "GENERAL" as const,
    }),
    [],
  );
  const { tooltipContent: paletteTooltip } =
    useKeyboardShortcut(paletteShortcut);

  const homeShortcut = useMemo(
    () => ({
      type: "SEQUENCE" as const,
      strokes: [{ key: "G" }, { key: "H" }],
      action: () => void router.push(hubRoutes.home),
      group: "NAVIGATION" as const,
      description: copy.nav.goHome,
    }),
    [router],
  );
  useKeyboardShortcut(homeShortcut);

  const onHome = router.pathname === hubRoutes.home;

  return (
    <>
      <CommandPallette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />
      <div className="mb-1">
        {isLoading ? (
          <div className={twMerge("mb-4 flex", isCollapsed && "md:p-1.5")}>
            <div className="h-6 w-6 animate-pulse rounded-md bg-light-200 dark:bg-dark-200" />
            <div
              className={twMerge(
                "ml-2 h-6 w-[150px] animate-pulse rounded-md bg-light-200 dark:bg-dark-200",
                isCollapsed && "md:hidden",
              )}
            />
          </div>
        ) : (
          <div
            className={twMerge(
              "mb-3 flex items-center justify-start gap-1",
              isCollapsed && "md:flex-col-reverse md:items-center",
            )}
          >
            <Link
              href={homeHref(workspace.publicId || null)}
              onClick={onCloseSideNav}
              title={copy.nav.switchProjectHint}
              className={twMerge(
                "group mb-1 flex h-[34px] min-w-0 flex-1 items-center justify-start rounded-md p-1.5 hover:bg-light-200 dark:hover:bg-dark-200",
                isCollapsed &&
                  "md:mb-1.5 md:h-9 md:w-9 md:flex-none md:justify-center md:p-0",
              )}
            >
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-light-1000 dark:bg-dark-1000">
                <span className="text-xs font-bold leading-none text-light-50 dark:text-dark-50">
                  {workspace.name.charAt(0).toUpperCase()}
                </span>
              </span>
              <span
                className={twMerge(
                  "ml-2 min-w-0 flex-1 truncate text-left text-sm font-bold text-neutral-900 dark:text-dark-1000",
                  isCollapsed && "md:hidden",
                )}
              >
                {workspace.name}
              </span>
              <TbSwitchHorizontal
                className={twMerge(
                  "ml-1 h-4 w-4 shrink-0 text-light-800 opacity-0 transition-opacity group-hover:opacity-100 dark:text-dark-800",
                  isCollapsed && "md:hidden",
                )}
                aria-hidden="true"
              />
            </Link>
            <Tooltip content={paletteTooltip}>
              <Button
                aria-label={copy.nav.search}
                className={twMerge(
                  "mb-1 h-[34px] w-[34px] flex-shrink-0 rounded-lg bg-light-200 p-2 hover:bg-light-300 focus:outline-none dark:bg-dark-200 dark:hover:bg-dark-300",
                  isCollapsed && "md:mb-2 md:h-9 md:w-9",
                )}
                onClick={() => setIsPaletteOpen(true)}
              >
                <HiMagnifyingGlass className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
        )}

        <Link
          href={hubRoutes.home}
          onClick={onCloseSideNav}
          title={copy.nav.home}
          aria-current={onHome ? "page" : undefined}
          className={twMerge(
            "flex items-center gap-3 rounded-md p-1.5 text-sm font-medium text-neutral-600 hover:bg-light-200 hover:text-light-1000 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000",
            isCollapsed && "justify-center",
            onHome &&
              "bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000",
          )}
        >
          <TbHome size={18} className="shrink-0" aria-hidden="true" />
          {!isCollapsed && copy.nav.home}
        </Link>
      </div>
    </>
  );
}
