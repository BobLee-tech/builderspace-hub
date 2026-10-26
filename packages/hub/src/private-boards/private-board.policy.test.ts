import { describe, expect, it } from "vitest";

import {
  boardBeingPublished,
  canSeePrivateBoard,
  canSwitchAudience,
  collectBoardRefs,
  countBoardRefs,
  MAX_BOARD_REFS,
} from "./private-board.policy";

describe("collectBoardRefs", () => {
  it("finds every kind of id Kan's routers take", () => {
    const refs = collectBoardRefs({
      boardPublicId: "b1",
      listPublicId: "l1",
      cardPublicId: "c1",
      labelPublicId: "lb1",
      checklistPublicId: "cl1",
      checklistItemPublicId: "ci1",
      commentPublicId: "cm1",
      attachmentPublicId: "a1",
    });
    expect(refs).toEqual({
      board: ["b1"],
      list: ["l1"],
      card: ["c1"],
      label: ["lb1"],
      checklist: ["cl1"],
      checklistItem: ["ci1"],
      comment: ["cm1"],
      attachment: ["a1"],
    });
  });

  it("reads prefixed fields and lists of ids", () => {
    const refs = collectBoardRefs({
      sourceBoardPublicId: "template",
      targetListPublicId: "elsewhere",
      labelPublicIds: ["lb1", "lb2"],
    });
    expect(refs.board).toEqual(["template"]);
    expect(refs.list).toEqual(["elsewhere"]);
    expect(refs.label).toEqual(["lb1", "lb2"]);
  });

  it("looks inside nested objects and arrays, but not forever", () => {
    expect(
      collectBoardRefs({
        moves: [{ cardPublicId: "c1" }, { cardPublicId: "c2" }],
      }).card,
    ).toEqual(["c1", "c2"]);

    const deep = {
      a: { b: { c: { d: { e: { cardPublicId: "too-deep" } } } } },
    };
    expect(collectBoardRefs(deep).card).toEqual([]);
  });

  it("ignores ids of things outside a board, and junk values", () => {
    const refs = collectBoardRefs({
      workspacePublicId: "w1",
      memberPublicIds: ["m1"],
      webhookPublicId: "h1",
      documentPublicId: "d1",
      cardPublicId: 42,
      listPublicId: "",
      // Longer than any public id: it cannot name anything.
      boardPublicId: "x".repeat(13),
    });
    expect(countBoardRefs(refs)).toBe(0);
  });

  it("accepts inputs that are not objects", () => {
    for (const input of [undefined, null, "boardPublicId", 7]) {
      expect(countBoardRefs(collectBoardRefs(input))).toBe(0);
    }
  });

  it("counts each id once", () => {
    const refs = collectBoardRefs({
      cardPublicId: "c1",
      moves: [{ cardPublicId: "c1" }],
      labelPublicIds: ["lb1", "lb1"],
    });
    expect(refs.card).toEqual(["c1"]);
    expect(refs.label).toEqual(["lb1"]);
    expect(countBoardRefs(refs)).toBe(2);
  });

  it("stops collecting just past the cap, however many ids are sent", () => {
    const ids = Array.from({ length: 50_000 }, (_, i) => `c${i}`);
    expect(countBoardRefs(collectBoardRefs({ cardPublicIds: ids }))).toBe(
      MAX_BOARD_REFS + 1,
    );
    expect(
      countBoardRefs(
        collectBoardRefs({ cardPublicIds: ids.slice(0, MAX_BOARD_REFS) }),
      ),
    ).toBe(MAX_BOARD_REFS);
    expect(
      countBoardRefs(
        collectBoardRefs({ moves: ids.map((id) => ({ cardPublicId: id })) }),
      ),
    ).toBe(MAX_BOARD_REFS + 1);
  });
});

describe("canSeePrivateBoard", () => {
  const viewer = (id: string | null, ...adminOf: number[]) => ({
    id,
    adminOf: new Set(adminOf),
  });
  const onlyMe = (ownerUserId: string | null) => ({
    audience: "owner" as const,
    ownerUserId,
    workspaceId: 1,
  });
  const adminsOnly = {
    audience: "admins" as const,
    ownerUserId: "u1",
    workspaceId: 1,
  };

  it("shows 仅自己可见 to its owner only, even over a project admin", () => {
    expect(canSeePrivateBoard(onlyMe("u1"), viewer("u1"))).toBe(true);
    expect(canSeePrivateBoard(onlyMe("u1"), viewer("u2", 1))).toBe(false);
    expect(canSeePrivateBoard(onlyMe("u1"), viewer(null))).toBe(false);
  });

  it("hides 仅自己可见 from everyone once the owner is gone", () => {
    expect(canSeePrivateBoard(onlyMe(null), viewer("u1", 1))).toBe(false);
    expect(canSeePrivateBoard(onlyMe(null), viewer(null))).toBe(false);
  });

  it("shows 仅管理员可见 to the admins of its own project, whoever set it", () => {
    expect(canSeePrivateBoard(adminsOnly, viewer("u2", 1))).toBe(true);
    expect(canSeePrivateBoard(adminsOnly, viewer("u1"))).toBe(false);
    expect(canSeePrivateBoard(adminsOnly, viewer("u2", 2))).toBe(false);
    expect(canSeePrivateBoard(adminsOnly, viewer(null, 1))).toBe(false);
  });
});

