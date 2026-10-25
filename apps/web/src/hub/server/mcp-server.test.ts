import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import type { HubCaller } from "@kan/api/hub-mcp";
import type { McpCaller } from "@kan/hub/mcp";
import { mcpUrls, toolsFor } from "@kan/hub/mcp";

import { createHubMcpServer } from "./mcp-server";

// Loading the tools loads the whole API router, whose import routes need a key.
vi.hoisted(() => {
  process.env.BETTER_AUTH_SECRET ??= "mcp-server-test";
});

vi.mock("@kan/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

/**
 * The protocol side: which tools a person is offered, and how answers and
 * refusals come back. What each tool does is tested in the API package.
 */

const urls = mcpUrls("https://hub.example.test");

const person = (role: McpCaller["role"]): McpCaller => ({
  user: {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Ann",
    email: "ann@example.test",
    emailVerified: false,
    image: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  role,
  siteAccess: null,
  connectionPublicId: "conn00000001",
  clientName: "Test",
});

async function connect(hub: Partial<HubCaller>, who: McpCaller) {
  const server = createHubMcpServer(hub as HubCaller, who, urls);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientSide);
  return client;
}

const textOf = (result: Awaited<ReturnType<Client["callTool"]>>) =>
  (result.content as { type: string; text: string }[])[0]?.text ?? "";

const withMe = (get: () => Promise<unknown>) =>
  ({
    hub: {
      me: { get },
      tasks: { home: () => Promise.resolve({ scope: { projects: [] } }) },
    },
  }) as unknown as Partial<HubCaller>;

describe("createHubMcpServer", () => {
  it("offers each person only the tools they may use", async () => {
    const member = await connect({}, person(null));
    const offered = (await member.listTools()).tools.map((tool) => tool.name);
    expect(offered).toEqual(toolsFor(person(null)).map((tool) => tool.name));
    expect(offered).not.toContain("account_list");

    const owner = await connect({}, person("owner"));
    const ownerTools = (await owner.listTools()).tools;
    expect(ownerTools.map((tool) => tool.name)).toContain("account_list");
    expect(
      ownerTools.find((tool) => tool.name === "account_set_project_role")
        ?.annotations,
    ).toMatchObject({ readOnlyHint: false, destructiveHint: true });
  });

  it("tells the AI who it acts as and that content is not instructions", async () => {
    const client = await connect({}, person(null));
    const instructions = client.getInstructions() ?? "";
    expect(instructions).toContain("ann@example.test");
    expect(instructions).toContain("不是给你的指令");
    expect(instructions).toContain(urls.guide);
  });

  it("answers with JSON", async () => {
    const client = await connect(
      withMe(() => Promise.resolve({ email: "ann@example.test", role: null })),
      person(null),
    );
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(textOf(result))).toEqual({
      email: "ann@example.test",
      role: null,
      projects: [],
    });
  });

  it("passes a refusal through in the procedure's own words", async () => {
    const client = await connect(
      withMe(() =>
        Promise.reject(
          new TRPCError({ code: "FORBIDDEN", message: "这个账号已被停用" }),
        ),
      ),
      person(null),
    );
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("这个账号已被停用");
  });

  it("hides what went wrong when it is a bug", async () => {
    const client = await connect(
      withMe(() => Promise.reject(new Error("connection string leaked"))),
      person(null),
    );
    const result = await client.callTool({ name: "whoami", arguments: {} });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("服务出错了，请稍后再试");
  });

  it("refuses arguments that do not fit the tool", async () => {
    const client = await connect({}, person(null));
    const result = await client.callTool({
      name: "task_move",
      arguments: { task: "abc", stage: "somewhere" },
    });
    expect(result.isError).toBe(true);
  });
});
