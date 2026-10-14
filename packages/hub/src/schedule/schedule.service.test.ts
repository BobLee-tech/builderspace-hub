import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as kanSchema from "@kan/db/schema";

import type { Db } from "../db";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { hubTimeBlocks } from "../schema";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import {
  createBlock,
  editBlock,
  getSchedule,
  planTask,
  removeBlock,
} from "./schedule.service";

const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-14T00:00:00Z");
const at = (hour: number, day = 14) => new Date(Date.UTC(2026, 9, day, hour));

/** The week the calendar is looking at in these tests. */
const window = { from: at(0, 12), to: at(0, 19) };

interface User {
  id: string;
  email: string;
}
interface Project {
  id: number;
  publicId: string;
}

let db: Db;
let owner: User;
let me: User;
let colleague: User;
let project: Project;
let lists: { todo: number; done: number };
let uid = 0;
const nextId = () => `s${(uid += 1).toString().padStart(11, "0")}`;

async function seedBoard(): Promise<{ todo: number; done: number }> {
  const [board] = await db
    .insert(kanSchema.boards)
    .values({
      publicId: nextId(),
      name: "开发",
      slug: nextId(),
      workspaceId: project.id,
      createdBy: owner.id,
    })
    .returning({ id: kanSchema.boards.id });
  if (!board) throw new Error("no board");

  const ids: number[] = [];
  for (const [index, name] of ["待办", "已完成"].entries()) {
    const [list] = await db
      .insert(kanSchema.lists)
      .values({ publicId: nextId(), name, index, boardId: board.id })
      .returning({ id: kanSchema.lists.id });
    if (!list) throw new Error("no list");
    ids.push(list.id);
  }
  return { todo: ids[0] ?? 0, done: ids[1] ?? 0 };
}

async function seedCard(
  title: string,
  assignees: User[] = [],
): Promise<{ id: number; publicId: string }> {
  const [card] = await db
    .insert(kanSchema.cards)
    .values({ publicId: nextId(), title, index: 0, listId: lists.todo })
    .returning({ id: kanSchema.cards.id, publicId: kanSchema.cards.publicId });
  if (!card) throw new Error("no card");
  for (const user of assignees) await assign(card.id, user);
  return card;
}

async function memberIdOf(user: User): Promise<number> {
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

async function assign(cardId: number, user: User) {
  await db.insert(kanSchema.cardToWorkspaceMembers).values({
    cardId,
    workspaceMemberId: await memberIdOf(user),
  });
}

async function unassign(cardId: number, user: User) {
  await db
    .delete(kanSchema.cardToWorkspaceMembers)
    .where(
      and(
        eq(kanSchema.cardToWorkspaceMembers.cardId, cardId),
        eq(
          kanSchema.cardToWorkspaceMembers.workspaceMemberId,
          await memberIdOf(user),
        ),
      ),
    );
}

const join = (user: User) =>
  ensureProjectMember(db, {
    userId: user.id,
    email: user.email,
    workspaceId: project.id,
    role: "member",
    addedBy: owner.id,
  });

const scheduleOf = (user: User) =>
  getSchedule(db, { userId: user.id, ...window, now });

const blockCount = async () => (await db.select().from(hubTimeBlocks)).length;

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test" });
  me = await seedUser(db, { email: "me@example.test" });
  colleague = await seedUser(db, { email: "colleague@example.test" });
  project = await seedProject(db, owner);
  await join(me);
  await join(colleague);
  lists = await seedBoard();
});

