import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as kanSchema from "@kan/db/schema";

import type { Db } from "../db";
import type { Mailer, MailMessage } from "../mail";
import type { NudgeDeps } from "./nudge.service";
import { ensureProjectMember } from "../kan/members.gateway";
import { MailError } from "../mail";
import { hubAuditLog, hubPrivateBoards, hubRateLimits } from "../schema";
import { HubError } from "../shared/errors";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "../testing/test-db";
import {
  getNudgeMail,
  listNudgeable,
  nudgePerson,
  setNudgeMail,
} from "./nudge.service";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const now = new Date("2026-10-24T02:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY);

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
  boardId: number;
  todo: number;
  doing: number;
  done: number;
}

let db: Db;
let owner: User;
let me: User;
let ann: User;
let bob: User;
let club: Project;
let ops: Lists;
let uid = 0;
const nextId = () => `n${(uid += 1).toString().padStart(11, "0")}`;

/** A mailer that keeps what it was asked to send, or fails the way it is told. */
function fakeMailer(fail?: MailError): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    acceptsReplies: false,
    send(message) {
      if (fail) return Promise.reject(fail);
      sent.push(message);
      return Promise.resolve({ id: `mail-${sent.length}` });
    },
  };
}

const deps = (mailer: Mailer | null = fakeMailer()): NudgeDeps => ({
  mailer,
  baseUrl: "https://hub.example.test",
});

const join = (user: User, project: Project) =>
  ensureProjectMember(db, {
    userId: user.id,
    email: user.email,
    workspaceId: project.id,
    role: "member",
    addedBy: owner.id,
  });

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

  const listIds: number[] = [];
  for (const [index, listName] of ["待办", "进行中", "已完成"].entries()) {
    const [list] = await db
      .insert(kanSchema.lists)
      .values({ publicId: nextId(), name: listName, index, boardId: board.id })
      .returning({ id: kanSchema.lists.id });
    if (!list) throw new Error("no list");
    listIds.push(list.id);
  }
  const [todo = 0, doing = 0, done = 0] = listIds;
  return { boardId: board.id, todo, doing, done };
}

async function seedCard(
  listId: number,
  title: string,
  options: {
    assignees?: User[];
    project?: Project;
    createdDaysAgo?: number;
    dueInDays?: number;
    activityDaysAgo?: number;
  } = {},
): Promise<number> {
  const [card] = await db
    .insert(kanSchema.cards)
    .values({
      publicId: nextId(),
      title,
      index: 0,
      listId,
      createdAt: daysAgo(options.createdDaysAgo ?? 0),
      dueDate:
        options.dueInDays === undefined
          ? null
          : new Date(now.getTime() + options.dueInDays * DAY),
    })
    .returning({ id: kanSchema.cards.id });
  if (!card) throw new Error("no card");

  for (const user of options.assignees ?? []) {
    const [member] = await db
      .select({ id: kanSchema.workspaceMembers.id })
      .from(kanSchema.workspaceMembers)
      .where(
        and(
          eq(kanSchema.workspaceMembers.userId, user.id),
          eq(
            kanSchema.workspaceMembers.workspaceId,
            (options.project ?? club).id,
          ),
        ),
      );
    if (!member) throw new Error("not a member");
    await db
      .insert(kanSchema.cardToWorkspaceMembers)
      .values({ cardId: card.id, workspaceMemberId: member.id });
  }

  if (options.activityDaysAgo !== undefined) {
    await db.insert(kanSchema.cardActivities).values({
      publicId: nextId(),
      type: "card.updated.list",
      cardId: card.id,
      createdAt: daysAgo(options.activityDaysAgo),
    });
  }
  return card.id;
}

const actor = (user: User) => ({ userId: user.id, email: user.email });

const names = (list: { people: { name: string }[] }) =>
  list.people.map((p) => p.name);

beforeEach(async () => {
  db = await createHubTestDb();
  owner = await seedUser(db, { email: "owner@example.test", name: "Owner" });
  me = await seedUser(db, { email: "me@example.test", name: "Me" });
  ann = await seedUser(db, { email: "ann@example.test", name: "Ann" });
  bob = await seedUser(db, { email: "bob@example.test", name: "Bob" });
  club = await seedProject(db, owner, { name: "BuilderSpace 社团" });
  for (const user of [me, ann, bob]) await join(user, club);
  ops = await seedBoard(club, "运营");
});

