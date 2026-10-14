import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import * as kanSchema from "@kan/db/schema";

import type { Db } from "../db";
import type {
  GitHubClient,
  GitHubTokens,
  RawCommit,
  RawIssue,
  RawPull,
  RepoRead,
} from "./github.client";
import { listAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { hubGitHubAccounts, hubGitHubEvents } from "../schema";
import { createHubTestDb, seedProject, seedUser } from "../testing/test-db";
import {
  completeConnect,
  disconnectGitHub,
  getGitHubSummary,
  syncGitHub,
} from "./connect.service";
import { GitHubAuthError } from "./github.client";
import { addProjectRepo } from "./repo.service";
import { decryptToken } from "./token-crypto";

const secret = "test-secret-test-secret-test-secret-1234";
const now = new Date("2026-10-14T00:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);

interface RepoData {
  commits?: RepoRead<RawCommit>;
  pulls?: RepoRead<RawPull>;
  issues?: RepoRead<RawIssue>;
}

/** A GitHub that answers from fixtures and remembers what it was asked. */
class FakeGitHub implements GitHubClient {
  repos = new Map<string, RepoData>();
  read: string[] = [];
  revoked: string[] = [];
  refreshed = 0;
  tokens: GitHubTokens = {
    accessToken: "ghu_first",
    accessTokenExpiresAt: later(8 * 3_600_000),
    refreshToken: "ghr_first",
    refreshTokenExpiresAt: later(180 * 86_400_000),
  };
  failExchange = false;
  failRefresh = false;
  unauthorised = false;

  exchangeCode() {
    return this.failExchange
      ? Promise.reject(new GitHubAuthError())
      : Promise.resolve(this.tokens);
  }
  refresh() {
    this.refreshed += 1;
    if (this.failRefresh) return Promise.reject(new GitHubAuthError());
    return Promise.resolve({
      accessToken: "ghu_refreshed",
      accessTokenExpiresAt: later(8 * 3_600_000),
      refreshToken: "ghr_refreshed",
      refreshTokenExpiresAt: later(180 * 86_400_000),
    });
  }
  revoke(token: string) {
    this.revoked.push(token);
    return Promise.resolve();
  }
  me() {
    return Promise.resolve({ id: 42, login: "me-gh", avatarUrl: null });
  }
  private answer<T>(repo: string, pick: (d: RepoData) => RepoRead<T> | undefined) {
    this.read.push(repo);
    if (this.unauthorised) return Promise.reject(new GitHubAuthError());
    return Promise.resolve(pick(this.repos.get(repo) ?? {}) ?? { ok: true, items: [] });
  }
  commits(_: string, repo: string) {
    return this.answer(repo, (d) => d.commits);
  }
  pulls(_: string, repo: string) {
    return this.answer(repo, (d) => d.pulls);
  }
  issues(_: string, repo: string) {
    return this.answer(repo, (d) => d.issues);
  }
}

let db: Db;
let github: FakeGitHub;
let me: { id: string; email: string };
let owner: { id: string; email: string };
let coursemate: { id: number; publicId: string; name: string };
let echo: { id: number; publicId: string; name: string };

const deps = () => ({ client: github, secret });
const actor = () => ({ userId: me.id, email: me.email });
const connect = () =>
  completeConnect(db, actor(), { code: "c", redirectUri: "https://hub/cb", now }, deps());
const commit = (sha: string, days: number): RawCommit => ({
  sha,
  message: `Commit ${sha}`,
  url: `https://github.com/x/commit/${sha}`,
  authoredAt: daysAgo(days),
});
const storedEvents = () => db.select().from(hubGitHubEvents);

beforeEach(async () => {
  db = await createHubTestDb();
  github = new FakeGitHub();
  owner = await seedUser(db, { email: "owner@example.test" });
  me = await seedUser(db, { email: "me@example.test" });
  coursemate = await seedProject(db, owner, { name: "CourseMate" });
  echo = await seedProject(db, owner, { name: "EchoAgent" });
  await ensureProjectMember(db, {
    userId: me.id,
    email: me.email,
    workspaceId: coursemate.id,
    role: "member",
    addedBy: owner.id,
  });
  const admin = { userId: owner.id, email: owner.email };
  await addProjectRepo(db, admin, { projectPublicId: coursemate.publicId, repo: "club/coursemate" });
  await addProjectRepo(db, admin, { projectPublicId: echo.publicId, repo: "club/echoagent" });
});

describe("completeConnect", () => {
  it("stores who they are and the tokens encrypted, and logs it", async () => {
    expect(await connect()).toEqual({ login: "me-gh" });

    const [row] = await db.select().from(hubGitHubAccounts);
    expect(row).toMatchObject({ userId: me.id, githubId: 42, login: "me-gh" });
    expect(row?.accessToken).not.toContain("ghu_first");
    expect(decryptToken(row?.accessToken ?? "", secret)).toBe("ghu_first");
    expect(decryptToken(row?.refreshToken ?? "", secret)).toBe("ghr_first");
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({ action: "github.connected", summary: "连接了 GitHub 账号 me-gh" });
    expect(JSON.stringify(entry)).not.toContain("ghu_");
  });

  it("stores nothing when GitHub refuses the code", async () => {
    github.failExchange = true;
    await expect(connect()).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await db.select().from(hubGitHubAccounts)).toEqual([]);
  });
});

describe("syncGitHub", () => {
  it("reads only the repositories of projects they can see", async () => {
    await connect();
    github.repos.set("club/coursemate", { commits: { ok: true, items: [commit("a1", 2)] } });
    github.repos.set("club/echoagent", { commits: { ok: true, items: [commit("e1", 2)] } });

    const report = await syncGitHub(db, { userId: me.id, now }, deps());

    expect([...new Set(github.read)]).toEqual(["club/coursemate"]);
    expect(report).toEqual({ events: 1, repos: [{ fullName: "club/coursemate", status: "ok" }] });
    expect((await storedEvents()).map((e) => e.ref)).toEqual(["a1"]);
  });

  it("reports a repository the App cannot read, and keeps going", async () => {
    await ensureProjectMember(db, {
      userId: me.id,
      email: me.email,
      workspaceId: echo.id,
      role: "member",
      addedBy: owner.id,
    });
    await connect();
    github.repos.set("club/coursemate", { pulls: { ok: false, reason: "no_access" } });
    github.repos.set("club/echoagent", { commits: { ok: true, items: [commit("e1", 1)] } });

    const report = await syncGitHub(db, { userId: me.id, now }, deps());

    expect(report.repos).toEqual([
      { fullName: "club/coursemate", status: "no_access" },
      { fullName: "club/echoagent", status: "ok" },
    ]);
    expect(report.events).toBe(1);
  });

  it("allows one sync a minute and never stores an event twice", async () => {
    await connect();
    github.repos.set("club/coursemate", { commits: { ok: true, items: [commit("a1", 2)] } });

    await syncGitHub(db, { userId: me.id, now }, deps());
    await expect(syncGitHub(db, { userId: me.id, now: later(30_000) }, deps())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await syncGitHub(db, { userId: me.id, now: later(60_000) }, deps());

    expect(await storedEvents()).toHaveLength(1);
  });

  it("refreshes an expiring token and stores the new one encrypted", async () => {
    github.tokens = { ...github.tokens, accessTokenExpiresAt: later(10_000) };
    await connect();

    await syncGitHub(db, { userId: me.id, now }, deps());

    expect(github.refreshed).toBe(1);
    const [row] = await db.select().from(hubGitHubAccounts);
    expect(decryptToken(row?.accessToken ?? "", secret)).toBe("ghu_refreshed");
    expect(decryptToken(row?.refreshToken ?? "", secret)).toBe("ghr_refreshed");
  });

  it("asks them to connect again when GitHub no longer accepts the tokens", async () => {
    github.tokens = { ...github.tokens, accessTokenExpiresAt: later(10_000) };
    await connect();
    github.failRefresh = true;
    await expect(syncGitHub(db, { userId: me.id, now }, deps())).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("重新连接") as unknown,
    });

    github.failRefresh = false;
    github.tokens = { ...github.tokens, accessTokenExpiresAt: later(8 * 3_600_000) };
    await connect();
    github.unauthorised = true;
    await expect(syncGitHub(db, { userId: me.id, now }, deps())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await storedEvents()).toEqual([]);
  });

  it("answers NOT_FOUND before anyone has connected", async () => {
    await expect(syncGitHub(db, { userId: me.id, now }, deps())).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("getGitHubSummary", () => {
  it("counts by window and project, newest first", async () => {
    await connect();
    github.repos.set("club/coursemate", {
      commits: { ok: true, items: [commit("a1", 2), commit("a2", 45)] },
      pulls: {
        ok: true,
        items: [
          {
            number: 5,
            title: "Add login",
            url: "https://github.com/club/coursemate/pull/5",
            authorLogin: "me-gh",
            createdAt: daysAgo(10),
            mergedAt: daysAgo(1),
          },
        ],
      },
    });
    await syncGitHub(db, { userId: me.id, now }, deps());

    const summary = await getGitHubSummary(db, { userId: me.id, now });

    expect(summary.connection).toMatchObject({ login: "me-gh", lastSyncedAt: now });
    expect(summary.repos).toEqual([
      { fullName: "club/coursemate", url: "https://github.com/club/coursemate", projects: ["CourseMate"] },
    ]);
    expect(summary.counts[30]).toEqual({ commit: 1, pr_opened: 1, pr_merged: 1, issue_opened: 0 });
    expect(summary.counts[90].commit).toBe(2);
    expect(summary.byProject).toEqual([
      {
        project: { publicId: coursemate.publicId, name: "CourseMate" },
        counts: { commit: 2, pr_opened: 1, pr_merged: 1, issue_opened: 0 },
      },
    ]);
    expect(summary.recent.map((e) => [e.kind, e.title])).toEqual([
      ["pr_merged", "Add login"],
      ["commit", "Commit a1"],
      ["pr_opened", "Add login"],
      ["commit", "Commit a2"],
    ]);
  });

  it("stops showing a project's activity once they leave it", async () => {
    await connect();
    github.repos.set("club/coursemate", { commits: { ok: true, items: [commit("a1", 2)] } });
    await syncGitHub(db, { userId: me.id, now }, deps());

    await db
      .update(kanSchema.workspaceMembers)
      .set({ deletedAt: now })
      .where(eq(kanSchema.workspaceMembers.userId, me.id));

    const summary = await getGitHubSummary(db, { userId: me.id, now });
    expect(summary.repos).toEqual([]);
    expect(summary.recent).toEqual([]);
    expect(summary.counts[90].commit).toBe(0);
  });

  it("lists their repositories even before they connect", async () => {
    const summary = await getGitHubSummary(db, { userId: me.id, now });
    expect(summary.connection).toBeNull();
    expect(summary.repos.map((r) => r.fullName)).toEqual(["club/coursemate"]);
  });
});

describe("disconnectGitHub", () => {
  it("revokes the token, forgets everything synced and logs it", async () => {
    await connect();
    github.repos.set("club/coursemate", { commits: { ok: true, items: [commit("a1", 2)] } });
    await syncGitHub(db, { userId: me.id, now }, deps());

    await disconnectGitHub(db, actor(), deps());

    expect(github.revoked).toEqual(["ghu_first"]);
    expect(await db.select().from(hubGitHubAccounts)).toEqual([]);
    expect(await storedEvents()).toEqual([]);
    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry?.action).toBe("github.disconnected");
  });

  it("does nothing when they were not connected", async () => {
    await disconnectGitHub(db, actor(), deps());
    expect(github.revoked).toEqual([]);
  });
});
