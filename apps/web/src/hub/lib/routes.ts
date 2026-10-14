import type { TaskView } from "@kan/hub/public";
import { HUB_JOIN_PATH } from "@kan/hub/public";

/**
 * Every path the Hub's own pages link to, in one place.
 */
export const hubRoutes = {
  /** Where a signed-in person lands. */
  afterLogin: "/home",
  home: "/home",
  personal: "/me",
  login: "/login",
  signup: "/signup",
  join: HUB_JOIN_PATH,
} as const;

/** The home page, scoped to one project or (no id) to 全部. */
export function homeHref(projectPublicId?: string | null): string {
  return withProject(hubRoutes.home, projectPublicId);
}

/** The task board for one view, scoped like the home page. */
export function taskBoardHref(
  view: TaskView,
  projectPublicId?: string | null,
): string {
  return withProject(`/tasks/${view}`, projectPublicId);
}

export function cardHref(cardPublicId: string): string {
  return `/cards/${cardPublicId}`;
}

function withProject(path: string, projectPublicId?: string | null): string {
  return projectPublicId
    ? `${path}?project=${encodeURIComponent(projectPublicId)}`
    : path;
}
