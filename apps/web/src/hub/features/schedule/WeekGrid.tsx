import { useEffect, useMemo, useRef, useState } from "react";
import { twMerge } from "tailwind-merge";

import type { DisplayBlock, PlanTask } from "./schedule-display";
import type { Span } from "~/hub/lib/schedule-layout";
import { copy } from "~/hub/copy/zh";
import {
  addDays,
  DAY_HEIGHT,
  dayIndexAt,
  dragSpan,
  endDayOf,
  HOUR_HEIGHT,
  moveSpanTo,
  resizeSpanTo,
  segmentsOfDay,
  startOfDay,
  timeAtOffset,
  weekDays,
} from "~/hub/lib/schedule-layout";
import { useOpenTask } from "../tasks/task-display";
import { blockStyle, formatTime, labelOf } from "./schedule-display";

const text = copy.schedule;

/** How far the pointer must travel before a press on a block counts as a drag. */
const DRAG_THRESHOLD_PX = 4;

/** Where the grid is scrolled to when it first appears: the working day's start. */
const FIRST_VISIBLE_HOUR = 8;

const weekdayFormat = new Intl.DateTimeFormat("zh-CN", { weekday: "short" });

type Gesture =
  | {
      type: "create";
      /** The column the press started in; the whole drag stays on it. */
      day: Date;
      anchor: Date;
      current: Date;
    }
  | {
      type: "move" | "resize";
      block: DisplayBlock;
      span: Span;
      /** For a move: how far into the block the pointer took hold. */
      grabMs: number;
      from: { x: number; y: number };
      dragged: boolean;
    };

interface Props {
  weekStart: Date;
  blocks: DisplayBlock[];
  openTasks: PlanTask[];
  /** What a drag on empty time would create, drawn as the preview. */
  preview: Pick<DisplayBlock, "kind" | "title" | "task">;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (span: Span) => void;
  onChange: (block: DisplayBlock, span: Span) => void;
}

/**
 * Seven day columns with an hour scale. A press on empty time and a drag draws
 * a block; a press on a block selects it, a drag moves it, and a drag on its
 * bottom edge resizes it. All the time arithmetic is in `schedule-layout`.
 */
