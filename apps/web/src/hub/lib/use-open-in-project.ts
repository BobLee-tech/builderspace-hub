import { useRouter } from "next/router";
import { useCallback } from "react";

import { useWorkspace } from "~/providers/workspace";

/**
 * Opens a page that belongs to a project, switching the app's current project
 * first when needed.
 *
 * Kan keeps one "current project" in the browser, and its board and card
 * pages read names, permissions and settings from it. Jumping from the
 * all-projects views straight to another project's card without switching
 * would show that card under the wrong project.
 */
export function useOpenInProject() {
  const router = useRouter();
  const { workspace, availableWorkspaces, switchWorkspace } = useWorkspace();

  return useCallback(
    (projectPublicId: string, href: string) => {
      const target = availableWorkspaces.find(
        (candidate) => candidate.publicId === projectPublicId,
      );
      if (!target || target.publicId === workspace.publicId) {
        void router.push(href);
        return;
      }
      switchWorkspace(target, href);
    },
    [availableWorkspaces, router, switchWorkspace, workspace.publicId],
  );
}

/** Makes a project the app's current one without leaving the page. */
export function useSelectProject() {
  const { workspace, availableWorkspaces, switchWorkspace } = useWorkspace();

  return useCallback(
    (projectPublicId: string) => {
      const target = availableWorkspaces.find(
        (candidate) => candidate.publicId === projectPublicId,
      );
      if (target && target.publicId !== workspace.publicId) {
        switchWorkspace(target, null);
      }
    },
    [availableWorkspaces, switchWorkspace, workspace.publicId],
  );
}
