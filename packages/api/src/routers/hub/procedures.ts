import { TRPCError } from "@trpc/server";

import type { AdminActor, HubPermission } from "@kan/hub/accounts";
import { can, getAccessFacts } from "@kan/hub/accounts";
import { isHubError } from "@kan/hub/shared";

import { protectedProcedure } from "../../trpc";

const HUB_ERROR_CODES = {
  INVALID_INPUT: "BAD_REQUEST",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "CONFLICT",
  FORBIDDEN: "FORBIDDEN",
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
 * A signed-in, non-suspended person using the app in a browser. Adds
 * `ctx.actor` (who they are and their back-office role).
 *
 * Refusals use FORBIDDEN, never UNAUTHORIZED: Kan's client sends anyone who
 * gets UNAUTHORIZED back to the login page.
 */
export const hubProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const user = ctx.user;
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });

  if (usesApiKey(ctx.headers)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "后台不接受 API key" });
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
  return next({ ctx: { ...ctx, actor } });
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