export function WeekGrid({
  weekStart,
  blocks,
  openTasks,
  preview,
  selectedId,
  onSelect,
  onCreate,
  onChange,
}: Props) {
  const days = useMemo(() => weekDays(weekStart), [weekStart]);
  const gridRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const now = useNow();

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = FIRST_VISIBLE_HOUR * HOUR_HEIGHT - 8;
    }
  }, []);

  // While a block is being dragged, it is drawn where it would land.
  const shown = useMemo(() => {
    const dragged = gesture && gesture.type !== "create" ? gesture : null;
    const drawn = blocks.map((block) =>
      dragged && block.id === dragged.block.id
        ? { ...block, ...dragged.span }
        : block,
    );
    return gesture?.type === "create"
      ? [
          ...drawn,
          {
            ...preview,
            id: "preview",
            ghost: true,
            ...dragSpan(gesture.anchor, gesture.current),
          },
        ]
      : drawn;
  }, [blocks, gesture, preview]);

  const dayAt = (event: React.PointerEvent): Date => {
    const rect = gridRef.current?.getBoundingClientRect();
    if (!rect) return weekStart;
    return days[dayIndexAt(event.clientX, rect.left, rect.width)] ?? weekStart;
  };

  /** The time under the pointer, read on `day` (by default the column under it). */
  const timeAt = (
    event: React.PointerEvent,
    day: Date = dayAt(event),
  ): Date => {
    const top = gridRef.current?.getBoundingClientRect().top ?? 0;
    return timeAtOffset(day, event.clientY - top);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const blockEl = target.closest<HTMLElement>("[data-block-id]");
    const pointer = timeAt(event);
    event.currentTarget.setPointerCapture(event.pointerId);

    if (!blockEl) {
      // Not deselected yet: closing the editor above the grid would shift it
      // under the pointer in the middle of the drag.
      setGesture({
        type: "create",
        day: dayAt(event),
        anchor: pointer,
        current: pointer,
      });
      return;
    }
    const block = blocks.find((b) => b.id === blockEl.dataset.blockId);
    if (!block) return;
    setGesture({
      type: target.closest("[data-resize]") ? "resize" : "move",
      block,
      span: { startsAt: block.startsAt, endsAt: block.endsAt },
      grabMs: pointer.getTime() - block.startsAt.getTime(),
      from: { x: event.clientX, y: event.clientY },
      dragged: false,
    });
  };

  const onPointerMove = (event: React.PointerEvent) => {
    if (!gesture) return;
    if (gesture.type === "create") {
      // Only the height counts: drifting sideways must not stretch the new
      // block into the next day.
      setGesture({ ...gesture, current: timeAt(event, gesture.day) });
      return;
    }
    const original = {
      startsAt: gesture.block.startsAt,
      endsAt: gesture.block.endsAt,
    };
    // A move may change day; a resize happens on the block's own last day.
    const span =
      gesture.type === "move"
        ? moveSpanTo(
            original,
            new Date(timeAt(event).getTime() - gesture.grabMs),
          )
        : resizeSpanTo(original, timeAt(event, endDayOf(original)));
    const travelled = Math.hypot(
      event.clientX - gesture.from.x,
      event.clientY - gesture.from.y,
    );
    setGesture({
      ...gesture,
      span,
      dragged: gesture.dragged || travelled > DRAG_THRESHOLD_PX,
    });
  };

  const onPointerUp = () => {
    if (!gesture) return;
    setGesture(null);
    if (gesture.type === "create") {
      const isClick = gesture.anchor.getTime() === gesture.current.getTime();
      onSelect(null);
      // With a block selected, a click on empty time only lets go of it;
      // otherwise every attempt to deselect left a stray block behind.
      if (isClick && selectedId !== null) return;
      onCreate(dragSpan(gesture.anchor, gesture.current));
      return;
    }
    const moved =
      gesture.span.startsAt.getTime() !== gesture.block.startsAt.getTime() ||
      gesture.span.endsAt.getTime() !== gesture.block.endsAt.getTime();
    if (gesture.dragged && moved) onChange(gesture.block, gesture.span);
    else onSelect(gesture.block.id);
  };

  const today = startOfDay(now ?? new Date(0));

  return (
    <div
      ref={scrollRef}
      className="h-[calc(100vh-21rem)] min-h-[420px] overflow-auto rounded-xl border border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-100"
    >
      <div className="min-w-[720px]">
        <div className="sticky top-0 z-20 border-b border-light-300 bg-light-50 dark:border-dark-300 dark:bg-dark-100">
          <div className="flex">
            <div className="w-12 shrink-0" />
            {days.map((day) => {
              const isToday = day.getTime() === today.getTime();
              return (
                <div
                  key={day.getTime()}
                  className="flex flex-1 items-center justify-center gap-1.5 border-l border-light-300 py-2 text-xs dark:border-dark-300"
                >
                  <span className="text-light-900 dark:text-dark-900">
                    {weekdayFormat.format(day)}
                  </span>
                  <span
                    className={twMerge(
                      "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-sm font-semibold tabular-nums text-light-1000 dark:text-dark-1000",
                      isToday &&
                        "bg-light-1000 text-light-50 dark:bg-dark-1000 dark:text-dark-50",
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
          </div>
          <DueRow days={days} openTasks={openTasks} />
        </div>

        <div className="flex">
          <div
            className="relative w-12 shrink-0"
            style={{ height: DAY_HEIGHT }}
          >
            {Array.from({ length: 23 }, (_, index) => (
              <span
                key={index}
                className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-light-800 dark:text-dark-800"
                style={{ top: (index + 1) * HOUR_HEIGHT }}
              >
                {index + 1}:00
              </span>
            ))}
          </div>

          <div
            ref={gridRef}
            className="relative flex flex-1 touch-pan-y select-none"
            style={{ height: DAY_HEIGHT }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={() => setGesture(null)}
          >
            <HourLines />
            {days.map((day) => (
              <DayColumn
                key={day.getTime()}
                day={day}
                blocks={shown}
                selectedId={selectedId}
                draggingId={
                  gesture && gesture.type !== "create" ? gesture.block.id : null
                }
                now={now}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** The clock, refreshed each minute; null on the server so the page hydrates cleanly. */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

function HourLines() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {Array.from({ length: 24 }, (_, hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-light-200 dark:border-dark-200"
          style={{ top: hour * HOUR_HEIGHT }}
        />
      ))}
    </div>
  );
}

function DayColumn({
  day,
  blocks,
  selectedId,
  draggingId,
  now,
}: {
  day: Date;
  blocks: DisplayBlock[];
  selectedId: string | null;
  draggingId: string | null;
  now: Date | null;
}) {
  const segments = segmentsOfDay(blocks, day);
  const isToday = now !== null && startOfDay(now).getTime() === day.getTime();

  return (
    <div className="relative flex-1 border-l border-light-300 dark:border-dark-300">
      {segments.map(
        ({ block, top, height, startsHere, endsHere, lane, lanes }) => {
          // Once picked, a block squeezed into a narrow lane takes the whole
          // column, so it is easy to drag, resize or delete.
          const lifted = block.id === selectedId || block.id === draggingId;
          return (
            <div
              key={block.id}
              data-block-id={block.ghost ? undefined : block.id}
              className={twMerge(
                "absolute overflow-hidden px-1.5 py-0.5 text-xs leading-4",
                blockStyle[block.kind],
                block.ghost
                  ? "pointer-events-none opacity-60"
                  : "cursor-grab active:cursor-grabbing",
                startsHere ? "rounded-t-md" : "border-t-0",
                endsHere ? "rounded-b-md" : "border-b-0",
                block.task?.stage === "done" && "opacity-60",
                block.id === selectedId &&
                  "ring-2 ring-light-1000 ring-offset-1 dark:ring-dark-1000",
                lifted && "z-10",
                block.id === draggingId && "shadow-lg",
              )}
              style={{
                top,
                height: height - 1,
                left: lifted ? "1px" : `calc(${(lane / lanes) * 100}% + 1px)`,
                width: lifted
                  ? "calc(100% - 3px)"
                  : `calc(${100 / lanes}% - 3px)`,
              }}
            >
              <span
                className={twMerge(
                  "block truncate font-medium",
                  block.task?.stage === "done" && "line-through",
                )}
              >
                {labelOf(block)}
              </span>
              {height >= 40 && (
                <span className="block truncate tabular-nums opacity-70">
                  {formatTime(block.startsAt)}–{formatTime(block.endsAt)}
                </span>
              )}
              {endsHere && !block.ghost && (
                <span
                  data-resize
                  className="absolute inset-x-0 bottom-0 h-2 cursor-ns-resize"
                />
              )}
            </div>
          );
        },
      )}

      {isToday && <NowLine now={now} />}
    </div>
  );
}

function NowLine({ now }: { now: Date }) {
  const minutes = now.getHours() * 60 + now.getMinutes();
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
      style={{ top: (minutes / 60) * HOUR_HEIGHT }}
      title={text.now}
    >
      <span className="-ml-1 h-2 w-2 rounded-full bg-red-500" />
      <span className="h-px flex-1 bg-red-500" />
    </div>
  );
}

/** Tasks due each day, as small chips above the hours. */
function DueRow({ days, openTasks }: { days: Date[]; openTasks: PlanTask[] }) {
  const dueOn = (day: Date) =>
    openTasks.filter(({ task }) => {
      if (!task.dueDate) return false;
      const due = new Date(task.dueDate);
      return due >= day && due < addDays(day, 1);
    });
  const hasAny = days.some((day) => dueOn(day).length > 0);
  if (!hasAny) return null;

  return (
    <div className="flex border-t border-light-300 dark:border-dark-300">
      <div className="w-12 shrink-0 px-1 py-1.5 text-right text-[11px] leading-4 text-light-800 dark:text-dark-800">
        {text.dueRow}
      </div>
      {days.map((day) => (
        <div
          key={day.getTime()}
          className="flex min-w-0 flex-1 flex-col gap-1 border-l border-light-300 p-1 dark:border-dark-300"
        >
          {dueOn(day).map(({ task }) => (
            <DueChip key={task.publicId} task={task} />
          ))}
        </div>
      ))}
    </div>
  );
}

function DueChip({ task }: { task: PlanTask["task"] }) {
  const open = useOpenTask(task);
  return (
    <button
      type="button"
      onClick={open}
      title={task.title}
      className={twMerge(
        "truncate rounded border border-light-400 px-1.5 py-0.5 text-left text-[11px] leading-4 text-light-1000 hover:bg-light-200 dark:border-dark-400 dark:text-dark-1000 dark:hover:bg-dark-200",
        task.dueState === "overdue" &&
          "border-red-300 text-red-700 dark:border-red-900 dark:text-red-400",
      )}
    >
      {task.title}
    </button>
  );
}
