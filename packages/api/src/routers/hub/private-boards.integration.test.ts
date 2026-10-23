import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as kanSchema from "@kan/db/schema";
import { createHubTestDb, seedProject, seedUser } from "@kan/hub/testing";

import { appRouter } from "../../root";
import {
  callerContext,
  createHubCaller,
  ensureProjectMemberForTests,
} from "./test-helpers";

// Kan's import router reads this when the whole API is loaded.
vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET ??= "private-boards-integration-test";
});

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** Calls Kan's whole API as the given user, or a signed-out visitor. */
const createAppCaller = (database: dbClient, user: User | null) =>
  appRouter.createCaller(callerContext(database, user));

/**
 * 仅自己可见 through the real API: Kan's own procedures, unchanged, refuse or
 * leave out other people's private boards because of the middleware in
 * trpc.ts and the two filters in board.all and workspace.search. The rules
 * themselves are tested in @kan/hub.
 */

interface User {
  id: string;
  email: string;
}

let db: dbClient;
let creator: User;
let teammate: User;
let project: { id: number; publicId: string };
let shared: { board: string; list: string; card: string };
let hidden: { board: string; list: string; card: string };
let uid = 0;
const nextId = () => `i${(uid += 1).toString().padStart(11, "0")}`;

beforeEach(async () => {
  db = await createHubTestDb();
  creator = await seedUser(db, { email: "creator@example.test" });
  teammate = await seedUser(db, { email: "teammate@example.test" });
  project = await seedProject(db, creator, { name: "BuilderSpace" });
  await ensureProjectMemberForTests(db, teammate, project.id, "admin");

  shared = await seedBoard("Roadmap");
  hidden = await seedBoard("Diary");
  await createHubCaller(db, creator).boards.setOnlyMe({
    boardPublicId: hidden.board,
    onlyMe: true,
  });
});

async function seedBoard(name: string) {
  const ids = { board: nextId(), list: nextId(), card: nextId() };
  const [board] = await db
    .insert(kanSchema.boards)
    .values({
      publicId: ids.board,
      name,
      slug: name.toLowerCase(),
      workspaceId: project.id,
      createdBy: creator.id,
    })
    .returning({ id: kanSchema.boards.id });
  if (!board) throw new Error("no board");
  const [list] = await db
    .insert(kanSchema.lists)
    .values({ publicId: ids.list, name: "待办", index: 0, boardId: board.id })
    .returning({ id: kanSchema.lists.id });
  if (!list) throw new Error("no list");
  await db.insert(kanSchema.cards).values({
    publicId: ids.card,
    title: `${name} card`,
    index: 0,
    listId: list.id,
    createdBy: creator.id,
  });
  return ids;
}

