import type { HubStructure } from "./types";

// Limits enforced by the Hub API (packages/api/src/routers).
const WORKSPACE_NAME_MAX = 64;
const WORKSPACE_SLUG_MIN = 3;
const WORKSPACE_SLUG_MAX = 64;
const WORKSPACE_SLUG_PATTERN = /^(?![-]+$)[a-zA-Z0-9-]+$/;
const BOARD_NAME_MAX = 100;
const LABEL_NAME_MAX = 36;
const CARD_TITLE_MAX = 2000;

const duplicates = (values: string[]): string[] => [
  ...new Set(values.filter((value, index) => values.indexOf(value) !== index)),
];

const isValidSlug = (slug: string): boolean =>
  slug.length >= WORKSPACE_SLUG_MIN &&
  slug.length <= WORKSPACE_SLUG_MAX &&
  WORKSPACE_SLUG_PATTERN.test(slug);

const preview = (title: string): string =>
  title.length > 20 ? `${title.slice(0, 20)}…` : title;

/**
 * Checks a structure against the Hub API's limits before anything is sent,
 * so a typo fails up front instead of leaving the Hub half seeded.
 * Returns human-readable problems; an empty array means valid.
 */
export function validateStructure(structure: HubStructure): string[] {
  const { lists, labels, functions, projects, tasks } = structure;
  const errors: string[] = [];

  if (lists.length === 0) errors.push("至少需要一个看板列");
  if (projects.length === 0) errors.push("至少需要一个项目");
  if (functions.length === 0) errors.push("至少需要一个职能");
  if (lists.some((name) => name.trim() === ""))
    errors.push("看板列名称不能为空");

  for (const label of labels) {
    if (label.length > LABEL_NAME_MAX)
      errors.push(`标签 "${label}" 超过 ${LABEL_NAME_MAX} 个字符`);
  }

  for (const key of duplicates(projects.map((p) => p.key)))
    errors.push(`重复的项目 key: "${key}"`);
  for (const slug of duplicates(projects.map((p) => p.slug)))
    errors.push(`重复的项目 slug: "${slug}"`);
  for (const key of duplicates(functions.map((f) => f.key)))
    errors.push(`重复的职能 key: "${key}"`);
  for (const name of duplicates(
    functions.flatMap((f) => [f.name, ...(f.formerNames ?? [])]),
  ))
    errors.push(`重复的职能名称: "${name}"`);

  for (const project of projects) {
    if (!isValidSlug(project.slug))
      errors.push(`项目 "${project.key}" 的 slug 不合法: "${project.slug}"`);
    if (project.name.trim() === "" || project.name.length > WORKSPACE_NAME_MAX)
      errors.push(
        `项目 "${project.key}" 的名称超过 ${WORKSPACE_NAME_MAX} 个字符`,
      );
  }

  for (const fn of functions) {
    if (fn.name.trim() === "" || fn.name.length > BOARD_NAME_MAX)
      errors.push(`职能 "${fn.key}" 的名称超过 ${BOARD_NAME_MAX} 个字符`);
  }

  const seenTasks = new Set<string>();

  for (const task of tasks) {
    if (task.title.trim() === "") {
      errors.push("任务标题不能为空");
      continue;
    }

    const name = `任务 "${preview(task.title)}"`;
    const project = projects.find((p) => p.key === task.project);
    const fn = functions.find((f) => f.key === task.function);

    if (task.title.length > CARD_TITLE_MAX)
      errors.push(`${name} 的标题超过 ${CARD_TITLE_MAX} 个字符`);
    if (!project) errors.push(`${name} 指向不存在的项目 "${task.project}"`);
    if (!fn) errors.push(`${name} 指向不存在的职能 "${task.function}"`);

    for (const label of task.labels ?? []) {
      if (!labels.includes(label))
        errors.push(`${name} 使用了未定义的标签 "${label}"`);
    }

    if (project && fn) {
      const id = `${project.key}\n${fn.key}\n${task.title}`;
      if (seenTasks.has(id))
        errors.push(`${name} 在 ${project.name} / ${fn.name} 中重复`);
      seenTasks.add(id);
    }
  }

  return errors;
}
