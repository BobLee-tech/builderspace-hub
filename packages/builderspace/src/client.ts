import { z } from "zod";

import type { HubClient } from "./types";

export class HubApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HubApiError";
    this.status = status;
  }
}

export interface HubClientConfig {
  /** Origin of the Hub, e.g. `https://hub.example.com`. */
  baseUrl: string;
  /** Created in the Hub under 设置 → API. Sent as `x-api-key`; never logged. */
  apiKey: string;
  fetch?: typeof fetch;
}

const workspaceSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
});

const workspaceListSchema = z.array(z.object({ workspace: workspaceSchema }));

const boardListSchema = z.array(
  z.object({
    publicId: z.string(),
    name: z.string(),
    lists: z.array(
      z.object({ publicId: z.string(), name: z.string(), index: z.number() }),
    ),
    labels: z.array(z.object({ publicId: z.string(), name: z.string() })),
  }),
);

const boardCreatedSchema = z.object({ publicId: z.string(), name: z.string() });

const boardDetailSchema = z.object({
  lists: z.array(z.object({ cards: z.array(z.object({ title: z.string() })) })),
});

const cardCreatedSchema = z.object({ publicId: z.string() });

const errorBodySchema = z.object({ message: z.string() });

const segment = (value: string): string => encodeURIComponent(value);

/** Minimal client for the Hub's REST API (`/api/v1`, see `/api/v1/openapi.json`). */
export function createHubClient(config: HubClientConfig): HubClient {
  const fetchImpl = config.fetch ?? fetch;
  const root = `${config.baseUrl.replace(/\/+$/, "")}/api/v1`;

  const request = async <T>(
    method: "GET" | "POST",
    path: string,
    schema: z.ZodType<T>,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetchImpl(`${root}${path}`, {
      method,
      headers: {
        accept: "application/json",
        "x-api-key": config.apiKey,
        ...(body !== undefined && { "content-type": "application/json" }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });

    const text = await response.text();
    let payload: unknown;
    try {
      payload = text === "" ? undefined : JSON.parse(text);
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const serverMessage = errorBodySchema.safeParse(payload);
      const detail =
        response.status === 401
          ? "API key 无效或已过期，请在 Hub 的 设置 → API 重新创建"
          : serverMessage.success
            ? serverMessage.data.message
            : response.statusText || "请求失败";
      throw new HubApiError(
        response.status,
        `${method} ${path} → ${response.status}: ${detail}`,
      );
    }

    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`${method} ${path} 返回了意料之外的数据结构`);
    }
    return parsed.data;
  };

  return {
    listWorkspaces: async () =>
      (await request("GET", "/workspaces", workspaceListSchema)).map(
        (item) => item.workspace,
      ),

    createWorkspace: (input) =>
      request("POST", "/workspaces", workspaceSchema, input),

    listBoards: async (workspacePublicId) =>
      (
        await request(
          "GET",
          `/workspaces/${segment(workspacePublicId)}/boards`,
          boardListSchema,
        )
      ).map((board) => ({
        ...board,
        lists: [...board.lists].sort((a, b) => a.index - b.index),
      })),

    createBoard: (workspacePublicId, input) =>
      request(
        "POST",
        `/workspaces/${segment(workspacePublicId)}/boards`,
        boardCreatedSchema,
        input,
      ),

    listCardTitles: async (boardPublicId) =>
      (
        await request(
          "GET",
          `/boards/${segment(boardPublicId)}`,
          boardDetailSchema,
        )
      ).lists.flatMap((list) => list.cards.map((card) => card.title)),

    createCard: (input) =>
      request("POST", "/cards", cardCreatedSchema, {
        ...input,
        memberPublicIds: [],
        position: "end",
      }),
  };
}
