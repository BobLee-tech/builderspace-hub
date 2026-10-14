import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The `state` that ties GitHub's redirect back to the browser that started
 * it, so nobody can make a person connect someone else's GitHub account. It
 * lives in a short-lived cookie that only the GitHub routes receive.
 */

export const STATE_COOKIE = "hub_github_state";
const COOKIE_PATH = "/api/hub/github";
const STATE_MAX_AGE_SECONDS = 600;

export function newState(): string {
  return randomBytes(32).toString("base64url");
}

/** Compares in constant time; anything missing or malformed does not match. */
export function statesMatch(
  fromCookie: string | undefined,
  fromGitHub: unknown,
): boolean {
  if (!fromCookie || typeof fromGitHub !== "string") return false;
  const a = Buffer.from(fromCookie);
  const b = Buffer.from(fromGitHub);
  return a.length === b.length && a.length >= 32 && timingSafeEqual(a, b);
}

const attributes = (secure: boolean) =>
  `Path=${COOKIE_PATH}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;

export function stateCookie(state: string, secure: boolean): string {
  return `${STATE_COOKIE}=${state}; Max-Age=${STATE_MAX_AGE_SECONDS}; ${attributes(secure)}`;
}

export function clearedStateCookie(secure: boolean): string {
  return `${STATE_COOKIE}=; Max-Age=0; ${attributes(secure)}`;
}
