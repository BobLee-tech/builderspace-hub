import type { GitHubEventKind } from "../schema";
import type { RawCommit, RawIssue, RawPull } from "./github.client";

/**
 * Pure rules for GitHub activity: what counts as something a person did, the
 * windows it is counted in, and how often it may be fetched. No IO.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** How far back a sync reads. */
export const SYNC_DAYS = 90;

/** The windows the page counts in, shortest first. */
export const COUNT_WINDOWS = [30, 90] as const;
export type CountWindow = (typeof COUNT_WINDOWS)[number];

/** A sync reads several GitHub lists per repository; once a minute is plenty. */
export const SYNC_COOLDOWN_MS = 60_000;

/** Refresh a token this long before GitHub says it expires. */
const REFRESH_MARGIN_MS = 60_000;

export const RECENT_EVENTS_LIMIT = 50;

export interface NewEvent {
  repoFullName: string;
  kind: GitHubEventKind;
  ref: string;
  title: string;
  url: string;
  occurredAt: Date;
}

export function syncSince(now: Date): Date {
  return new Date(now.getTime() - SYNC_DAYS * DAY_MS);
}

export function canSyncAgain(lastSyncedAt: Date | null, now: Date): boolean {
  return (
    !lastSyncedAt || now.getTime() - lastSyncedAt.getTime() >= SYNC_COOLDOWN_MS
  );
}

export function needsRefresh(expiresAt: Date | null, now: Date): boolean {
  return (
    expiresAt !== null &&
    expiresAt.getTime() - now.getTime() <= REFRESH_MARGIN_MS
  );
}

const sameLogin = (a: string | null, b: string) =>
  a !== null && a.toLowerCase() === b.toLowerCase();

/** The first line of a commit message, the way GitHub shows it in lists. */
const headline = (message: string) =>
  (message.split("\n")[0] ?? "").trim().slice(0, 200);

/**
 * What this person did in one repository since `since`. Commits arrive
 * already filtered by author; pull requests and issues are filtered here, and
 * issues that are really pull requests are left to the pull-request list.
 */
export function eventsFrom(input: {
  repo: string;
  login: string;
  since: Date;
  commits: readonly RawCommit[];
  pulls: readonly RawPull[];
  issues: readonly RawIssue[];
}): NewEvent[] {
  const { repo, login, since } = input;
  const events: NewEvent[] = [];

  for (const commit of input.commits) {
    if (!commit.sha || commit.authoredAt < since) continue;
    events.push({
      repoFullName: repo,
      kind: "commit",
      ref: commit.sha,
      title: headline(commit.message) || commit.sha.slice(0, 7),
      url: commit.url,
      occurredAt: commit.authoredAt,
    });
  }

  for (const pull of input.pulls) {
    if (!sameLogin(pull.authorLogin, login)) continue;
    const base = {
      repoFullName: repo,
      ref: String(pull.number),
      title: pull.title,
      url: pull.url,
    };
    if (pull.createdAt >= since) {
      events.push({ ...base, kind: "pr_opened", occurredAt: pull.createdAt });
    }
    if (pull.mergedAt && pull.mergedAt >= since) {
      events.push({ ...base, kind: "pr_merged", occurredAt: pull.mergedAt });
    }
  }

  for (const issue of input.issues) {
    if (issue.isPullRequest || !sameLogin(issue.authorLogin, login)) continue;
    if (issue.createdAt < since) continue;
    events.push({
      repoFullName: repo,
      kind: "issue_opened",
      ref: String(issue.number),
      title: issue.title,
      url: issue.url,
      occurredAt: issue.createdAt,
    });
  }

  return events;
}

export type KindCounts = Record<GitHubEventKind, number>;

export function emptyCounts(): KindCounts {
  return { commit: 0, pr_opened: 0, pr_merged: 0, issue_opened: 0 };
}

/** Counts per kind of the events inside the last `days` days. */
export function countWithin(
  events: readonly { kind: GitHubEventKind; occurredAt: Date }[],
  days: number,
  now: Date,
): KindCounts {
  const from = now.getTime() - days * DAY_MS;
  const counts = emptyCounts();
  for (const event of events) {
    if (event.occurredAt.getTime() >= from) counts[event.kind] += 1;
  }
  return counts;
}
