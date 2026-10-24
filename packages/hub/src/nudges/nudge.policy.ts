import type { RateLimitRule } from "../rate-limit";
import type { DueState, Stage } from "../tasks/task.policy";
import { isOpen } from "../tasks/task.policy";

/**
 * Pure rules for 催一下: which tasks count as stuck, who can be nudged about
 * them, and in what order a nudge mail lists someone's tasks. No IO.
 */

/** An open task nobody has touched for this many days counts as stuck. */
export const STALE_AFTER_DAYS = 3;

/** One nudge mail per person per hour, however many people ask. */
export const NUDGE_LIMIT: RateLimitRule = { window: 60 * 60, max: 1 };

/** How many tasks a nudge mail lists before "还有 N 件". */
export const NUDGE_MAIL_TASK_LIMIT = 8;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The limit is counted per recipient and never per sender, so nothing about
 * who asked is stored anywhere.
 */
export function nudgeLimitKey(recipientId: string): string {
  return `hub:nudge:${recipientId}`;
}

/** What the rules need to know about one task. */
export interface NudgeFacts {
  stage: Stage;
  dueState: DueState;
  dueDate: Date | null;
  /** The latest of: created, edited, and any activity (a move, a comment). */
  lastTouchedAt: Date;
}

export interface AssignedTask extends NudgeFacts {
  title: string;
  /** Registered people the task is assigned to. */
  assigneeIds: readonly string[];
}

export type Stuck = { kind: "overdue" } | { kind: "idle"; days: number };

export function idleDays(lastTouchedAt: Date, now: Date): number {
  return Math.max(
    0,
    Math.floor((now.getTime() - lastTouchedAt.getTime()) / DAY_MS),
  );
}

/** Why an open task counts as stuck, or null when it does not. Overdue wins. */
export function stuckReason(task: NudgeFacts, now: Date): Stuck | null {
  if (!isOpen(task.stage)) return null;
  if (task.dueState === "overdue") return { kind: "overdue" };
  const days = idleDays(task.lastTouchedAt, now);
  return days >= STALE_AFTER_DAYS ? { kind: "idle", days } : null;
}

export interface StuckPerson<T extends AssignedTask> {
  userId: string;
  /** Their open tasks among the ones given. */
  openCount: number;
  /** Their most stuck task, the one the list shows. */
  headline: { task: T; stuck: Stuck };
}

/**
 * Who a viewer could nudge, given the tasks the viewer can see: everyone but
 * the viewer with at least one stuck task. Most stuck first: overdue before
 * idle, the longest overdue or idle first.
 */
export function stuckPeople<T extends AssignedTask>(
  tasks: readonly T[],
  viewerId: string,
  now: Date,
): StuckPerson<T>[] {
  const openCounts = new Map<string, number>();
  const headlines = new Map<string, StuckPerson<T>["headline"]>();

  for (const task of tasks) {
    if (!isOpen(task.stage)) continue;
    const stuck = stuckReason(task, now);
    for (const userId of new Set(task.assigneeIds)) {
      if (userId === viewerId) continue;
      openCounts.set(userId, (openCounts.get(userId) ?? 0) + 1);
      const current = headlines.get(userId);
      if (stuck && (!current || moreStuck({ task, stuck }, current) < 0)) {
        headlines.set(userId, { task, stuck });
      }
    }
  }

  return [...headlines]
    .map(([userId, headline]) => ({
      userId,
      openCount: openCounts.get(userId) ?? 0,
      headline,
    }))
    .sort((a, b) => moreStuck(a.headline, b.headline));
}

/** Negative when `a` is more stuck than `b`. */
function moreStuck(
  a: { task: NudgeFacts; stuck: Stuck },
  b: { task: NudgeFacts; stuck: Stuck },
): number {
  if (a.stuck.kind !== b.stuck.kind) return a.stuck.kind === "overdue" ? -1 : 1;
  if (a.stuck.kind === "overdue") {
    return (a.task.dueDate?.getTime() ?? 0) - (b.task.dueDate?.getTime() ?? 0);
  }
  return a.task.lastTouchedAt.getTime() - b.task.lastTouchedAt.getTime();
}

/**
 * The order a nudge mail lists someone's tasks in: soonest due first (so
 * overdue ones lead), undated ones last; among equals, the longest untouched
 * first.
 */
export function mailOrder<T extends NudgeFacts>(tasks: readonly T[]): T[] {
  const due = (task: T) => task.dueDate?.getTime() ?? Number.POSITIVE_INFINITY;
  return [...tasks].sort(
    (a, b) =>
      due(a) - due(b) || a.lastTouchedAt.getTime() - b.lastTouchedAt.getTime(),
  );
}
