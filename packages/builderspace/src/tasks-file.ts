import { z } from "zod";

import type { TaskDef } from "./types";

const taskSchema = z
  .object({
    project: z.string(),
    function: z.string(),
    title: z.string(),
    description: z.string().optional(),
    labels: z.array(z.string()).optional(),
  })
  .strict();

/**
 * Parses a private tasks file: a JSON array of tasks in the same shape as
 * `HubStructure.tasks`. Whether the tasks point at real projects, functions
 * and labels is checked later, together with the rest of the structure.
 *
 * @param label how to refer to the file in error messages
 */
export function parseTasksFile(text: string, label: string): TaskDef[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`${label} 不是合法的 JSON`);
  }

  if (!Array.isArray(data)) {
    throw new Error(`${label} 的内容应该是一个任务数组`);
  }

  return data.map((item, index) => {
    const parsed = taskSchema.safeParse(item);
    if (parsed.success) return parsed.data;

    const where = `${label} 第 ${index + 1} 个任务`;
    const issue = parsed.error.issues[0];
    if (issue?.code === "unrecognized_keys") {
      throw new Error(`${where}有未知字段 "${issue.keys[0]}"`);
    }
    const field = issue?.path.join(".");
    throw new Error(
      field ? `${where}的 ${field} 不正确` : `${where}格式不正确`,
    );
  });
}
