import { useState } from "react";

import type { Stage } from "@kan/hub/public";
import { functionNames, stageNames } from "@kan/hub/public";

import type { NewTask } from "./use-board-actions";
import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { colorOf, useFunctionColors } from "~/hub/lib/use-function-colors";
import {
  buttonClass,
  Card,
  ErrorText,
  inputClass,
} from "~/hub/ui/admin-primitives";

type Board = RouterOutputs["hub"]["tasks"]["board"];
type OpenStage = Exclude<Stage, "other">;

const text = copy.tasks.form;
const openStages: OpenStage[] = ["todo", "doing", "review", "done"];

/**
 * Adds a task from the overall board. It goes onto the chosen function's
 * board, in the chosen column, so it shows up there as well. Only boards the
 * person may create tasks on are offered.
 */
export function NewTaskForm({
  board,
  initialStage,
  onCreate,
  onClose,
  isPending,
}: {
  board: Board;
  initialStage: OpenStage;
  onCreate: (task: NewTask) => Promise<boolean>;
  onClose: () => void;
  isPending: boolean;
}) {
  const colors = useFunctionColors();
  const showProject = board.scope.current === null;
  const targets = board.boards.filter(
    (target) => board.access[target.project.publicId]?.canCreate,
  );

  const [title, setTitle] = useState("");
  const [boardPublicId, setBoardPublicId] = useState(
    targets[0]?.publicId ?? "",
  );
  const [stage, setStage] = useState<OpenStage>(initialStage);
  const [due, setDue] = useState("");
  const [assignToMe, setAssignToMe] = useState(true);
  const [problem, setProblem] = useState<string | null>(null);

  const target = targets.find((t) => t.publicId === boardPublicId);
  const stagesHere = openStages.filter((s) => target?.listsByStage[s]);

  const label = (t: (typeof targets)[number]) => {
    const where = t.functionKey ? functionNames[t.functionKey] : t.name;
    return showProject ? `${t.project.name} · ${where}` : where;
  };

  return (
    <Card className="mb-4">
      <form
        className="grid gap-3 md:grid-cols-[2fr_1fr_1fr_1fr_auto] md:items-end"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!title.trim()) {
            setProblem(text.titleRequired);
            return;
          }
          const [year, month, day] = due.split("-").map(Number);
          const created = await onCreate({
            title: title.trim(),
            boardPublicId,
            stage: stagesHere.includes(stage)
              ? stage
              : (stagesHere[0] ?? "todo"),
            dueDate:
              year && month && day
                ? new Date(year, month - 1, day, 23, 59)
                : null,
            assignToMe,
          });
          if (created) {
            setTitle("");
            setProblem(null);
          }
        }}
      >
        <label className="block text-xs text-light-900 dark:text-dark-900">
          {text.title}
          <input
            autoFocus
            className={`${inputClass} mt-1`}
            placeholder={text.titlePlaceholder}
            value={title}
            maxLength={2000}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="block text-xs text-light-900 dark:text-dark-900">
          <span className="flex items-center gap-1.5">
            {text.board}
            {target && (
              <span
                aria-hidden="true"
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: colorOf(colors, target.functionKey) }}
              />
            )}
          </span>
          <select
            className={`${inputClass} mt-1`}
            value={boardPublicId}
            onChange={(event) => setBoardPublicId(event.target.value)}
          >
            {targets.map((t) => (
              <option key={t.publicId} value={t.publicId}>
                {label(t)}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-light-900 dark:text-dark-900">
          {text.stage}
          <select
            className={`${inputClass} mt-1`}
            value={stagesHere.includes(stage) ? stage : stagesHere[0]}
            onChange={(event) => setStage(event.target.value as OpenStage)}
          >
            {stagesHere.map((s) => (
              <option key={s} value={s}>
                {stageNames[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs text-light-900 dark:text-dark-900">
          {text.due}
          <input
            type="date"
            className={`${inputClass} mt-1`}
            value={due}
            onChange={(event) => setDue(event.target.value)}
          />
        </label>
        <div className="flex items-center gap-2 md:pb-0.5">
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-light-1000 dark:text-dark-1000">
            <input
              type="checkbox"
              checked={assignToMe}
              onChange={(event) => setAssignToMe(event.target.checked)}
            />
            {text.assignMe}
          </label>
          <button
            type="submit"
            className={buttonClass.primary}
            disabled={isPending || !target}
          >
            {text.create}
          </button>
          <button type="button" className={buttonClass.ghost} onClick={onClose}>
            {text.cancel}
          </button>
        </div>
      </form>
      <ErrorText message={problem ?? undefined} />
    </Card>
  );
}
