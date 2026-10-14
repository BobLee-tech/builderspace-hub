import { normalizeEmail } from "../shared/email";

/** How long a registration link stays usable. */
export const GRANT_TTL_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function grantExpiry(issuedAt: Date): Date {
  return new Date(issuedAt.getTime() + GRANT_TTL_DAYS * DAY_MS);
}

/** The parts of a grant row the rules depend on. */
export interface GrantFacts {
  email: string;
  expiresAt: Date;
  consumedAt: Date | null;
  revokedAt: Date | null;
}

export type GrantState = "pending" | "consumed" | "revoked" | "expired";

/**
 * A grant's state at a point in time. Something done to the grant (used,
 * revoked) outranks it merely having run out of time.
 */
export function grantState(grant: GrantFacts, now: Date): GrantState {
  if (grant.consumedAt) return "consumed";
  if (grant.revokedAt) return "revoked";
  if (grant.expiresAt.getTime() <= now.getTime()) return "expired";
  return "pending";
}

export type GrantRefusal =
  | "no_grant"
  | "email_mismatch"
  | "consumed"
  | "revoked"
  | "expired";

export type GrantDecision =
  | { allowed: true }
  | { allowed: false; reason: GrantRefusal };

/**
 * May this address register with this grant right now?
 *
 * The grant is found by its secret token, so the caller has already proved they
 * hold the link; this checks the link is still good and was issued for the
 * address being registered.
 */
export function evaluateGrant(
  grant: GrantFacts | null,
  attempt: { email: string; now: Date },
): GrantDecision {
  if (!grant) return { allowed: false, reason: "no_grant" };

  const state = grantState(grant, attempt.now);
  if (state !== "pending") return { allowed: false, reason: state };

  if (normalizeEmail(attempt.email) !== grant.email) {
    return { allowed: false, reason: "email_mismatch" };
  }

  return { allowed: true };
}
