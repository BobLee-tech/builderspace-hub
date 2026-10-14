/**
 * The only entry point of this package that is safe to import in the browser:
 * constants and pure helpers, nothing that touches Node or the database.
 */

/**
 * Request header that carries a registration-link token on sign-up. The token
 * travels in a header, and in the link's `#fragment`, so that it never appears
 * in a URL the server sees and therefore never lands in access logs.
 */
export const HUB_GRANT_HEADER = "x-hub-grant";

/** Path of the registration page; the token goes after `#`. */
export const HUB_JOIN_PATH = "/join";

export function buildJoinLink(origin: string, token: string): string {
  return `${origin}${HUB_JOIN_PATH}#${token}`;
}
