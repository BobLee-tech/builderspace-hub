import type { HubRole } from "../accounts/roles";
import { can } from "../accounts/roles";

/**
 * Departments: one list the whole club shares (技术, 活动, 运营 to start with).
 * Every project has every department, each with its own people. The list is
 * kept in the back office: departments can be added and renamed, never removed.
 */

export const DEPARTMENT_NAME_MAX_LENGTH = 20;

/**
 * Making departments and putting people in them goes with managing accounts
 * and their project roles.
 */
export function canManageDepartments(role: HubRole | null): boolean {
  return can(role, "accounts.manage");
}

/** Trims and collapses whitespace; null when empty or too long. */
export function normaliseDepartmentName(value: string): string | null {
  const name = value.replace(/\s+/g, " ").trim();
  return name.length === 0 || name.length > DEPARTMENT_NAME_MAX_LENGTH
    ? null
    : name;
}

/** "project id:department id", to look a department of a project up in a set. */
export function departmentRef(
  workspaceId: number,
  departmentId: number,
): string {
  return `${workspaceId}:${departmentId}`;
}

/**
 * The departments someone counts as being in: the ones they were put in, in
 * projects they are still an active member of.
 */
export function effectiveDepartments(input: {
  rows: { workspaceId: number; departmentId: number }[];
  activeProjectIds: ReadonlySet<number>;
}): Set<string> {
  return new Set(
    input.rows
      .filter((row) => input.activeProjectIds.has(row.workspaceId))
      .map((row) => departmentRef(row.workspaceId, row.departmentId)),
  );
}

/**
 * The order after moving one department a step up or down, as the new
 * positions of the two that swap; null when it is already at that end.
 */
export function swapForMove<T extends { id: number; position: number }>(
  ordered: readonly T[],
  id: number,
  direction: "up" | "down",
): [{ id: number; position: number }, { id: number; position: number }] | null {
  const index = ordered.findIndex((d) => d.id === id);
  const other = ordered[direction === "up" ? index - 1 : index + 1];
  const self = ordered[index];
  if (!self || !other) return null;
  return [
    { id: self.id, position: other.position },
    { id: other.id, position: self.position },
  ];
}
