import { describe, expect, it } from "vitest";

import type {
  BoardSummary,
  HubClient,
  HubStructure,
  WorkspaceSummary,
} from "./types";
import { seedHub } from "./seed";

const structure = (): HubStructure => ({
  lists: ["待办", "进行中", "已完成"],
  labels: ["P0", "P1"],
  functions: [
    { key: "dev", name: "开发" },
    { key: "ops", name: "运营" },
  ],
  projects: [
    { key: "community", name: "社群", slug: "bss-community" },
    { key: "coursemate", name: "CourseMate", slug: "bss-coursemate" },
  ],
  tasks: [
    {
      project: "community",
      function: "dev",
      title: "官网初版",
      description: "加入入口\n活动 & <项目>",
      labels: ["P0"],
    },
    { project: "coursemate", function: "dev", title: "完整上线" },
  ],
});

const must = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("expected a value");
  return value;
};

interface FakeCard {
  title: string;
  description: string;
  listPublicId: string;
  labelPublicIds: string[];
}

/** In-memory stand-in for the Hub REST API that records every mutation. */
const createFakeClient = () => {
  let nextId = 1;
  const id = (prefix: string) =>
    `${prefix}${String(nextId++).padStart(10, "0")}`;

  const workspaces: WorkspaceSummary[] = [];
  const boards = new Map<string, BoardSummary[]>();
  const cards = new Map<string, FakeCard[]>();
  const mutations: string[] = [];

  const client: HubClient = {
    listWorkspaces: () => Promise.resolve([...workspaces]),
    createWorkspace: (input) => {
      mutations.push(`workspace:${input.slug}`);
      const ws = { publicId: id("ws"), name: input.name, slug: input.slug };
      workspaces.push(ws);
      boards.set(ws.publicId, []);
      return Promise.resolve(ws);
    },
    listBoards: (workspacePublicId) =>
      Promise.resolve([...(boards.get(workspacePublicId) ?? [])]),
    createBoard: (workspacePublicId, input) => {
      mutations.push(`board:${input.name}`);
      const board: BoardSummary = {
        publicId: id("bd"),
        name: input.name,
        lists: input.lists.map((name, index) => ({
          publicId: id("ls"),
          name,
          index,
        })),
        labels: input.labels.map((name) => ({ publicId: id("lb"), name })),
      };
      boards.get(workspacePublicId)?.push(board);
      cards.set(board.publicId, []);
      return Promise.resolve({ publicId: board.publicId, name: board.name });
    },
    listCardTitles: (boardPublicId) =>
      Promise.resolve((cards.get(boardPublicId) ?? []).map((c) => c.title)),
    createCard: (input) => {
      mutations.push(`card:${input.title}`);
      for (const list of boards.values()) {
        for (const board of list) {
          if (board.lists.some((l) => l.publicId === input.listPublicId)) {
            cards.get(board.publicId)?.push(input);
          }
        }
      }
      return Promise.resolve({ publicId: id("cd") });
    },
  };

  return { client, workspaces, boards, cards, mutations };
};

