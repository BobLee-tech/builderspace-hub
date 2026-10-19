import { describe, expect, it } from "vitest";

import { parseCli } from "./args";

describe("parseCli", () => {
  it("parses a grant with a back-office role and projects", () => {
    expect(
      parseCli([
        "grant",
        "--email",
        "new@example.test",
        "--hub-role",
        "owner",
        "--project",
        "abc123def456:admin",
        "--project",
        "xyz789uvw012:guest",
        "--note",
        "第一位所有者",
      ]),
    ).toEqual({
      ok: true,
      command: {
        name: "grant",
        email: "new@example.test",
        hubRole: "owner",
        note: "第一位所有者",
        projects: [
          { projectPublicId: "abc123def456", role: "admin" },
          { projectPublicId: "xyz789uvw012", role: "guest" },
        ],
      },
    });
  });

  it("parses the smallest grant", () => {
    expect(parseCli(["grant", "--email", "new@example.test"])).toEqual({
      ok: true,
      command: {
        name: "grant",
        email: "new@example.test",
        hubRole: null,
        note: null,
        projects: [],
      },
    });
  });

  it("defaults a project's role to member", () => {
    const result = parseCli([
      "grant",
      "--email",
      "new@example.test",
      "--project",
      "abc123def456",
    ]);

    expect(result.ok && result.command).toMatchObject({
      projects: [{ projectPublicId: "abc123def456", role: "member" }],
    });
  });

  it("parses a role change, including removing a role", () => {
    expect(
      parseCli(["set-role", "--email", "a@example.test", "--role", "owner"]),
    ).toEqual({
      ok: true,
      command: { name: "set-role", email: "a@example.test", role: "owner" },
    });
    expect(
      parseCli(["set-role", "--email", "a@example.test", "--role", "none"]),
    ).toEqual({
      ok: true,
      command: { name: "set-role", email: "a@example.test", role: null },
    });
  });

  it("parses project setup", () => {
    expect(
      parseCli(["setup-projects", "--owner", "owner@example.test"]),
    ).toEqual({
      ok: true,
      command: { name: "setup-projects", ownerEmail: "owner@example.test" },
    });
  });

  it("parses a provisioning retry", () => {
    expect(parseCli(["provision", "--email", "new@example.test"])).toEqual({
      ok: true,
      command: { name: "provision", email: "new@example.test" },
    });
  });

  it.each([["projects"], ["doctor"], ["help"]] as const)(
    "parses `%s`",
    (name) => {
      expect(parseCli([name])).toEqual({ ok: true, command: { name } });
    },
  );

  it.each([
    [["mail-links"], { email: null, dryRun: false }],
    [["mail-links", "--dry-run"], { email: null, dryRun: true }],
    [
      ["mail-links", "--email", "a@b.co", "--dry-run"],
      { email: "a@b.co", dryRun: true },
    ],
    [
      ["mail-links", "--dry-run", "--email", "a@b.co"],
      { email: "a@b.co", dryRun: true },
    ],
  ])("parses %j", (argv, options) => {
    expect(parseCli(argv)).toEqual({
      ok: true,
      command: { name: "mail-links", ...options },
    });
  });

  it("shows help when called with nothing", () => {
    expect(parseCli([])).toEqual({ ok: true, command: { name: "help" } });
  });

  it.each([
    [["launch"], "未知命令: launch"],
    [["grant"], "grant 需要 --email"],
    [["grant", "--email"], "--email 后面缺少值"],
    [
      ["grant", "--email", "a@b.co", "--hub-role", "boss"],
      "--hub-role 只能是 owner、admin 或 viewer",
    ],
    [
      ["grant", "--email", "a@b.co", "--project", "abc:chief"],
      "--project 的角色只能是 admin、member 或 guest",
    ],
    [
      ["grant", "--email", "a@b.co", "--project", ":member"],
      "--project 的格式是 <项目ID>:<角色>",
    ],
    [["grant", "--email", "a@b.co", "--force"], "未知参数: --force"],
    [["doctor", "--fix"], "doctor 不接受参数"],
    [["provision"], "provision 需要 --email"],
    [["setup-projects"], "setup-projects 需要 --owner"],
    [["set-role", "--email", "a@b.co"], "set-role 需要 --email 和 --role"],
    [
      ["set-role", "--email", "a@b.co", "--role", "boss"],
      "--role 只能是 owner、admin、viewer 或 none",
    ],
    [["setup-projects", "--email", "x"], "setup-projects 只接受 --owner"],
    [["provision", "--user", "x"], "provision 只接受 --email"],
    [["mail-links", "--email"], "--email 后面缺少值"],
    [["mail-links", "--email", "--dry-run"], "--email 后面缺少值"],
    [["mail-links", "--all"], "mail-links 只接受 --email 和 --dry-run"],
  ])("rejects %j", (argv, error) => {
    expect(parseCli(argv)).toEqual({ ok: false, error });
  });
});
