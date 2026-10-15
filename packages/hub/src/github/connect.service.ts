import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { GitHubEventKind } from "../schema";
import type { CountWindow, KindCounts, NewEvent } from "./activity.policy";
import type { GitHubClient } from "./github.client";
import type { ConnectionRow } from "./connection.repo";
import { withAudit } from "../audit";
import { HubError } from "../shared/errors";
import {
  canSyncAgain,
  COUNT_WINDOWS,
  countWithin,
  eventsFrom,
  needsRefresh,
  RECENT_EVENTS_LIMIT,
  syncSince,
} from "./activity.policy";
import {
  deleteConnection,
  findConnection,
  listEvents,
  markSynced,
  saveConnection,
  updateTokens,
  upsertEvents,
} from "./connection.repo";
import { GitHubAuthError } from "./github.client";
import { repoUrl } from "./repo.policy";
import { listReposForUser } from "./repo.service";
import { decryptToken, encryptToken } from "./token-crypto";

/**
 * Connecting a person's GitHub account through the Hub's GitHub App, reading
 * what they did in the repositories of their projects, and showing it.
 *
 * Only repositories linked to projects the person can see are ever read or
 * shown, checked again every time, so leaving a project removes its activity.
 */

export interface GitHubDeps {
  client: GitHubClient;
  /** The app's auth secret; GitHub tokens are encrypted with a key from it. */
  secret: string;
}

export interface GitHubSummary {
  connection: {
    login: string;
    avatarUrl: string | null;
    connectedAt: Date;
    lastSyncedAt: Date | null;
  } | null;
  /** The repositories that count for this person, with their projects. */
  repos: { fullName: string; url: string; projects: string[] }[];
  counts: Record<CountWindow, KindCounts>;
  /** Over the longest window. */
  byProject: { project: { publicId: string; name: string }; counts: KindCounts }[];
  recent: {
    kind: GitHubEventKind;
    title: string;
    url: string;
    repoFullName: string;
    occurredAt: Date;
  }[];
}

export interface SyncReport {
  events: number;
  repos: { fullName: string; status: "ok" | "no_access" | "failed" }[];
}

const RECONNECT = "GitHub 授权已失效，请重新连接 GitHub。";

/** Repositories read at once during a sync; keeps clear of GitHub's burst limits. */
const SYNC_CONCURRENCY = 4;

export async function completeConnect(
  db: Db,
  actor: AuditActor & { userId: string },
  input: { code: string; redirectUri: string; now: Date },
  deps: GitHubDeps,
): Promise<{ login: string }> {
  let login: string;
  try {
    const tokens = await deps.client.exchangeCode(input.code, input.redirectUri);
    const user = await deps.client.me(tokens.accessToken);
    login = user.login;
    await withAudit(
      db,
      (tx) =>
        saveConnection(tx, {
          userId: actor.userId,
          githubId: user.id,
          login: user.login,
          avatarUrl: user.avatarUrl,
          accessToken: encryptToken(tokens.accessToken, deps.secret),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshToken: tokens.refreshToken
            ? encryptToken(tokens.refreshToken, deps.secret)
            : null,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          connectedAt: input.now,
        }),
      () => ({
        actor,
        action: "github.connected",
        entityType: "account",
        entityId: actor.userId,
        summary: `连接了 GitHub 账号 ${user.login}`,
      }),
    );
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      throw new HubError("INVALID_INPUT", "GitHub 授权没有成功，请再试一次。");
    }
    throw error;
  }
  return { login };
}

/** A token GitHub will accept now, refreshing it first when it is about to expire. */
async function usableToken(
  db: Db,
  connection: ConnectionRow,
  deps: GitHubDeps,
  now: Date,
): Promise<string> {
  const access = decryptToken(connection.accessToken, deps.secret);
  if (access && !needsRefresh(connection.accessTokenExpiresAt, now)) {
    return access;
  }

  const refresh = connection.refreshToken
    ? decryptToken(connection.refreshToken, deps.secret)
    : null;
  const refreshExpired =
    connection.refreshTokenExpiresAt !== null &&
    connection.refreshTokenExpiresAt <= now;
  if (!refresh || refreshExpired) throw new HubError("CONFLICT", RECONNECT);

  try {
    const tokens = await deps.client.refresh(refresh);
    await updateTokens(db, connection.userId, {
      accessToken: encryptToken(tokens.accessToken, deps.secret),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshToken: tokens.refreshToken
        ? encryptToken(tokens.refreshToken, deps.secret)
        : connection.refreshToken,
      refreshTokenExpiresAt:
        tokens.refreshTokenExpiresAt ?? connection.refreshTokenExpiresAt,
    });
    return tokens.accessToken;
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      throw new HubError("CONFLICT", RECONNECT);
    }
    throw error;
  }
}

