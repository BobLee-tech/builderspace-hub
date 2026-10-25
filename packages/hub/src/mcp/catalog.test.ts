import { describe, expect, it } from "vitest";

import { mcpToolGroups, mcpTools, toolsFor } from "./catalog";

const names = (tools: { name: string }[]) => tools.map((tool) => tool.name);

describe("the MCP tool catalog", () => {
  it("names every tool once, in snake_case, in a known group", () => {
    const all = names([...mcpTools]);
    expect(new Set(all).size).toBe(all.length);
    for (const tool of mcpTools) {
      expect(tool.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(mcpToolGroups).toContain(tool.group);
      expect(tool.description.length).toBeGreaterThan(10);
      if (tool.replaces) expect(tool.writes).toBe(true);
    }
  });

  it("gives an ordinary member only the tools anyone has", () => {
    const tools = toolsFor({ role: null, siteAccess: null });
    expect(tools.every((tool) => tool.needs === null)).toBe(true);
    expect(names(tools)).toContain("task_create");
    expect(names(tools)).not.toContain("doc_create");
    expect(names(tools)).not.toContain("account_list");
  });

  it("adds the back office by role", () => {
    const viewer = names(toolsFor({ role: "viewer", siteAccess: null }));
    expect(viewer).toContain("account_list");
    expect(viewer).not.toContain("account_set_project_role");
    expect(viewer).not.toContain("audit_list");

    const admin = names(toolsFor({ role: "admin", siteAccess: null }));
    expect(admin).toEqual(
      expect.arrayContaining([
        "doc_create",
        "account_set_project_role",
        "grant_revoke",
        "audit_list",
      ]),
    );
    expect(admin).not.toContain("volunteer_list");
  });

  it("adds the website's lists to those with website access", () => {
    const people = names(toolsFor({ role: null, siteAccess: "people" }));
    expect(people).toEqual(
      expect.arrayContaining(["volunteer_list", "volunteer_update"]),
    );
    expect(people).not.toContain("account_list");
  });
});
