import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as kanSchema from "@kan/db/schema";
import {
  createHubTestDb,
  seedHubAccount,
  seedProject,
  seedUser,
} from "@kan/hub/testing";

import { createHubCaller, ensureProjectMemberForTests } from "./test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The personal calendar API: every signed-in member has their own, nobody can
 * reach anyone else's. The rules themselves are tested in @kan/hub; this checks
 * the gate, the wiring and the error mapping.
 */

let db: dbClient;
let member: { id: string; email: string };
let colleague: { id: string; email: string };
let projectId: number;

const window = {
  from: new Date("2099-10-12T00:00:00Z"),
  to: new Date("2099-10-19T00:00:00Z"),
};
const nineToTen = {
  startsAt: new Date("2099-10-14T09:00:00Z"),
  endsAt: new Date("2099-10-14T10:00:00Z"),
};

beforeEach(async () => {
  db = await createHubTestDb();
  const owner = await seedUser(db, { email: "owner@example.test" });
  member = await seedUser(db, { email: "member@example.test" });
  colleague = await seedUser(db, { email: "colleague@example.test" });
  const project = await seedProject(db, owner);
  projectId = project.id;
  await ensureProjectMemberForTests(db, member, project.id, "member");
  await ensureProjectMemberForTests(db, colleague, project.id, "member");
});

/** A card on a fresh board of the shared project, assigned to `user`. */
async function seedAssignedCard(
  user: { id: string },
  title: string,
): Promise<string> {
  const [board] = await db
    .insert(kanSchema.boards)
    .values({
      publicId: "board0000001",
      name: "开发",
      slug: "dev",
      workspaceId: projectId,
      createdBy: user.id,
    })
    .returning({ id: kanSchema.boards.id });
  const [list] = await db
    .insert(kanSchema.lists)
    .values({
      publicId: "list00000001",
      name: "待办",
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
  return "card00000001";
}

describe("hub.schedule", () => {
  it("lets a member draw, move and remove their own blocks", async () => {
    const caller = createHubCaller(db, member);

    const { publicId } = await caller.schedule.create({
      kind: "busy",
      title: "上课",
      ...nineToTen,
    });
    expect((await caller.schedule.get(window)).blocks).toMatchObject([
      { publicId, kind: "busy", title: "上课" },
    ]);

    await caller.schedule.edit({
      blockPublicId: publicId,
      endsAt: new Date("2099-10-14T11:00:00Z"),
    });
    expect((await caller.schedule.get(window)).blocks[0]?.endsAt).toEqual(
      new Date("2099-10-14T11:00:00Z"),
    );

    await caller.schedule.remove({ blockPublicId: publicId });
    expect((await caller.schedule.get(window)).blocks).toEqual([]);
  });

  it("keeps each member's calendar to themselves", async () => {
    const { publicId } = await createHubCaller(db, member).schedule.create({
      kind: "busy",
      title: "私事",
      ...nineToTen,
    });
    const theirs = createHubCaller(db, colleague);

    expect((await theirs.schedule.get(window)).blocks).toEqual([]);
    await expect(
      theirs.schedule.edit({ blockPublicId: publicId, title: "改了" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      theirs.schedule.remove({ blockPublicId: publicId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("sets time aside for a task assigned to the caller", async () => {
    const cardPublicId = await seedAssignedCard(member, "写接口");

    const caller = createHubCaller(db, member);
    await caller.schedule.planTask({ cardPublicId, ...nineToTen });
    await expect(
      createHubCaller(db, colleague).schedule.planTask({
        cardPublicId,
        ...nineToTen,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const schedule = await caller.schedule.get(window);
    expect(schedule.blocks).toMatchObject([
      { kind: "task", title: "写接口", task: { publicId: cardPublicId } },
    ]);
    expect(schedule.openTasks).toMatchObject([
      { task: { publicId: cardPublicId }, planned: true },
    ]);
  });

  it("maps a bad range to BAD_REQUEST and a bad window too", async () => {
    const caller = createHubCaller(db, member);

    await expect(
      caller.schedule.create({
        kind: "free",
        startsAt: nineToTen.endsAt,
        endsAt: nineToTen.startsAt,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.schedule.get({ from: window.to, to: window.from }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("refuses visitors, API keys and suspended accounts", async () => {
    await expect(
      createHubCaller(db, null).schedule.get(window),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createHubCaller(db, member, { "x-api-key": "anything" }).schedule.get(
        window,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await seedHubAccount(db, member.id, { status: "suspended" });
    await expect(
      createHubCaller(db, member).schedule.create({
        kind: "free",
        ...nineToTen,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
