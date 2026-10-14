import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as kanSchema from "@kan/db/schema";

import type { Db } from "../db";
import { ensureProjectMember } from "../kan/members.gateway";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import { ARCHIVE_LIST_LIMIT, ARCHIVE_MONTHS } from "./archive.policy";
import { getArchive } from "./archive.service";

const now = new Date("2026-10-14T00:00:00Z");
const at = (iso: string) => new Date(iso);

interface User {
  id: string;
  email: string;
}
interface Project {
  id: number;
  publicId: string;
  name: string;
}
interface Lists {
  todo: number;
  doing: number;
  done: number;
}

let db: Db;
let owner: User;
let me: User;
let colleague: User;
let coursemate: Project;
let uid = 0;
const nextId = () => `a${(uid += 1).toString().padStart(11, "0")}`;

async function seedBoard(project: Project, name: string): Promise<Lists> {
  const [board] = await db
    .insert(kanSchema.boards)
    .values({
      publicId: nextId(),
      name,
      slug: nextId(),
      workspaceId: project.id,
      createdBy: owner.id,
    })
    .returning({ id: kanSchema.boards.id });
  if (!board) throw new Error("no board");

  const ids: number[] = [];
  for (const [index, listName] of ["待办", "进行中", "已完成"].entries()) {
    const [list] = await db
      .insert(kanSchema.lists)
      .values({ publicId: nextId(), name: listName, index, boardId: board.id })
      .returning({ id: kanSchema.lists.id });
    if (!list) throw new Error("no list");
    ids.push(list.id);
  }
  const [todo = 0, doing = 0, done = 0] = ids;
  return { todo, doing, done };
}

async function memberIdOf(user: User, project: Project): Promise<number> {
  const [member] = await db
    .select({ id: kanSchema.workspaceMembers.id })
    .from(kanSchema.workspaceMembers)
    .where(
      and(
        eq(kanSchema.workspaceMembers.userId, user.id),
        eq(kanSchema.workspaceMembers.workspaceId, project.id),
      ),
    );
  if (!member) throw new Error("not a member");
  return member.id;
}

/** A card in `listId`, assigned as given, with an empty activity log. */
async function seedCard(
  project: Project,
  listId: number,
  title: string,
  options: { assignees?: User[]; createdAt?: Date } = {},
): Promise<number> {
  const [card] = await db
    .insert(kanSchema.cards)
    .values({
      publicId: nextId(),
      title,
      index: 0,
      listId,
      createdAt: options.createdAt ?? at("2026-01-01T00:00:00Z"),
    })
    .returning({ id: kanSchema.cards.id });
  if (!card) throw new Error("no card");
  for (const user of options.assignees ?? []) {
    await db.insert(kanSchema.cardToWorkspaceMembers).values({
      cardId: card.id,
      workspaceMemberId: await memberIdOf(user, project),
    });
  }
  return card.id;
}

/** Logs a move the way Kan's card.update does. */
async function logMove(
  cardId: number,
  toListId: number,
  by: User,
  iso: string,
): Promise<void> {
  await db.insert(kanSchema.cardActivities).values({
    publicId: nextId(),
    type: "card.updated.list",
    cardId,
    toListId,
    createdBy: by.id,
    createdAt: at(iso),
  });
}

async function logCreated(cardId: number, by: User, iso: string) {
  await db.insert(kanSchema.cardActivities).values({
    publicId: nextId(),
    type: "card.created",
    cardId,
    createdBy: by.id,
    createdAt: at(iso),
  });
}

async function moveCard(cardId: number, listId: number) {
  await db
    .update(kanSchema.cards)
    .set({ listId })
    .where(eq(kanSchema.cards.id, cardId));
}

/** A card that ends up in 已完成, moved there by `by` at `iso`. */
async function finish(
  project: Project,
  lists: Lists,
  title: string,
  by: User,
  iso: string,
  assignees: User[] = [],
) {
  const cardId = await seedCard(project, lists.done, title, { assignees });
  await logMove(cardId, lists.done, by, iso);
  return cardId;
}

const join = (user: User, project: Project) =>
  ensureProjectMember(db, {
    userId: user.id,
    email: user.email,
    workspaceId: project.id,
    role: "member",
    addedBy: owner.id,
  });

const archiveOf = (user: User, timeZone = "Australia/Sydney") =>
  getArchive(db, { userId: user.id, timeZone, now });

const titles = (archive: Awaited<ReturnType<typeof archiveOf>>) =>
  archive.recent.map((item) => item.task.title);

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
  me = await seedUser(db, { email: "me@example.test" });
  colleague = await seedUser(db, { email: "colleague@example.test" });
  coursemate = await seedProject(db, owner, {
    name: "CourseMate",
    slug: "bss-coursemate",
  });
  await join(me, coursemate);
  await join(colleague, coursemate);
});

describe("who a finished task counts for", () => {
  it("credits the assignees, whoever moved it", async () => {
    const dev = await seedBoard(coursemate, "开发");
    await finish(
      coursemate,
      dev,
      "我的任务",
      colleague,
      "2026-10-02T00:00:00Z",
      [me],
    );
    await finish(coursemate, dev, "同事的任务", me, "2026-10-03T00:00:00Z", [
      colleague,
    ]);

    expect(titles(await archiveOf(me))).toEqual(["我的任务"]);
    expect(titles(await archiveOf(colleague))).toEqual(["同事的任务"]);
  });

  it("credits an unassigned task to whoever moved it to 已完成", async () => {
    const dev = await seedBoard(coursemate, "开发");
    await finish(coursemate, dev, "我顺手做的", me, "2026-10-02T00:00:00Z");
    await finish(
      coursemate,
      dev,
      "同事顺手做的",
      colleague,
      "2026-10-03T00:00:00Z",
    );

    expect(titles(await archiveOf(me))).toEqual(["我顺手做的"]);
  });

  it("never counts a task in a project I cannot see", async () => {
    const elsewhere = await seedProject(db, owner, { name: "EchoAgent" });
    const dev = await seedBoard(elsewhere, "开发");
    // My name is on the log from when I was still in that project.
    await finish(elsewhere, dev, "别的项目", me, "2026-10-02T00:00:00Z");

    expect((await archiveOf(me)).total).toBe(0);
  });
});

