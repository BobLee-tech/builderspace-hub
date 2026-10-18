import type {
  BoardSummary,
  HubClient,
  HubStructure,
  SeedReport,
  TaskDef,
  WorkspaceSummary,
} from "./types";
import { validateStructure } from "./validate";

export interface SeedOptions {
  /** Report what would be created without changing the Hub. */
  dryRun?: boolean;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"]/g, (char) => HTML_ESCAPES[char] ?? char);

/** Card descriptions are stored as rich-text HTML: one paragraph per line. */
const toDescriptionHtml = (text: string | undefined): string =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");

const firstList = (board: BoardSummary) =>
  [...board.lists].sort((a, b) => a.index - b.index)[0];

/**
 * Brings the Hub in line with `structure`: one workspace per project, one
 * board per function, one card per starter task.
 *
 * Additive and idempotent. Workspaces are matched by slug, boards by name and
 * cards by title, so it is safe to re-run after editing the structure, and it
 * never renames, moves or deletes what people have changed in the Hub.
 */
export async function seedHub(
  client: HubClient,
  structure: HubStructure,
  options: SeedOptions = {},
): Promise<SeedReport> {
  const errors = validateStructure(structure);
  if (errors.length > 0) {
    throw new Error(`结构配置有问题，未做任何改动:\n- ${errors.join("\n- ")}`);
  }

  const dryRun = options.dryRun ?? false;
  const report: SeedReport = {
    dryRun,
    workspaces: { created: [], existing: [] },
    boards: { created: [], existing: [] },
    cards: { created: [], existing: [] },
    warnings: [],
  };

  const workspaces = await client.listWorkspaces();

  for (const project of structure.projects) {
    let workspace: WorkspaceSummary | undefined = workspaces.find(
      (w) => w.slug === project.slug,
    );

    if (workspace) {
      report.workspaces.existing.push(project.name);
    } else {
      report.workspaces.created.push(project.name);
      if (!dryRun) {
        workspace = await client.createWorkspace({
          name: project.name,
          slug: project.slug,
          ...(project.description && { description: project.description }),
        });
      }
    }

    const boards = workspace ? await client.listBoards(workspace.publicId) : [];

    for (const fn of structure.functions) {
      const boardName = `${project.name} / ${fn.name}`;
      const tasks = structure.tasks.filter(
        (t) => t.project === project.key && t.function === fn.key,
      );
      const names = [fn.name, ...(fn.formerNames ?? [])];
      let board = boards.find((b) => names.includes(b.name));

      if (board) {
        report.boards.existing.push(boardName);
      } else {
        report.boards.created.push(boardName);
        if (workspace && !dryRun) {
          const created = await client.createBoard(workspace.publicId, {
            name: fn.name,
            lists: structure.lists,
            labels: structure.labels,
          });
          // The create response has no list/label ids; cards need them.
          board = (await client.listBoards(workspace.publicId)).find(
            (b) => b.publicId === created.publicId,
          );
        }
      }

      if (!board) {
        // Dry run on a board that does not exist yet: everything is new.
        report.cards.created.push(
          ...tasks.map((t) => `${boardName} / ${t.title}`),
        );
        continue;
      }

      await seedCards(client, board, boardName, tasks, dryRun, report);
    }
  }

  return report;
}

async function seedCards(
  client: HubClient,
  board: BoardSummary,
  boardName: string,
  tasks: TaskDef[],
  dryRun: boolean,
  report: SeedReport,
): Promise<void> {
  if (tasks.length === 0) return;

  const list = firstList(board);
  if (!list) {
    report.warnings.push(
      `${boardName} 没有任何列，跳过 ${tasks.length} 个任务`,
    );
    return;
  }

  const existingTitles = new Set(await client.listCardTitles(board.publicId));

  for (const task of tasks) {
    const cardName = `${boardName} / ${task.title}`;

    if (existingTitles.has(task.title)) {
      report.cards.existing.push(cardName);
      continue;
    }

    const labelPublicIds: string[] = [];
    for (const labelName of task.labels ?? []) {
      const label = board.labels.find((l) => l.name === labelName);
      if (label) labelPublicIds.push(label.publicId);
      else report.warnings.push(`${boardName} 缺少标签 "${labelName}"`);
    }

    report.cards.created.push(cardName);
    if (!dryRun) {
      await client.createCard({
        title: task.title,
        description: toDescriptionHtml(task.description),
        listPublicId: list.publicId,
        labelPublicIds,
      });
    }
  }
}
