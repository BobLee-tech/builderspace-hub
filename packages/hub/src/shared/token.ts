import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * A registration-link secret: 256 random bits, URL-safe.
 * Shown to an admin exactly once; only its hash is stored.
 */
export function generateGrantToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * What is stored and looked up instead of the token itself. A plain SHA-256 is
 * enough because the input is already 256 bits of randomness, not a password.
 */
export function hashGrantToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Cheap shape check so junk never reaches a query. */
export function isGrantTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}
