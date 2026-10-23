import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as kanSchema from "@kan/db/schema";

import type { Db } from "../db";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { hubPrivateBoards } from "../schema";
import { getTaskBoard, getVisibleTasks } from "../tasks/task.service";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import {
  assertRequestAllowed,
  getBoardPrivacy,
  onlyVisibleBoards,
  setBoardOnlyMe,
} from "./private-board.service";

interface User {
  id: string;
  email: string;
}

/** Public ids of one seeded board and one of everything inside it. */
interface SeededBoard {
  id: number;
  board: string;
  list: string;
  card: string;
  label: string;
  checklist: string;
  checklistItem: string;
  comment: string;
  attachment: string;
}

const now = new Date("2026-10-23T00:00:00Z");

let db: Db;
let creator: User;
let teammate: User;
let outsider: User;
let project: { id: number; publicId: string; name: string };
let uid = 0;
const nextId = () => `p${(uid += 1).toString().padStart(11, "0")}`;

const actor = (user: User) => ({ userId: user.id, email: user.email });

beforeEach(async () => {
  db = await createHubTestDb();
  creator = await seedUser(db, { email: "creator@example.test" });
  teammate = await seedUser(db, { email: "teammate@example.test" });
  outsider = await seedUser(db, { email: "outsider@example.test" });
  project = await seedProject(db, creator, { name: "BuilderSpace" });
  await ensureProjectMember(db, {
    userId: teammate.id,
    email: teammate.email,
    workspaceId: project.id,
    role: "admin",
    addedBy: creator.id,
  });
});

async function seedBoard(name: string, createdBy: User): Promise<SeededBoard> {
  const ids = {
    board: nextId(),
    list: nextId(),
    card: nextId(),
    label: nextId(),
    checklist: nextId(),
    checklistItem: nextId(),
    comment: nextId(),
    attachment: nextId(),
  };
  const [board] = await db
    .insert(kanSchema.boards)
    .values({
      publicId: ids.board,
      name,
      slug: ids.board,
      workspaceId: project.id,
      createdBy: createdBy.id,
      visibility: "public",
    })
    .returning({ id: kanSchema.boards.id });
  if (!board) throw new Error("no board");
  const [list] = await db
    .insert(kanSchema.lists)
    .values({ publicId: ids.list, name: "待办", index: 0, boardId: board.id })
    .returning({ id: kanSchema.lists.id });
  if (!list) throw new Error("no list");
  await db
    .insert(kanSchema.labels)
    .values({ publicId: ids.label, name: "work", boardId: board.id });
  const [card] = await db
    .insert(kanSchema.cards)
    .values({
      publicId: ids.card,
      title: `${name} task`,
      index: 0,
      listId: list.id,
    })
    .returning({ id: kanSchema.cards.id });
  if (!card) throw new Error("no card");
  const [checklist] = await db
    .insert(kanSchema.checklists)
    .values({
      publicId: ids.checklist,
      name: "steps",
      index: 0,
      cardId: card.id,
    })
    .returning({ id: kanSchema.checklists.id });
  if (!checklist) throw new Error("no checklist");
  await db.insert(kanSchema.checklistItems).values({
    publicId: ids.checklistItem,
    title: "step",
    index: 0,
    checklistId: checklist.id,
  });
  await db
    .insert(kanSchema.comments)
    .values({ publicId: ids.comment, comment: "note", cardId: card.id });
  await db.insert(kanSchema.cardAttachments).values({
    publicId: ids.attachment,
    cardId: card.id,
    filename: "a.txt",
    originalFilename: "a.txt",
    contentType: "text/plain",
    size: 1,
    s3Key: "k",
  });
  return { id: board.id, ...ids };
}

async function kanVisibility(boardId: number) {
  const [row] = await db
    .select({ visibility: kanSchema.boards.visibility })
    .from(kanSchema.boards)
    .where(eq(kanSchema.boards.id, boardId));
  return row?.visibility;
}