describe("a 仅自己可见 board", () => {
  it("is left out of the project's boards for everyone but its owner", async () => {
    const names = async (user: User) =>
      (
        await createAppCaller(db, user).board.all({
          workspacePublicId: project.publicId,
        })
      ).map((board) => board.name);

    expect(await names(creator)).toEqual(["Diary", "Roadmap"]);
    expect(await names(teammate)).toEqual(["Roadmap"]);
  });

  it("cannot be opened by anyone else, even a project admin or with its link", async () => {
    const asTeammate = createAppCaller(db, teammate);
    await expect(
      asTeammate.board.byId({ boardPublicId: hidden.board }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asTeammate.card.byId({ cardPublicId: hidden.card }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      asTeammate.card.getActivities({ cardPublicId: hidden.card }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      createAppCaller(db, null).card.byId({ cardPublicId: hidden.card }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const asOwner = createAppCaller(db, creator);
    expect(
      (await asOwner.board.byId({ boardPublicId: hidden.board })).name,
    ).toBe("Diary");
    expect((await asOwner.card.byId({ cardPublicId: hidden.card })).title).toBe(
      "Diary card",
    );
  });

  it("cannot be written to by anyone else, and nothing changes", async () => {
    const asTeammate = createAppCaller(db, teammate);
    await expect(
      asTeammate.card.update({ cardPublicId: hidden.card, title: "mine now" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Moving one of their own cards into it.
    await expect(
      asTeammate.card.update({
        cardPublicId: shared.card,
        listPublicId: hidden.list,
        index: 0,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const titles = await db
      .select({ title: kanSchema.cards.title })
      .from(kanSchema.cards)
      .where(eq(kanSchema.cards.publicId, hidden.card));
    expect(titles).toEqual([{ title: "Diary card" }]);
  });

  it("does not turn up in search for anyone else", async () => {
    const found = async (user: User, query: string) =>
      (
        await createAppCaller(db, user).workspace.search({
          workspacePublicId: project.publicId,
          query,
        })
      ).map((result) => result.title);

    expect(await found(creator, "Diary")).toEqual(
      expect.arrayContaining(["Diary", "Diary card"]),
    );
    expect(await found(teammate, "Diary")).toEqual([]);
    expect(await found(teammate, "Roadmap")).toEqual(
      expect.arrayContaining(["Roadmap", "Roadmap card"]),
    );
  });

  it("does not use up search's limits for anyone else", async () => {
    const listIdOf = async (publicId: string) => {
      const [list] = await db
        .select({ id: kanSchema.lists.id })
        .from(kanSchema.lists)
        .where(eq(kanSchema.lists.publicId, publicId));
      if (!list) throw new Error("no list");
      return list.id;
    };
    // Exact matches in the private board outrank the visible card below.
    const hiddenList = await listIdOf(hidden.list);
    for (const index of [1, 2, 3]) {
      await db.insert(kanSchema.cards).values({
        publicId: nextId(),
        title: "Diary",
        index,
        listId: hiddenList,
      });
    }
    await db.insert(kanSchema.cards).values({
      publicId: nextId(),
      title: "Diary notes for the roadmap",
      index: 1,
      listId: await listIdOf(shared.list),
    });

    // A limit of 2 leaves one place for cards.
    const results = await createAppCaller(db, teammate).workspace.search({
      workspacePublicId: project.publicId,
      query: "Diary",
      limit: 2,
    });
    expect(results.map((result) => result.title)).toEqual([
      "Diary notes for the roadmap",
    ]);
  });

  it("cannot go on the public link until its owner shares it again", async () => {
    const asOwner = createAppCaller(db, creator);
    await expect(
      asOwner.board.update({
        boardPublicId: hidden.board,
        visibility: "public",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await createHubCaller(db, creator).boards.setOnlyMe({
      boardPublicId: hidden.board,
      onlyMe: false,
    });
    await asOwner.board.update({
      boardPublicId: hidden.board,
      visibility: "public",
    });
    expect(
      (
        await createAppCaller(db, teammate).board.byId({
          boardPublicId: hidden.board,
        })
      ).visibility,
    ).toBe("public");
  });
});

describe("hub.boards", () => {
  it("tells each person whether the board is private and whether they may change it", async () => {
    expect(
      await createHubCaller(db, creator).boards.privacy({
        boardPublicId: hidden.board,
      }),
    ).toEqual({ onlyMe: true, canChange: true });
    expect(
      await createHubCaller(db, teammate).boards.privacy({
        boardPublicId: shared.board,
      }),
    ).toEqual({ onlyMe: false, canChange: false });
    await expect(
      createHubCaller(db, teammate).boards.privacy({
        boardPublicId: hidden.board,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets only the creator hide a board, and refuses API keys", async () => {
    await expect(
      createHubCaller(db, teammate).boards.setOnlyMe({
        boardPublicId: shared.board,
        onlyMe: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      createHubCaller(db, creator, {
        "x-api-key": "anything",
      }).boards.setOnlyMe({
        boardPublicId: shared.board,
        onlyMe: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    expect(
      await createHubCaller(db, creator).boards.setOnlyMe({
        boardPublicId: shared.board,
        onlyMe: true,
      }),
    ).toEqual({ onlyMe: true, canChange: true });
  });
});
