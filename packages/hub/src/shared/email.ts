import { z } from "zod";

// `user.email` is varchar(255) in Kan's schema.
const EMAIL_MAX_LENGTH = 255;

const emailSchema = z.string().email().max(EMAIL_MAX_LENGTH);

/**
 * The one way the Hub compares e-mail addresses: trimmed and lower-cased.
 *
 * Better Auth lower-cases addresses before creating a user, while Kan stores
 * invitations exactly as typed, so any comparison that skips this step can miss
 * a match. Returns null for anything that is not a usable address.
 */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;

  const candidate = raw.trim().toLowerCase();
  const parsed = emailSchema.safeParse(candidate);

  return parsed.success ? parsed.data : null;
}