describe("listNudgeable", () => {
  it("lists teammates with a stuck task, with their open count and most stuck task", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });
    await seedCard(ops.todo, "海报", { assignees: [ann] });
    await seedCard(ops.todo, "刚建的", { assignees: [bob] });
    await seedCard(ops.todo, "我的", { assignees: [me], createdDaysAgo: 9 });

    const list = await listNudgeable(db, { userId: me.id, now }, deps());

    expect(list.canSend).toBe(true);
    expect(list.people).toEqual([
      {
        userId: ann.id,
        name: "Ann",
        openCount: 2,
        headline: { title: "推文", stuck: { kind: "idle", days: 5 } },
        optedOut: false,
        waitSeconds: null,
      },
    ]);
  });

  it("counts a move or a comment as touching the task", async () => {
    await seedCard(ops.doing, "昨天挪过", {
      assignees: [ann],
      createdDaysAgo: 10,
      activityDaysAgo: 1,
    });

    expect(
      names(await listNudgeable(db, { userId: me.id, now }, deps())),
    ).toEqual([]);
  });

  it("counts an overdue task as stuck however fresh it is", async () => {
    await seedCard(ops.doing, "逾期", { assignees: [ann], dueInDays: -1 });

    const [person] = (await listNudgeable(db, { userId: me.id, now }, deps()))
      .people;
    expect(person?.headline.stuck).toEqual({ kind: "overdue" });
  });

  it("only looks at tasks the viewer can see", async () => {
    const other = await seedProject(db, owner, { name: "EchoAgent" });
    await join(ann, other);
    const echo = await seedBoard(other, "技术");
    await seedCard(echo.todo, "别的项目", {
      assignees: [ann],
      project: other,
      createdDaysAgo: 9,
    });
    const diary = await seedBoard(club, "日记");
    await db
      .insert(hubPrivateBoards)
      .values({ boardId: diary.boardId, ownerUserId: ann.id });
    await seedCard(diary.todo, "私人的", {
      assignees: [ann],
      createdDaysAgo: 9,
    });

    expect(
      names(await listNudgeable(db, { userId: me.id, now }, deps())),
    ).toEqual([]);
  });

  it("marks who turned mail off and who was nudged within the hour", async () => {
    await seedCard(ops.doing, "推文", {
      assignees: [ann, bob],
      createdDaysAgo: 5,
    });
    await setNudgeMail(db, actor(bob), false, now);
    await nudgePerson(db, { userId: me.id, recipientId: ann.id, now }, deps());

    const list = await listNudgeable(
      db,
      { userId: me.id, now: new Date(now.getTime() + 20 * 60 * 1000) },
      deps(),
    );

    const byName = new Map(list.people.map((p) => [p.name, p]));
    expect(byName.get("Ann")).toMatchObject({
      optedOut: false,
      waitSeconds: 2400,
    });
    expect(byName.get("Bob")).toMatchObject({
      optedOut: true,
      waitSeconds: null,
    });
  });

  it("leaves out suspended accounts", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });
    await seedHubAccount(db, ann.id, { status: "suspended" });

    expect(
      names(await listNudgeable(db, { userId: me.id, now }, deps())),
    ).toEqual([]);
  });

  it("says nobody can be nudged while no mail service is set up", async () => {
    expect(
      (await listNudgeable(db, { userId: me.id, now }, deps(null))).canSend,
    ).toBe(false);
  });
});

