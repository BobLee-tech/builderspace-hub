import { z } from "zod";

import type { AuditActor } from "../audit";
import type { Db } from "../db";
import type { HubRole } from "../schema";
import type { GrantState } from "./grant.policy";
import { roleLabels } from "../accounts/roles";
import { recordAudit, withAudit } from "../audit";
import { findProjectByPublicId } from "../kan/projects.gateway";
import { findUserByEmail } from "../kan/users.gateway";
import { grantSources, hubRoles, projectRoles } from "../schema";
import { normalizeEmail } from "../shared/email";
import { HubError } from "../shared/errors";
import {
  generateGrantToken,
  hashGrantToken,
  isGrantTokenShape,
} from "../shared/token";
import { grantExpiry, grantState } from "./grant.policy";
import {
  findGrantByPublicId,
  findGrantByTokenHash,
  findOpenGrantByEmail,
  insertGrant,
  insertGrantProjects,
  listGrantsPage,
  listProjectsOfGrants,
  markGrantRevoked,
  reopenGrant,
  setGrantHubRole,
} from "./grant.repo";

const issueGrantSchema = z.object({
  email: z.string(),
  hubRole: z.enum(hubRoles).nullish(),
  note: z.string().trim().max(280).nullish(),
  source: z.enum(grantSources),
  projects: z
    .array(
      z.object({
        projectPublicId: z.string().min(1),
        role: z.enum(projectRoles),
      }),
    )
    .max(20),
  now: z.date().optional(),
});

export type IssueGrantInput = z.input<typeof issueGrantSchema>;

export interface IssuedGrant {
  publicId: string;
  email: string;
  expiresAt: Date;
  /** The link secret. It exists only in this return value; show it once. */
  token: string;
}

/**
 * Lets one e-mail address register, and says which projects the new account
 * joins. Any earlier unused grant for the address is revoked, so only the
 * newest link works.
 */
export async function issueGrant(
  db: Db,
  actor: AuditActor,
  rawInput: IssueGrantInput,
): Promise<IssuedGrant> {
  const parsed = issueGrantSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new HubError("INVALID_INPUT", "注册许可的内容不合法");
  }
  const input = parsed.data;
  const now = input.now ?? new Date();

  const email = normalizeEmail(input.email);
  if (!email) throw new HubError("INVALID_INPUT", "邮箱格式不正确");

  const publicIds = input.projects.map((project) => project.projectPublicId);
  if (new Set(publicIds).size !== publicIds.length) {
    throw new HubError("INVALID_INPUT", "同一个项目只能选一次");
  }

  if (await findUserByEmail(db, email)) {
    throw new HubError("CONFLICT", "这个邮箱已经注册过了");
  }

  const projects: {
    workspaceId: number;
    role: (typeof projectRoles)[number];
  }[] = [];
  for (const requested of input.projects) {
    const project = await findProjectByPublicId(db, requested.projectPublicId);
    if (!project) {
      throw new HubError(
        "NOT_FOUND",
        `找不到项目 ${requested.projectPublicId}`,
      );
    }
    projects.push({ workspaceId: project.id, role: requested.role });
  }

  const token = generateGrantToken();

  const grant = await withAudit(
    db,
    async (tx) => {
      const previous = await findOpenGrantByEmail(tx, email);
      if (previous) {
        await markGrantRevoked(tx, previous.id, {
          userId: actor.userId,
          at: now,
        });
        await recordAudit(tx, {
          actor,
          action: "grant.revoked",
          entityType: "grant",
          entityId: previous.publicId,
          summary: `${email} 的旧注册许可被新的替换`,
        });
      }

      const created = await insertGrant(tx, {
        email,
        tokenHash: hashGrantToken(token),
        hubRole: input.hubRole ?? null,
        note: input.note?.length ? input.note : null,
        source: input.source,
        expiresAt: grantExpiry(now),
        createdBy: actor.userId,
        createdAt: now,
      });
      await insertGrantProjects(tx, created.id, projects);

      return created;
    },
    (created) => ({
      actor,
      action: "grant.issued",
      entityType: "grant",
      entityId: created.publicId,
      summary: `为 ${email} 开通注册`,
      detail: {
        projects: projects.length,
        hubRole: created.hubRole,
        source: created.source,
      },
    }),
  );

  return {
    publicId: grant.publicId,
    email: grant.email,
    expiresAt: grant.expiresAt,
    token,
  };
}

/** Withdraws an unused grant; its link stops working immediately. */
export async function revokeGrant(
  db: Db,
  actor: AuditActor,
  grantPublicId: string,
  now: Date = new Date(),
): Promise<void> {
  const grant = await findGrantByPublicId(db, grantPublicId);
  if (!grant) throw new HubError("NOT_FOUND", "找不到这条注册许可");

  await withAudit(
    db,
    async (tx) => {
      const revoked = await markGrantRevoked(tx, grant.id, {
        userId: actor.userId,
        at: now,
      });
      if (!revoked) {
        throw new HubError("CONFLICT", "这条注册许可已经被使用或撤销");
      }
    },
    () => ({
      actor,
      action: "grant.revoked",
      entityType: "grant",
      entityId: grant.publicId,
      summary: `撤销 ${grant.email} 的注册许可`,
    }),
  );
}

