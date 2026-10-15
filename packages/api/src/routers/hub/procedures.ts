import { TRPCError } from "@trpc/server";

import type { AdminActor, HubPermission } from "@kan/hub/accounts";
import type { SiteActor, SitePermission } from "@kan/hub/site";
import { can, getAccessFacts } from "@kan/hub/accounts";
import { isHubError } from "@kan/hub/shared";
import { canOnSite, connectSiteDb } from "@kan/hub/site";

import { protectedProcedure } from "../../trpc";

const HUB_ERROR_CODES = {
  INVALID_INPUT: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
  UNAVAILABLE: "SERVICE_UNAVAILABLE",
} as const;

/**
 * Runs a Hub use case and turns its expected failures into tRPC errors with
 * the use case's own message. Anything else is a bug and is re-thrown as is.
 */
export async function runHub<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isHubError(error)) {
      throw new TRPCError({
        code: HUB_ERROR_CODES[error.code],
        message: error.message,
      });
    }
    throw error;
  }
}

/** True when the request authenticated with an API key rather than a browser session. */
const usesApiKey = (headers: Headers): boolean =>
  headers.has("x-api-key") ||
  /^bearer\s/i.test(headers.get("authorization") ?? "");

/**
 * A signed-in, non-suspended person using the app in a browser: every Hub
 * page, the home page included. Adds `ctx.actor` (who they are and their
 * back-office role, which is null for most members) and `ctx.siteAccess`
 * (their access to the official website's data, null for most).
 *
 * Refusals use FORBIDDEN, never UNAUTHORIZED: Kan's client sends anyone who
 * gets UNAUTHORIZED back to the login page.
 */
export const hubProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

  if (usesApiKey(ctx.headers)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Hub 的接口只能在网页里使用，不接受 API key",
    });
  }

  const facts = await getAccessFacts(ctx.db, user.id);
  if (facts.status === "suspended") {
    throw new TRPCError({ code: "FORBIDDEN", message: "这个账号已被停用" });
  }

  const actor: AdminActor = {
    userId: user.id,
    email: user.email,
    role: facts.role,
  };
  return next({ ctx: { ...ctx, actor, siteAccess: facts.siteAccess } });
});

/** `hubProcedure` that also requires one back-office permission. */
export const hubAdminProcedure = (permission: HubPermission) =>
  hubProcedure.use(({ ctx, next }) => {
    if (!can(ctx.actor.role, permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "没有执行这个操作的权限",
      });
    }
    return next();
  });

/**
 * `hubProcedure` for the back office's 官网 section: requires one website
 * permission and a connected website database. Adds `ctx.site` (that
 * database) and `ctx.siteActor`.
 */
export const hubSiteProcedure = (permission: SitePermission) =>
  hubProcedure.use(({ ctx, next }) => {
    if (!canOnSite(ctx.siteAccess, permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "没有查看或处理官网数据的权限",
      });
    }
    const site = connectSiteDb();
    if (!site) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "还没有连接官网数据库",
      });
    }
    const siteActor: SiteActor = {
      userId: ctx.actor.userId,
      email: ctx.actor.email,
      siteAccess: ctx.siteAccess,
    };
    return next({ ctx: { ...ctx, site, siteActor } });
  });