/** Every input field a Kan procedure could use to reach into the board. */
function everyRef(board: SeededBoard): Record<string, string>[] {
  return [
    { boardPublicId: board.board },
    { sourceBoardPublicId: board.board },
    { listPublicId: board.list },
    { cardPublicId: board.card },
    { labelPublicId: board.label },
    { checklistPublicId: board.checklist },
    { checklistItemPublicId: board.checklistItem },
    { commentPublicId: board.comment },
    { attachmentPublicId: board.attachment },
  ];
}

describe("setBoardOnlyMe", () => {
  it("lets the creator hide their board, takes it off the public link, and logs it without its name", async () => {
    const board = await seedBoard("private", creator);

    expect(
      await setBoardOnlyMe(db, actor(creator), {
        boardPublicId: board.board,
        onlyMe: true,
      }),
    ).toEqual({ onlyMe: true, canChange: true });

    expect(await kanVisibility(board.id)).toBe("private");
    const [entry] = await listAudit(db, { limit: 5, offset: 0 });
    expect(entry).toMatchObject({
      action: "board.privacy_changed",
      entityType: "board",
      entityId: board.board,
      actorEmail: creator.email,
    });
    expect(JSON.stringify(entry)).not.toContain("private task");
    expect(entry?.summary).not.toContain("private");
  });

  it("refuses anyone but the creator, even a project admin, and changes nothing", async () => {
    const board = await seedBoard("roadmap", creator);

    await expect(
      setBoardOnlyMe(db, actor(teammate), {
        boardPublicId: board.board,
        onlyMe: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setBoardOnlyMe(db, actor(outsider), {
        boardPublicId: board.board,
        onlyMe: true,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(await db.select().from(hubPrivateBoards)).toEqual([]);
    expect(await kanVisibility(board.id)).toBe("public");
    expect(await listAudit(db, { limit: 5, offset: 0 })).toEqual([]);
  });

  it("lets the owner turn it off; the board stays off the public link", async () => {
    const board = await seedBoard("private", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: board.board,
      onlyMe: true,
    });

    await expect(
      setBoardOnlyMe(db, actor(teammate), {
        boardPublicId: board.board,
        onlyMe: false,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    expect(
      await setBoardOnlyMe(db, actor(creator), {
        boardPublicId: board.board,
        onlyMe: false,
      }),
    ).toEqual({ onlyMe: false, canChange: true });
    expect(await db.select().from(hubPrivateBoards)).toEqual([]);
    expect(await kanVisibility(board.id)).toBe("private");
    expect(await getBoardPrivacy(db, teammate.id, board.board)).toEqual({
      onlyMe: false,
      canChange: false,
    });
  });

  it("does nothing, and logs nothing, when the board is already that way", async () => {
    const board = await seedBoard("private", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: board.board,
      onlyMe: false,
    });
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: board.board,
      onlyMe: true,
    });
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: board.board,
      onlyMe: true,
    });

    expect(await listAudit(db, { limit: 5, offset: 0 })).toHaveLength(1);
  });

  it("answers NOT_FOUND for a board that does not exist or was deleted", async () => {
    const board = await seedBoard("old", creator);
    await db
      .update(kanSchema.boards)
      .set({ deletedAt: now })
      .where(eq(kanSchema.boards.id, board.id));

    for (const boardPublicId of [board.board, "nonexistent1"]) {
      await expect(
        setBoardOnlyMe(db, actor(creator), { boardPublicId, onlyMe: true }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });
});

describe("getBoardPrivacy", () => {
  it("tells the creator they can hide it, and others that they cannot", async () => {
    const board = await seedBoard("roadmap", creator);
    expect(await getBoardPrivacy(db, creator.id, board.board)).toEqual({
      onlyMe: false,
      canChange: true,
    });
    expect(await getBoardPrivacy(db, teammate.id, board.board)).toEqual({
      onlyMe: false,
      canChange: false,
    });
    await expect(
      getBoardPrivacy(db, outsider.id, board.board),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("assertRequestAllowed", () => {
  it("refuses every id inside someone else's private board, and lets the owner through", async () => {
    const hidden = await seedBoard("private", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: hidden.board,
      onlyMe: true,
    });

    for (const input of everyRef(hidden)) {
      await expect(
        assertRequestAllowed(db, { viewerId: teammate.id, path: "x", input }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        assertRequestAllowed(db, { viewerId: null, path: "x", input }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(
        assertRequestAllowed(db, { viewerId: creator.id, path: "x", input }),
      ).resolves.toBeUndefined();
    }
  });

  it("refuses a request that mixes an ordinary board with a hidden one", async () => {
    const shared = await seedBoard("roadmap", creator);
    const hidden = await seedBoard("private", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: hidden.board,
      onlyMe: true,
    });

    // Moving a card into a list of the hidden board.
    await expect(
      assertRequestAllowed(db, {
        viewerId: teammate.id,
        path: "card.update",
        input: { cardPublicId: shared.card, listPublicId: hidden.list },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("lets everything through for ordinary boards, and for inputs that name no board", async () => {
    const shared = await seedBoard("roadmap", creator);
    for (const input of [
      ...everyRef(shared),
      { workspacePublicId: "w" },
      undefined,
    ]) {
      await expect(
        assertRequestAllowed(db, { viewerId: teammate.id, path: "x", input }),
      ).resolves.toBeUndefined();
    }
  });

  it("hides the board from everyone once its owner's account is deleted", async () => {
    const hidden = await seedBoard("private", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: hidden.board,
      onlyMe: true,
    });
    await db.delete(kanSchema.users).where(eq(kanSchema.users.id, creator.id));

    await expect(
      assertRequestAllowed(db, {
        viewerId: teammate.id,
        path: "board.byId",
        input: { boardPublicId: hidden.board },
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses putting a private board on the public link, even for its owner", async () => {
    const hidden = await seedBoard("private", creator);
    const shared = await seedBoard("roadmap", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: hidden.board,
      onlyMe: true,
    });

    await expect(
      assertRequestAllowed(db, {
        viewerId: creator.id,
        path: "board.update",
        input: { boardPublicId: hidden.board, visibility: "public" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      assertRequestAllowed(db, {
        viewerId: creator.id,
        path: "board.update",
        input: { boardPublicId: shared.board, visibility: "public" },
      }),
    ).resolves.toBeUndefined();
  });
});

describe("onlyVisibleBoards", () => {
  it("drops other people's private boards from a list, keeping the order", async () => {
    const first = await seedBoard("alpha", creator);
    const hidden = await seedBoard("private", creator);
    const last = await seedBoard("omega", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: hidden.board,
      onlyMe: true,
    });
    const items = [first, hidden, last].map((b) => ({ publicId: b.board }));

    expect(
      await onlyVisibleBoards(db, teammate.id, items, (item) => item.publicId),
    ).toEqual([{ publicId: first.board }, { publicId: last.board }]);
    expect(
      await onlyVisibleBoards(db, creator.id, items, (item) => item.publicId),
    ).toEqual(items);
    expect(
      await onlyVisibleBoards(db, teammate.id, [], (item: string) => item),
    ).toEqual([]);
  });
});

describe("the home page and 总版", () => {
  it("show a private board's cards to its owner only", async () => {
    await seedBoard("技术", creator);
    const hidden = await seedBoard("private", creator);
    await setBoardOnlyMe(db, actor(creator), {
      boardPublicId: hidden.board,
      onlyMe: true,
    });

    const titles = async (user: User) =>
      (await getVisibleTasks(db, { userId: user.id, now }))
        .map((t) => t.title)
        .sort();
    expect(await titles(creator)).toEqual(["private task", "技术 task"]);
    expect(await titles(teammate)).toEqual(["技术 task"]);

    const boardsOn = async (user: User) =>
      (
        await getTaskBoard(db, { userId: user.id, now, view: "all" })
      ).boards.map((b) => b.name);
    expect((await boardsOn(creator)).sort()).toEqual(["private", "技术"]);
    expect(await boardsOn(teammate)).toEqual(["技术"]);
  });
});
