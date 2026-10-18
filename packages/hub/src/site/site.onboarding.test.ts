import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../db";
import type { Mailer, MailMessage } from "../mail";
import type { SiteDb } from "./site.db";
import type { OnboardingDeps } from "./site.onboarding";
import type { SiteActor } from "./site.service";
import { describeGrantForJoin, issueGrant } from "../access";
import { listAudit } from "../audit";
import { MailError } from "../mail";
import { hubAccessGrantProjects, hubAccessGrants } from "../schema";
import {
  createHubTestDb,
  createSiteTestDb,
  seedProject,
  seedSiteVolunteer,
  seedUser,
} from "../testing/test-db";
import { onboardingDeps } from "./site.onboarding";
import {
  listSiteVolunteers,
  sendVolunteerLink,
  updateSiteVolunteer,
} from "./site.service";
import { siteVolunteerApplications } from "./site.tables";

const now = new Date("2026-10-18T09:00:00Z");
const later = (days: number) =>
  new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

let db: Db;
let site: SiteDb;
let community: { id: number; publicId: string };
let sent: MailMessage[];
let mailer: Mailer & { send: ReturnType<typeof vi.fn> };
let deps: OnboardingDeps;

const admin: SiteActor = {
  userId: null,
  email: "admin@example.test",
  hubRole: "admin",
  siteAccess: "people",
};
/** 名单 access without a back-office role: may follow up, may not issue links. */
const listsOnly: SiteActor = { ...admin, hubRole: null };

const auditActions = async () =>
  (await listAudit(db, { limit: 50, offset: 0 })).map((entry) => entry.action);

const tokenIn = (message: MailMessage | undefined) =>
  /\/join#(\S+)/.exec(message?.text ?? "")?.[1];

const accept = (id: string, actor: SiteActor = admin, at: Date = now) =>
  updateSiteVolunteer(db, site, actor, { id, status: "accepted" }, deps, at);

const statusOf = async (id: string) => {
  const [row] = await site
    .select({ status: siteVolunteerApplications.status })
    .from(siteVolunteerApplications)
    .where(eq(siteVolunteerApplications.id, id));
  return row?.status;
};

beforeEach(async () => {
  [db, site] = await Promise.all([createHubTestDb(), createSiteTestDb()]);
  const owner = await seedUser(db, { email: "owner@example.test" });
  community = await seedProject(db, owner, {
    name: "BuilderSpace 社团",
    slug: "bss-community",
  });
  await seedProject(db, owner, { name: "CourseMate", slug: "bss-coursemate" });
  sent = [];
  mailer = {
    acceptsReplies: true,
    send: vi.fn((message: MailMessage) => {
      sent.push(message);
      return Promise.resolve({ id: `mail-${sent.length}` });
    }),
  };
  deps = { mailer, baseUrl: "https://hub.example.test/some/path" };
});