describe("nudgePerson", () => {
  it("mails the person their own unfinished tasks, numbered, soonest due first", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });
    await seedCard(ops.todo, "海报", { assignees: [ann], dueInDays: -1 });
    await seedCard(ops.done, "做完的", { assignees: [ann], createdDaysAgo: 9 });
    // In a project I am not in: the mail is Ann's, so it still lists it.
    const other = await seedProject(db, owner, { name: "EchoAgent" });
    await join(ann, other);
    const echo = await seedBoard(other, "技术");
    await seedCard(echo.todo, "接口", { assignees: [ann], project: other });
    const mailer = fakeMailer();

    const result = await nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(mailer),
    );

    expect(result).toEqual({ delivery: "sent" });
    expect(mailer.sent).toHaveLength(1);
    const [mail] = mailer.sent;
    expect(mail?.to).toBe("ann@example.test");
    expect(mail?.subject).toBe("你还有 3 件事没做完");
    expect(mail?.text).toContain("你好 Ann，");
    expect(mail?.text).toContain("1. 海报（BuilderSpace 社团 · 运营）· 已逾期");
    expect(mail?.text).toContain(
      "2. 推文（BuilderSpace 社团 · 运营）· 5 天没动",
    );
    expect(mail?.text).toContain("3. 接口（EchoAgent · 技术）· 待办");
    expect(mail?.text).not.toContain("做完的");
  });

  it("lists at most eight tasks and says how many more", async () => {
    for (let i = 0; i < 10; i += 1) {
      await seedCard(ops.todo, `任务 ${i}`, {
        assignees: [ann],
        createdDaysAgo: 5,
      });
    }
    const mailer = fakeMailer();

    await nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(mailer),
    );

    expect(mailer.sent[0]?.text).toContain("8. 任务");
    expect(mailer.sent[0]?.text).not.toContain("9. 任务");
    expect(mailer.sent[0]?.text).toContain("……还有 2 件");
  });

  it("mails each person at most once an hour, whoever asks", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });
    const mailer = fakeMailer();
    await nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(mailer),
    );

    const again = nudgePerson(
      db,
      {
        userId: bob.id,
        recipientId: ann.id,
        now: new Date(now.getTime() + 30 * 60 * 1000),
      },
      deps(mailer),
    );

    await expect(again).rejects.toMatchObject({
      code: "CONFLICT",
      message: "一小时内已经有人提醒过 TA 了，30 分钟后可以再提醒",
    });
    await nudgePerson(
      db,
      {
        userId: bob.id,
        recipientId: ann.id,
        now: new Date(now.getTime() + HOUR),
      },
      deps(mailer),
    );
    expect(mailer.sent).toHaveLength(2);
  });

  it("keeps no trace of who asked", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });
    const mailer = fakeMailer();

    await nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(mailer),
    );

    expect(await db.select().from(hubAuditLog)).toEqual([]);
    const limits = await db.select().from(hubRateLimits);
    expect(limits.map((row) => row.key)).toEqual([`hub:nudge:${ann.id}`]);
    expect(JSON.stringify(mailer.sent)).not.toContain("me@example.test");
    expect(JSON.stringify(mailer.sent)).not.toContain(me.id);
  });

  it("refuses someone who turned the mail off, and sends nothing", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });
    await setNudgeMail(db, actor(ann), false, now);
    const mailer = fakeMailer();

    await expect(
      nudgePerson(
        db,
        { userId: me.id, recipientId: ann.id, now },
        deps(mailer),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "TA 关掉了催一下邮件",
    });
    expect(mailer.sent).toEqual([]);
  });

  it("refuses anyone not on my list: nothing stuck, myself, or a stranger", async () => {
    await seedCard(ops.doing, "刚建的", { assignees: [ann] });
    await seedCard(ops.doing, "我的", { assignees: [me], createdDaysAgo: 9 });
    const stranger = await seedUser(db, { email: "x@example.test" });
    const mailer = fakeMailer();

    for (const recipientId of [ann.id, me.id, stranger.id]) {
      await expect(
        nudgePerson(db, { userId: me.id, recipientId, now }, deps(mailer)),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    expect(mailer.sent).toEqual([]);
    expect(await db.select().from(hubRateLimits)).toEqual([]);
  });

  it("frees the hour again when the mail service refuses the mail", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });

    await expect(
      nudgePerson(
        db,
        { userId: me.id, recipientId: ann.id, now },
        deps(fakeMailer(new MailError("发信服务拒绝了：HTTP 422"))),
      ),
    ).rejects.toMatchObject({ code: "UNAVAILABLE" });

    const retry = await nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(),
    );
    expect(retry).toEqual({ delivery: "sent" });
  });

  it("keeps the hour when nobody knows whether the mail went out", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });

    const result = await nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(fakeMailer(new MailError("发信服务没有回应", { uncertain: true }))),
    );

    expect(result).toEqual({ delivery: "unconfirmed" });
    await expect(
      nudgePerson(db, { userId: me.id, recipientId: ann.id, now }, deps()),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("refuses while no mail service is set up, and counts nothing", async () => {
    await seedCard(ops.doing, "推文", { assignees: [ann], createdDaysAgo: 5 });

    const attempt = nudgePerson(
      db,
      { userId: me.id, recipientId: ann.id, now },
      deps(null),
    );

    await expect(attempt).rejects.toBeInstanceOf(HubError);
    await expect(attempt).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.select().from(hubRateLimits)).toEqual([]);
  });
});

describe("nudge mail preference", () => {
  it("is on until turned off, and every change is logged", async () => {
    expect(await getNudgeMail(db, ann.id)).toEqual({ on: true });

    expect(await setNudgeMail(db, actor(ann), false, now)).toEqual({
      on: false,
    });
    expect(await getNudgeMail(db, ann.id)).toEqual({ on: false });
    expect(await setNudgeMail(db, actor(ann), true, now)).toEqual({ on: true });
    expect(await getNudgeMail(db, ann.id)).toEqual({ on: true });

    const log = await db.select().from(hubAuditLog);
    expect(log.map((entry) => [entry.action, entry.actorUserId])).toEqual([
      ["nudge_mail.turned_off", ann.id],
      ["nudge_mail.turned_on", ann.id],
    ]);
  });

  it("changes and logs nothing when it is already as asked", async () => {
    await setNudgeMail(db, actor(ann), true, now);
    await setNudgeMail(db, actor(bob), false, now);
    await setNudgeMail(db, actor(bob), false, now);

    expect(await db.select().from(hubAuditLog)).toHaveLength(1);
  });
});
