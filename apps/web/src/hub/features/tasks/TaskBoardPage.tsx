import type { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/router";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useState } from "react";
import { TbArrowLeft, TbPlus } from "react-icons/tb";
import { twMerge } from "tailwind-merge";

import type { Stage, TaskView } from "@kan/hub/public";
import {
  functionKeys,
  functionNames,
  stageNames,
  taskViews,
} from "@kan/hub/public";

import type { HubTask } from "./task-display";
import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { homeHref, taskBoardHref } from "~/hub/lib/routes";
import { useFunctionColors } from "~/hub/lib/use-function-colors";
import { buttonClass, Card, ErrorText } from "~/hub/ui/admin-primitives";
import { api } from "~/utils/api";
import { BoardCard } from "./BoardCard";
import { NewTaskForm } from "./NewTaskForm";
import {
  ScopeSwitcher,
  useFollowScope,
  useProjectParam,
} from "./ScopeSwitcher";
import { useBoardActions } from "./use-board-actions";

type Board = RouterOutputs["hub"]["tasks"]["board"];
type Column = Board["columns"][number];
type OpenStage = Exclude<Stage, "other">;

const text = copy.tasks;

function isTaskView(value: unknown): value is TaskView {
  return (taskViews as readonly unknown[]).includes(value);
}

export function viewTitle(view: TaskView): string {
  return view in text.views
    ? text.views[view as keyof typeof text.views]
    : functionNames[view as keyof typeof functionNames];
}

function stageTitle(stage: Stage): string {
  return stage === "other" ? text.otherStage : stageNames[stage];
}

/**
 * One view across every project in scope, split into the standard columns.
 * The "all" view of one project is that project's 总版: every task of its
 * 开发 / 运营 / 营销 boards, coloured by function. Where the person may edit,
 * a task can be dragged to another column or given a due date here, and new
 * tasks can be added; each change lands on the task's own board.
 */
export function TaskBoardPage() {
  const router = useRouter();
  const { projectPublicId, isReady } = useProjectParam();
  const view = router.query.view;
  const valid = isTaskView(view);
  const query = {
    view: valid ? view : ("all" as const),
    project: projectPublicId,
  };

  const board = api.hub.tasks.board.useQuery(query, {
    enabled: isReady && valid,
    retry: false,
  });
  useFollowScope(board.data?.scope.current);
  const actions = useBoardActions(board.data, query);
  const [formStage, setFormStage] = useState<OpenStage | null>(null);

  const data = board.data;
  const canCreateSomewhere =
    data?.boards.some(
      (target) => data.access[target.project.publicId]?.canCreate,
    ) ?? false;
  const title = valid ? viewTitle(view) : "";
  const scopeName = board.data?.scope.current?.name;

  return (
    <div className="flex h-full min-h-0 flex-col px-5 py-8 md:px-10 md:py-10">
      <header className="mb-5 space-y-4">
        <Link
          href={homeHref(projectPublicId)}
          className="inline-flex items-center gap-1 text-xs text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
        >
          <TbArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          {text.backHome}
        </Link>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-light-1000 dark:text-dark-1000">
              {title}
              {scopeName && (
                <span className="ml-2 text-base font-medium text-light-900 dark:text-dark-900">
                  · {scopeName}
                </span>
              )}
            </h1>
            {view === "all" && (
              <>
                <p className="mt-1 max-w-xl text-xs leading-5 text-light-900 dark:text-dark-900">
                  {text.overallHint}
                </p>
                <ColorLegend />
              </>
            )}
          </div>
          <div className="flex flex-col items-start gap-2 md:items-end">
            {board.data && valid && (
              <ScopeSwitcher
                projects={board.data.scope.projects}
                current={board.data.scope.current}
                hrefFor={(id) => taskBoardHref(view, id)}
              />
            )}
            {canCreateSomewhere && (
              <button
                type="button"
                className={buttonClass.primary}
                onClick={() => setFormStage("todo")}
              >
                <TbPlus className="mr-1 h-4 w-4" aria-hidden="true" />
                {text.newTask}
              </button>
            )}
          </div>
        </div>
      </header>

      {board.data && formStage && (
        <NewTaskForm
          key={formStage}
          board={board.data}
          initialStage={formStage}
          isPending={actions.isCreating}
          onCreate={actions.create}
          onClose={() => setFormStage(null)}
        />
      )}
      <ErrorText message={actions.error ?? undefined} />

      {!valid && isReady ? (
        <Notice>{text.emptyBoard}</Notice>
      ) : board.error?.data?.code === "NOT_FOUND" ? (
        <Notice>
          {copy.home.scopeMissing}{" "}
          <Link
            href={taskBoardHref(valid ? view : "all")}
            className="underline"
          >
            {copy.home.scopeMissingBack}
          </Link>
        </Notice>
      ) : !board.data ? (
        <ColumnsSkeleton />
      ) : (
        <Columns
          board={board.data}
          onMove={actions.move}
          onSetDue={actions.setDue}
          onAdd={canCreateSomewhere ? setFormStage : undefined}
        />
      )}
    </div>
  );
}

function ColorLegend() {
  const colors = useFunctionColors();
  return (
    <p className="mt-2 flex flex-wrap gap-3 text-xs text-light-900 dark:text-dark-900">
      {functionKeys.map((key) => (
        <span key={key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: colors[key] }}
          />
          {functionNames[key]}
        </span>
      ))}
    </p>
  );
}