describe("accepting an application", () => {
  it("mails the applicant a working link into the club's project", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      nickname: "珊.",
      email: " Shan@Example.test ",
    });

    const result = await accept(volunteer.id);

    expect(result.onboarding).toEqual({
      kind: "sent",
      email: "shan@example.test",
      expiresAt: later(7),
    });
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail).toMatchObject({
      to: "shan@example.test",
      subject: "欢迎加入 UNSW 创客社 BuilderSpace",
    });
    expect(mail?.text).toMatch(/^你好 珊，/);
    expect(mail?.text).toContain("https://hub.example.test/join#");

    const token = tokenIn(mail);
    expect(await describeGrantForJoin(db, token, now)).toMatchObject({
      state: "valid",
      email: "shan@example.test",
    });

    const [grant] = await db.select().from(hubAccessGrants);
    expect(grant).toMatchObject({ source: "application", hubRole: null });
    expect(mail?.idempotencyKey).toBe(`hub-welcome-${grant?.publicId}`);
    const presets = await db.select().from(hubAccessGrantProjects);
    expect(presets).toEqual([
      expect.objectContaining({ workspaceId: community.id, role: "member" }),
    ]);

    expect(await statusOf(volunteer.id)).toBe("accepted");
    expect(await auditActions()).toEqual(
      expect.arrayContaining([
        "site.volunteer_updated",
        "grant.issued",
        "grant.mailed",
      ]),
    );
  });

  it("points to the club group instead of a reply when replies go nowhere", async () => {
    deps = {
      mailer: { ...mailer, acceptsReplies: false },
      baseUrl: deps.baseUrl,
    };
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    await accept(volunteer.id);
    expect(sent[0]?.text).not.toContain("回复这封邮件");
    expect(sent[0]?.text).toContain("在社团群里说一声");
  });

  it("sends nothing when the application was already accepted", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    await accept(volunteer.id);

    const again = await accept(volunteer.id);
    expect(again.onboarding).toBeNull();
    expect(sent).toHaveLength(1);
  });

  it("sends nothing for any other status or a notes change", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    const moved = await updateSiteVolunteer(
      db,
      site,
      admin,
      { id: volunteer.id, status: "interviewing", notes: "x" },
      deps,
      now,
    );
    expect(moved.onboarding).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("leaves someone who already has an account alone", async () => {
    await seedUser(db, { email: "member@example.test" });
    const volunteer = await seedSiteVolunteer(site, {
      email: "Member@example.test",
    });

    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "registered",
    });
    expect(sent).toHaveLength(0);
  });

  it("does not replace a link that still works", async () => {
    await issueGrant(db, admin, {
      email: "a@example.test",
      source: "cli",
      projects: [],
      now,
    });
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });

    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "linked",
      expiresAt: later(7),
    });
    expect(sent).toHaveLength(0);
  });

  it("says when there is no address to send to", async () => {
    const volunteer = await seedSiteVolunteer(site);
    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "no_email",
    });
  });

  it("keeps the acceptance but issues nothing for someone without a back-office role", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });

    expect((await accept(volunteer.id, listsOnly)).onboarding).toEqual({
      kind: "not_allowed",
    });
    expect(await statusOf(volunteer.id)).toBe("accepted");
    expect(await db.select().from(hubAccessGrants)).toHaveLength(0);
  });

  it("issues nothing while mail is not set up", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    deps = { mailer: null, baseUrl: "https://hub.example.test" };
    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "mail_off",
    });

    deps = { mailer, baseUrl: null };
    expect(
      (
        await sendVolunteerLink(
          db,
          site,
          admin,
          { id: volunteer.id },
          deps,
          now,
        )
      ).kind,
    ).toBe("mail_off");
    expect(await db.select().from(hubAccessGrants)).toHaveLength(0);
  });

  it("revokes the link at once when the mail does not go out", async () => {
    mailer.send.mockRejectedValueOnce(
      new MailError("发信服务拒绝了：HTTP 403"),
    );
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });

    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "failed",
      message: "邮件没发出去（发信服务拒绝了：HTTP 403），链接已作废",
    });
    const [grant] = await db.select().from(hubAccessGrants);
    expect(grant?.revokedAt).not.toBeNull();
    expect(await statusOf(volunteer.id)).toBe("accepted");
    expect(await auditActions()).not.toContain("grant.mailed");
  });

  it("keeps the link when the mail service gives no clear answer", async () => {
    mailer.send.mockRejectedValueOnce(
      new MailError("发信服务没有回应", { uncertain: true }),
    );
    const volunteer = await seedSiteVolunteer(site, {
      nickname: "uncertain",
      email: "a@example.test",
    });

    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "uncertain",
      message: "发信服务没有回应",
      expiresAt: later(7),
    });
    const [grant] = await db.select().from(hubAccessGrants);
    expect(grant?.revokedAt).toBeNull();
    expect(await auditActions()).toContain("grant.mail_unconfirmed");
    expect(await auditActions()).not.toContain("grant.revoked");

    const { items } = await listSiteVolunteers(
      db,
      site,
      admin,
      { status: null, page: 1 },
      now,
    );
    expect(items[0]?.hubAccess).toMatchObject({ state: "linked" });
  });

  it("hides an unexpected mail failure's details but still revokes the link", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mailer.send.mockRejectedValueOnce(new Error("socket hang up"));
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });

    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "failed",
      message: "邮件没发出去（发信时出了意外），链接已作废",
    });
    const [grant] = await db.select().from(hubAccessGrants);
    expect(grant?.revokedAt).not.toBeNull();
    spy.mockRestore();
  });

  it("fails plainly when the club's project does not exist", async () => {
    db = await createHubTestDb();
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    expect((await accept(volunteer.id)).onboarding).toEqual({
      kind: "failed",
      message: "找不到「BuilderSpace 社团」项目",
    });
    expect(sent).toHaveLength(0);
  });
});

