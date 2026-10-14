import { useCallback } from "react";

import { usePermissions } from "~/hooks/usePermissions";
import { useWorkspace } from "~/providers/workspace";

/**
 * Kan's `usePermissions`, plus the Hub's own rules, for Kan's views to use at
 * their seams (docs/hub/UPSTREAM_SEAMS.md). The server enforces the same rules
 * (packages/api/src/routers/hub/guards.ts); this only decides what is shown.
 *
 * The Hub rule Kan does not know: templates are created by project admins
 * only, so for a member "create" on the templates page is not offered.
 */
export function useHubPermissions(
  options: { creating?: "board" | "template" } = {},
) {
  const permissions = usePermissions();
  const { workspace } = useWorkspace();
  const canCreateTemplate =
    permissions.canCreateBoard && workspace.role === "admin";

  return {
    ...permissions,
    canCreateTemplate,
    canCreateBoard:
      options.creating === "template"
        ? canCreateTemplate
        : permissions.canCreateBoard,
  };
}

/**
 * Which sidebar links someone sees. A link to a page they cannot use is not
 * shown at all. Until their permissions have loaded, the common pages stay
 * visible (every role can view boards and members by default) so the sidebar
 * does not flicker; templates wait for the project role, which is known
 * already.
 */
export function useHubNavFilter(): (href: string) => boolean {
  const { workspace } = useWorkspace();
  const { hasPermission, isLoading } = usePermissions();

  return useCallback(
    (href: string) => {
      switch (href) {
        case "/templates":
          return workspace.role === "admin";
        case "/boards":
          return isLoading || hasPermission("board:view");
        case "/members":
          return isLoading || hasPermission("member:view");
        default:
          return true;
      }
    },
    [hasPermission, isLoading, workspace.role],
  );
}
