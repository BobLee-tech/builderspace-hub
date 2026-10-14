import { describe, expect, it, vi } from "vitest";

import { createHubClient, HubApiError } from "./client";

const API_KEY = "kan_test_key_do_not_leak";

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const setup = (...responses: Response[]) => {
  const fetchMock = vi.fn<typeof fetch>();
  for (const response of responses) fetchMock.mockResolvedValueOnce(response);
  const client = createHubClient({
    baseUrl: "https://hub.example.com/",
    apiKey: API_KEY,
    fetch: fetchMock,
  });
  return { client, fetchMock };
};

const callOf = (fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, n = 0) => {
  const call = fetchMock.mock.calls[n];
  if (!call) throw new Error(`fetch call #${n} was never made`);
  const [url, init = {}] = call;
  if (typeof url !== "string") throw new Error("expected a string URL");
  return {
    url,
    init,
    headers: new Headers(init.headers),
    body:
      typeof init.body === "string"
        ? (JSON.parse(init.body) as unknown)
        : undefined,
  };
};

describe("createHubClient", () => {
  it("authenticates every request with the API key header", async () => {
    const { client, fetchMock } = setup(jsonResponse([]));

    await client.listWorkspaces();

    const call = callOf(fetchMock);
    expect(call.url).toBe("https://hub.example.com/api/v1/workspaces");
    expect(call.init.method).toBe("GET");
    expect(call.headers.get("x-api-key")).toBe(API_KEY);
    expect(call.headers.get("accept")).toBe("application/json");
  });

  it("flattens the workspace list", async () => {
    const { client } = setup(
      jsonResponse([
        {
          role: "admin",
          workspace: {
            publicId: "ws0000000001",
            name: "社群",
            slug: "bss-community",
            plan: "free",
          },
        },
      ]),
    );

    await expect(client.listWorkspaces()).resolves.toEqual([
      { publicId: "ws0000000001", name: "社群", slug: "bss-community" },
    ]);
  });

  it("creates a workspace with a JSON body", async () => {
    const { client, fetchMock } = setup(
      jsonResponse({
        publicId: "ws0000000001",
        name: "社群",
        slug: "bss-community",
        description: null,
        plan: "free",
        cardPrefix: "",
      }),
    );

    const ws = await client.createWorkspace({
      name: "社群",
      slug: "bss-community",
      description: "BuilderSpace 社群",
    });

    const call = callOf(fetchMock);
    expect(call.init.method).toBe("POST");
    expect(call.headers.get("content-type")).toBe("application/json");
    expect(call.body).toEqual({
      name: "社群",
      slug: "bss-community",
      description: "BuilderSpace 社群",
    });
    expect(ws).toEqual({
      publicId: "ws0000000001",
      name: "社群",
      slug: "bss-community",
    });
  });

  it("lists and creates boards under a workspace", async () => {
    const { client, fetchMock } = setup(
      jsonResponse([
        {
          publicId: "bd0000000001",
          name: "开发",
          favorite: false,
          lists: [
            { publicId: "ls0000000002", name: "进行中", index: 1 },
            { publicId: "ls0000000001", name: "待办", index: 0 },
          ],
          labels: [
            { publicId: "lb0000000001", name: "P0", colourCode: "#0d9488" },
          ],
        },
      ]),
      jsonResponse({ publicId: "bd0000000002", name: "运营" }),
    );

    const boards = await client.listBoards("ws0000000001");
    const created = await client.createBoard("ws0000000001", {
      name: "运营",
      lists: ["待办"],
      labels: ["P0"],
    });

    expect(callOf(fetchMock, 0).url).toBe(
      "https://hub.example.com/api/v1/workspaces/ws0000000001/boards",
    );
    expect(boards).toEqual([
      {
        publicId: "bd0000000001",
        name: "开发",
        lists: [
          { publicId: "ls0000000001", name: "待办", index: 0 },
          { publicId: "ls0000000002", name: "进行中", index: 1 },
        ],
        labels: [{ publicId: "lb0000000001", name: "P0" }],
      },
    ]);
    expect(callOf(fetchMock, 1).init.method).toBe("POST");
    expect(callOf(fetchMock, 1).body).toEqual({
      name: "运营",
      lists: ["待办"],
      labels: ["P0"],
    });
    expect(created).toEqual({ publicId: "bd0000000002", name: "运营" });
  });

  it("collects card titles across all lists of a board", async () => {
    const { client, fetchMock } = setup(
      jsonResponse({
        publicId: "bd0000000001",
        lists: [
          { publicId: "ls1", cards: [{ title: "A" }, { title: "B" }] },
          { publicId: "ls2", cards: [{ title: "C" }] },
        ],
      }),
    );

    await expect(client.listCardTitles("bd0000000001")).resolves.toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(callOf(fetchMock).url).toBe(
      "https://hub.example.com/api/v1/boards/bd0000000001",
    );
  });

  it("creates cards at the end of the list, unassigned", async () => {
    const { client, fetchMock } = setup(
      jsonResponse({ publicId: "cd0000000001" }),
    );

    await client.createCard({
      title: "官网初版",
      description: "<p>x</p>",
      listPublicId: "ls0000000001",
      labelPublicIds: ["lb0000000001"],
    });

    expect(callOf(fetchMock).url).toBe("https://hub.example.com/api/v1/cards");
    expect(callOf(fetchMock).body).toEqual({
      title: "官网初版",
      description: "<p>x</p>",
      listPublicId: "ls0000000001",
      labelPublicIds: ["lb0000000001"],
      memberPublicIds: [],
      position: "end",
    });
  });

  it("escapes path parameters", async () => {
    const { client, fetchMock } = setup(jsonResponse([]));

    await client.listBoards("../admin?x=1");

    expect(callOf(fetchMock).url).toBe(
      "https://hub.example.com/api/v1/workspaces/..%2Fadmin%3Fx%3D1/boards",
    );
  });

  it("turns API errors into HubApiError with the server message", async () => {
    const { client } = setup(
      jsonResponse({ message: "Workspace slug is already taken" }, 400),
    );

    const error = await client
      .createWorkspace({ name: "社群", slug: "bss-community" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HubApiError);
    expect((error as HubApiError).status).toBe(400);
    expect((error as HubApiError).message).toBe(
      "POST /workspaces → 400: Workspace slug is already taken",
    );
  });

  it("explains a 401 without echoing the key", async () => {
    const { client } = setup(new Response("nope", { status: 401 }));

    const error = (await client
      .listWorkspaces()
      .catch((e: unknown) => e)) as HubApiError;

    expect(error.status).toBe(401);
    expect(error.message).toContain("API key 无效或已过期");
    expect(error.message).not.toContain(API_KEY);
  });

  it("rejects a response that does not match the expected shape", async () => {
    const { client } = setup(jsonResponse({ unexpected: true }));

    await expect(client.listWorkspaces()).rejects.toThrow(
      "GET /workspaces 返回了意料之外的数据结构",
    );
  });
});
