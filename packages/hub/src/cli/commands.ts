import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import { hubStructure } from "@kan/builderspace/structure";

import type { Db } from "../db";
import type { Mailer } from "../mail";
import type { AcceptedApplicant, SiteActor, SiteDb } from "../site";
import type { CliCommand } from "./args";
import {
  changeGrantHubRole,
  GRANT_TTL_DAYS,
  issueGrant,
  provisionUser,
} from "../access";
import { upsertAccount } from "../accounts/account.repo";
import { roleLabels } from "../accounts/roles";
import { CLI_ACTOR, withAudit } from "../audit";
import { listProjects } from "../kan/projects.gateway";
import { findUserByEmail } from "../kan/users.gateway";
import {
  HUB_MIGRATIONS_SCHEMA,
  HUB_MIGRATIONS_TABLE,
} from "../migration-table";
import { hubMigrationsFolder } from "../migrations-path";
import { buildJoinLink } from "../public";
import { normalizeEmail } from "../shared/email";
import { HubError } from "../shared/errors";
import { mailAcceptedApplicants } from "../site";
import { formatExpiryDay } from "../site/welcome-email";
import { ensureStandardProjects } from "../structure";

export interface CliEnv {
  /** Where the Hub is served, e.g. `https://hub.example.com`. */
  baseUrl: string | null;
  now: Date;
  /** The website's database; only `mail-links` reads it. */
  site?: SiteDb | null;
  /** Resend; only `mail-links` sends with it. */
  mailer?: Mailer | null;
  /** Whether `POSTGRES_URL` is this machine's database. */
  databaseIsLocal?: boolean;
}

export const USAGE = [
  "用法: pnpm --filter @kan/hub cli <命令>",
  "",
  "  grant --email <邮箱> [--hub-role owner|admin|viewer]",
  "        [--project <项目ID>:<admin|member|guest>]... [--note <备注>]",
  "            给一个邮箱开通注册，打印一次性注册链接",
  "  provision --email <邮箱>",
  "            注册成功但没被加进项目时，手动补齐（可重复执行）",
  "  setup-projects --owner <邮箱>",
  "            按标准结构建好项目和看板，该邮箱成为项目管理员（可重复执行）",
  "  set-role --email <邮箱> --role owner|admin|viewer|none",
  "            直接设置后台角色（补救用：例如没有人能进后台时）",
  "  mail-links [--email <邮箱>] [--dry-run]",
  "            给官网「已录取」但还没发过链接的人发注册链接（Resend，可重复执行）；",
  "            --email 只发这一个人并替换对方手上的旧链接，--dry-run 只列出会发给谁",
  "  projects  列出所有项目的 ID 和名称",
  "  doctor    检查 Hub 的数据库迁移是否已是最新",
  "  help      显示这段说明",
];

function joinLink(baseUrl: string | null, token: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl ?? "");
  } catch {
    throw new HubError(
      "INVALID_INPUT",
      "需要 NEXT_PUBLIC_BASE_URL（Hub 的访问地址）才能生成注册链接",
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new HubError(
      "INVALID_INPUT",
      "NEXT_PUBLIC_BASE_URL 必须是 http(s) 地址",
    );
  }

  return buildJoinLink(url.origin, token);
}

/**
 * Whether a URL points at this machine: loopback (`localhost`, `*.localhost`,
 * 127.x, ::1), the any-address (0.0.0.0, ::), or a Postgres Unix socket (no
 * host, a path as the host, or `?host=/…`). A URL that does not parse counts
 * too: socket forms such as `postgres://u@/db?host=/tmp` do not, and refusing
 * is safer than guessing.
 */
export function isLocalUrl(url: string | null | undefined): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url ?? "");
  } catch {
    return true;
  }
  const host = parsed.hostname.toLowerCase();
  const socket =
    host === "" ||
    host.startsWith("%2f") ||
    (parsed.searchParams.get("host")?.startsWith("/") ?? false);
  const loopback =
    host === "localhost" ||
    host.endsWith(".localhost") ||
    /^127\.\d+(\.\d+){0,2}$/.test(host) ||
    host === "[::1]" ||
    host.startsWith("[::ffff:7f");
  const anyAddress = host === "0.0.0.0" || host === "[::]";
  return socket || loopback || anyAddress;
}

/**
 * The command line is the break-glass path, so it may issue links as an owner
 * would. Everything it sends is still logged, as `cli`.
 */
const CLI_SITE_ACTOR: SiteActor = {
  ...CLI_ACTOR,
  hubRole: "owner",
  siteAccess: "people",
};

const SENT_OR_SETTLED = new Set(["sent", "registered", "linked"]);

const failed = (applicant: AcceptedApplicant) =>
  applicant.outcome !== null && !SENT_OR_SETTLED.has(applicant.outcome.kind);

