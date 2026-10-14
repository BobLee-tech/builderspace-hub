import { describe, expect, it } from "vitest";

import { parseTasksFile } from "./tasks-file";

describe("parseTasksFile", () => {
  it("reads a list of tasks", () => {
    const text = JSON.stringify([
      {
        project: "community",
        function: "ops",
        title: "社群运营分工",
        description: "第一行\n第二行",
        labels: ["P0"],
      },
      { project: "coursemate", function: "dev", title: "完整上线" },
    ]);

    expect(parseTasksFile(text, "tasks.local.json")).toEqual([
      {
        project: "community",
        function: "ops",
        title: "社群运营分工",
        description: "第一行\n第二行",
        labels: ["P0"],
      },
      { project: "coursemate", function: "dev", title: "完整上线" },
    ]);
  });

  it("accepts an empty list", () => {
    expect(parseTasksFile("[]", "tasks.local.json")).toEqual([]);
  });

  it("rejects text that is not JSON", () => {
    expect(() => parseTasksFile("{ nope", "tasks.local.json")).toThrow(
      "tasks.local.json 不是合法的 JSON",
    );
  });

  it("rejects anything other than a list", () => {
    expect(() => parseTasksFile('{"tasks": []}', "tasks.local.json")).toThrow(
      "tasks.local.json 的内容应该是一个任务数组",
    );
  });

  it("points at the task and field that is wrong", () => {
    const text = JSON.stringify([
      { project: "community", function: "ops", title: "ok" },
      { project: "community", function: "ops" },
    ]);

    expect(() => parseTasksFile(text, "tasks.local.json")).toThrow(
      "tasks.local.json 第 2 个任务的 title 不正确",
    );
  });

  it("rejects misspelled fields instead of silently dropping them", () => {
    const text = JSON.stringify([
      { project: "community", function: "ops", title: "x", lables: ["P0"] },
    ]);

    expect(() => parseTasksFile(text, "tasks.local.json")).toThrow(
      'tasks.local.json 第 1 个任务有未知字段 "lables"',
    );
  });
});
