import type { Db } from "../db";
import type { GrantDecision } from "./grant.policy";
import { upsertAccount } from "../accounts/account.repo";
import { recordAudit } from "../audit";
import { ensureProjectMember } from "../kan/members.gateway";
import { normalizeEmail } from "../shared/email";
import { hashGrantToken, isGrantTokenShape } from "../shared/token";
import { evaluateGrant } from "./grant.policy";
import {
  findGrantByTokenHash,
  findOpenGrantByEmail,
  listGrantProjects,
  markGrantConsumed,
} from "./grant.repo";

/**
 * The registration gate: may an account be created for this address by someone
 * presenting this link token? Called before Better Auth inserts the user.
 */
export async function decideUserCreate(
  db: Db,
  attempt: { email: string; token: unknown; now: Date },
): Promise<GrantDecision> {
  if (!isGrantTokenShape(attempt.token)) {
    return { allowed: false, reason: "no_grant" };
  }

  const grant = await findGrantByTokenHash(db, hashGrantToken(attempt.token));

  return evaluateGrant(grant, { email: attempt.email, now: attempt.now });
}

export interface ProvisionResult {
  /** True when this call used up a grant. */
  provisioned: boolean;
  projectsAdded: number;
}

const NOTHING_TO_DO: ProvisionResult = { provisioned: false, projectsAdded: 0 };

/**
 * Gives a newly registered account what its grant promised: membership of the
 * preset projects. Safe to call any number of times.
 *
 * Better Auth commits the user row before its `after` hook runs and has no
 * transaction around the two, so this cannot be atomic with sign-up. Instead it
 * is idempotent: memberships are added only where missing and the grant is
 * marked used last, so a call that died half-way is completed by the next one.
 *
 * An unrevoked grant is honoured even after its link has expired: the account
 * exists, so it passed the gate while the link was still good.
 */
export async function provisionUser(
  db: Db,
  account: { userId: string; email: string; now: Date },
): Promise<ProvisionResult> {
  const email = normalizeEmail(account.email);
  if (!email) return NOTHING_TO_DO;

  const grant = await findOpenGrantByEmail(db, email);
  if (!grant) return NOTHING_TO_DO;

  let projectsAdded = 0;
  for (const project of await listGrantProjects(db, grant.id)) {
    const outcome = await ensureProjectMember(db, {
      userId: account.userId,
      email,
      workspaceId: project.workspaceId,
      role: project.role,
      addedBy: grant.createdBy ?? account.userId,
    });
    if (outcome === "added") projectsAdded += 1;
  }

  const consumed = await db.transaction(async (tx) => {
    const won = await markGrantConsumed(tx, grant.id, {
      userId: account.userId,
      at: account.now,
    });
    if (won) {
      if (grant.hubRole) {
        await upsertAccount(tx, account.userId, {
          role: grant.hubRole,
          now: account.now,
        });
      }
      await recordAudit(tx, {
        actor: { userId: account.userId, email },
        action: "grant.consumed",
        entityType: "grant",
        entityId: grant.publicId,
        summary: `${email} 使用注册许可完成注册`,
        detail: { projectsAdded },
      });
    }
    return won;
  });

  return { provisioned: consumed, projectsAdded };
}