function Columns({
  board,
  onMove,
  onSetDue,
  onAdd,
}: {
  board: Board;
  onMove: (task: HubTask, to: Stage) => Promise<void>;
  onSetDue: (task: HubTask, dueDate: Date | null) => void;
  onAdd?: (stage: OpenStage) => void;
}) {
  // A small distance before a drag starts keeps plain clicks opening the card.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [dragging, setDragging] = useState<HubTask | null>(null);
  const canEdit = (task: HubTask) =>
    board.access[task.project.publicId]?.canEdit ?? false;

  return (
    <DndContext
      sensors={sensors}
      onDragStart={(event: DragStartEvent) =>
        setDragging((event.active.data.current as { task: HubTask }).task)
      }
      onDragCancel={() => setDragging(null)}
      onDragEnd={(event: DragEndEvent) => {
        setDragging(null);
        const task = (
          event.active.data.current as { task: HubTask } | undefined
        )?.task;
        const to = event.over?.id as Stage | undefined;
        if (task && to) void onMove(task, to);
      }}
    >
      <div className="-mx-5 flex min-h-0 flex-1 gap-3 overflow-x-auto px-5 pb-4 md:-mx-10 md:px-10">
        {board.columns.map((column) => (
          <TaskColumn
            key={column.stage}
            column={column}
            canEdit={canEdit}
            onSetDue={onSetDue}
            onAdd={onAdd}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging && (
          <BoardCard task={dragging} canEdit onSetDue={onSetDue} isOverlay />
        )}
      </DragOverlay>
    </DndContext>
  );
}

function TaskColumn({
  column,
  canEdit,
  onSetDue,
  onAdd,
}: {
  column: Column;
  canEdit: (task: HubTask) => boolean;
  onSetDue: (task: HubTask, dueDate: Date | null) => void;
  onAdd?: (stage: OpenStage) => void;
}) {
  // "Other" holds renamed lists; there is no single list to move a task into.
  const { setNodeRef, isOver } = useDroppable({
    id: column.stage,
    disabled: column.stage === "other",
  });
  const limited = column.total > column.tasks.length;
  const stage = column.stage;

  return (
    <section
      ref={setNodeRef}
      className={twMerge(
        "flex min-w-[15rem] flex-1 basis-0 flex-col rounded-xl bg-light-100 p-2 transition-colors dark:bg-dark-100",
        isOver &&
          "bg-light-200 ring-1 ring-light-600 dark:bg-dark-200 dark:ring-dark-600",
      )}
    >
      <h2 className="flex items-center justify-between px-2 py-1.5 text-sm font-semibold text-light-1000 dark:text-dark-1000">
        {stageTitle(stage)}
        <span className="flex items-center gap-1">
          <span className="text-xs font-normal tabular-nums text-light-900 dark:text-dark-900">
            {column.total}
          </span>
          {onAdd && stage !== "other" && (
            <button
              type="button"
              title={text.newTaskIn(stageTitle(stage))}
              aria-label={text.newTaskIn(stageTitle(stage))}
              className="rounded p-0.5 text-light-900 hover:bg-light-300 hover:text-light-1000 dark:text-dark-900 dark:hover:bg-dark-300"
              onClick={() => onAdd(stage)}
            >
              <TbPlus className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </span>
      </h2>
      {limited && (
        <p className="px-2 pb-1 text-xs text-light-900 dark:text-dark-900">
          {text.doneLimited(column.tasks.length, column.total)}
        </p>
      )}
      <div className="mt-1 min-h-0 flex-1 space-y-2 overflow-y-auto">
        {column.tasks.length === 0 ? (
          <p className="px-2 py-3 text-xs text-light-800 dark:text-dark-800">
            {text.emptyColumn}
          </p>
        ) : (
          column.tasks.map((task) => (
            <BoardCard
              key={task.publicId}
              task={task}
              canEdit={canEdit(task)}
              onSetDue={onSetDue}
            />
          ))
        )}
      </div>
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Card className="max-w-xl">
      <p className="text-sm text-light-1000 dark:text-dark-1000">{children}</p>
    </Card>
  );
}

function ColumnsSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden" aria-busy="true">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="h-80 w-72 shrink-0 animate-pulse rounded-xl bg-light-200 dark:bg-dark-200"
        />
      ))}
    </div>
  );
}
