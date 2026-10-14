import { describe, expect, it } from "vitest";

import type { RouterOutputs } from "~/utils/api";
import { withTaskDue, withTaskMoved } from "./board-cache";

type Board = RouterOutputs["hub"]["tasks"]["board"];

const task = (publicId: string, stage: string) =>
  ({ publicId, stage, listName: "待办", dueDate: null }) as never;

const board = {
  columns: [
    { stage: "todo", tasks: [task("a", "todo"), task("b", "todo")], total: 2 },
    { stage: "doing", tasks: [], total: 0 },
  ],
} as unknown as Board;

describe("withTaskMoved", () => {
  it("moves a task to the top of another column and fixes the totals", () => {
    const after = withTaskMoved(board, "b", "doing", "进行中");

    expect(after.columns[0]?.tasks.map((t) => t.publicId)).toEqual(["a"]);
    expect(after.columns[0]?.total).toBe(1);
    expect(after.columns[1]?.tasks[0]).toMatchObject({
      publicId: "b",
      stage: "doing",
      listName: "进行中",
    });
    expect(after.columns[1]?.total).toBe(1);
  });

  it("leaves the board alone for an unknown task, the same column or a hidden column", () => {
    expect(withTaskMoved(board, "zz", "doing", "进行中")).toBe(board);
    expect(withTaskMoved(board, "a", "todo", "待办")).toBe(board);
    expect(withTaskMoved(board, "a", "done", "已完成")).toBe(board);
  });
});

describe("withTaskDue", () => {
  it("changes only that task's due date", () => {
    const due = new Date("2026-10-20T12:00:00Z");
    const after = withTaskDue(board, "a", due);

    expect(after.columns[0]?.tasks[0]?.dueDate).toBe(due);
    expect(after.columns[0]?.tasks[1]?.dueDate).toBeNull();
  });
});
