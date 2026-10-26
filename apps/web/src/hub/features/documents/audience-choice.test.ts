import { describe, expect, it } from "vitest";

import type { AudienceChoice } from "./audience-choice";
import {
  audienceChanged,
  audienceFrom,
  canSendAudience,
  isEmptySelection,
} from "./audience-choice";

const nobody: AudienceChoice = { kind: "selected", userIds: [], groups: [] };
const oneMember: AudienceChoice = {
  kind: "selected",
  userIds: ["u1"],
  groups: [],
};

describe("audienceFrom", () => {
  it("keeps 所有成员 and 只有能修改的人 as they are", () => {
    expect(audienceFrom({ audience: "all", readers: null })).toEqual({
      kind: "all",
    });
    expect(audienceFrom({ audience: "editors", readers: null })).toEqual({
      kind: "editors",
    });
  });

  it("lists the people and groups of 指定的人", () => {
    expect(
      audienceFrom({
        audience: "selected",
        readers: {
          users: [{ userId: "u1", name: "Ada" }],
          groups: [
            {
              projectPublicId: "p1",
              departmentPublicId: "d1",
              label: "社群 · 技术",
            },
          ],
        },
      }),
    ).toEqual({
      kind: "selected",
      userIds: ["u1"],
      groups: [{ projectPublicId: "p1", departmentPublicId: "d1" }],
    });
  });

  it("starts 指定的人 empty when the readers are not known", () => {
    expect(audienceFrom({ audience: "selected", readers: null })).toEqual(
      nobody,
    );
  });
});

describe("isEmptySelection", () => {
  it("is only 指定的人 with nobody picked", () => {
    expect(isEmptySelection(nobody)).toBe(true);
    expect(isEmptySelection(oneMember)).toBe(false);
    expect(isEmptySelection({ kind: "all" })).toBe(false);
    expect(isEmptySelection({ kind: "editors" })).toBe(false);
  });
});

describe("audienceChanged", () => {
  it("compares the choice with where the form started", () => {
    expect(audienceChanged(oneMember, { ...oneMember })).toBe(false);
    expect(audienceChanged({ kind: "all" }, oneMember)).toBe(true);
    expect(audienceChanged(nobody, oneMember)).toBe(true);
  });
});

describe("canSendAudience", () => {
  it("lets an unchanged choice through, even one that now names nobody", () => {
    // Shared only with a project since deleted: the stored list resolves to
    // nobody, but the title and folder must still be editable.
    expect(canSendAudience(nobody, nobody)).toBe(true);
  });

  it("holds back 指定的人 changed to nobody", () => {
    expect(canSendAudience(nobody, oneMember)).toBe(false);
    expect(canSendAudience(nobody, { kind: "all" })).toBe(false);
  });

  it("lets any other choice through", () => {
    expect(canSendAudience(oneMember, nobody)).toBe(true);
    expect(canSendAudience({ kind: "editors" }, oneMember)).toBe(true);
  });
});
