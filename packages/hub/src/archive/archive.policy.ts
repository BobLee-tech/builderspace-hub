import type { Stage } from "../tasks/task.policy";

/**
 * Pure rules for "我完成的": when a task was finished, who it counts for, and
 * which month that falls in for the person looking. No IO.
 */

/** How many finished tasks the page lists; the counts always cover all of them. */
export const ARCHIVE_LIST_LIMIT = 100;

/** How many months the month-by-month counts go back, the current one included. */
export const ARCHIVE_MONTHS = 12;

/** One entry of a card's history that can mark it finished. */
export interface CardEvent {
  kind: "created" | "moved";
  /** The column the card landed in; null when the event does not say. */
  toStage: Stage | null;
  /** Who did it; null when that account is gone. */
  by: string | null;
  at: Date;
}

export interface Completion {
  at: Date;
  by: string | null;
}

/**
 * When and by whom a card that now sits in a finished column was finished: the
 * last move into such a column. A card that was created there and never moved
 * was finished when it was created. Null when the history says neither.
 */
export function completionOf(events: readonly CardEvent[]): Completion | null {
  const latest = (matches: (event: CardEvent) => boolean) =>
    events
      .filter(matches)
      .reduce<CardEvent | null>(
        (last, e) => (last && last.at >= e.at ? last : e),
        null,
      );

  const event =
    latest((e) => e.kind === "moved" && e.toStage === "done") ??
    latest((e) => e.kind === "created");
  return event ? { at: event.at, by: event.by } : null;
}

/**
 * Whether a finished task counts as mine: the people it is assigned to get the
 * credit; a task nobody was assigned to counts for whoever finished it.
 */
export function countsForMe(input: {
  assignedToMe: boolean;
  hasAssignees: boolean;
  finishedBy: string | null;
  userId: string;
}): boolean {
  if (input.hasAssignees) return input.assignedToMe;
  return input.finishedBy === input.userId;
}

/** Whether the runtime knows this IANA time zone, e.g. "Australia/Sydney". */
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** "2026-10": the calendar month `date` falls in, on a wall clock in `timeZone`. */
export function monthKey(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(date);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

/** The `count` months up to and including `current`, oldest first. */
export function monthsEndingAt(current: string, count: number): string[] {
  const [yearText, monthText] = current.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  return Array.from({ length: count }, (_, index) => {
    const back = count - 1 - index;
    const total = year * 12 + (month - 1) - back;
    const y = Math.floor(total / 12);
    const m = (total % 12) + 1;
    return `${y}-${String(m).padStart(2, "0")}`;
  });
}
