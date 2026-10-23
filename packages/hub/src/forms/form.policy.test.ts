import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "./form.model";
import {
  canCreateForm,
  canFill,
  canLike,
  canManageForm,
  canSeeWall,
  canShareForm,
  isHiddenForm,
  reconcileSettings,
} from "./form.policy";

describe("who manages forms", () => {
  it("lets owners and admins create", () => {
    expect(canCreateForm("owner")).toBe(true);
    expect(canCreateForm("admin")).toBe(true);
    expect(canCreateForm("viewer")).toBe(false);
    expect(canCreateForm(null)).toBe(false);
  });

  it("lets owners and listed managers manage, but only owners and admin managers share", () => {
    const open = { hidden: false };
    expect(canManageForm({ role: "owner", isManager: false, ...open })).toBe(
      true,
    );
    expect(canManageForm({ role: "admin", isManager: false, ...open })).toBe(
      false,
    );
    expect(canManageForm({ role: null, isManager: true, ...open })).toBe(true);
    expect(canShareForm({ role: "owner", isManager: false, ...open })).toBe(
      true,
    );
    expect(canShareForm({ role: "admin", isManager: true, ...open })).toBe(
      true,
    );
    expect(canShareForm({ role: "admin", isManager: false, ...open })).toBe(
      false,
    );
    expect(canShareForm({ role: null, isManager: true, ...open })).toBe(false);
  });

  it("keeps a hidden form to the people it was handed to, owners included", () => {
    const hidden = { hidden: true };
    expect(canManageForm({ role: "owner", isManager: false, ...hidden })).toBe(
      false,
    );
    expect(canManageForm({ role: "owner", isManager: true, ...hidden })).toBe(
      true,
    );
    expect(canManageForm({ role: null, isManager: true, ...hidden })).toBe(
      true,
    );
    expect(canShareForm({ role: "owner", isManager: false, ...hidden })).toBe(
      false,
    );
    expect(canShareForm({ role: "owner", isManager: true, ...hidden })).toBe(
      true,
    );
    expect(canShareForm({ role: "admin", isManager: true, ...hidden })).toBe(
      true,
    );
    expect(canShareForm({ role: null, isManager: true, ...hidden })).toBe(
      false,
    );
  });

  it("hides a form only while someone manages it", () => {
    expect(isHiddenForm({ managersOnly: true, managerCount: 2 })).toBe(true);
    expect(isHiddenForm({ managersOnly: true, managerCount: 0 })).toBe(false);
    expect(isHiddenForm({ managersOnly: false, managerCount: 2 })).toBe(false);
  });
});

describe("canFill", () => {
  const anonymous = { userId: null, role: null, projectIds: [] };
  const member = { userId: "u1", role: null, projectIds: ["p1"] };
  const form = (
    access: "public" | "members" | "projects",
    projectIds: string[] = [],
  ) => ({
    access,
    settings: { projectIds },
  });

  it("follows the access level", () => {
    expect(canFill(form("public"), anonymous)).toEqual({ allowed: true });
    expect(canFill(form("members"), anonymous)).toEqual({
      allowed: false,
      reason: "sign_in",
    });
    expect(canFill(form("members"), member)).toEqual({ allowed: true });
    expect(canFill(form("projects", ["p1", "p2"]), member)).toEqual({
      allowed: true,
    });
    expect(canFill(form("projects", ["p2"]), member)).toEqual({
      allowed: false,
      reason: "not_in_project",
    });
    expect(canFill(form("projects", ["p1"]), anonymous)).toEqual({
      allowed: false,
      reason: "sign_in",
    });
  });
});

describe("canSeeWall", () => {
  const see = (wall: "off" | "after_submit" | "always", extra: object = {}) =>
    canSeeWall({
      wall,
      isManager: false,
      mayFill: true,
      hasAnswered: false,
      ...extra,
    });

  it("shows managers always, others by the wall setting", () => {
    expect(see("off", { isManager: true, mayFill: false })).toBe(true);
    expect(see("off")).toBe(false);
    expect(see("always")).toBe(true);
    expect(see("always", { mayFill: false })).toBe(false);
    expect(see("after_submit")).toBe(false);
    expect(see("after_submit", { hasAnswered: true })).toBe(true);
  });
});

describe("canLike", () => {
  const like = (extra: object) =>
    canLike({
      likes: "anyone",
      signedIn: false,
      hasBrowserKey: true,
      isOwnAnswer: false,
      ...extra,
    });

  it("follows the like setting and never allows liking oneself", () => {
    expect(like({ likes: "off" })).toEqual({
      allowed: false,
      reason: "这份表单没有开点赞",
    });
    expect(like({ isOwnAnswer: true, signedIn: true })).toEqual({
      allowed: false,
      reason: "不能给自己点赞",
    });
    expect(like({ signedIn: true, likes: "signed_in" })).toEqual({
      allowed: true,
    });
    expect(like({ likes: "signed_in" })).toEqual({
      allowed: false,
      reason: "登录后才能点赞",
    });
    expect(like({})).toEqual({ allowed: true });
    expect(like({ hasBrowserKey: false }).allowed).toBe(false);
  });
});

describe("reconcileSettings", () => {
  it("drops what cannot apply", () => {
    expect(
      reconcileSettings("members", {
        ...DEFAULT_SETTINGS,
        limitOne: false,
        allowEdit: true,
        wall: "off",
        likes: "anyone",
        projectIds: ["p1"],
      }),
    ).toMatchObject({ allowEdit: false, likes: "off", projectIds: [] });
    expect(
      reconcileSettings("members", {
        ...DEFAULT_SETTINGS,
        wall: "always",
        likes: "anyone",
      }).likes,
    ).toBe("signed_in");
    expect(
      reconcileSettings("public", {
        ...DEFAULT_SETTINGS,
        wall: "always",
        likes: "anyone",
      }).likes,
    ).toBe("anyone");
    expect(
      reconcileSettings("projects", { ...DEFAULT_SETTINGS, projectIds: ["p1"] })
        .projectIds,
    ).toEqual(["p1"]);
  });
});
