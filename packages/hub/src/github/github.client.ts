/**
 * The few GitHub calls the Hub makes, behind an interface so use cases can be
 * tested without the network. Everything is read-only except the token
 * endpoints. Lists read one page of 100, which covers a club project's 90 days.
 */

export interface GitHubTokens {
  accessToken: string;
  accessTokenExpiresAt: Date | null;
  refreshToken: string | null;
  refreshTokenExpiresAt: Date | null;
}

export interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string | null;
}

export interface RawCommit {
  sha: string;
  message: string;
  url: string;
  authoredAt: Date;
}

export interface RawPull {
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  createdAt: Date;
  mergedAt: Date | null;
}

export interface RawIssue {
  number: number;
  title: string;
  url: string;
  authorLogin: string | null;
  createdAt: Date;
  isPullRequest: boolean;
}

/** A repository could not be read: the App is not installed on it or the person has no access, or GitHub failed. */
export type RepoRead<T> =
  | { ok: true; items: T[] }
  | { ok: false; reason: "no_access" | "failed" };

/** GitHub no longer accepts the token: the person has to connect again. */
export class GitHubAuthError extends Error {
  constructor(message = "GitHub authorisation is no longer valid") {
    super(message);
    this.name = "GitHubAuthError";
  }
}

export interface GitHubClient {
  exchangeCode(code: string, redirectUri: string): Promise<GitHubTokens>;
  refresh(refreshToken: string): Promise<GitHubTokens>;
  revoke(accessToken: string): Promise<void>;
  me(token: string): Promise<GitHubUser>;
  commits(
    token: string,
    repo: string,
    query: { author: string; since: Date },
  ): Promise<RepoRead<RawCommit>>;
  pulls(token: string, repo: string): Promise<RepoRead<RawPull>>;
  issues(
    token: string,
    repo: string,
    query: { creator: string; since: Date },
  ): Promise<RepoRead<RawIssue>>;
}

interface Config {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
  now?: () => Date;
}

const API = "https://api.github.com";
const TIMEOUT_MS = 8_000;

const date = (value: unknown): Date | null =>
  typeof value === "string" && value ? new Date(value) : null;
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function createGitHubClient(config: Config): GitHubClient {
  const doFetch = config.fetch ?? fetch;
  const now = config.now ?? (() => new Date());

  const api = (token: string, path: string) =>
    doFetch(`${API}${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "builderspace-hub",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  async function list<T>(
    token: string,
    path: string,
    map: (item: Record<string, unknown>) => T,
  ): Promise<RepoRead<T>> {
    let response: Response;
    try {
      response = await api(token, path);
    } catch {
      return { ok: false, reason: "failed" };
    }
    if (response.status === 401) throw new GitHubAuthError();
    if (response.status === 404 || response.status === 403) {
      const rateLimited = response.headers.get("x-ratelimit-remaining") === "0";
      return { ok: false, reason: rateLimited ? "failed" : "no_access" };
    }
    if (!response.ok) return { ok: false, reason: "failed" };
    const body: unknown = await response.json();
    return Array.isArray(body)
      ? { ok: true, items: (body as Record<string, unknown>[]).map(map) }
      : { ok: false, reason: "failed" };
  }

  async function tokenRequest(
    params: Record<string, string>,
  ): Promise<GitHubTokens> {
    const response = await doFetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "builderspace-hub",
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          ...params,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    const body = (await response.json()) as Record<string, unknown>;
    const accessToken = str(body.access_token);
    if (!response.ok || !accessToken) {
      throw new GitHubAuthError(str(body.error) || "token request failed");
    }
    const at = now().getTime();
    const inSeconds = (value: unknown) =>
      typeof value === "number" ? new Date(at + value * 1000) : null;
    return {
      accessToken,
      accessTokenExpiresAt: inSeconds(body.expires_in),
      refreshToken: str(body.refresh_token) || null,
      refreshTokenExpiresAt: inSeconds(body.refresh_token_expires_in),
    };
  }

  const author = (item: Record<string, unknown>) => {
    const user = item.user as Record<string, unknown> | null | undefined;
    return user ? str(user.login) || null : null;
  };

  return {
    exchangeCode: (code, redirectUri) =>
      tokenRequest({ code, redirect_uri: redirectUri }),

    refresh: (refreshToken) =>
      tokenRequest({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),

    async revoke(accessToken) {
      const basic = Buffer.from(
        `${config.clientId}:${config.clientSecret}`,
      ).toString("base64");
      await doFetch(`${API}/applications/${config.clientId}/token`, {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${basic}`,
          "User-Agent": "builderspace-hub",
        },
        body: JSON.stringify({ access_token: accessToken }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      }).catch(() => undefined);
    },

    async me(token) {
      const response = await api(token, "/user");
      if (response.status === 401) throw new GitHubAuthError();
      if (!response.ok) throw new Error(`GitHub /user: ${response.status}`);
      const body = (await response.json()) as Record<string, unknown>;
      return {
        id: Number(body.id),
        login: str(body.login),
        avatarUrl: str(body.avatar_url) || null,
      };
    },

    commits: (token, repo, query) =>
      list(
        token,
        `/repos/${repo}/commits?author=${encodeURIComponent(query.author)}&since=${query.since.toISOString()}&per_page=100`,
        (item) => {
          const commit = (item.commit ?? {}) as Record<string, unknown>;
          const authored = (commit.author ?? {}) as Record<string, unknown>;
          return {
            sha: str(item.sha),
            message: str(commit.message),
            url: str(item.html_url),
            authoredAt: date(authored.date) ?? new Date(0),
          };
        },
      ),

    pulls: (token, repo) =>
      list(
        token,
        `/repos/${repo}/pulls?state=all&sort=created&direction=desc&per_page=100`,
        (item) => ({
          number: Number(item.number),
          title: str(item.title),
          url: str(item.html_url),
          authorLogin: author(item),
          createdAt: date(item.created_at) ?? new Date(0),
          mergedAt: date(item.merged_at),
        }),
      ),

    issues: (token, repo, query) =>
      list(
        token,
        `/repos/${repo}/issues?creator=${encodeURIComponent(query.creator)}&state=all&since=${query.since.toISOString()}&per_page=100`,
        (item) => ({
          number: Number(item.number),
          title: str(item.title),
          url: str(item.html_url),
          authorLogin: author(item),
          createdAt: date(item.created_at) ?? new Date(0),
          isPullRequest: item.pull_request !== undefined,
        }),
      ),
  };
}