describe("seedHub", () => {
  it("builds every project × function board on an empty Hub", async () => {
    const fake = createFakeClient();

    const report = await seedHub(fake.client, structure());

    expect(report.workspaces.created).toEqual(["社群", "CourseMate"]);
    expect(report.boards.created).toEqual([
      "社群 / 开发",
      "社群 / 运营",
      "CourseMate / 开发",
      "CourseMate / 运营",
    ]);
    expect(report.cards.created).toEqual([
      "社群 / 开发 / 官网初版",
      "CourseMate / 开发 / 完整上线",
    ]);
    expect(fake.workspaces.map((w) => w.slug)).toEqual([
      "bss-community",
      "bss-coursemate",
    ]);
  });

  it("gives every board the shared lists and labels", async () => {
    const fake = createFakeClient();

    await seedHub(fake.client, structure());

    for (const list of fake.boards.values()) {
      for (const board of list) {
        expect(board.lists.map((l) => l.name)).toEqual([
          "待办",
          "进行中",
          "已完成",
        ]);
        expect(board.labels.map((l) => l.name)).toEqual(["P0", "P1"]);
      }
    }
  });

  it("files each task in the first list of its board with its labels", async () => {
    const fake = createFakeClient();

    await seedHub(fake.client, structure());

    const community = must(
      fake.workspaces.find((w) => w.slug === "bss-community"),
    );
    const devBoard = must(
      must(fake.boards.get(community.publicId)).find((b) => b.name === "开发"),
    );
    const [card] = must(fake.cards.get(devBoard.publicId));

    expect(card?.title).toBe("官网初版");
    expect(card?.listPublicId).toBe(devBoard.lists[0]?.publicId);
    expect(card?.labelPublicIds).toEqual([
      devBoard.labels.find((l) => l.name === "P0")?.publicId,
    ]);
  });

  it("stores descriptions as escaped HTML paragraphs", async () => {
    const fake = createFakeClient();

    await seedHub(fake.client, structure());

    const all = [...fake.cards.values()].flat();
    expect(all.find((c) => c.title === "官网初版")?.description).toBe(
      "<p>加入入口</p><p>活动 &amp; &lt;项目&gt;</p>",
    );
    expect(all.find((c) => c.title === "完整上线")?.description).toBe("");
  });

  it("is idempotent: a second run creates nothing", async () => {
    const fake = createFakeClient();
    await seedHub(fake.client, structure());
    const before = fake.mutations.length;

    const report = await seedHub(fake.client, structure());

    expect(fake.mutations.length).toBe(before);
    expect(report.workspaces.created).toEqual([]);
    expect(report.boards.created).toEqual([]);
    expect(report.cards.created).toEqual([]);
    expect(report.workspaces.existing).toEqual(["社群", "CourseMate"]);
    expect(report.boards.existing).toHaveLength(4);
    expect(report.cards.existing).toHaveLength(2);
  });

  it("only fills the gaps when the Hub is partly set up", async () => {
    const fake = createFakeClient();
    const ws = await fake.client.createWorkspace({
      name: "社群（已改名）",
      slug: "bss-community",
    });
    await fake.client.createBoard(ws.publicId, {
      name: "开发",
      lists: ["待办"],
      labels: [],
    });
    fake.mutations.length = 0;

    const report = await seedHub(fake.client, structure());

    expect(report.workspaces.existing).toEqual(["社群"]);
    expect(report.workspaces.created).toEqual(["CourseMate"]);
    expect(report.boards.existing).toEqual(["社群 / 开发"]);
    expect(fake.mutations).not.toContain("workspace:bss-community");
    expect(fake.mutations.filter((m) => m === "board:开发")).toHaveLength(1);
  });

  it("skips labels a pre-existing board does not have instead of failing", async () => {
    const fake = createFakeClient();
    const ws = await fake.client.createWorkspace({
      name: "社群",
      slug: "bss-community",
    });
    const board = await fake.client.createBoard(ws.publicId, {
      name: "开发",
      lists: ["Backlog"],
      labels: [],
    });

    await seedHub(fake.client, structure());

    const [card] = must(fake.cards.get(board.publicId));
    expect(card?.title).toBe("官网初版");
    expect(card?.labelPublicIds).toEqual([]);
  });

  it("reports a board with no lists instead of creating orphan cards", async () => {
    const fake = createFakeClient();
    const ws = await fake.client.createWorkspace({
      name: "社群",
      slug: "bss-community",
    });
    await fake.client.createBoard(ws.publicId, {
      name: "开发",
      lists: [],
      labels: [],
    });

    const report = await seedHub(fake.client, structure());

    expect(report.warnings).toContain("社群 / 开发 没有任何列，跳过 1 个任务");
    expect(report.cards.created).toEqual(["CourseMate / 开发 / 完整上线"]);
  });

  it("dry run reports the plan without changing anything", async () => {
    const fake = createFakeClient();

    const report = await seedHub(fake.client, structure(), { dryRun: true });

    expect(fake.mutations).toEqual([]);
    expect(report.dryRun).toBe(true);
    expect(report.workspaces.created).toEqual(["社群", "CourseMate"]);
    expect(report.boards.created).toHaveLength(4);
    expect(report.cards.created).toHaveLength(2);
  });

  it("dry run on a partly set up Hub still reads existing state", async () => {
    const fake = createFakeClient();
    await seedHub(fake.client, structure());
    const extended = structure();
    extended.tasks.push({
      project: "community",
      function: "ops",
      title: "社群运营分工",
    });
    fake.mutations.length = 0;

    const report = await seedHub(fake.client, extended, { dryRun: true });

    expect(fake.mutations).toEqual([]);
    expect(report.cards.created).toEqual(["社群 / 运营 / 社群运营分工"]);
    expect(report.cards.existing).toHaveLength(2);
  });

  it("refuses to touch the Hub when the structure is invalid", async () => {
    const fake = createFakeClient();
    const broken = structure();
    broken.tasks.push({ project: "nope", function: "dev", title: "x" });

    await expect(seedHub(fake.client, broken)).rejects.toThrow(
      '任务 "x" 指向不存在的项目 "nope"',
    );
    expect(fake.mutations).toEqual([]);
  });
});
