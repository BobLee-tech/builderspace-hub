import type { TimeBlockKind } from "../schema";

/**
 * Pure rules for the personal calendar. No IO.
 *
 * Messages are Chinese because they are shown to the person as they are.
 */

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Shorter than this is a slip of the mouse, not a plan. */
export const MIN_BLOCK_MS = 5 * MINUTE;

/** A trip can take a few days; anything longer should be split. */
export const MAX_BLOCK_MS = 7 * DAY;

/** The calendar shows a week; a month view with spill-over is the most we allow. */
export const MAX_WINDOW_MS = 42 * DAY;

export const TITLE_MAX_LENGTH = 80;

/** The kinds a person draws by hand. `task` blocks come from dragging a card. */
export const manualKinds = ["free", "busy", "meeting"] as const;
export type ManualKind = (typeof manualKinds)[number];

export function isManualKind(kind: TimeBlockKind): kind is ManualKind {
  return (manualKinds as readonly string[]).includes(kind);
}

/** Why this start and end cannot be a block, or null when they can. */
export function rangeProblem(startsAt: Date, endsAt: Date): string | null {
  const length = endsAt.getTime() - startsAt.getTime();
  if (Number.isNaN(length) || length <= 0) return "结束时间要晚于开始时间。";
  if (length < MIN_BLOCK_MS) return "时间段至少要 5 分钟。";
  if (length > MAX_BLOCK_MS) return "一个时间段最长 7 天，更长的请拆开。";
  return null;
}

/** Why this is not a window the calendar can show, or null when it is. */
export function windowProblem(from: Date, to: Date): string | null {
  const length = to.getTime() - from.getTime();
  if (Number.isNaN(length) || length <= 0) return "查看范围不对。";
  if (length > MAX_WINDOW_MS) return "一次最多查看 6 周。";
  return null;
}

/** Blank titles are the same as no title. */
export function normaliseTitle(
  title: string | null | undefined,
): string | null {
  const trimmed = title?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export interface Span {
  startsAt: Date;
  endsAt: Date;
}

/** Whether the span shares any time with the window; touching edges do not count. */
export function overlapsWindow(span: Span, from: Date, to: Date): boolean {
  return span.startsAt < to && span.endsAt > from;
}
