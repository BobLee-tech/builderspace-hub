import Link from "next/link";
import { useRouter } from "next/router";
import { TbFiles, TbShieldLock } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import { can } from "@kan/hub/public";

import { copy } from "~/hub/copy/zh";
import { api } from "~/utils/api";

const linkClass =
  "mt-1 flex items-center gap-3 rounded-md p-1.5 text-sm font-medium text-neutral-600 hover:bg-light-200 hover:text-light-1000 dark:text-dark-900 dark:hover:bg-dark-200 dark:hover:text-dark-1000";

/**
 * The Hub's own sidebar links, rendered once under Kan's navigation: 文档 for
 * every member, 后台 for back-office members only. They live in one component
 * so the sidebar needs a single registered edit (docs/hub/UPSTREAM_SEAMS.md).
 */
export function HubAdminLink({
  isCollapsed,
  onCloseSideNav,
}: {
  isCollapsed?: boolean;
  onCloseSideNav?: () => void;
}) {
  const { pathname } = useRouter();
  const me = api.hub.me.get.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });

  return (
    <>
      <Link
        href="/documents"
        onClick={onCloseSideNav}
        title={copy.documents.entry}
        className={twMerge(
          linkClass,
          isCollapsed && "justify-center",
          pathname.startsWith("/documents") && "bg-light-200 dark:bg-dark-200",
        )}
      >
        <TbFiles size={18} className="shrink-0" />
        {!isCollapsed && copy.documents.entry}
      </Link>
      {can(me.data?.role ?? null, "admin.view") && (
        <Link
          href="/admin"
          onClick={onCloseSideNav}
          title={copy.admin.entry}
          className={twMerge(
            linkClass,
            isCollapsed && "justify-center",
            pathname.startsWith("/admin") && "bg-light-200 dark:bg-dark-200",
          )}
        >
          <TbShieldLock size={18} className="shrink-0" />
          {!isCollapsed && copy.admin.entry}
        </Link>
      )}
    </>
  );
}
