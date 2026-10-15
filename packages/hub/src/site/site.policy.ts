/**
 * Who may do what with the official website's data. Pure: shared by the
 * server, which enforces it, and the browser, which only uses it to hide
 * pages and buttons.
 *
 * Website access is granted per person and has nothing to do with the
 * back-office role: an owner without it cannot see the website's data either.
 */

export const siteAccessLevels = ["people", "manage"] as const;
/** `people`: the interest lists. `manage`: those plus reviewing projects. */
export type SiteAccess = (typeof siteAccessLevels)[number];

export const siteAccessLabels: Record<SiteAccess, string> = {
  people: "名单",
  manage: "管理",
};

export const sitePermissions = [
  /** Read volunteer applications and join submissions; update a volunteer's status and notes. */
  "site.people",
  /** Approve or reject the project cards and progress updates visitors submit. */
  "site.review",
] as const;
export type SitePermission = (typeof sitePermissions)[number];

const LEVEL_PERMISSIONS: Record<SiteAccess, readonly SitePermission[]> = {
  people: ["site.people"],
  manage: ["site.people", "site.review"],
};

/** The single website permission check. `null` is someone without access. */
export function canOnSite(
  access: SiteAccess | null,
  permission: SitePermission,
): boolean {
  return access !== null && LEVEL_PERMISSIONS[access].includes(permission);
}

/** Review states shared by project cards and progress updates. */
export const reviewStatuses = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof reviewStatuses)[number];

/** A reviewer's decision: anything but going back to pending. */
export const reviewDecisions = ["approved", "rejected"] as const;
export type ReviewDecision = (typeof reviewDecisions)[number];

export const reviewStatusLabels: Record<ReviewStatus, string> = {
  pending: "待审核",
  approved: "已通过",
  rejected: "已驳回",
};

/** Where a volunteer application is in the follow-up. */
export const volunteerStatuses = [
  "new",
  "contacted",
  "interviewing",
  "accepted",
  "declined",
] as const;
export type VolunteerStatus = (typeof volunteerStatuses)[number];

export const volunteerStatusLabels: Record<VolunteerStatus, string> = {
  new: "新申请",
  contacted: "已联系",
  interviewing: "面试中",
  accepted: "已录取",
  declined: "已婉拒",
};

/** The website's own limit on `volunteer_applications.ops_notes`. */
export const VOLUNTEER_NOTES_MAX = 1000;
