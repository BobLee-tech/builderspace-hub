import { describe, expect, it } from "vitest";

import type { HubStructure } from "./types";
import { hubStructure } from "./structure";
import { validateStructure } from "./validate";

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a value");
  return value;
};

const base = (): HubStructure => ({
  lists: ["待办", "进行中"],
  labels: ["P0"],
  functions: [{ key: "dev", name: "开发" }],
  projects: [{ key: "community", name: "社群", slug: "bss-community" }],
  tasks: [
    {
      project: "community",
      function: "dev",
      title: "官网初版",
      labels: ["P0"],
    },
  ],
});

describe("hubStructure (the real BuilderSpace config)", () => {
  it("is valid", () => {
    expect(validateStructure(hubStructure)).toEqual([]);
  });

  it("has the three projects, each split into the three functions", () => {
    expect(hubStructure.projects.map((p) => p.name)).toEqual([
      "CourseMate",
      "BuilderSpace 社团",
      "EchoAgent",
    ]);
    expect(hubStructure.functions.map((f) => f.name)).toEqual([
      "技术",
      "活动",
      "运营",
    ]);
  });

  it("ships no starter tasks: internal work items stay out of the public repo", () => {
    expect(hubStructure.tasks).toEqual([]);
  });

  it("starts every board with a backlog list first", () => {
    expect(hubStructure.lists[0]).toBe("待办");
  });
});

describe("validateStructure", () => {
  it("accepts a minimal valid structure", () => {
    expect(validateStructure(base())).toEqual([]);
  });

  it("rejects duplicate project keys", () => {
    const s = base();
    s.projects.push({ key: "community", name: "另一个", slug: "bss-other" });
    expect(validateStructure(s)).toContain('重复的项目 key: "community"');
  });

  it("rejects duplicate project slugs", () => {
    const s = base();
    s.projects.push({ key: "other", name: "另一个", slug: "bss-community" });
    expect(validateStructure(s)).toContain('重复的项目 slug: "bss-community"');
  });

  it("rejects duplicate function keys and names", () => {
    const s = base();
    s.functions.push({ key: "dev", name: "开发" });
    const errors = validateStructure(s);
    expect(errors).toContain('重复的职能 key: "dev"');
    expect(errors).toContain('重复的职能名称: "开发"');
  });

  it("rejects a former function name that another function still uses", () => {
    const s = base();
    s.functions.push({ key: "ops", name: "运营", formerNames: ["开发"] });
    expect(validateStructure(s)).toContain('重复的职能名称: "开发"');
  });

  it("rejects slugs the Hub API would refuse", () => {
    for (const slug of ["ab", "has space", "---", "中文"]) {
      const s = base();
      must(s.projects[0]).slug = slug;
      expect(validateStructure(s)).toContain(
        `项目 "community" 的 slug 不合法: "${slug}"`,
      );
    }
  });

  it("rejects names longer than the Hub API limits", () => {
    const s = base();
    must(s.projects[0]).name = "x".repeat(65);
    must(s.functions[0]).name = "y".repeat(101);
    s.labels = ["z".repeat(37)];
    s.tasks = [];
    const errors = validateStructure(s);
    expect(errors).toContain('项目 "community" 的名称超过 64 个字符');
    expect(errors).toContain('职能 "dev" 的名称超过 100 个字符');
    expect(errors).toContain(`标签 "${"z".repeat(37)}" 超过 36 个字符`);
  });

  it("requires at least one list, project and function", () => {
    const s = base();
    s.lists = [];
    s.projects = [];
    s.functions = [];
    s.tasks = [];
    const errors = validateStructure(s);
    expect(errors).toContain("至少需要一个看板列");
    expect(errors).toContain("至少需要一个项目");
    expect(errors).toContain("至少需要一个职能");
  });

  it("rejects blank list names", () => {
    const s = base();
    s.lists = ["待办", "  "];
    expect(validateStructure(s)).toContain("看板列名称不能为空");
  });

  it("rejects tasks pointing at unknown projects, functions or labels", () => {
    const s = base();
    s.tasks = [
      { project: "nope", function: "dev", title: "a" },
      { project: "community", function: "nope", title: "b" },
      { project: "community", function: "dev", title: "c", labels: ["P9"] },
    ];
    const errors = validateStructure(s);
    expect(errors).toContain('任务 "a" 指向不存在的项目 "nope"');
    expect(errors).toContain('任务 "b" 指向不存在的职能 "nope"');
    expect(errors).toContain('任务 "c" 使用了未定义的标签 "P9"');
  });

  it("rejects empty or oversized task titles", () => {
    const s = base();
    s.tasks = [
      { project: "community", function: "dev", title: " " },
      { project: "community", function: "dev", title: "t".repeat(2001) },
    ];
    const errors = validateStructure(s);
    expect(errors).toContain("任务标题不能为空");
    expect(errors.some((e) => e.endsWith("的标题超过 2000 个字符"))).toBe(true);
  });

  it("rejects the same task title twice on one board", () => {
    const s = base();
    s.tasks.push({ project: "community", function: "dev", title: "官网初版" });
    expect(validateStructure(s)).toContain(
      '任务 "官网初版" 在 社群 / 开发 中重复',
    );
  });
});
