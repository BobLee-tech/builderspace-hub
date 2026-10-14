import type { HubStructure } from "./types";

/**
 * How BuilderSpace organises its work in the Hub.
 *
 *   project (workspace)  →  function (board)  →  task (card)
 *
 * Edit this file and re-run `pnpm --filter @kan/builderspace seed` to add
 * projects, functions or starter tasks. The seed only ever adds what is
 * missing; it never renames, moves or deletes anything already in the Hub.
 */
export const hubStructure: HubStructure = {
  lists: ["待办", "进行中", "待验收", "已完成"],
  labels: ["P0", "P1", "P2", "卡住"],
  functions: [
    { key: "dev", name: "开发" },
    { key: "ops", name: "运营" },
    { key: "marketing", name: "营销" },
  ],
  projects: [
    {
      key: "community",
      name: "社群",
      slug: "bss-community",
      description: "BuilderSpace Soc 社群：拉新、活动、官网、社团申请。",
    },
    {
      key: "coursemate",
      name: "CourseMate",
      slug: "bss-coursemate",
      description: "团队第一款官方产品。",
    },
    {
      key: "echoagent",
      name: "EchoAgent",
      slug: "bss-echoagent",
    },
  ],
  // Deliberately empty. Starter tasks are real, internal work items, and this
  // repository is public: keep them in a private file and pass it to the seed
  // with HUB_TASKS_FILE (see tasks.example.json).
  tasks: [],
};
