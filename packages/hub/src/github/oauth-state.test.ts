import { describe, expect, it } from "vitest";

import {
  clearedStateCookie,
  newState,
  stateCookie,
  statesMatch,
} from "./oauth-state";

describe("OAuth state", () => {
  it("is long, random and URL-safe", () => {
    const a = newState();
    expect(a).toMatch(/^[\w-]{43}$/);
    expect(newState()).not.toBe(a);
  });

  it("matches only the exact value", () => {
    const state = newState();
    expect(statesMatch(state, state)).toBe(true);
    expect(statesMatch(state, `${state}x`)).toBe(false);
    expect(statesMatch(state, newState())).toBe(false);
    expect(statesMatch(undefined, state)).toBe(false);
    expect(statesMatch(state, undefined)).toBe(false);
    expect(statesMatch(state, [state])).toBe(false);
    expect(statesMatch("short", "short")).toBe(false);
  });

  it("keeps the cookie to the GitHub routes, out of scripts, and secure in production", () => {
    expect(stateCookie("abc", true)).toBe(
      "hub_github_state=abc; Max-Age=600; Path=/api/hub/github; HttpOnly; SameSite=Lax; Secure",
    );
    expect(stateCookie("abc", false)).not.toContain("Secure");
    expect(clearedStateCookie(true)).toContain("Max-Age=0");
  });
});
