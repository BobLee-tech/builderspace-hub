import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
  boards,
  labels,
  lists,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import type { Db } from "../db";
import type { StandardStructure } from "./structure.service";
import { listAudit } from "../audit";
import { createHubTestDb, seedUser } from "../testing/test-db";
import { ensureStandardProjects } from "./structure.service";

const structure: StandardStructure = {
  lists: ["待办", "进行中", "已完成"],
  labels: ["P0", "P1"],
  functions: [
    { key: "dev", name: "开发" },
    { key: "ops", name: "运营" },
  ],
  projects: [
    {
      key: "community",
      name: "社群",
      slug: "bss-community",
      description: "社群",
    },
    { key: "coursemate", name: "CourseMate", slug: "bss-coursemate" },
  ],
};

let db: Db;
let owner: { id: string; email: string };

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
});

const run = (ownerEmail = "owner@example.test") =>
  ensureStandardProjects(db, { ownerEmail, structure });

describe("ensureStandardProjects", () => {
  it("creates every project with one board per function", async () => {
    const report = await run();

    expect(report).toEqual({
      projectsCreated: ["社群", "CourseMate"],
      projectsExisting: [],
      boardsCreated: [
        "社群 / 开发",
        "社群 / 运营",
        "CourseMate / 开发",
        "CourseMate / 运营",
      ],
      boardsExisting: [],
    });

    const projectRows = await db
      .select({ slug: workspaces.slug, description: workspaces.description })
      .from(workspaces);
    expect(projectRows).toEqual([
      { slug: "bss-community", description: "社群" },
      { slug: "bss-coursemate", description: null },
    ]);
  });

  it("makes the owner an admin of each project", async () => {
    await run();

    const memberships = await db
      .select({ role: workspaceMembers.role, status: workspaceMembers.status })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, owner.id));
    expect(memberships).toEqual([
      { role: "admin", status: "active" },
      { role: "admin", status: "active" },
    ]);
  });

  it("gives every board the standard lists, in order, and labels", async () => {
    await run();

    const [board] = await db
      .select({ id: boards.id, slug: boards.slug })
      .from(boards)
      .where(eq(boards.name, "开发"))
      .limit(1);
    expect(board?.slug).toBe("dev");

    const boardLists = await db
      .select({ name: lists.name, index: lists.index })
      .from(lists)
      .where(eq(lists.boardId, board?.id ?? -1))
      .orderBy(lists.index);
    expect(boardLists).toEqual([
      { name: "待办", index: 0 },
      { name: "进行中", index: 1 },
      { name: "已完成", index: 2 },
    ]);

    const boardLabels = await db
      .select({ name: labels.name })
      .from(labels)
      .where(eq(labels.boardId, board?.id ?? -1));
    expect(boardLabels.map((l) => l.name)).toEqual(["P0", "P1"]);
  });

  it("only fills in what is missing on a second run", async () => {
    await run();
    const report = await run();

    expect(report.projectsCreated).toEqual([]);
    expect(report.boardsCreated).toEqual([]);
    expect(report.projectsExisting).toEqual(["社群", "CourseMate"]);
    expect(report.boardsExisting).toHaveLength(4);
    expect(await db.select().from(boards)).toHaveLength(4);
  });

  it("logs each project and board it creates, as the command line", async () => {
    await run();

    const entries = await listAudit(db, { limit: 50, offset: 0 });
    expect(entries.filter((e) => e.action === "project.created")).toHaveLength(
      2,
    );
    expect(entries.filter((e) => e.action === "board.created")).toHaveLength(4);
    expect(entries.every((e) => e.actorEmail === "cli")).toBe(true);
  });

  it("refuses an owner without an account and creates nothing", async () => {
    await expect(run("ghost@example.test")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await db.select().from(workspaces)).toEqual([]);
  });
});
