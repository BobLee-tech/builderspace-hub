import type { HubRole, TaskView } from "@kan/hub/public";
import { can, HUB_JOIN_PATH } from "@kan/hub/public";

/**
 * Every path the Hub's own pages link to, in one place.
 */
export const hubRoutes = {
  /** Where a signed-in person lands. */
  afterLogin: "/home",
  home: "/home",
  personal: "/me",
  personalDone: "/me/done",
  personalGitHub: "/me/github",
  login: "/login",
  signup: "/signup",
  join: HUB_JOIN_PATH,
} as const;

/** Where the back office starts for someone: the 官网 section if that is all they have. */
export function adminHome(role: HubRole | null): string {
  return can(role, "admin.view") ? "/admin" : "/admin/site";
}

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
