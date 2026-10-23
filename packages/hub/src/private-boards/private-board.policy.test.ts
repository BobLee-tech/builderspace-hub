import { describe, expect, it } from "vitest";

import {
  boardBeingPublished,
  canChangeOnlyMe,
  canSeePrivateBoard,
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
  it("lets only the owner see it", () => {
    expect(canSeePrivateBoard("u1", "u1")).toBe(true);
    expect(canSeePrivateBoard("u1", "u2")).toBe(false);
    expect(canSeePrivateBoard("u1", null)).toBe(false);
  });

  it("hides it from everyone once the owner is gone", () => {
    expect(canSeePrivateBoard(null, "u1")).toBe(false);
    expect(canSeePrivateBoard(null, null)).toBe(false);
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

describe("canChangeOnlyMe", () => {
  const shared = (createdBy: string | null) => ({ createdBy, privateTo: null });
  const onlyMe = (createdBy: string | null, ownerUserId: string | null) => ({
    createdBy,
    privateTo: { ownerUserId },
  });

  it("lets the creator turn it on, and nobody else", () => {
    expect(canChangeOnlyMe(shared("u1"), "u1")).toBe(true);
    expect(canChangeOnlyMe(shared("u1"), "u2")).toBe(false);
    expect(canChangeOnlyMe(shared(null), "u1")).toBe(false);
  });

  it("lets the owner turn it off, and nobody else", () => {
    expect(canChangeOnlyMe(onlyMe("u1", "u1"), "u1")).toBe(true);
    expect(canChangeOnlyMe(onlyMe("u1", "u1"), "u2")).toBe(false);
    expect(canChangeOnlyMe(onlyMe("u1", null), "u1")).toBe(false);
  });
});