describe("when a task was finished", () => {
  it("drops a task that was reopened", async () => {
    const dev = await seedBoard(coursemate, "开发");
    const cardId = await finish(
      coursemate,
      dev,
      "又打开了",
      me,
      "2026-10-02T00:00:00Z",
      [me],
    );
    await moveCard(cardId, dev.doing);
    await logMove(cardId, dev.doing, me, "2026-10-03T00:00:00Z");

    expect((await archiveOf(me)).total).toBe(0);
  });

  it("uses the last time it reached 已完成", async () => {
    const dev = await seedBoard(coursemate, "开发");
    const cardId = await finish(
      coursemate,
      dev,
      "返工",
      me,
      "2026-10-02T00:00:00Z",
      [me],
    );
    await logMove(cardId, dev.doing, me, "2026-10-03T00:00:00Z");
    await logMove(cardId, dev.done, me, "2026-10-05T00:00:00Z");

    expect((await archiveOf(me)).recent[0]?.finishedAt).toEqual(
      at("2026-10-05T00:00:00Z"),
    );
  });

  it("uses creation for a card made straight into 已完成", async () => {
    const dev = await seedBoard(coursemate, "开发");
    const cardId = await seedCard(coursemate, dev.done, "补记一条");
    await logCreated(cardId, me, "2026-10-06T00:00:00Z");

    const archive = await archiveOf(me);
    expect(titles(archive)).toEqual(["补记一条"]);
    expect(archive.recent[0]?.finishedAt).toEqual(at("2026-10-06T00:00:00Z"));
  });

  it("falls back to the card's creation when it has no log, for its assignees only", async () => {
    const dev = await seedBoard(coursemate, "开发");
    await seedCard(coursemate, dev.done, "导入的", {
      assignees: [me],
      createdAt: at("2026-08-20T00:00:00Z"),
    });
    await seedCard(coursemate, dev.done, "导入的，没人负责");

    const archive = await archiveOf(me);
    expect(titles(archive)).toEqual(["导入的"]);
    expect(archive.recent[0]?.finishedAt).toEqual(at("2026-08-20T00:00:00Z"));
  });
});

describe("the counts", () => {
  it("splits by month on the viewer's clock, by project and by function", async () => {
    const dev = await seedBoard(coursemate, "开发");
    const ops = await seedBoard(coursemate, "运营");
    const ideas = await seedBoard(coursemate, "灵感池");
    // October in Sydney, still September in UTC.
    await finish(coursemate, dev, "跨月", me, "2026-09-30T15:30:00Z", [me]);
    await finish(coursemate, ops, "本月运营", me, "2026-10-10T00:00:00Z", [me]);
    await finish(coursemate, ideas, "别的看板", me, "2026-07-01T00:00:00Z", [
      me,
    ]);

    const sydney = await archiveOf(me, "Australia/Sydney");
    expect(sydney.total).toBe(3);
    expect(sydney.thisMonth).toBe(2);
    expect(sydney.months).toHaveLength(ARCHIVE_MONTHS);
    expect(sydney.months.at(-1)).toEqual({ month: "2026-10", count: 2 });
    expect(sydney.months.find((m) => m.month === "2026-07")?.count).toBe(1);
    expect(sydney.byFunction).toEqual({
      dev: 1,
      ops: 1,
      marketing: 0,
      other: 1,
    });
    expect(sydney.byProject).toEqual([
      {
        project: { publicId: coursemate.publicId, name: "CourseMate" },
        count: 3,
      },
    ]);
    expect(titles(sydney)).toEqual(["本月运营", "跨月", "别的看板"]);

    const utc = await archiveOf(me, "UTC");
    expect(utc.thisMonth).toBe(1);
    expect(utc.months.find((m) => m.month === "2026-09")?.count).toBe(1);
  });

  it("lists at most the newest ARCHIVE_LIST_LIMIT but counts them all", async () => {
    const dev = await seedBoard(coursemate, "开发");
    const extra = 3;
    const memberId = await memberIdOf(me, coursemate);
    const cards = await db
      .insert(kanSchema.cards)
      .values(
        Array.from({ length: ARCHIVE_LIST_LIMIT + extra }, (_, i) => ({
          publicId: nextId(),
          title: `任务 ${i}`,
          index: i,
          listId: dev.done,
        })),
      )
      .returning({ id: kanSchema.cards.id });
    await db
      .insert(kanSchema.cardToWorkspaceMembers)
      .values(
        cards.map((card) => ({ cardId: card.id, workspaceMemberId: memberId })),
      );

    const archive = await archiveOf(me);
    expect(archive.total).toBe(ARCHIVE_LIST_LIMIT + extra);
    expect(archive.recent).toHaveLength(ARCHIVE_LIST_LIMIT);
  });

  it("refuses a time zone that does not exist", async () => {
    await expect(archiveOf(me, "Mars/Olympus_Mons")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
  });
});
