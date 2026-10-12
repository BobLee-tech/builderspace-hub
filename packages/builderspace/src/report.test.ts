import { describe, expect, it } from "vitest";

import type { SeedReport } from "./types";
import { formatReport } from "./report";

const report = (overrides: Partial<SeedReport> = {}): SeedReport => ({
  dryRun: false,
  workspaces: { created: ["社群"], existing: ["CourseMate"] },
  boards: { created: ["社群 / 开发", "社群 / 运营"], existing: [] },
  cards: { created: ["社群 / 开发 / 官网初版"], existing: [] },
  warnings: [],
  ...overrides,
});

describe("formatReport", () => {
  it("lists what was created and counts what already existed", () => {
    expect(formatReport(report())).toBe(
      [
        "已创建：",
        "  项目 1 个（已存在 1 个）",
        "    + 社群",
        "  看板 2 个（已存在 0 个）",
        "    + 社群 / 开发",
        "    + 社群 / 运营",
        "  任务 1 个（已存在 0 个）",
        "    + 社群 / 开发 / 官网初版",
      ].join("\n"),
    );
  });

  it("makes clear that a dry run changed nothing", () => {
    expect(formatReport(report({ dryRun: true }))).toContain(
      "预演（未做任何改动），将会创建：",
    );
  });

  it("says so when the Hub is already up to date", () => {
    const upToDate = report({
      workspaces: { created: [], existing: ["社群"] },
      boards: { created: [], existing: ["社群 / 开发"] },
      cards: { created: [], existing: [] },
    });
    expect(formatReport(upToDate)).toBe(
      "Hub 已是最新，无需改动（项目 1 个、看板 1 个、任务 0 个均已存在）。",
    );
  });

  it("appends warnings", () => {
    const text = formatReport(
      report({ warnings: ["社群 / 开发 没有任何列，跳过 1 个任务"] }),
    );
    expect(
      text.endsWith("注意：\n  ! 社群 / 开发 没有任何列，跳过 1 个任务"),
    ).toBe(true);
  });
});
