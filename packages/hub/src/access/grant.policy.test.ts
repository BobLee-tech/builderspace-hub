import { describe, expect, it } from "vitest";

import type { GrantFacts } from "./grant.policy";
import {
  evaluateGrant,
  GRANT_TTL_DAYS,
  grantExpiry,
  grantState,
} from "./grant.policy";

const now = new Date("2026-10-13T12:00:00Z");
const later = new Date("2026-10-20T12:00:00Z");
const earlier = new Date("2026-10-10T12:00:00Z");

const grant = (overrides: Partial<GrantFacts> = {}): GrantFacts => ({
  email: "new@example.test",
  expiresAt: later,
  consumedAt: null,
  revokedAt: null,
  ...overrides,
});

describe("grantExpiry", () => {
  it("is a week after issue", () => {
    expect(GRANT_TTL_DAYS).toBe(7);
    expect(grantExpiry(now)).toEqual(later);
  });
});

describe("grantState", () => {
  it("is pending while unused, unrevoked and unexpired", () => {
    expect(grantState(grant(), now)).toBe("pending");
  });

  it("expires at the stated instant, not after it", () => {
    expect(grantState(grant({ expiresAt: now }), now)).toBe("expired");
    expect(grantState(grant({ expiresAt: earlier }), now)).toBe("expired");
  });

  it("reports consumed and revoked", () => {
    expect(grantState(grant({ consumedAt: earlier }), now)).toBe("consumed");
    expect(grantState(grant({ revokedAt: earlier }), now)).toBe("revoked");
  });

  it("prefers what happened to the grant over the passing of time", () => {
    expect(
      grantState(grant({ consumedAt: earlier, expiresAt: earlier }), now),
    ).toBe("consumed");
    expect(
      grantState(grant({ revokedAt: earlier, expiresAt: earlier }), now),
    ).toBe("revoked");
  });
});

describe("evaluateGrant", () => {
  const attempt = { email: "new@example.test", now };

  it("allows the invited address with a live grant", () => {
    expect(evaluateGrant(grant(), attempt)).toEqual({ allowed: true });
  });

  it("compares addresses case-insensitively", () => {
    expect(
      evaluateGrant(grant(), { email: " New@Example.TEST ", now }),
    ).toEqual({ allowed: true });
  });

  it("refuses when there is no grant", () => {
    expect(evaluateGrant(null, attempt)).toEqual({
      allowed: false,
      reason: "no_grant",
    });
  });

  it("refuses a different address even with a live grant", () => {
    expect(
      evaluateGrant(grant(), { email: "other@example.test", now }),
    ).toEqual({ allowed: false, reason: "email_mismatch" });
  });

  it("refuses an unusable address", () => {
    expect(evaluateGrant(grant(), { email: "not-an-email", now })).toEqual({
      allowed: false,
      reason: "email_mismatch",
    });
  });

  it.each([
    ["consumed", { consumedAt: earlier }],
    ["revoked", { revokedAt: earlier }],
    ["expired", { expiresAt: earlier }],
  ] as const)("refuses a %s grant", (reason, overrides) => {
    expect(evaluateGrant(grant(overrides), attempt)).toEqual({
      allowed: false,
      reason,
    });
  });
});
