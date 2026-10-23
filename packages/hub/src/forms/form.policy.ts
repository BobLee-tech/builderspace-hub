import type { HubRole } from "../accounts/roles";
import type { FormAccess } from "../schema";
import type { FormSettings, LikeMode, WallMode } from "./form.model";
import { can } from "../accounts/roles";

/**
 * Who may do what with a form. Pure: the server enforces these, the pages
 * use them only to decide what to show.
 */

/** Creating forms is for back-office owners and admins. */
export function canCreateForm(role: HubRole | null): boolean {
  return can(role, "forms.manage");
}

/**
 * Changing a form and reading its answers: owners, and the people it was
 * handed to (its creator is one). An admin does not see every form's
 * answers, which may hold phone numbers and the like.
 */
export function canManageForm(input: {
  role: HubRole | null;
  isManager: boolean;
}): boolean {
  return input.role === "owner" || input.isManager;
}

/**
 * Handing a form to more people, and deleting it: owners, and admins who
 * manage it. A member it was handed to cannot pass it on or delete it.
 */
export function canShareForm(input: {
  role: HubRole | null;
  isManager: boolean;
}): boolean {
  return input.role === "owner" || (input.role === "admin" && input.isManager);
}

/** Someone opening a form: signed in or not, and which projects they are in. */
export interface FormViewer {
  /** Null for someone who is not signed in (or whose account is suspended). */
  userId: string | null;
  role: HubRole | null;
  /** Public ids of the projects they are an active member of. */
  projectIds: string[];
}

export type FillDecision =
  | { allowed: true }
  | { allowed: false; reason: "sign_in" | "not_in_project" };

/** Whether this person may answer a form with this access level. */
export function canFill(
  form: { access: FormAccess; settings: Pick<FormSettings, "projectIds"> },
  viewer: FormViewer,
): FillDecision {
  if (form.access === "public") return { allowed: true };
  if (!viewer.userId) return { allowed: false, reason: "sign_in" };
  if (form.access === "members") return { allowed: true };
  const allowed = new Set(form.settings.projectIds);
  return viewer.projectIds.some((id) => allowed.has(id))
    ? { allowed: true }
    : { allowed: false, reason: "not_in_project" };
}

/**
 * Whether someone sees the results wall. Managers always do (it is their
 * preview); others only when the wall is on, they may answer the form, and,
 * for `after_submit`, they have answered.
 */
export function canSeeWall(input: {
  wall: WallMode;
  isManager: boolean;
  mayFill: boolean;
  hasAnswered: boolean;
}): boolean {
  if (input.isManager) return true;
  if (input.wall === "off" || !input.mayFill) return false;
  return input.wall === "always" || input.hasAnswered;
}

export type LikeDecision =
  | { allowed: true }
  | { allowed: false; reason: string };

/** Whether someone who sees the wall may 👍 one answer on it. */
export function canLike(input: {
  likes: LikeMode;
  signedIn: boolean;
  /** A browser key was sent (anonymous likes on a public form). */
  hasBrowserKey: boolean;
  isOwnAnswer: boolean;
}): LikeDecision {
  if (input.likes === "off") {
    return { allowed: false, reason: "这份表单没有开点赞" };
  }
  if (input.isOwnAnswer) return { allowed: false, reason: "不能给自己点赞" };
  if (input.signedIn) return { allowed: true };
  if (input.likes === "signed_in") {
    return { allowed: false, reason: "登录后才能点赞" };
  }
  return input.hasBrowserKey
    ? { allowed: true }
    : { allowed: false, reason: "这个浏览器不能点赞，请刷新页面再试" };
}

/**
 * Settings that cannot go together are brought into line rather than
 * refused: editing an answer needs one answer per person, and the wall's
 * likes need a wall. Anonymous likes only make sense on a public form.
 */
export function reconcileSettings(
  access: FormAccess,
  settings: FormSettings,
): FormSettings {
  const likes: LikeMode =
    settings.wall === "off"
      ? "off"
      : settings.likes === "anyone" && access !== "public"
        ? "signed_in"
        : settings.likes;
  return {
    ...settings,
    allowEdit: settings.limitOne && settings.allowEdit,
    likes,
    projectIds: access === "projects" ? settings.projectIds : [],
  };
}
