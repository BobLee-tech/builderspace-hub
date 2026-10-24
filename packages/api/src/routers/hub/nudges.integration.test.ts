import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as kanSchema from "@kan/db/schema";
import { createHubTestDb, seedProject, seedUser } from "@kan/hub/testing";

import { createHubCaller, ensureProjectMemberForTests } from "./test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * 催一下 through the API: the list, sending through Resend, the hourly limit
 * and the mail switch. The rules themselves are tested in @kan/hub; this
 * checks the wiring and the error mapping.
 */

let db: dbClient;
let me: { id: string; email: string };
let ann: { id: string; email: string };
let projectId: number;

const DAY = 24 * 60 * 60 * 1000;

beforeEach(async () => {
  db = await createHubTestDb();
  const owner = await seedUser(db, { email: "owner@example.test" });
  me = await seedUser(db, { email: "me@example.test" });
  ann = await seedUser(db, { email: "ann@example.test", name: "Ann" });
  const project = await seedProject(db, owner);
  projectId = project.id;
  await ensureProjectMemberForTests(db, me, project.id, "member");
  await ensureProjectMemberForTests(db, ann, project.id, "member");
  await seedStuckCard(ann, "推文");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A card nobody has touched for five days, assigned to `user`. */
async function seedStuckCard(user: { id: string }, title: string) {
  const [board] = await db
    .insert(kanSchema.boards)
    .values({
      publicId: "board0000001",
      name: "运营",
      slug: "ops",
      workspaceId: projectId,
      createdBy: user.id,
    })
    .returning({ id: kanSchema.boards.id });
  const [list] = await db
    .insert(kanSchema.lists)
    .values({
      publicId: "list00000001",
      name: "进行中",
      index: 0,
      boardId: board?.id ?? 0,
    })
    .returning({ id: kanSchema.lists.id });
  const [card] = await db
    .insert(kanSchema.cards)
    .values({
      publicId: "card00000001",
      title,
      index: 0,
      listId: list?.id ?? 0,
      createdAt: new Date(Date.now() - 5 * DAY),
    })
    .returning({ id: kanSchema.cards.id });
  const [membership] = await db
    .select({ id: kanSchema.workspaceMembers.id })
    .from(kanSchema.workspaceMembers)
    .where(eq(kanSchema.workspaceMembers.userId, user.id));
  await db.insert(kanSchema.cardToWorkspaceMembers).values({
    cardId: card?.id ?? 0,
    workspaceMemberId: membership?.id ?? 0,
  });
}

/** Turns mail on, with Resend answered by a stub that records each request. */
function withResend() {
  vi.stubEnv("HUB_RESEND_API_KEY", "re_test");
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://hub.example.test");
  const requests: { to: string[]; subject: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: { body: string }) => {
      requests.push(JSON.parse(init.body) as { to: string[]; subject: string });
      return Promise.resolve(
        new Response(JSON.stringify({ id: "email-1" }), { status: 200 }),
      );
    }),
  );
  return requests;
}

describe("hub.nudges", () => {
  it("lists a teammate whose task has stalled", async () => {
    vi.stubEnv("HUB_RESEND_API_KEY", "");

    const list = await createHubCaller(db, me).nudges.list();

    expect(list.canSend).toBe(false);
    expect(list.people).toMatchObject([
      {
        userId: ann.id,
        name: "Ann",
        openCount: 1,
        headline: { title: "推文", stuck: { kind: "idle", days: 5 } },
      },
    ]);
  });

  it("mails them once, then refuses for the rest of the hour", async () => {
    const requests = withResend();
    const caller = createHubCaller(db, me);

    expect(await caller.nudges.send({ userId: ann.id })).toEqual({
      delivery: "sent",
    });
    expect(requests).toMatchObject([
      { to: ["ann@example.test"], subject: "你还有 1 件事没做完" },
    ]);
    await expect(caller.nudges.send({ userId: ann.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(requests).toHaveLength(1);
  });

  it("refuses while no mail service is set up", async () => {
    vi.stubEnv("HUB_RESEND_API_KEY", "");

    await expect(
      createHubCaller(db, me).nudges.send({ userId: ann.id }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "还没有配置发信服务，暂时不能提醒",
    });
  });

  it("refuses someone with nothing stuck as not found", async () => {
    withResend();

    await expect(
      createHubCaller(db, ann).nudges.send({ userId: me.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets me turn my own mail off and on", async () => {
    const caller = createHubCaller(db, ann);

    expect(await caller.nudges.mail()).toEqual({ on: true });
    await caller.nudges.setMail({ on: false });
    expect(await caller.nudges.mail()).toEqual({ on: false });
    expect(
      (await createHubCaller(db, me).nudges.list()).people[0]?.optedOut,
    ).toBe(true);
  });
});