/**
 * Gives back a link that was replaced by one that never reached its owner
 * (the mail carrying the replacement was refused). Only an unused grant that
 * has not run out can come back. Returns whether it did.
 */
export async function restoreGrant(
  db: Db,
  actor: AuditActor,
  grantPublicId: string,
  now: Date = new Date(),
): Promise<boolean> {
  const grant = await findGrantByPublicId(db, grantPublicId);
  if (!grant || grantState(grant, now) !== "revoked") return false;
  if (grant.expiresAt <= now) return false;

  try {
    await withAudit(
      db,
      async (tx) => {
        if (!(await reopenGrant(tx, grant.id))) {
          throw new HubError("CONFLICT", "这条注册许可已经不能恢复");
        }
      },
      () => ({
        actor,
        action: "grant.restored",
        entityType: "grant",
        entityId: grant.publicId,
        summary: `恢复 ${grant.email} 之前的注册许可（替换它的链接没有发出去）`,
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof HubError) return false;
    throw error;
  }
}

/**
 * Changes the back-office role someone's registration link will give them,
 * keeping the link itself, so a link already sent does not have to be
 * replaced. Returns false when the address has no usable link.
 */
export async function changeGrantHubRole(
  db: Db,
  actor: AuditActor,
  input: { email: string; hubRole: HubRole | null },
  now: Date = new Date(),
): Promise<boolean> {
  const email = normalizeEmail(input.email);
  const grant = email ? await findOpenGrantByEmail(db, email) : null;
  if (!grant || grant.expiresAt <= now) return false;

  await applyGrantHubRole(db, actor, grant, input.hubRole);
  return true;
}

/** The same change from the back office, which knows the link by its id. */
export async function changeGrantHubRoleById(
  db: Db,
  actor: AuditActor,
  input: { grantPublicId: string; hubRole: HubRole | null },
  now: Date = new Date(),
): Promise<void> {
  const grant = await findGrantByPublicId(db, input.grantPublicId);
  if (!grant) throw new HubError("NOT_FOUND", "找不到这条注册许可");
  if (grantState(grant, now) !== "pending") {
    throw new HubError("CONFLICT", "这条注册链接已经不能再用，改不了预设角色");
  }
  await applyGrantHubRole(db, actor, grant, input.hubRole);
}

async function applyGrantHubRole(
  db: Db,
  actor: AuditActor,
  grant: { id: number; publicId: string; email: string },
  hubRole: HubRole | null,
): Promise<void> {
  const label = hubRole ? roleLabels[hubRole] : "无";
  await withAudit(
    db,
    async (tx) => {
      if (!(await setGrantHubRole(tx, grant.id, hubRole))) {
        throw new HubError("CONFLICT", "这条注册许可已经被使用或撤销");
      }
    },
    () => ({
      actor,
      action: "grant.role_changed",
      entityType: "grant",
      entityId: grant.publicId,
      summary: `把 ${grant.email} 的注册许可预设的后台角色改为 ${label}`,
    }),
  );
}

export type JoinLinkStatus =
  | { state: "valid"; email: string; expiresAt: Date }
  | { state: "invalid" | "expired" | "consumed" | "revoked" };

/**
 * What the registration page shows for a link. Anyone who can call this holds
 * the token, so telling them a real link was used or ran out reveals nothing;
 * an unknown token only ever gets "invalid".
 */
export async function describeGrantForJoin(
  db: Db,
  token: unknown,
  now: Date,
): Promise<JoinLinkStatus> {
  if (!isGrantTokenShape(token)) return { state: "invalid" };

  const grant = await findGrantByTokenHash(db, hashGrantToken(token));
  if (!grant) return { state: "invalid" };

  const state = grantState(grant, now);
  if (state !== "pending") return { state };

  return { state: "valid", email: grant.email, expiresAt: grant.expiresAt };
}

export const GRANTS_PAGE_SIZE = 50;

export interface GrantSummary {
  publicId: string;
  email: string;
  hubRole: (typeof hubRoles)[number] | null;
  note: string | null;
  source: (typeof grantSources)[number];
  state: GrantState;
  createdAt: Date;
  expiresAt: Date;
  projects: { projectName: string; role: (typeof projectRoles)[number] }[];
}

/** Grants newest first, with their state as of `now`. Never includes tokens. */
export async function listGrants(
  db: Db,
  query: { page: number; now?: Date },
): Promise<{ items: GrantSummary[]; total: number; pageSize: number }> {
  const page = Math.max(1, Math.floor(query.page));
  const now = query.now ?? new Date();
  const { rows, total } = await listGrantsPage(db, {
    limit: GRANTS_PAGE_SIZE,
    offset: (page - 1) * GRANTS_PAGE_SIZE,
  });
  const projects = await listProjectsOfGrants(
    db,
    rows.map((row) => row.id),
  );

  return {
    items: rows.map((row) => ({
      publicId: row.publicId,
      email: row.email,
      hubRole: row.hubRole,
      note: row.note,
      source: row.source,
      state: grantState(row, now),
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      projects: projects.get(row.id) ?? [],
    })),
    total,
    pageSize: GRANTS_PAGE_SIZE,
  };
}
