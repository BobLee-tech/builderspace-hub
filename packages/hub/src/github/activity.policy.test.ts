import { describe, expect, it } from "vitest";

import {
  canSyncAgain,
  countWithin,
  eventsFrom,
  needsRefresh,
  SYNC_COOLDOWN_MS,
  syncSince,
} from "./activity.policy";

const now = new Date("2026-10-14T00:00:00Z");
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
const since = syncSince(now);

describe("eventsFrom", () => {
  const pull = (
    overrides: Partial<Parameters<typeof eventsFrom>[0]["pulls"][number]>,
  ) => ({
    number: 1,
    title: "PR",
    url: "u",
    authorLogin: "Me",
    createdAt: daysAgo(5),
    mergedAt: null,
    ...overrides,
  });

  it("turns commits into events titled by their first line", () => {
    const events = eventsFrom({
      repo: "c/a",
      login: "me",
      since,
      commits: [
        {
          sha: "abc1234",
          message: "Fix login\n\ndetails",
          url: "u1",
          authoredAt: daysAgo(3),
        },
        { sha: "old", message: "Too old", url: "u2", authoredAt: daysAgo(120) },
        { sha: "def5678", message: "", url: "u3", authoredAt: daysAgo(1) },
      ],
      pulls: [],
      issues: [],
    });

    expect(events.map((e) => [e.kind, e.ref, e.title])).toEqual([
      ["commit", "abc1234", "Fix login"],
      ["commit", "def5678", "def5678"],
    ]);
  });

  it("counts my pull requests when opened and again when merged, case-insensitively", () => {
    const events = eventsFrom({
      repo: "c/a",
      login: "me",
      since,
      commits: [],
      pulls: [
        pull({ number: 1, mergedAt: daysAgo(2) }),
        pull({ number: 2 }),
        pull({ number: 3, authorLogin: "someone" }),
        pull({ number: 4, createdAt: daysAgo(200), mergedAt: daysAgo(10) }),
      ],
      issues: [],
    });

    expect(events.map((e) => [e.kind, e.ref])).toEqual([
      ["pr_opened", "1"],
      ["pr_merged", "1"],
      ["pr_opened", "2"],
      ["pr_merged", "4"],
    ]);
  });

  it("counts my issues but not pull requests posing as issues", () => {
    const issue = {
      title: "Bug",
      url: "u",
      authorLogin: "me",
      createdAt: daysAgo(4),
    };
    const events = eventsFrom({
      repo: "c/a",
      login: "me",
      since,
      commits: [],
      pulls: [],
      issues: [
        { ...issue, number: 8, isPullRequest: false },
        { ...issue, number: 9, isPullRequest: true },
        { ...issue, number: 10, isPullRequest: false, authorLogin: "other" },
        { ...issue, number: 11, isPullRequest: false, createdAt: daysAgo(100) },
      ],
    });

    expect(events.map((e) => [e.kind, e.ref])).toEqual([["issue_opened", "8"]]);
  });
});

describe("countWithin", () => {
  it("counts each kind inside the window only", () => {
    const events = [
      { kind: "commit" as const, occurredAt: daysAgo(1) },
      { kind: "commit" as const, occurredAt: daysAgo(40) },
      { kind: "pr_merged" as const, occurredAt: daysAgo(29) },
    ];
    expect(countWithin(events, 30, now)).toEqual({
      commit: 1,
      pr_opened: 0,
      pr_merged: 1,
      issue_opened: 0,
    });
    expect(countWithin(events, 90, now).commit).toBe(2);
  });
});

describe("timing", () => {
  it("allows one sync a minute", () => {
    expect(canSyncAgain(null, now)).toBe(true);
    expect(
      canSyncAgain(new Date(now.getTime() - SYNC_COOLDOWN_MS + 1), now),
    ).toBe(false);
    expect(canSyncAgain(new Date(now.getTime() - SYNC_COOLDOWN_MS), now)).toBe(
      true,
    );
  });

  it("refreshes a token shortly before it expires, and never one without an expiry", () => {
    expect(needsRefresh(null, now)).toBe(false);
    expect(needsRefresh(new Date(now.getTime() + 30_000), now)).toBe(true);
    expect(needsRefresh(new Date(now.getTime() + 3_600_000), now)).toBe(false);
  });
});
