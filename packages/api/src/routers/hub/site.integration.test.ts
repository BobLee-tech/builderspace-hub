import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import type { SiteDb } from "@kan/hub/site";
import {
  createHubTestDb,
  createSiteTestDb,
  overrideSiteDbForTests,
  seedHubAccount,
  seedSiteProject,
  seedSiteVolunteer,
  seedUser,
} from "@kan/hub/testing";

import { createHubCaller } from "./test-helpers";

// Each test boots two in-memory Postgres databases: the Hub's and the website's.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The 官网 section's API: who may call what, the owner-only switch that grants
 * access, and the refusal while the website's database is not connected. The
 * use cases themselves are tested in @kan/hub.
 */

let db: dbClient;
let site: SiteDb;
let owner: { id: string; email: string };

const userWith = async (
  email: string,
  facts: Parameters<typeof seedHubAccount>[2],
) => {
  const user = await seedUser(db, { email });
  await seedHubAccount(db, user.id, facts);
  return user;
};

beforeEach(async () => {
  [db, site] = await Promise.all([createHubTestDb(), createSiteTestDb()]);
  overrideSiteDbForTests(site);
  owner = await userWith("owner@example.test", { role: "owner" });
});

afterEach(() => {
  overrideSiteDbForTests(null);
});

describe("hub.site", () => {
  it("is closed to an owner until website access is granted", async () => {
    const caller = createHubCaller(db, owner);
    await expect(caller.site.summary()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await caller.site.status()).toEqual({
      access: null,
      connected: false,
    });

    await caller.accounts.setSiteAccess({ userId: owner.id, access: "manage" });

    expect(await caller.me.get()).toMatchObject({ siteAccess: "manage" });
    expect(await caller.site.status()).toEqual({
      access: "manage",
      connected: true,
    });
    await expect(caller.site.summary()).resolves.toMatchObject({
      reviews: { pendingProjects: 0 },
    });
  });

  it("gives 名单 the lists but not project review", async () => {
    const operator = await userWith("ops@example.test", {
      role: "admin",
      siteAccess: "people",
    });
    const volunteer = await seedSiteVolunteer(site);
    const project = await seedSiteProject(site);
    const caller = createHubCaller(db, operator);

    await expect(
      caller.site.volunteers({ status: null, page: 1 }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      caller.site.updateVolunteer({ id: volunteer.id, status: "contacted" }),
    ).resolves.toEqual({ onboarding: null });
    await expect(
      caller.site.joins({ supportersOnly: false, page: 1 }),
    ).resolves.toMatchObject({ total: 0 });
    await expect(
      caller.site.export({ kind: "volunteers", status: null }),
    ).resolves.toMatchObject({ kind: "volunteers" });

    await expect(
      caller.site.projects({ review: "pending", page: 1 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.site.reviewProject({ id: project.id, decision: "approved" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("passes the back-office role on, which decides who may issue links", async () => {
    // No mail service in tests, whatever the machine's environment says.
    vi.stubEnv("HUB_RESEND_API_KEY", "");
    const listsOnly = await userWith("lists@example.test", {
      siteAccess: "people",
    });
    const admin = await userWith("admin@example.test", {
      role: "admin",
      siteAccess: "people",
    });
    const first = await seedSiteVolunteer(site, { email: "a@example.test" });
    const second = await seedSiteVolunteer(site, { email: "b@example.test" });

    await expect(
      createHubCaller(db, listsOnly).site.updateVolunteer({
        id: first.id,
        status: "accepted",
      }),
    ).resolves.toEqual({ onboarding: { kind: "not_allowed" } });
    await expect(
      createHubCaller(db, admin).site.updateVolunteer({
        id: second.id,
        status: "accepted",
      }),
    ).resolves.toEqual({ onboarding: { kind: "mail_off" } });
    await expect(
      createHubCaller(db, admin).site.sendVolunteerLink({ id: second.id }),
    ).resolves.toEqual({ kind: "mail_off" });
    vi.unstubAllEnvs();
  });

  it("sends links only for accepted applications", async () => {
    const admin = await userWith("admin@example.test", {
      role: "admin",
      siteAccess: "people",
    });
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    await expect(
      createHubCaller(db, admin).site.sendVolunteerLink({ id: volunteer.id }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("lets 管理 review project cards", async () => {
    const developer = await userWith("dev@example.test", {
      siteAccess: "manage",
    });
    const project = await seedSiteProject(site);
    const caller = createHubCaller(db, developer);

    await expect(
      caller.site.projects({ review: "pending", page: 1 }),
    ).resolves.toMatchObject({ total: 1 });
    await caller.site.reviewProject({ id: project.id, decision: "approved" });
    await expect(
      caller.site.projects({ review: "approved", page: 1 }),
    ).resolves.toMatchObject({ total: 1 });
    await expect(
      caller.site.updates({ review: "pending", page: 1 }),
    ).resolves.toMatchObject({ total: 0 });
  });

  it("lets only owners grant website access", async () => {
    const admin = await userWith("admin@example.test", { role: "admin" });
    await expect(
      createHubCaller(db, admin).accounts.setSiteAccess({
        userId: admin.id,
        access: "manage",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("refuses a suspended account even with website access", async () => {
    const developer = await userWith("dev@example.test", {
      siteAccess: "manage",
      status: "suspended",
    });
    await expect(
      createHubCaller(db, developer).site.summary(),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("says when the website's database is not connected", async () => {
    overrideSiteDbForTests(null);
    vi.stubEnv("HUB_SITE_DATABASE_URL", "");
    const developer = await userWith("dev@example.test", {
      siteAccess: "manage",
    });
    const caller = createHubCaller(db, developer);

    expect(await caller.site.status()).toEqual({
      access: "manage",
      connected: false,
    });
    await expect(caller.site.summary()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    vi.unstubAllEnvs();
  });
});
