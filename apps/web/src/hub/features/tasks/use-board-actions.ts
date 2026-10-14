import { useState } from "react";

import type { Stage, TaskView } from "@kan/hub/public";
import { stageNames } from "@kan/hub/public";

import type { HubTask } from "./task-display";
import type { RouterOutputs } from "~/utils/api";
import { copy } from "~/hub/copy/zh";
import { withTaskDue, withTaskMoved } from "~/hub/lib/board-cache";
import { api } from "~/utils/api";

type Board = RouterOutputs["hub"]["tasks"]["board"];

const text = copy.tasks;

export interface NewTask {
  title: string;
  boardPublicId: string;
  stage: Exclude<Stage, "other">;
  dueDate: Date | null;
  assignToMe: boolean;
}

/**
 * Everything the overall board can change, written through Kan's own card
 * API: the card is the same one its board shows, Kan checks the permission
 * and records the activity. The board updates at once and is refreshed from
 * the server afterwards, as is the home page.
 */
export function useBoardActions(
  board: Board | undefined,
  query: { view: TaskView; project?: string },
) {
  const utils = api.useUtils();
  const updateCard = api.card.update.useMutation();
  const createCard = api.card.create.useMutation();
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    Promise.all([
      utils.hub.tasks.board.invalidate(),
      utils.hub.tasks.home.invalidate(),
    ]);

  const targetOf = (boardPublicId: string) =>
    board?.boards.find((candidate) => candidate.publicId === boardPublicId);

  async function move(task: HubTask, to: Stage): Promise<void> {
    if (to === task.stage || to === "other") return;
    const target = targetOf(task.board.publicId);
    const listPublicId = target?.listsByStage[to];
    if (!listPublicId) {
      setError(text.move.noList(task.board.name, stageNames[to]));
      return;
    }

    setError(null);
    utils.hub.tasks.board.setData(query, (old) =>
      old ? withTaskMoved(old, task.publicId, to, stageNames[to]) : old,
    );
    try {
      await updateCard.mutateAsync({
        cardPublicId: task.publicId,
        listPublicId,
      });
    } catch {
      setError(text.move.failed);
    } finally {
      void refresh();
    }
  }

  async function setDue(task: HubTask, dueDate: Date | null): Promise<void> {
    setError(null);
    utils.hub.tasks.board.setData(query, (old) =>
      old ? withTaskDue(old, task.publicId, dueDate) : old,
    );
    try {
      await updateCard.mutateAsync({ cardPublicId: task.publicId, dueDate });
    } catch {
      setError(text.dueFailed);
    } finally {
      void refresh();
    }
  }

  async function create(input: NewTask): Promise<boolean> {
    const target = targetOf(input.boardPublicId);
    const listPublicId = target?.listsByStage[input.stage];
    if (!target || !listPublicId) {
      setError(text.move.noList(target?.name ?? "", stageNames[input.stage]));
      return false;
    }
    const access = board?.access[target.project.publicId];

    setError(null);
    try {
      await createCard.mutateAsync({
        title: input.title,
        description: "",
        listPublicId,
        labelPublicIds: [],
        memberPublicIds:
          input.assignToMe && access ? [access.memberPublicId] : [],
        position: "end",
        dueDate: input.dueDate,
      });
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      void refresh();
    }
  }

  return {
    move,
    setDue,
    create,
    isCreating: createCard.isPending,
    error,
    clearError: () => setError(null),
  };
}
