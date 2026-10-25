import { describe, expect, it } from "vitest";

import { mcpNotOffered, toolsFor } from "@kan/hub/public";

import { buildMcpGuide, guideToMarkdown, MCP_SERVER_NAME } from "./mcp-guide";

const endpoint = "https://hub.example.test/api/hub/mcp";

const guideFor = (role: "owner" | null) =>
  buildMcpGuide({
    endpoint,
    role,
    tools: toolsFor({ role, siteAccess: null }),
  });

describe("the MCP guide", () => {
  it("tells an AI where the server is and how each client adds it", () => {
    const markdown = guideToMarkdown(guideFor(null));
    expect(markdown.startsWith("# 接入 BuilderSpace Hub 的 MCP\n")).toBe(true);
    expect(markdown).toContain(`\`${endpoint}\``);
    expect(markdown).toContain(
      `claude mcp add --transport http ${MCP_SERVER_NAME} ${endpoint}`,
    );
    expect(markdown).toContain(
      `codex mcp add ${MCP_SERVER_NAME} --url ${endpoint}`,
    );
    expect(markdown).toContain("### Cursor");
    expect(markdown).toContain("OAuth");
  });

  it("writes JSON snippets that parse", () => {
    const blocks = guideFor(null).sections.flatMap((section) => section.blocks);
    const json = blocks.flatMap((block) =>
      block.kind === "client" && block.code?.language === "json"
        ? [block.code.code]
        : [],
    );
    expect(json).toHaveLength(3);
    for (const code of json)
      expect(() => JSON.parse(code) as unknown).not.toThrow();
    expect(json.join()).toContain(endpoint);
  });

  it("lists the viewer's own tools, and only those", () => {
    const member = guideToMarkdown(guideFor(null));
    expect(member).toContain("`task_create`");
    expect(member).not.toContain("`account_list`");
    expect(member).not.toContain("### 后台");

    const owner = guideToMarkdown(guideFor("owner"));
    expect(owner).toContain("### 后台");
    expect(owner).toContain("`account_set_project_role`");
    expect(owner).toContain("后台角色：所有者");
  });

  it("explains tokens for clients without OAuth, without ever holding one", () => {
    const markdown = guideToMarkdown(guideFor(null));
    expect(markdown).toContain("## 客户端不支持 OAuth 时：用令牌");
    expect(markdown).toContain(`--header "Authorization: Bearer <令牌>"`);
    expect(markdown).not.toMatch(/bsh_(pat|at|rt)_/);
    expect(markdown).toContain("## 断线和重新登录");
  });

  it("says what an AI cannot do, and how to stay safe", () => {
    const markdown = guideToMarkdown(guideFor(null));
    for (const item of mcpNotOffered) expect(markdown).toContain(`- ${item}`);
    expect(markdown).toContain("## 安全须知");
    expect(markdown).toMatch(/^1\. /m);
    expect(markdown.endsWith("\n")).toBe(true);
  });
});
