import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";

import { hubStructure } from "@kan/builderspace/structure";

import type { Db } from "../db";
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
import { ensureStandardProjects } from "../structure";

export interface CliEnv {
  /** Where the Hub is served, e.g. `https://hub.example.com`. */
  baseUrl: string | null;
  now: Date;
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

async function appliedHubMigrations(db: Db): Promise<number> {
  try {
    const result = await db.execute<{ count: number }>(
      sql.raw(
        `select count(*)::int as count from "${HUB_MIGRATIONS_SCHEMA}"."${HUB_MIGRATIONS_TABLE}"`,
      ),
    );
    return result.rows[0]?.count ?? 0;
  } catch {
    // The bookkeeping table does not exist until the first migration runs.
    return 0;
  }
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
