import type { dbClient } from "@kan/db/client";
import * as memberRepo from "@kan/db/repository/member.repo";

import { hubRouter } from "./index";

/** Calls `hub.*` as the given user (or a signed-out visitor). */
export function createHubCaller(
  db: dbClient,
  user: { id: string; email: string } | null,
  headers: Record<string, string> = {},
) {
  return hubRouter.createCaller(callerContext(db, user, headers));
}

/** What a caller of any router sees as `ctx`, for the given user or a signed-out visitor. */
export function callerContext(
  db: dbClient,
  user: { id: string; email: string } | null,
  headers: Record<string, string> = {},
) {
  return {
    user: user
      ? {
          id: user.id,
          email: user.email,
          name: "Test",
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
      : null,
    db,
    auth: {} as never,
    headers: new Headers(headers),
    transport: "trpc",
    requestId: crypto.randomUUID(),
  };
}

/** Adds an active membership directly, for tests. */
export async function ensureProjectMemberForTests(
  db: dbClient,
  user: { id: string; email: string },
  workspaceId: number,
  role: "admin" | "member" | "guest",
): Promise<void> {
  await memberRepo.create(db, {
    userId: user.id,
    email: user.email,
    workspaceId,
    createdBy: user.id,
    role,
    status: "active",
  });
}