const nameOf = (applicant: AcceptedApplicant) =>
  applicant.email
    ? `${applicant.nickname} <${applicant.email}>`
    : applicant.nickname;

/** What happened to one applicant, or null when there is nothing to say. */
function describeApplicant(
  applicant: AcceptedApplicant,
  options: { dryRun: boolean; byAddress: boolean },
): string | null {
  const name = nameOf(applicant);
  const { before, outcome } = applicant;
  // The launcher is left out: `cli` and `cli:prod` read different databases,
  // and the right one is whichever this run used.
  const resend = `用这次同样的方式运行 mail-links --email ${applicant.email}`;

  if (before === null) return `! ${name}：申请里没有能用的邮箱，发不了`;
  if (applicant.due && options.dryRun) {
    return before.state === "linked"
      ? `· 会发给 ${name}（替换对方手上还能用的链接）`
      : `· 会发给 ${name}`;
  }
  if (outcome === null) {
    if (before.state === "expired") {
      return `! ${name}：${formatExpiryDay(before.expiresAt)}到期的链接已过期，没有自动重发。要重发，${resend}`;
    }
    // Asked for by address, the one thing left undone is an account that
    // exists; a sweep only counts those.
    return options.byAddress ? `· ${name}：已经注册，不用发` : null;
  }

  switch (outcome.kind) {
    case "sent":
      return `✓ ${name}：已发，${formatExpiryDay(outcome.expiresAt)}前有效`;
    case "uncertain":
      return `? ${name}：发信服务没给出结果（${outcome.message}），链接保留。对方没收到就${resend}`;
    case "failed":
      return `✗ ${name}：${outcome.message}`;
    case "registered":
      return `· ${name}：已经注册，不用发`;
    case "linked":
      return `· ${name}：已有还能用的链接，没发`;
    case "no_email":
      return `✗ ${name}：没有邮箱`;
    case "not_allowed":
      return `✗ ${name}：没有发链接的权限`;
    case "mail_off":
      return `✗ ${name}：没有配置发信`;
  }
}

async function mailLinks(
  db: Db,
  command: Extract<CliCommand, { name: "mail-links" }>,
  env: CliEnv,
): Promise<string[]> {
  if (!env.site) {
    throw new HubError(
      "INVALID_INPUT",
      "需要 HUB_SITE_DATABASE_URL（官网数据库）才能找到已录取的申请",
    );
  }
  if (!command.dryRun) {
    if (!env.mailer) {
      throw new HubError(
        "INVALID_INPUT",
        "需要 HUB_RESEND_API_KEY 才能发信；只想看会发给谁，加 --dry-run",
      );
    }
    // Fail before issuing anything, as `grant` does.
    joinLink(env.baseUrl, "check");
    // A link into a local Hub reaches nobody, and the applicant would then
    // count as mailed: `.env` quietly fills in local values.
    if (isLocalUrl(env.baseUrl) || env.databaseIsLocal) {
      throw new HubError(
        "INVALID_INPUT",
        "NEXT_PUBLIC_BASE_URL 和 POSTGRES_URL 都要是线上的，不能是本机地址，否则寄出去的链接打不开",
      );
    }
  }

  const applicants = await mailAcceptedApplicants(
    db,
    env.site,
    CLI_SITE_ACTOR,
    { email: command.email, dryRun: command.dryRun },
    { mailer: env.mailer ?? null, baseUrl: env.baseUrl },
    env.now,
  );

  const due = applicants.filter((applicant) => applicant.due).length;
  const sent = applicants.filter(
    (applicant) => applicant.outcome?.kind === "sent",
  ).length;
  const failures = applicants.filter(failed).length;
  const summary =
    failures > 0
      ? `✗ 已发 ${sent} 封，${failures} 人没发成，见下面。`
      : command.dryRun
        ? `--dry-run：会发给 ${due} 人，什么都没发。`
        : sent > 0
          ? `已发 ${sent} 封。`
          : "没有要发的。";

  const lines = [summary];
  if (command.email === null) {
    const count = (state: string | null) =>
      applicants.filter(
        (applicant) => (applicant.before?.state ?? null) === state,
      ).length;
    lines.push(
      `已录取 ${applicants.length} 人：已注册 ${count("registered")}，链接还有效 ${count("linked")}，链接已过期 ${count("expired")}，没有邮箱 ${count(null)}，还没发过 ${count("none")}`,
    );
  }
  for (const applicant of applicants) {
    const line = describeApplicant(applicant, {
      dryRun: command.dryRun,
      byAddress: command.email !== null,
    });
    if (line) lines.push(line);
  }
  return lines;
}

