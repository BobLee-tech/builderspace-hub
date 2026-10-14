import type { dbClient } from "@kan/db/client";
import * as memberRepo from "@kan/db/repository/member.repo";

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