describe("boardBeingPublished", () => {
  it("names the board when Kan's board.update makes it public", () => {
    expect(
      boardBeingPublished("board.update", {
        boardPublicId: "b1",
        visibility: "public",
      }),
    ).toBe("b1");
  });

  it("ignores everything else", () => {
    expect(
      boardBeingPublished("board.update", {
        boardPublicId: "b1",
        visibility: "private",
      }),
    ).toBeUndefined();
    expect(
      boardBeingPublished("board.update", { boardPublicId: "b1", name: "x" }),
    ).toBeUndefined();
    expect(
      boardBeingPublished("board.create", {
        boardPublicId: "b1",
        visibility: "public",
      }),
    ).toBeUndefined();
    expect(boardBeingPublished("board.update", undefined)).toBeUndefined();
    expect(
      boardBeingPublished("board.update", [{ visibility: "public" }]),
    ).toBeUndefined();
    expect(
      boardBeingPublished("board.update", {
        boardPublicId: 1,
        visibility: "public",
      }),
    ).toBeUndefined();
  });
});

describe("canSwitchAudience", () => {
  const board = (
    createdBy: string | null,
    hidden: { audience: "owner" | "admins"; ownerUserId: string | null } | null,
  ) => ({ workspaceId: 1, createdBy, private: hidden });
  const member = (id: string) => ({ id, adminOf: new Set<number>() });
  const admin = (id: string) => ({ id, adminOf: new Set([1]) });
  const shared = board("u1", null);

  it("lets only the creator make a board 仅自己可见", () => {
    expect(canSwitchAudience(shared, member("u1"), "owner")).toBe(true);
    expect(canSwitchAudience(shared, admin("u2"), "owner")).toBe(false);
    expect(canSwitchAudience(board(null, null), admin("u1"), "owner")).toBe(
      false,
    );
  });

  it("lets only an admin of its project make a board 仅管理员可见", () => {
    expect(canSwitchAudience(shared, admin("u2"), "admins")).toBe(true);
    expect(canSwitchAudience(shared, member("u1"), "admins")).toBe(false);
    expect(
      canSwitchAudience(shared, { id: "u2", adminOf: new Set([2]) }, "admins"),
    ).toBe(false);
  });

  it("lets only the owner hand 仅自己可见 back, or pass it to the admins if they are one", () => {
    const onlyMe = board("u1", { audience: "owner", ownerUserId: "u1" });
    expect(canSwitchAudience(onlyMe, member("u1"), null)).toBe(true);
    expect(canSwitchAudience(onlyMe, member("u1"), "admins")).toBe(false);
    expect(canSwitchAudience(onlyMe, admin("u1"), "admins")).toBe(true);
    expect(canSwitchAudience(onlyMe, admin("u2"), null)).toBe(false);
    expect(
      canSwitchAudience(
        board("u1", { audience: "owner", ownerUserId: null }),
        admin("u1"),
        null,
      ),
    ).toBe(false);
  });

  it("lets any admin hand 仅管理员可见 back; only its creator may make it 仅自己可见", () => {
    const adminsOnly = board("u1", { audience: "admins", ownerUserId: "u3" });
    expect(canSwitchAudience(adminsOnly, admin("u2"), null)).toBe(true);
    expect(canSwitchAudience(adminsOnly, member("u2"), null)).toBe(false);
    expect(canSwitchAudience(adminsOnly, admin("u2"), "owner")).toBe(false);
    expect(canSwitchAudience(adminsOnly, admin("u1"), "owner")).toBe(true);
    expect(canSwitchAudience(adminsOnly, member("u1"), "owner")).toBe(false);
  });

  it("does not count staying where it is as a move", () => {
    expect(canSwitchAudience(shared, admin("u1"), null)).toBe(false);
    expect(
      canSwitchAudience(
        board("u1", { audience: "admins", ownerUserId: "u1" }),
        admin("u1"),
        "admins",
      ),
    ).toBe(false);
  });
});