describe("sending a link again", () => {
  it("replaces a working link with a new one", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    await accept(volunteer.id);
    const first = tokenIn(sent[0]);

    const outcome = await sendVolunteerLink(
      db,
      site,
      admin,
      { id: volunteer.id },
      deps,
      now,
    );

    expect(outcome.kind).toBe("sent");
    expect(sent).toHaveLength(2);
    expect(await describeGrantForJoin(db, first, now)).toEqual({
      state: "revoked",
    });
    expect(await describeGrantForJoin(db, tokenIn(sent[1]), now)).toMatchObject(
      { state: "valid" },
    );
  });

  it("keeps the old link working when the new mail is refused", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    await accept(volunteer.id);
    const first = tokenIn(sent[0]);
    mailer.send.mockRejectedValueOnce(
      new MailError("发信服务拒绝了：HTTP 403"),
    );

    const outcome = await sendVolunteerLink(
      db,
      site,
      admin,
      { id: volunteer.id },
      deps,
      now,
    );

    expect(outcome).toEqual({
      kind: "failed",
      message:
        "邮件没发出去（发信服务拒绝了：HTTP 403），新链接已作废，之前那条链接仍然有效",
    });
    expect(await describeGrantForJoin(db, first, now)).toMatchObject({
      state: "valid",
    });
    const open = (await db.select().from(hubAccessGrants)).filter(
      (grant) => grant.revokedAt === null,
    );
    expect(open).toHaveLength(1);
    expect(await auditActions()).toContain("grant.restored");

    const { items } = await listSiteVolunteers(
      db,
      site,
      admin,
      { status: null, page: 1 },
      now,
    );
    expect(items[0]?.hubAccess).toEqual({
      state: "linked",
      issuedAt: now,
      expiresAt: later(7),
    });
  });

  it("only works on accepted applications", async () => {
    const volunteer = await seedSiteVolunteer(site, {
      email: "a@example.test",
    });
    await expect(
      sendVolunteerLink(db, site, admin, { id: volunteer.id }, deps, now),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "先把申请改成「已录取」再发注册链接",
    });
  });

  it("refuses an unknown application, a bad id and someone without 名单", async () => {
    await expect(
      sendVolunteerLink(
        db,
        site,
        admin,
        { id: "00000000-0000-4000-8000-000000000000" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      sendVolunteerLink(db, site, admin, { id: "nope" }, deps, now),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      sendVolunteerLink(
        db,
        site,
        { ...admin, siteAccess: null },
        { id: "00000000-0000-4000-8000-000000000000" },
        deps,
        now,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("where each applicant stands in the Hub", () => {
  it("shows registered, linked, expired and nothing yet", async () => {
    await seedUser(db, { email: "member@example.test" });
    await seedSiteVolunteer(site, {
      nickname: "registered",
      email: "member@example.test",
    });
    const linked = await seedSiteVolunteer(site, {
      nickname: "linked",
      email: "linked@example.test",
    });
    await accept(linked.id);
    await issueGrant(db, admin, {
      email: "old@example.test",
      source: "cli",
      projects: [],
      now: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
    });
    await seedSiteVolunteer(site, {
      nickname: "expired",
      email: "old@example.test",
    });
    await seedSiteVolunteer(site, {
      nickname: "none",
      email: "n@example.test",
    });
    await seedSiteVolunteer(site, { nickname: "no email" });

    const { items } = await listSiteVolunteers(
      db,
      site,
      admin,
      { status: null, page: 1 },
      now,
    );
    const byName = Object.fromEntries(
      items.map((item) => [item.nickname, item.hubAccess]),
    );
    expect(byName).toEqual({
      registered: { state: "registered" },
      linked: { state: "linked", issuedAt: now, expiresAt: later(7) },
      expired: { state: "expired", expiresAt: later(-1) },
      none: { state: "none" },
      "no email": { state: "none" },
    });
  });
});

describe("onboardingDeps", () => {
  it("has no mailer without a Resend key", () => {
    expect(
      onboardingDeps({ NEXT_PUBLIC_BASE_URL: "https://hub.test" }),
    ).toEqual({ mailer: null, baseUrl: "https://hub.test" });
  });

  it("builds a mailer from the key and falls back to the auth URL", () => {
    const made = onboardingDeps({
      HUB_RESEND_API_KEY: "re_test",
      BETTER_AUTH_URL: "https://auth.test",
    });
    expect(made.mailer).not.toBeNull();
    expect(made.baseUrl).toBe("https://auth.test");
  });
});
