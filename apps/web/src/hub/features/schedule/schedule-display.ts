import type { Span } from "~/hub/lib/schedule-layout";
import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";

type Schedule = RouterOutputs["hub"]["schedule"]["get"];

export type ScheduleBlock = Schedule["blocks"][number];
export type PlanTask = Schedule["openTasks"][number];
export type BlockKind = ScheduleBlock["kind"];

/** The kinds a person draws with; task blocks come from picking a task. */
export const brushKinds = ["busy", "free", "meeting"] as const;
export type BrushKind = (typeof brushKinds)[number];

/** What dragging on the time table paints: a kind of time, or one task. */
export type Brush = { kind: BrushKind } | { task: PlanTask["task"] };

/**
 * A block as the grid draws it. Real blocks, the one being dragged and the
 * placeholder for a block still being saved all take this shape.
 */
export interface DisplayBlock extends Span {
  id: string;
  kind: BlockKind;
  title: string | null;
  /** Set on task blocks: the card the block is for. */
  task: ScheduleBlock["task"];
  /** A preview, not yet saved: not clickable. */
  ghost?: boolean;
}

export function toDisplayBlock(block: ScheduleBlock): DisplayBlock {
  return {
    id: block.publicId,
    kind: block.kind,
    title: block.title,
    task: block.task,
    startsAt: block.startsAt,
    endsAt: block.endsAt,
  };
}

/** The text a block shows: its own title, or the kind's name when it has none. */
export function labelOf(block: Pick<DisplayBlock, "kind" | "title">): string {
  return block.title ?? copy.schedule.kinds[block.kind];
}

/**
 * Monochrome on purpose: free time is an empty outline, busy time a grey fill,
 * a meeting black, a task a white card with a strong border.
 */
export const blockStyle: Record<BlockKind, string> = {
  free: "border border-dashed border-light-600 bg-light-50/70 text-light-900 dark:border-dark-600 dark:bg-dark-50/50 dark:text-dark-900",
  busy: "border border-light-400 bg-light-300 text-light-1000 dark:border-dark-500 dark:bg-dark-300 dark:text-dark-1000",
  meeting:
    "border border-light-1000 bg-light-1000 text-light-50 dark:border-dark-1000 dark:bg-dark-1000 dark:text-dark-50",
  task: "border-2 border-light-1000 bg-light-50 text-light-1000 dark:border-dark-1000 dark:bg-dark-100 dark:text-dark-1000",
};

const timeFormat = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const dayFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
  weekday: "short",
});

export const formatTime = (date: Date) => timeFormat.format(date);
export const formatDay = (date: Date) => dayFormat.format(date);

/** "10月14日周三 09:00–11:00", or both dates when the block crosses midnight. */
export function formatSpan(span: Span): string {
  const sameDay = span.startsAt.toDateString() === span.endsAt.toDateString();
  return sameDay
    ? `${formatDay(span.startsAt)} ${formatTime(span.startsAt)}–${formatTime(span.endsAt)}`
    : `${formatDay(span.startsAt)} ${formatTime(span.startsAt)} – ${formatDay(span.endsAt)} ${formatTime(span.endsAt)}`;
}
