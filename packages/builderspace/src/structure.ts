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
  // Named after the club's three departments; the former names keep boards
  // that have not been renamed yet working. 运营 used to be the ops board's
  // name and is now marketing's, so it cannot also be a former name of ops:
  // every 运营 board was renamed to 活动 before this shipped.
  functions: [
    { key: "dev", name: "技术", formerNames: ["开发"] },
    { key: "ops", name: "活动" },
    { key: "marketing", name: "运营", formerNames: ["营销"] },
  ],
  // Listed in the order the team wants them shown.
  projects: [
    {
      key: "coursemate",
      name: "CourseMate",
      slug: "bss-coursemate",
      description: "团队第一款官方产品。",
    },
    {
      key: "community",
      name: "BuilderSpace 社团",
      slug: "bss-community",
      description: "BuilderSpace 社团：拉新、活动、官网、社团申请。",
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
