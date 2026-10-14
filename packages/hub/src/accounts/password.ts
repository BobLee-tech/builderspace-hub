import { randomInt } from "node:crypto";
import { hashPassword } from "better-auth/crypto";

// No 0/O, 1/l/I: these passwords are read aloud or copied into a chat.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
const LENGTH = 16;

/**
 * A strong one-time password for an account an admin created or reset.
 * 16 characters from 55 symbols is about 92 bits.
 */
export function generateTemporaryPassword(): string {
  return Array.from(
    { length: LENGTH },
    () => ALPHABET[randomInt(ALPHABET.length)],
  ).join("");
}

/**
 * Hashes the way Better Auth's email-and-password sign-in expects, so a
 * password set here works on the normal login page.
 */
export function hashAccountPassword(password: string): Promise<string> {
  return hashPassword(password);
}
