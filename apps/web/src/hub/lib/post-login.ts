// Room for the MCP consent page's address, whose query carries a whole
// authorization request (app id, redirect, PKCE challenge, state, resource).
const MAX_LENGTH = 2048;

// Printable ASCII only: no spaces, control characters or backslashes.
const SAFE_PATH = /^\/[\x21-\x5B\x5D-\x7E]*$/;

/**
 * Where to send someone after they sign in, given the `?next=` value from the
 * URL. Only a path inside this app is accepted; anything that a browser could
 * read as another origin falls back, so a crafted login link cannot bounce a
 * freshly signed-in user to someone else's site.
 */
export function resolvePostLoginTarget(
  next: unknown,
  fallback: string,
): string {
  if (typeof next !== "string") return fallback;
  if (next.length === 0 || next.length > MAX_LENGTH) return fallback;
  if (!SAFE_PATH.test(next)) return fallback;

  // "//host" and "/%2F%2Fhost" are both origins in disguise.
  let decoded: string;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    return fallback;
  }
  if (next.startsWith("//") || decoded.startsWith("//")) return fallback;
  if (decoded.includes("\\")) return fallback;

  return next;
}
