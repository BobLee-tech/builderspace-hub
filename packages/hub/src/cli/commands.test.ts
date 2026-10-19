import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Db } from "../db";
import type { Mailer, MailMessage } from "../mail";
import type { SiteDb } from "../site";
import type { CliEnv } from "./commands";
import { describeGrantForJoin, issueGrant } from "../access";
import { getAccessFacts } from "../accounts";
import { CLI_ACTOR, listAudit } from "../audit";
import { MailError } from "../mail";
import { siteVolunteerApplications } from "../site/site.tables";
import {
  createHubTestDb,
  createKanOnlyTestDb,
  createSiteTestDb,
  seedProject,
  seedSiteVolunteer,
  seedUser,
} from "../testing/test-db";
import { runCommand } from "./commands";

const now = new Date("2026-10-13T12:00:00Z");
const env = { baseUrl: "https://hub.example.test/", now };

let db: Db;

beforeEach(async () => {
  db = await createHubTestDb();
});

describe("grant", () => {
  const grant = {
    name: "grant" as const,
    email: "Owner@Example.test",
    hubRole: "owner" as const,
    note: null,
    projects: [],
  };

  it("prints a working registration link", async () => {
    const lines = await runCommand(db, grant, env);

    const link = lines.find((line) => line.startsWith("https://"));
    expect(link).toMatch(
      /^https:\/\/hub\.example\.test\/join#[A-Za-z0-9_-]{43}$/,
    );

    const token = link?.split("#")[1];
    expect(await describeGrantForJoin(db, token, now)).toMatchObject({
      state: "valid",
      email: "owner@example.test",
    });
  });

  it("is logged as done from the command line", async () => {
    await runCommand(db, grant, env);

    const [entry] = await listAudit(db, { limit: 5, offset: 0 });
    expect(entry).toMatchObject({
      action: "grant.issued",
      actorEmail: "cli",
      detail: { hubRole: "owner", source: "cli" },
    });
  });

  it.each([null, "", "hub.example.test", "ftp://hub.example.test"])(
    "refuses to build a link from base URL %j",
    async (baseUrl) => {
      await expect(
        runCommand(db, grant, { baseUrl, now }),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
      expect(await listAudit(db, { limit: 5, offset: 0 })).toEqual([]);
    },
  );
});

describe("set-role", () => {
  it("sets and removes a back-office role, logged as the command line", async () => {
    const user = await seedUser(db, { email: "boss@example.test" });

    expect(
      await runCommand(
        db,
        { name: "set-role", email: "Boss@Example.test", role: "owner" },
        env,
      ),
    ).toEqual(["boss@example.test 的后台角色已设为 所有者。"]);
    expect((await getAccessFacts(db, user.id)).role).toBe("owner");

    expect(
      await runCommand(
        db,
        { name: "set-role", email: "boss@example.test", role: null },
        env,
      ),
    ).toEqual(["boss@example.test 已没有后台角色。"]);

    const [entry] = await listAudit(db, { limit: 1, offset: 0 });
    expect(entry).toMatchObject({
      action: "account.role_changed",
      actorEmail: "cli",
    });
  });

  it("changes what a pending registration link gives, keeping the link", async () => {
    const lines = await runCommand(
      db,
      {
        name: "grant",
        email: "partner@example.test",
        hubRole: "admin",
        note: null,
        projects: [],
      },
      env,
    );
    const token = lines
      .find((line) => line.startsWith("https://"))
      ?.split("#")[1];

    expect(
      await runCommand(
        db,
        { name: "set-role", email: "partner@example.test", role: "owner" },
        env,
      ),
    ).toEqual([
      "partner@example.test 还没注册：已把注册链接预设的后台角色改为 所有者，链接不变，注册后生效。",
    ]);

    // The link still works, and registering through it now makes an owner.
    expect(await describeGrantForJoin(db, token, now)).toMatchObject({
      state: "valid",
    });
    const partner = await seedUser(db, { email: "partner@example.test" });
    await runCommand(
      db,
      { name: "provision", email: "partner@example.test" },
      env,
    );
    expect((await getAccessFacts(db, partner.id)).role).toBe("owner");

    const entries = await listAudit(db, { limit: 10, offset: 0 });
    expect(entries.map((entry) => entry.action)).toContain(
      "grant.role_changed",
    );
  });

  it("does not touch a link that has expired", async () => {
    await runCommand(
      db,
      {
        name: "grant",
        email: "late@example.test",
        hubRole: "admin",
        note: null,
        projects: [],
      },
      env,
    );
    const later = { ...env, now: new Date("2026-11-30T00:00:00Z") };

    await expect(
      runCommand(
        db,
        { name: "set-role", email: "late@example.test", role: "owner" },
        later,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports an address with neither an account nor a link", async () => {
    await expect(
      runCommand(
        db,
        { name: "set-role", email: "ghost@example.test", role: "owner" },
        env,
      ),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "ghost@example.test 还没有注册账号，也没有待使用的注册链接",
    });
  });
});

describe("setup-projects", () => {
  it("builds the BuilderSpace projects and says what it did", async () => {
    await seedUser(db, { email: "owner@example.test" });

    const first = await runCommand(
      db,
      { name: "setup-projects", ownerEmail: "owner@example.test" },
      env,
    );
    expect(first[0]).toBe(
      "新建项目 3 个：CourseMate、BuilderSpace 社团、EchoAgent",
    );
    expect(first[1]).toBe("新建看板 9 块");

    const second = await runCommand(
      db,
      { name: "setup-projects", ownerEmail: "owner@example.test" },
      env,
    );
    expect(second).toEqual([
      "项目和看板都已存在（3 个项目、9 块看板），无需改动。",
    ]);
  });
});

describe("provision", () => {
  it("finishes adding a registered account to its projects", async () => {
    const admin = await seedUser(db);
    const project = await seedProject(db, admin, { name: "社群" });
    await runCommand(
      db,
      {
        name: "grant",
        email: "new@example.test",
        hubRole: null,
        note: null,
        projects: [{ projectPublicId: project.publicId, role: "member" }],
      },
      env,
    );
    // Registered, but the step that adds projects never ran.
    await seedUser(db, { email: "new@example.test" });

    expect(
      await runCommand(
        db,
        { name: "provision", email: "New@Example.test" },
        env,
      ),
    ).toEqual(["已为 new@example.test 补齐 1 个项目。"]);

    expect(
      await runCommand(
        db,
        { name: "provision", email: "new@example.test" },
        env,
      ),
    ).toEqual(["new@example.test 没有待处理的注册许可，无需补齐。"]);
  });

  it("reports an address that has not registered", async () => {
    await expect(
      runCommand(db, { name: "provision", email: "ghost@example.test" }, env),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("projects", () => {
  it("lists each project's id and name", async () => {
    const owner = await seedUser(db);
    const project = await seedProject(db, owner, { name: "社群" });

    expect(await runCommand(db, { name: "projects" }, env)).toEqual([
      `${project.publicId}  社群`,
    ]);
  });

  it("says so when there are none", async () => {
    expect(await runCommand(db, { name: "projects" }, env)).toEqual([
      "还没有任何项目。",
    ]);
  });
});

describe("doctor", () => {
  it("reports an up-to-date database", async () => {
    const lines = await runCommand(db, { name: "doctor" }, env);

    expect(lines[0]).toMatch(/^✓ Hub 迁移已是最新（\d+ \/ \d+）$/);
  });

  it("tells the operator what to run when Hub migrations are missing", async () => {
    const kanOnly = await createKanOnlyTestDb();

    const lines = await runCommand(kanOnly, { name: "doctor" }, env);

    expect(lines[0]).toMatch(/^✗ Hub 迁移还没跑完（0 \/ \d+）/);
    expect(lines.join("\n")).toContain("pnpm --filter @kan/hub migrate");
  });

  it("reports a broken connection as an error, not as missing migrations", async () => {
    const unreachable = {
      execute: () =>
        Promise.reject(new Error("Connection terminated unexpectedly")),
    } as unknown as Db;

    await expect(
      runCommand(unreachable, { name: "doctor" }, env),
    ).rejects.toThrow("Connection terminated unexpectedly");
  });
});

describe("mail-links", () => {
  let site: SiteDb;
  let sent: MailMessage[];
  let mailer: Mailer & { send: ReturnType<typeof vi.fn> };
  let mailEnv: CliEnv;

  /** An application accepted without a mail, as 名单 alone or the website's own database leaves it. */
  const acceptedApplicant = async (nickname: string, email?: string) => {
    const row = await seedSiteVolunteer(site, {
      nickname,
      ...(email !== undefined && { email }),
    });
    await site
      .update(siteVolunteerApplications)
      .set({ status: "accepted" })
      .where(eq(siteVolunteerApplications.id, row.id));
  };

  const mailLinks = (
    options: { email?: string; dryRun?: boolean } = {},
    overrides: Partial<CliEnv> = {},
  ) =>
    runCommand(
      db,
      {
        name: "mail-links",
        email: options.email ?? null,
        dryRun: options.dryRun ?? false,
      },
      { ...mailEnv, ...overrides },
    );

  beforeEach(async () => {
    site = await createSiteTestDb();
    const owner = await seedUser(db, { email: "owner@example.test" });
    await seedProject(db, owner, {
      name: "BuilderSpace 社团",
      slug: "bss-community",
    });
    sent = [];
    mailer = {
      acceptsReplies: true,
      send: vi.fn((message: MailMessage) => {
        sent.push(message);
        return Promise.resolve({ id: `mail-${sent.length}` });
      }),
    };
    mailEnv = { ...env, site, mailer, databaseIsLocal: false };
  });

  it("mails accepted applicants who have no link yet, logged as the command line", async () => {
    await acceptedApplicant("李燊", "Muziss@Example.test");

    expect(await mailLinks()).toEqual([
      "已发 1 封。",
      "已录取 1 人：已注册 0，链接还有效 0，链接已过期 0，没有邮箱 0，还没发过 1",
      "✓ 李燊 <muziss@example.test>：已发，10 月 20 日前有效",
    ]);
    expect(sent.map((mail) => mail.to)).toEqual(["muziss@example.test"]);
    expect(sent[0]?.text).toContain("https://hub.example.test/join#");

    const entries = await listAudit(db, { limit: 10, offset: 0 });
    expect(entries).toContainEqual(
      expect.objectContaining({ action: "grant.mailed", actorEmail: "cli" }),
    );
  });

  it("lists who would get a link on a dry run, without a mail service", async () => {
    await acceptedApplicant("李燊", "muziss@example.test");

    expect(await mailLinks({ dryRun: true }, { mailer: null })).toEqual([
      "--dry-run：会发给 1 人，什么都没发。",
      "已录取 1 人：已注册 0，链接还有效 0，链接已过期 0，没有邮箱 0，还没发过 1",
      "· 会发给 李燊 <muziss@example.test>",
    ]);
    expect(sent).toHaveLength(0);
  });

  it("points out a link that ran out and an application without an address", async () => {
    await issueGrant(db, CLI_ACTOR, {
      email: "old@example.test",
      source: "application",
      projects: [],
      now: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000),
    });
    await acceptedApplicant("old", "old@example.test");
    await acceptedApplicant("微信联系");

    expect(await mailLinks()).toEqual([
      "没有要发的。",
      "已录取 2 人：已注册 0，链接还有效 0，链接已过期 1，没有邮箱 1，还没发过 0",
      expect.stringMatching(/^! (old|微信联系)/),
      expect.stringMatching(/^! (old|微信联系)/),
    ]);
    const text = (await mailLinks()).join("\n");
    expect(text).toContain(
      "! old <old@example.test>：10 月 12 日到期的链接已过期，没有自动重发。要重发：pnpm --filter @kan/hub cli mail-links --email old@example.test",
    );
    expect(text).toContain("! 微信联系：申请里没有能用的邮箱，发不了");
    expect(sent).toHaveLength(0);
  });

  it("fails the run when a mail is refused", async () => {
    mailer.send.mockRejectedValueOnce(
      new MailError("发信服务拒绝了：HTTP 403"),
    );
    await acceptedApplicant("李燊", "muziss@example.test");

    const lines = await mailLinks();

    expect(lines[0]).toBe("✗ 已发 0 封，1 人没发成，见下面。");
    expect(lines).toContain(
      "✗ 李燊 <muziss@example.test>：邮件没发出去（发信服务拒绝了：HTTP 403），链接已作废",
    );
  });

  it("with --email, mails that applicant a new link", async () => {
    await acceptedApplicant("李燊", "muziss@example.test");
    await acceptedApplicant("Nina", "nina@example.test");
    await mailLinks();
    const first = sent.find((mail) => mail.to === "muziss@example.test");

    expect(await mailLinks({ email: "Muziss@Example.test" })).toEqual([
      "已发 1 封。",
      "✓ 李燊 <muziss@example.test>：已发，10 月 20 日前有效",
    ]);
    expect(sent).toHaveLength(3);
    const token = /\/join#(\S+)/.exec(first?.text ?? "")?.[1];
    expect(await describeGrantForJoin(db, token, now)).toEqual({
      state: "revoked",
    });
  });

  it("refuses to run without the website's database", async () => {
    const refusal = mailLinks({ dryRun: true }, { site: null });
    await expect(refusal).rejects.toThrow("HUB_SITE_DATABASE_URL");
    await expect(refusal).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it.each<[string, Partial<CliEnv>, string]>([
    ["no mail service", { mailer: null }, "HUB_RESEND_API_KEY"],
    ["no base URL", { baseUrl: null }, "NEXT_PUBLIC_BASE_URL"],
    ["a local base URL", { baseUrl: "http://localhost:3000" }, "本机"],
    ["a local Hub database", { databaseIsLocal: true }, "本机"],
  ])("refuses to send with %s", async (_, overrides, hint) => {
    await acceptedApplicant("李燊", "muziss@example.test");

    const refusal = mailLinks({}, overrides);
    await expect(refusal).rejects.toThrow(hint);
    await expect(refusal).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(sent).toHaveLength(0);
    expect(await listAudit(db, { limit: 5, offset: 0 })).toEqual([]);
  });
});

describe("help", () => {
  it("lists the commands", async () => {
    const text = (await runCommand(db, { name: "help" }, env)).join("\n");

    for (const command of [
      "grant",
      "provision",
      "setup-projects",
      "set-role",
      "projects",
      "doctor",
      "mail-links",
    ]) {
      expect(text).toContain(command);
    }
  });
});
