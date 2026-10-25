import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  approveAuthorization,
  checkAuthorizeRequest,
  denyAuthorization,
  disconnectMcp,
  hubMcpUrls,
  listMcpConnections,
} from "@kan/hub/mcp";

import { createTRPCRouter } from "../../../trpc";
import { hubProcedure, runHub } from "../procedures";

/**
 * `hub.mcp.*`: the pages around MCP sign-in. The consent page checks an
 * authorization request and answers it; the MCP page lists the AI apps
 * connected to my account and disconnects them.
 *
 * The authorization request's parameters are the input. None is a secret (the
 * PKCE challenge is a hash, `state` is the app's own), so it is fine that the
 * logging middleware records them. The code only ever appears in an output.
 */

const authorizeQuery = z
  .record(z.string().max(64), z.string().max(4000))
  .refine((query) => Object.keys(query).length <= 30, "参数太多");

function requireUrls() {
  const urls = hubMcpUrls();
  if (!urls) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "还没有配置 NEXT_PUBLIC_BASE_URL，MCP 用不了",
    });
  }
  return urls;
}

export const mcpRouter = createTRPCRouter({
  /** The MCP endpoint's address and my connected apps, for the MCP page. */
  overview: hubProcedure.query(async ({ ctx }) => ({
    endpoint: hubMcpUrls()?.resource ?? null,
    connections: await listMcpConnections(ctx.db, ctx.actor.userId),
  })),

  disconnect: hubProcedure
    .input(z.object({ connectionPublicId: z.string().min(1).max(32) }))
    .mutation(({ ctx, input }) =>
      runHub(() => disconnectMcp(ctx.db, ctx.actor, input.connectionPublicId)),
    ),

  /** What the consent page shows: which app, and where I go back to. */
  check: hubProcedure
    .input(authorizeQuery)
    .query(({ ctx, input }) =>
      checkAuthorizeRequest(ctx.db, input, requireUrls().resource),
    ),

  approve: hubProcedure
    .input(authorizeQuery)
    .mutation(({ ctx, input }) =>
      runHub(() =>
        approveAuthorization(
          ctx.db,
          { userId: ctx.actor.userId },
          input,
          requireUrls().resource,
          new Date(),
        ),
      ),
    ),

  deny: hubProcedure
    .input(authorizeQuery)
    .mutation(({ ctx, input }) =>
      runHub(() => denyAuthorization(ctx.db, input)),
    ),
});