async function readRepo(
  client: GitHubClient,
  token: string,
  repo: string,
  login: string,
  since: Date,
): Promise<{ status: SyncReport["repos"][number]["status"]; events: NewEvent[] }> {
  const [commits, pulls, issues] = await Promise.all([
    client.commits(token, repo, { author: login, since }),
    client.pulls(token, repo),
    client.issues(token, repo, { creator: login, since }),
  ]);
  if (!commits.ok) return { status: commits.reason, events: [] };
  if (!pulls.ok) return { status: pulls.reason, events: [] };
  if (!issues.ok) return { status: issues.reason, events: [] };

  return {
    status: "ok",
    events: eventsFrom({
      repo,
      login,
      since,
      commits: commits.items,
      pulls: pulls.items,
      issues: issues.items,
    }),
  };
}

/** Reads the last SYNC_DAYS of this person's activity in their projects' repositories. */
export async function syncGitHub(
  db: Db,
  input: { userId: string; now: Date },
  deps: GitHubDeps,
): Promise<SyncReport> {
  const connection = await findConnection(db, input.userId);
  if (!connection) throw new HubError("NOT_FOUND", "还没有连接 GitHub。");
  if (!canSyncAgain(connection.lastSyncedAt, input.now)) {
    throw new HubError("CONFLICT", "刚刚同步过，请过一分钟再试。");
  }

  const token = await usableToken(db, connection, deps, input.now);
  const repos = [
    ...new Set(
      (await listReposForUser(db, input.userId)).map((r) => r.fullName),
    ),
  ];
  const since = syncSince(input.now);

  const results: SyncReport["repos"] = [];
  const events: NewEvent[] = [];
  try {
    for (let i = 0; i < repos.length; i += SYNC_CONCURRENCY) {
      const batch = repos.slice(i, i + SYNC_CONCURRENCY);
      const read = await Promise.all(
        batch.map((repo) =>
          readRepo(deps.client, token, repo, connection.login, since),
        ),
      );
      read.forEach((result, index) => {
        results.push({ fullName: batch[index] ?? "", status: result.status });
        events.push(...result.events);
      });
    }
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      throw new HubError("CONFLICT", RECONNECT);
    }
    throw error;
  }

  await db.transaction(async (tx) => {
    await upsertEvents(tx, input.userId, events);
    await markSynced(tx, input.userId, input.now);
  });
  return { events: events.length, repos: results };
}

export async function getGitHubSummary(
  db: Db,
  input: { userId: string; now: Date },
): Promise<GitHubSummary> {
  const [connection, linked] = await Promise.all([
    findConnection(db, input.userId),
    listReposForUser(db, input.userId),
  ]);

  const projectsByRepo = new Map<string, string[]>();
  for (const { fullName, project } of linked) {
    projectsByRepo.set(fullName, [
      ...(projectsByRepo.get(fullName) ?? []),
      project.name,
    ]);
  }
  const repoNames = [...projectsByRepo.keys()];

  const longest = Math.max(...COUNT_WINDOWS);
  const events = connection
    ? await listEvents(
        db,
        input.userId,
        repoNames,
        new Date(input.now.getTime() - longest * 86_400_000),
      )
    : [];

  const projects = new Map<
    string,
    { project: { publicId: string; name: string }; repos: Set<string> }
  >();
  for (const { fullName, project } of linked) {
    const entry = projects.get(project.publicId) ?? {
      project,
      repos: new Set<string>(),
    };
    entry.repos.add(fullName);
    projects.set(project.publicId, entry);
  }

  return {
    connection: connection
      ? {
          login: connection.login,
          avatarUrl: connection.avatarUrl,
          connectedAt: connection.connectedAt,
          lastSyncedAt: connection.lastSyncedAt,
        }
      : null,
    repos: repoNames.map((fullName) => ({
      fullName,
      url: repoUrl(fullName),
      projects: projectsByRepo.get(fullName) ?? [],
    })),
    counts: Object.fromEntries(
      COUNT_WINDOWS.map((days) => [days, countWithin(events, days, input.now)]),
    ) as Record<CountWindow, KindCounts>,
    byProject: [...projects.values()].map(({ project, repos }) => ({
      project,
      counts: countWithin(
        events.filter((event) => repos.has(event.repoFullName)),
        longest,
        input.now,
      ),
    })),
    recent: events.slice(0, RECENT_EVENTS_LIMIT).map((event) => ({
      kind: event.kind,
      title: event.title,
      url: event.url,
      repoFullName: event.repoFullName,
      occurredAt: event.occurredAt,
    })),
  };
}

/** Forgets the connection and its activity, and asks GitHub to revoke the token. */
export async function disconnectGitHub(
  db: Db,
  actor: AuditActor & { userId: string },
  deps: GitHubDeps,
): Promise<void> {
  const connection = await findConnection(db, actor.userId);
  if (!connection) return;

  const token = decryptToken(connection.accessToken, deps.secret);
  if (token) await deps.client.revoke(token);

  await withAudit(
    db,
    (tx) => deleteConnection(tx, actor.userId),
    () => ({
      actor,
      action: "github.disconnected",
      entityType: "account",
      entityId: actor.userId,
      summary: `断开了 GitHub 账号 ${connection.login}`,
    }),
  );
}
