import { and, asc, count, eq, ilike, inArray, isNull, or } from "drizzle-orm";

import * as memberRepo from "@kan/db/repository/member.repo";
import * as permissionRepo from "@kan/db/repository/permission.repo";
import {
  account,
  apikey,
  session,
  users,
  workspaceMembers,
  workspaces,
} from "@kan/db/schema";

import type { Db, DbOrTx } from "../db";
import type { ProjectRole } from "../schema";

/**
 * Account operations on Kan's own auth tables (`user`, `account`, `session`,
 * `apiKey`). Kan has no repository functions for an admin creating an account
 * or setting someone's password, so these write those tables directly, in the
 * exact shape Better Auth uses for e-mail-and-password accounts. The auth
 * package's integration test signs in with an account made here, which is what
 * keeps the two in step.
 */

export interface KanUser {
  id: string;
  name: string | null;
  email: string;
  createdAt: Date;
}

const userColumns = {
  id: users.id,
  name: users.name,
  email: users.email,
  createdAt: users.createdAt,
};

export async function getUserById(
  db: DbOrTx,
  userId: string,
): Promise<KanUser | null> {
  const [row] = await db
    .select(userColumns)
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

/** Creates a user that can sign in with e-mail and password. */
export async function insertPasswordUser(
  db: DbOrTx,
  input: { name: string; email: string; passwordHash: string; now: Date },
): Promise<KanUser> {
  const [user] = await db
    .insert(users)
    .values({
      name: input.name,
      email: input.email,
      emailVerified: false,
      createdAt: input.now,
      updatedAt: input.now,
    })
    .returning(userColumns);
  if (!user) throw new Error("insertPasswordUser: no user row");

  await db.insert(account).values({
    // Better Auth's credential accounts use the user id as the account id.
    accountId: user.id,
    providerId: "credential",
    userId: user.id,
    password: input.passwordHash,
    createdAt: input.now,
    updatedAt: input.now,
  });

  return user;
}

/** Sets (or adds) the e-mail-and-password credential of a user. */
export async function setPasswordHash(
  db: DbOrTx,
  input: { userId: string; passwordHash: string; now: Date },
): Promise<void> {
  const updated = await db
    .update(account)
    .set({ password: input.passwordHash, updatedAt: input.now })
    .where(
      and(
        eq(account.userId, input.userId),
        eq(account.providerId, "credential"),
      ),
    )
    .returning({ id: account.id });

  if (updated.length === 0) {
    await db.insert(account).values({
      accountId: input.userId,
      providerId: "credential",
      userId: input.userId,
      password: input.passwordHash,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
}

export async function renameUser(
  db: DbOrTx,
  input: { userId: string; name: string; now: Date },
): Promise<void> {
  await db
    .update(users)
    .set({ name: input.name, updatedAt: input.now })
    .where(eq(users.id, input.userId));
}

/** Signs a user out everywhere. Kan reads sessions from the database. */
export async function deleteSessions(
  db: DbOrTx,
  userId: string,
): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}

/** API keys yield a session of their own, so they must be switched off too. */
export async function disableApiKeys(
  db: DbOrTx,
  userId: string,
): Promise<void> {
  await db
    .update(apikey)
    .set({ enabled: false })
    .where(eq(apikey.userId, userId));
}

export interface ProjectMembership {
  workspaceId: number;
  projectPublicId: string;
  projectName: string;
  role: ProjectRole;
}

/** Active memberships of the given users, grouped by user id. */
export async function listMemberships(
  db: DbOrTx,
  userIds: string[],
): Promise<Map<string, ProjectMembership[]>> {
  const byUser = new Map<string, ProjectMembership[]>();
  if (userIds.length === 0) return byUser;

  const rows = await db
    .select({
      userId: workspaceMembers.userId,
      workspaceId: workspaces.id,
      projectPublicId: workspaces.publicId,
      projectName: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(
        inArray(workspaceMembers.userId, userIds),
        eq(workspaceMembers.status, "active"),
        isNull(workspaceMembers.deletedAt),
        isNull(workspaces.deletedAt),
      ),
    )
    .orderBy(asc(workspaces.id));

  for (const row of rows) {
    if (!row.userId) continue;
    const list = byUser.get(row.userId) ?? [];
    list.push({
      workspaceId: row.workspaceId,
      projectPublicId: row.projectPublicId,
      projectName: row.projectName,
      role: row.role,
    });
    byUser.set(row.userId, list);
  }
  return byUser;
}

/** One page of users, optionally filtered by name or e-mail, oldest first. */
export async function listUsers(
  db: Db,
  query: { search?: string; limit: number; offset: number },
): Promise<{ users: KanUser[]; total: number }> {
  const pattern = query.search?.trim()
    ? `%${query.search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
    : null;
  const where = pattern
    ? or(ilike(users.name, pattern), ilike(users.email, pattern))
    : undefined;

  const [page, totals] = await Promise.all([
    db
      .select(userColumns)
      .from(users)
      .where(where)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(users).where(where),
  ]);

  return { users: page, total: totals[0]?.total ?? 0 };
}

/**
 * Changes a member's role in a project, or removes them from it (`null`),
 * through Kan's repositories. Returns false when they were not a member.
 */
export async function setMembershipRole(
  db: Db,
  input: {
    userId: string;
    workspaceId: number;
    role: ProjectRole | null;
    actorUserId: string;
    now: Date;
  },
): Promise<boolean> {
  const member = await permissionRepo.getMemberWithRole(
    db,
    input.userId,
    input.workspaceId,
  );
  if (!member) return false;

  if (input.role === null) {
    await memberRepo.softDelete(db, {
      memberId: member.id,
      deletedAt: input.now,
      deletedBy: input.actorUserId,
    });
    return true;
  }

  const role = await permissionRepo.getRoleByWorkspaceIdAndName(
    db,
    input.workspaceId,
    input.role,
  );
  await memberRepo.updateRole(db, {
    memberId: member.id,
    role: input.role,
    roleId: role?.id ?? null,
  });
  return true;
}
