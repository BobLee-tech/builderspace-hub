import { useEffect, useMemo, useState } from "react";
import { TbChevronLeft, TbChevronRight } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { Brush, BrushKind, DisplayBlock } from "./schedule-display";
import type { Span } from "~/hub/lib/schedule-layout";
import { PageHead } from "~/components/PageHead";
import { copy } from "~/hub/copy/zh";
import { addDays, startOfWeek } from "~/hub/lib/schedule-layout";
import { buttonClass, ErrorText, PageHeader } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { PersonalTabs } from "../personal/PersonalTabs";
import { BlockEditor } from "./BlockEditor";
import { brushKinds, toDisplayBlock } from "./schedule-display";
import { TaskPanel } from "./TaskPanel";
import { WeekGrid } from "./WeekGrid";

const text = copy.schedule;

const DEFAULT_BRUSH: Brush = { kind: "busy" };

const rangeFormat = new Intl.DateTimeFormat("zh-CN", {
  month: "numeric",
  day: "numeric",
});

/** 个人: my own week. Private to the person looking at it. */
export function SchedulePage() {
  // Unknown until mounted: the server has no idea which week the viewer's
  // clock is in, and the first client render must match what the server sent.
  const [weekStart, setWeekStart] = useState<Date | null>(null);
  useEffect(() => setWeekStart(startOfWeek(new Date())), []);
  const [brush, setBrush] = useState<Brush>(DEFAULT_BRUSH);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Blocks that were just drawn and are still being saved.
  const [saving, setSaving] = useState<DisplayBlock[]>([]);
  const [lastKind, setLastKind] = useState<BrushKind>("busy");

  const range = useMemo(
    () =>
      weekStart ? { from: weekStart, to: addDays(weekStart, 7) } : undefined,
    [weekStart],
  );
  const utils = api.useUtils();
  const schedule = api.hub.schedule.get.useQuery(
    range ?? { from: new Date(0), to: new Date(1) },
    { enabled: !!range, retry: false },
  );

  const refresh = () => utils.hub.schedule.get.invalidate();
  const create = api.hub.schedule.create.useMutation({
    onSettled: refresh,
  });
  const plan = api.hub.schedule.planTask.useMutation({ onSettled: refresh });
  const remove = api.hub.schedule.remove.useMutation({ onSettled: refresh });
  const edit = api.hub.schedule.edit.useMutation({
    // Show the move straight away; put things back if the server refuses.
    onMutate: async (change) => {
      if (!range) return undefined;
      await utils.hub.schedule.get.cancel();
      const before = utils.hub.schedule.get.getData(range);
      utils.hub.schedule.get.setData(range, (data) =>
        data
          ? {
              ...data,
              blocks: data.blocks.map((block) =>
                block.publicId === change.blockPublicId
                  ? {
                      ...block,
                      ...(change.startsAt && { startsAt: change.startsAt }),
                      ...(change.endsAt && { endsAt: change.endsAt }),
                      ...(change.kind && { kind: change.kind }),
                      ...(change.title !== undefined && {
                        title: change.title?.trim()
                          ? change.title.trim()
                          : null,
                      }),
                    }
                  : block,
              ),
            }
          : data,
      );
      return { before };
    },
    onError: (_error, _change, context) => {
      if (range && context?.before) {
        utils.hub.schedule.get.setData(range, context.before);
      }
    },
    onSettled: refresh,
  });

  const blocks = useMemo(
    () => [...(schedule.data?.blocks ?? [])].map(toDisplayBlock),
    [schedule.data],
  );
  const openTasks = useMemo(
    () => schedule.data?.openTasks ?? [],
    [schedule.data],
  );
  const selected = schedule.data?.blocks.find(
    (block) => block.publicId === selectedId,
  );
  // A picked task that has since been finished or taken away is no longer a brush.
  const pickedTask =
    "task" in brush
      ? openTasks.find((item) => item.task.publicId === brush.task.publicId)
          ?.task
      : undefined;
  const activeBrush: Brush = pickedTask
    ? { task: pickedTask }
    : "task" in brush
      ? DEFAULT_BRUSH
      : brush;

  const draw = (span: Span) => {
    if ("task" in activeBrush) {
      plan.mutate({
        cardPublicId: activeBrush.task.publicId,
        ...span,
      });
      setBrush({ kind: lastKind });
      return;
    }
    const ghostId = `saving-${Date.now()}`;
    setSaving((current) => [
      ...current,
      {
        ...span,
        id: ghostId,
        kind: activeBrush.kind,
        title: null,
        task: null,
        ghost: true,
      },
    ]);
    create.mutate(
      { kind: activeBrush.kind, ...span },
      {
        onSuccess: ({ publicId }) => {
          if (activeBrush.kind !== "free") setSelectedId(publicId);
        },
        onSettled: () => {
          void refresh().then(() =>
            setSaving((current) => current.filter((b) => b.id !== ghostId)),
          );
        },
      },
    );
  };

  const pickKind = (kind: BrushKind) => {
    setBrush({ kind });
    setLastKind(kind);
  };

  const error =
    schedule.error?.message ??
    create.error?.message ??
    plan.error?.message ??
    edit.error?.message ??
    remove.error?.message;

  return (
    <div className="m-auto w-full max-w-[1280px] px-5 py-8 md:px-12 md:py-12">
      <PageHead title={`${text.title} · ${copy.brand}`} />
      <PersonalTabs />
      <PageHeader title={text.heading} description={text.description} />

      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <WeekNav weekStart={weekStart} onChange={setWeekStart} />
        <BrushBar
          brush={activeBrush}
          onPickKind={pickKind}
          onStopPlacing={() => setBrush({ kind: lastKind })}
        />
      </div>

      {selected && (
        <div className="mb-4">
          <BlockEditor
            block={selected}
            onEdit={(change) =>
              edit.mutate({ blockPublicId: selected.publicId, ...change })
            }
            onRemove={() => {
              setSelectedId(null);
              remove.mutate({ blockPublicId: selected.publicId });
            }}
            onClose={() => setSelectedId(null)}
          />
        </div>
      )}

      <div className="mb-3">
        <ErrorText message={error} />
      </div>

      <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
        <div className="min-w-0 flex-1">
          {weekStart && (
            <WeekGrid
              weekStart={weekStart}
              blocks={[...blocks, ...saving]}
              openTasks={openTasks}
              preview={
                "task" in activeBrush
                  ? { kind: "task", title: activeBrush.task.title, task: null }
                  : { kind: activeBrush.kind, title: null, task: null }
              }
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={draw}
              onChange={(block, span) =>
                edit.mutate({ blockPublicId: block.id, ...span })
              }
            />
          )}
        </div>
        <div className="w-full xl:w-72 xl:shrink-0">
          <TaskPanel
            tasks={openTasks}
            isLoading={!schedule.data && !schedule.error}
            pickedId={pickedTask?.publicId ?? null}
            onPick={(task) => setBrush(task ? { task } : { kind: lastKind })}
          />
        </div>
      </div>
    </div>
  );
}

