import type { SeedReport, SeedTally } from "./types";

const section = (label: string, tally: SeedTally): string[] => [
  `  ${label} ${tally.created.length} 个（已存在 ${tally.existing.length} 个）`,
  ...tally.created.map((name) => `    + ${name}`),
];

/** Renders a seed report for the terminal. */
export function formatReport(report: SeedReport): string {
  const { workspaces, boards, cards, warnings } = report;
  const lines: string[] = [];

  const createdCount =
    workspaces.created.length + boards.created.length + cards.created.length;

  if (createdCount === 0) {
    lines.push(
      `Hub 已是最新，无需改动（项目 ${workspaces.existing.length} 个、看板 ${boards.existing.length} 个、任务 ${cards.existing.length} 个均已存在）。`,
    );
  } else {
    lines.push(
      report.dryRun ? "预演（未做任何改动），将会创建：" : "已创建：",
      ...section("项目", workspaces),
      ...section("看板", boards),
      ...section("任务", cards),
    );
  }

  if (warnings.length > 0) {
    lines.push("注意：", ...warnings.map((warning) => `  ! ${warning}`));
  }

  return lines.join("\n");
}