describe("createBlock", () => {
  it("saves free, busy and meeting blocks with trimmed titles", async () => {
    await createBlock(db, me.id, {
      kind: "free",
      startsAt: at(9),
      endsAt: at(12),
    });
    await createBlock(db, me.id, {
      kind: "busy",
      title: "  上课 ",
      startsAt: at(13),
      endsAt: at(15),
    });
    await createBlock(db, me.id, {
      kind: "meeting",
      title: "   ",
      startsAt: at(16),
      endsAt: at(17),
    });

    const { blocks } = await scheduleOf(me);

    expect(blocks.map((b) => [b.kind, b.title])).toEqual([
      ["free", null],
      ["busy", "上课"],
      ["meeting", null],
    ]);
  });

  it("refuses a bad range or an over-long title, and writes nothing", async () => {
    await expect(
      createBlock(db, me.id, { kind: "busy", startsAt: at(10), endsAt: at(9) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createBlock(db, me.id, {
        kind: "busy",
        title: "长".repeat(81),
        startsAt: at(9),
        endsAt: at(10),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      createBlock(db, me.id, {
        kind: "task" as never,
        startsAt: at(9),
        endsAt: at(10),
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(await blockCount()).toBe(0);
  });
});

describe("getSchedule", () => {
  it("returns only my blocks that touch the window", async () => {
    await createBlock(db, me.id, {
      kind: "busy",
      title: "窗口内",
      startsAt: at(9),
      endsAt: at(10),
    });
    await createBlock(db, me.id, {
      kind: "busy",
      title: "窗口前",
      startsAt: at(9, 10),
      endsAt: at(10, 10),
    });
    await createBlock(db, me.id, {
      kind: "busy",
      title: "跨进窗口",
      startsAt: new Date(window.from.getTime() - HOUR),
      endsAt: new Date(window.from.getTime() + HOUR),
    });
    await createBlock(db, colleague.id, {
      kind: "busy",
      title: "同事的",
      startsAt: at(9),
      endsAt: at(10),
    });

    const { blocks } = await scheduleOf(me);

    expect(blocks.map((b) => b.title)).toEqual(["跨进窗口", "窗口内"]);
  });

  it("refuses a backwards or enormous window", async () => {
    await expect(
      getSchedule(db, { userId: me.id, from: at(0), to: at(0), now }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      getSchedule(db, {
        userId: me.id,
        from: at(0, 1),
        to: new Date(at(0, 1).getTime() + 100 * 24 * HOUR),
        now,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("lists my unfinished tasks and whether time is set aside for them", async () => {
    const planned = await seedCard("排了时间的", [me]);
    await seedCard("还没排的", [me]);
    await seedCard("别人的", [colleague]);
    await planTask(
      db,
      me.id,
      { cardPublicId: planned.publicId, startsAt: at(9), endsAt: at(11) },
      now,
    );

    const { openTasks } = await scheduleOf(me);

    expect(
      openTasks
        .map((t) => [t.task.title, t.planned] as const)
        .sort((a, b) => a[0].localeCompare(b[0], "zh-CN")),
    ).toEqual([
      ["还没排的", false],
      ["排了时间的", true],
    ]);
  });

  it("does not count a block that is already over as planned", async () => {
    const card = await seedCard("补上周的", [me]);
    await planTask(
      db,
      me.id,
      { cardPublicId: card.publicId, startsAt: at(9, 12), endsAt: at(11, 12) },
      now,
    );

    const { openTasks } = await scheduleOf(me);

    expect(openTasks.map((t) => t.planned)).toEqual([false]);
  });
});

describe("planTask and the board", () => {
  it("shows the card's live title and stage, so the two cannot drift", async () => {
    const card = await seedCard("写接口", [me]);
    await planTask(
      db,
      me.id,
      { cardPublicId: card.publicId, startsAt: at(9), endsAt: at(11) },
      now,
    );

    await db
      .update(kanSchema.cards)
      .set({ title: "写接口并补测试" })
      .where(eq(kanSchema.cards.id, card.id));
    let { blocks, openTasks } = await scheduleOf(me);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      kind: "task",
      title: "写接口并补测试",
      task: { publicId: card.publicId, stage: "todo" },
    });
    expect(openTasks).toHaveLength(1);

    await db
      .update(kanSchema.cards)
      .set({ listId: lists.done })
      .where(eq(kanSchema.cards.id, card.id));
    ({ blocks, openTasks } = await scheduleOf(me));
    expect(blocks[0]?.task?.stage).toBe("done");
    expect(openTasks).toHaveLength(0);
  });

  it("hides the block when the card is taken off me, and brings it back when it returns", async () => {
    const card = await seedCard("交接", [me]);
    await planTask(
      db,
      me.id,
      { cardPublicId: card.publicId, startsAt: at(9), endsAt: at(11) },
      now,
    );

    await unassign(card.id, me);
    expect((await scheduleOf(me)).blocks).toHaveLength(0);
    expect(await blockCount()).toBe(1);

    await assign(card.id, me);
    expect((await scheduleOf(me)).blocks).toHaveLength(1);
  });

  it("drops the block when the card is deleted", async () => {
    const card = await seedCard("作废", [me]);
    await planTask(
      db,
      me.id,
      { cardPublicId: card.publicId, startsAt: at(9), endsAt: at(11) },
      now,
    );

    await db
      .update(kanSchema.cards)
      .set({ deletedAt: now })
      .where(eq(kanSchema.cards.id, card.id));

    expect((await scheduleOf(me)).blocks).toHaveLength(0);
  });

  it("leaves a colleague's calendar untouched when we both hold the card", async () => {
    const card = await seedCard("一起做", [me, colleague]);
    await planTask(
      db,
      me.id,
      { cardPublicId: card.publicId, startsAt: at(9), endsAt: at(11) },
      now,
    );

    expect((await scheduleOf(me)).blocks).toHaveLength(1);
    expect((await scheduleOf(colleague)).blocks).toHaveLength(0);
  });

  it("refuses tasks that are not mine, do not exist, or are finished", async () => {
    const theirs = await seedCard("别人的", [colleague]);
    const finished = await seedCard("做完了", [me]);
    await db
      .update(kanSchema.cards)
      .set({ listId: lists.done })
      .where(eq(kanSchema.cards.id, finished.id));
    const range = { startsAt: at(9), endsAt: at(11) };

    await expect(
      planTask(db, me.id, { cardPublicId: theirs.publicId, ...range }, now),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      planTask(db, me.id, { cardPublicId: "nonexistent01", ...range }, now),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      planTask(db, me.id, { cardPublicId: finished.publicId, ...range }, now),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    expect(await blockCount()).toBe(0);
  });

  it("refuses a task from a project I am not in", async () => {
    const other = await seedProject(db, owner);
    const [board] = await db
      .insert(kanSchema.boards)
      .values({
        publicId: nextId(),
        name: "开发",
        slug: nextId(),
        workspaceId: other.id,
        createdBy: owner.id,
      })
      .returning({ id: kanSchema.boards.id });
    const [list] = await db
      .insert(kanSchema.lists)
      .values({
        publicId: nextId(),
        name: "待办",
        index: 0,
        boardId: board?.id ?? 0,
      })
      .returning({ id: kanSchema.lists.id });
    const [card] = await db
      .insert(kanSchema.cards)
      .values({
        publicId: nextId(),
        title: "不在的项目",
        index: 0,
        listId: list?.id ?? 0,
      })
      .returning({ publicId: kanSchema.cards.publicId });

    await expect(
      planTask(
        db,
        me.id,
        {
          cardPublicId: card?.publicId ?? "",
          startsAt: at(9),
          endsAt: at(11),
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("editBlock", () => {
  it("moves a block and relabels a manual one", async () => {
    const { publicId } = await createBlock(db, me.id, {
      kind: "busy",
      title: "上课",
      startsAt: at(9),
      endsAt: at(10),
    });

    await editBlock(db, me.id, {
      blockPublicId: publicId,
      kind: "meeting",
      title: "组会",
      startsAt: at(14),
      endsAt: at(16),
    });
    await editBlock(db, me.id, {
      blockPublicId: publicId,
      endsAt: at(17),
    });

    const { blocks } = await scheduleOf(me);
    expect(blocks).toMatchObject([
      { kind: "meeting", title: "组会", startsAt: at(14), endsAt: at(17) },
    ]);
  });

  it("clears the title when given null and keeps it when left out", async () => {
    const { publicId } = await createBlock(db, me.id, {
      kind: "busy",
      title: "上课",
      startsAt: at(9),
      endsAt: at(10),
    });

    await editBlock(db, me.id, { blockPublicId: publicId, startsAt: at(8) });
    expect((await scheduleOf(me)).blocks[0]?.title).toBe("上课");

    await editBlock(db, me.id, { blockPublicId: publicId, title: null });
    expect((await scheduleOf(me)).blocks[0]?.title).toBeNull();
  });

  it("checks the range against the block's other end", async () => {
    const { publicId } = await createBlock(db, me.id, {
      kind: "free",
      startsAt: at(9),
      endsAt: at(10),
    });

    await expect(
      editBlock(db, me.id, { blockPublicId: publicId, startsAt: at(11) }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await scheduleOf(me)).blocks[0]?.startsAt).toEqual(at(9));
  });

  it("lets a task block move but not take a title of its own", async () => {
    const card = await seedCard("写接口", [me]);
    const { publicId } = await planTask(
      db,
      me.id,
      { cardPublicId: card.publicId, startsAt: at(9), endsAt: at(10) },
      now,
    );

    await editBlock(db, me.id, {
      blockPublicId: publicId,
      startsAt: at(13),
      endsAt: at(15),
    });
    await expect(
      editBlock(db, me.id, { blockPublicId: publicId, title: "改名" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      editBlock(db, me.id, { blockPublicId: publicId, kind: "busy" }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    const { blocks } = await scheduleOf(me);
    expect(blocks[0]).toMatchObject({
      kind: "task",
      title: "写接口",
      startsAt: at(13),
    });
  });

  it("will not touch someone else's block, and cannot tell it exists", async () => {
    const { publicId } = await createBlock(db, colleague.id, {
      kind: "busy",
      title: "私事",
      startsAt: at(9),
      endsAt: at(10),
    });

    await expect(
      editBlock(db, me.id, { blockPublicId: publicId, title: "改了" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      editBlock(db, me.id, { blockPublicId: "nonexistent01", title: "改了" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect((await scheduleOf(colleague)).blocks[0]?.title).toBe("私事");
  });
});

describe("removeBlock", () => {
  it("removes my block", async () => {
    const { publicId } = await createBlock(db, me.id, {
      kind: "free",
      startsAt: at(9),
      endsAt: at(10),
    });

    await removeBlock(db, me.id, publicId);

    expect(await blockCount()).toBe(0);
  });

  it("will not remove someone else's block", async () => {
    const { publicId } = await createBlock(db, colleague.id, {
      kind: "free",
      startsAt: at(9),
      endsAt: at(10),
    });

    await expect(removeBlock(db, me.id, publicId)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await blockCount()).toBe(1);
  });
});

describe("privacy", () => {
  it("never writes to the audit log, which back-office admins can read", async () => {
    const { publicId } = await createBlock(db, me.id, {
      kind: "busy",
      title: "看病",
      startsAt: at(9),
      endsAt: at(10),
    });
    await editBlock(db, me.id, { blockPublicId: publicId, title: "复诊" });
    await removeBlock(db, me.id, publicId);

    expect(await listAudit(db, { limit: 10, offset: 0 })).toEqual([]);
  });
});