function WeekNav({
  weekStart,
  onChange,
}: {
  weekStart: Date | null;
  onChange: (weekStart: Date) => void;
}) {
  const label = weekStart
    ? `${rangeFormat.format(weekStart)} – ${rangeFormat.format(addDays(weekStart, 6))}`
    : "";
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        className={buttonClass.ghost}
        aria-label={text.week.previous}
        title={text.week.previous}
        disabled={!weekStart}
        onClick={() => weekStart && onChange(addDays(weekStart, -7))}
      >
        <TbChevronLeft className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        className={buttonClass.ghost}
        onClick={() => onChange(startOfWeek(new Date()))}
      >
        {text.week.current}
      </button>
      <button
        type="button"
        className={buttonClass.ghost}
        aria-label={text.week.next}
        title={text.week.next}
        disabled={!weekStart}
        onClick={() => weekStart && onChange(addDays(weekStart, 7))}
      >
        <TbChevronRight className="h-4 w-4" aria-hidden="true" />
      </button>
      <span className="ml-1 text-sm font-medium tabular-nums text-light-1000 dark:text-dark-1000">
        {label}
      </span>
    </div>
  );
}

/** What the next drag paints: pick a kind of time, or stop placing a picked task. */
function BrushBar({
  brush,
  onPickKind,
  onStopPlacing,
}: {
  brush: Brush;
  onPickKind: (kind: BrushKind) => void;
  onStopPlacing: () => void;
}) {
  if ("task" in brush) {
    return (
      <div className="flex items-center gap-3">
        <span className="text-sm text-light-1000 dark:text-dark-1000">
          {text.tasks.placing(brush.task.title)}
        </span>
        <button
          type="button"
          className={buttonClass.ghost}
          onClick={onStopPlacing}
        >
          {text.tasks.stopPlacing}
        </button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2" title={text.brush.hint}>
      <span className="hidden text-xs text-light-900 dark:text-dark-900 lg:inline">
        {text.brush.label}
      </span>
      <div className="flex gap-1" role="group" aria-label={text.brush.label}>
        {brushKinds.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={brush.kind === kind}
            onClick={() => onPickKind(kind)}
            className={twMerge(
              buttonClass.ghost,
              brush.kind === kind &&
                "border-light-1000 bg-light-1000 text-light-50 hover:bg-light-1000 dark:border-dark-1000 dark:bg-dark-1000 dark:text-dark-50 dark:hover:bg-dark-1000",
            )}
          >
            {text.kinds[kind]}
          </button>
        ))}
      </div>
    </div>
  );
}
