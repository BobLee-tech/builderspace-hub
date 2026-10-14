import { describe, expect, it } from "vitest";

import { createGitHubClient, GitHubAuthError } from "./github.client";

const now = new Date("2026-10-14T00:00:00Z");

/** A fetch that answers from a table of path → response, and records calls. */
function fakeFetch(
  routes: Record<
    string,
    | { status?: number; body?: unknown; headers?: Record<string, string> }
    | "throw"
  >,
) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    calls.push({ url, init });
    const key = Object.keys(routes).find((k) => url.includes(k));
    const route = key ? routes[key] : undefined;
    if (route === "throw") return Promise.reject(new Error("network down"));
    return Promise.resolve(
      new Response(JSON.stringify(route?.body ?? {}), {
        status: route?.status ?? 200,
        headers: route?.headers,
      }),
    );
  }) as typeof fetch;
  return { impl, calls };
}

const clientWith = (routes: Parameters<typeof fakeFetch>[0]) => {
  const fake = fakeFetch(routes);
  return {
    client: createGitHubClient({
      clientId: "Iv1.test",
      clientSecret: "secret",
      fetch: fake.impl,
      now: () => now,
    }),
    calls: fake.calls,
  };
};

describe("tokens", () => {
  it("exchanges a code and works out when the tokens expire", async () => {
    const { client, calls } = clientWith({
      "/login/oauth/access_token": {
        body: {
          access_token: "ghu_a",
          expires_in: 28800,
          refresh_token: "ghr_b",
          refresh_token_expires_in: 15811200,
        },
      },
    });

    const tokens = await client.exchangeCode("code-1", "https://hub/cb");

    expect(tokens).toEqual({
      accessToken: "ghu_a",
      accessTokenExpiresAt: new Date(now.getTime() + 28800 * 1000),
      refreshToken: "ghr_b",
      refreshTokenExpiresAt: new Date(now.getTime() + 15811200 * 1000),
    });
    expect(JSON.parse(calls[0]?.init?.body as string)).toMatchObject({
      client_id: "Iv1.test",
      code: "code-1",
      redirect_uri: "https://hub/cb",
    });
  });

  it("treats GitHub's error answer as a failed authorisation", async () => {
    const { client } = clientWith({
      "/login/oauth/access_token": { body: { error: "bad_verification_code" } },
    });
    await expect(client.exchangeCode("x", "y")).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
  });

  it("revokes quietly even when GitHub is unreachable", async () => {
    const { client } = clientWith({ "/applications/": "throw" });
    await expect(client.revoke("ghu_a")).resolves.toBeUndefined();
  });
});

describe("reading repositories", () => {
  it("maps commits, pulls and issues to plain values", async () => {
    const { client, calls } = clientWith({
      "/commits": {
        body: [
          {
            sha: "abc",
            html_url: "https://github.com/c/a/commit/abc",
            commit: {
              message: "Fix login\n\nlong body",
              author: { date: "2026-10-01T00:00:00Z" },
            },
          },
        ],
      },
      "/pulls": {
        body: [
          {
            number: 7,
            title: "Add page",
            html_url: "https://github.com/c/a/pull/7",
            user: { login: "me" },
            created_at: "2026-10-02T00:00:00Z",
            merged_at: null,
          },
        ],
      },
      "/issues": {
        body: [
          {
            number: 8,
            title: "Bug",
            html_url: "https://github.com/c/a/issues/8",
            user: { login: "me" },
            created_at: "2026-10-03T00:00:00Z",
          },
          {
            number: 7,
            title: "PR",
            user: { login: "me" },
            created_at: "2026-10-02T00:00:00Z",
            pull_request: {},
          },
        ],
      },
    });
    const since = new Date("2026-07-16T00:00:00Z");

    const commits = await client.commits("t", "c/a", { author: "me", since });
    const pulls = await client.pulls("t", "c/a");
    const issues = await client.issues("t", "c/a", { creator: "me", since });

    expect(commits).toEqual({
      ok: true,
      items: [
        {
          sha: "abc",
          message: "Fix login\n\nlong body",
          url: "https://github.com/c/a/commit/abc",
          authoredAt: new Date("2026-10-01T00:00:00Z"),
        },
      ],
    });
    expect(pulls).toMatchObject({
      ok: true,
      items: [{ number: 7, authorLogin: "me", mergedAt: null }],
    });
    expect(issues).toMatchObject({
      ok: true,
      items: [
        { number: 8, isPullRequest: false },
        { number: 7, isPullRequest: true },
      ],
    });
    expect(calls[0]?.url).toContain("author=me");
    expect(calls[0]?.url).toContain("since=2026-07-16T00:00:00.000Z");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer t",
    );
  });

  it("calls a missing or forbidden repository no access, and a rate limit a failure", async () => {
    const missing = clientWith({ "/pulls": { status: 404 } });
    const limited = clientWith({
      "/pulls": { status: 403, headers: { "x-ratelimit-remaining": "0" } },
    });
    const down = clientWith({ "/pulls": "throw" });

    expect(await missing.client.pulls("t", "c/a")).toEqual({
      ok: false,
      reason: "no_access",
    });
    expect(await limited.client.pulls("t", "c/a")).toEqual({
      ok: false,
      reason: "failed",
    });
    expect(await down.client.pulls("t", "c/a")).toEqual({
      ok: false,
      reason: "failed",
    });
  });

  it("raises on a token GitHub no longer accepts", async () => {
    const { client } = clientWith({
      "/pulls": { status: 401 },
      "/user": { status: 401 },
    });
    await expect(client.pulls("t", "c/a")).rejects.toBeInstanceOf(
      GitHubAuthError,
    );
    await expect(client.me("t")).rejects.toBeInstanceOf(GitHubAuthError);
  });

  it("reads who the token belongs to", async () => {
    const { client } = clientWith({
      "/user": {
        body: { id: 42, login: "me", avatar_url: "https://avatars/42" },
      },
    });
    expect(await client.me("t")).toEqual({
      id: 42,
      login: "me",
      avatarUrl: "https://avatars/42",
    });
  });
});
