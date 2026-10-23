import { describe, expect, it } from "vitest";

import { fieldTypes } from "@kan/hub/public";

import {
  baseAfterStatusChange,
  draftOf,
  duplicateField,
  move,
  newField,
  newOption,
  optionsFromLines,
  sameDraft,
} from "./form-draft";

describe("newField", () => {
  it("makes every type with defaults the model accepts", () => {
    for (const type of fieldTypes) {
      const field = newField(type);
      expect(field.type).toBe(type);
      expect(field.id).toMatch(/^[a-z0-9]{10}$/);
    }
    const choice = newField("single_choice");
    expect(choice.type === "single_choice" && choice.options).toHaveLength(2);
  });
});

describe("duplicateField", () => {
  it("gives the copy and its options new ids", () => {
    const original = newField("multi_choice");
    const copy = duplicateField(original);
    expect(copy.id).not.toBe(original.id);
    if (copy.type === "multi_choice" && original.type === "multi_choice") {
      expect(copy.options.map((o) => o.id)).not.toEqual(
        original.options.map((o) => o.id),
      );
    }
    expect(duplicateField(newField("long_text")).type).toBe("long_text");
  });
});

describe("move", () => {
  it("moves one place and stays put at the ends", () => {
    expect(move(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(move(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(move(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(move(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});

describe("optionsFromLines", () => {
  it("skips blanks and repeats, and respects the room left", () => {
    const added = optionsFromLines(
      " 红 \n\n蓝\n红\nRED\nred\n绿",
      [newOption("Red")],
      2,
    );
    expect(added.map((o) => o.label)).toEqual(["红", "蓝"]);
  });
});

describe("draftOf and sameDraft", () => {
  it("turns the deadline into an ISO string and compares drafts by value", () => {
    const detail = {
      title: "t",
      access: "public" as const,
      definition: { description: "", coverImage: null, fields: [] },
      settings: {
        limitOne: true,
        allowEdit: false,
        wall: "off" as const,
        wallShowNames: true,
        likes: "off" as const,
        projectIds: [],
        confirmation: "",
      },
      closesAt: new Date("2026-10-30T10:00:00Z"),
      maxResponses: null,
    };
    const draft = draftOf(detail);
    expect(draft.closesAt).toBe("2026-10-30T10:00:00.000Z");
    expect(sameDraft(draft, draftOf(detail))).toBe(true);
    expect(sameDraft(draft, { ...draft, title: "u" })).toBe(false);
    expect(draftOf({ ...detail, closesAt: null }).closesAt).toBeNull();
  });
});

describe("baseAfterStatusChange", () => {
  const sent = "2026-10-23T10:00:00.000Z";
  const changed = new Date("2026-10-23T10:05:00Z");

  it("moves a draft that was current to the form's new time", () => {
    expect(baseAfterStatusChange(sent, sent, changed)).toBe(
      "2026-10-23T10:05:00.000Z",
    );
  });

  it("keeps a draft the server found stale, or one saved again meanwhile", () => {
    expect(baseAfterStatusChange(sent, sent, null)).toBe(sent);
    const resaved = "2026-10-23T10:03:00.000Z";
    expect(baseAfterStatusChange(resaved, sent, changed)).toBe(resaved);
  });
});