async function appliedHubMigrations(db: Db): Promise<number> {
  try {
    const result = await db.execute<{ count: number }>(
      sql.raw(
        `select count(*)::int as count from "${HUB_MIGRATIONS_SCHEMA}"."${HUB_MIGRATIONS_TABLE}"`,
      ),
    );
    return result.rows[0]?.count ?? 0;
  } catch (error) {
    // The bookkeeping table does not exist until the first migration runs
    // (Postgres "undefined_table"). Anything else, such as a dropped
    // connection, is a real failure and must not read as "not migrated".
    if (isUndefinedTable(error)) return 0;
    throw error;
  }
}

function isUndefinedTable(error: unknown): boolean {
  const code = (error as { code?: unknown; cause?: { code?: unknown } } | null)
    ?.code;
  const causeCode = (error as { cause?: { code?: unknown } } | null)?.cause
    ?.code;
  return code === "42P01" || causeCode === "42P01";
}

function expectedHubMigrations(): number {
  const journal = JSON.parse(
    readFileSync(join(hubMigrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries: unknown[] };

  return journal.entries.length;
}

/** Runs one CLI command and returns the lines to print. */
export async function runCommand(
  db: Db,
  command: CliCommand,
  env: CliEnv,
): Promise<string[]> {
  switch (command.name) {
    case "help":
      return USAGE;

    case "projects": {
      const projects = await listProjects(db);
      if (projects.length === 0) return ["还没有任何项目。"];
      return projects.map((project) => `${project.publicId}  ${project.name}`);
    }

    case "doctor": {
      const applied = await appliedHubMigrations(db);
      const expected = expectedHubMigrations();
      if (applied >= expected) {
        return [`✓ Hub 迁移已是最新（${applied} / ${expected}）`];
      }
      return [
        `✗ Hub 迁移还没跑完（${applied} / ${expected}）`,
        "  运行: pnpm --filter @kan/hub migrate",
      ];
    }

    case "set-role": {
      const email = normalizeEmail(command.email);
      const user = email ? await findUserByEmail(db, email) : null;
      const role = command.role;
      const label = role ? roleLabels[role] : "无";

      if (!email || !user) {
        // Not registered yet: change what their pending link will give.
        const changed =
          email !== null &&
          (await changeGrantHubRole(
            db,
            CLI_ACTOR,
            { email, hubRole: role },
            env.now,
          ));
        if (!changed) {
          throw new HubError(
            "NOT_FOUND",
            `${command.email} 还没有注册账号，也没有待使用的注册链接`,
          );
        }
        return [
          `${email} 还没注册：已把注册链接预设的后台角色改为 ${label}，链接不变，注册后生效。`,
        ];
      }

      // The command line is the break-glass path, so it skips the back
      // office's role rules; it is still logged.
      await withAudit(
        db,
        (tx) => upsertAccount(tx, user.id, { role, now: env.now }),
        () => ({
          actor: CLI_ACTOR,
          action: "account.role_changed",
          entityType: "account",
          entityId: user.id,
          summary: `命令行把 ${email} 的后台角色设为 ${label}`,
        }),
      );

      return role
        ? [`${email} 的后台角色已设为 ${label}。`]
        : [`${email} 已没有后台角色。`];
    }

    case "setup-projects": {
      const report = await ensureStandardProjects(db, {
        ownerEmail: command.ownerEmail,
        structure: hubStructure,
      });

      if (
        report.projectsCreated.length === 0 &&
        report.boardsCreated.length === 0
      ) {
        return [
          `项目和看板都已存在（${report.projectsExisting.length} 个项目、${report.boardsExisting.length} 块看板），无需改动。`,
        ];
      }
      return [
        `新建项目 ${report.projectsCreated.length} 个：${report.projectsCreated.join("、") || "无"}`,
        `新建看板 ${report.boardsCreated.length} 块`,
      ];
    }

    case "mail-links":
      return mailLinks(db, command, env);

    case "provision": {
      const email = normalizeEmail(command.email);
      const user = email ? await findUserByEmail(db, email) : null;
      if (!email || !user) {
        throw new HubError("NOT_FOUND", `${command.email} 还没有注册账号`);
      }

      const result = await provisionUser(db, {
        userId: user.id,
        email,
        now: env.now,
      });

      return result.provisioned
        ? [`已为 ${email} 补齐 ${result.projectsAdded} 个项目。`]
        : [`${email} 没有待处理的注册许可，无需补齐。`];
    }

    case "grant": {
      // Fail before issuing, so a bad base URL never burns a grant.
      joinLink(env.baseUrl, "check");

      const issued = await issueGrant(db, CLI_ACTOR, {
        email: command.email,
        hubRole: command.hubRole,
        note: command.note,
        source: "cli",
        projects: command.projects,
        now: env.now,
      });

      return [
        `已为 ${issued.email} 开通注册。`,
        `注册链接只显示这一次，${GRANT_TTL_DAYS} 天内有效，请私下发给本人：`,
        joinLink(env.baseUrl, issued.token),
      ];
    }
  }
}
