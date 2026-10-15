import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";

/**
 * Encryption for the GitHub tokens kept in the database, so a copy of the
 * database alone does not hand out access to anyone's repositories.
 *
 * AES-256-GCM with a key derived (HKDF) from the app's existing auth secret,
 * so there is no second secret to manage. Rotating that secret makes stored
 * tokens unreadable; people then simply connect GitHub again.
 */

const VERSION = "v1";
const INFO = "builderspace-hub/github-token";

function keyFrom(secret: string): Buffer {
  if (secret.length < 16) {
    throw new Error("token-crypto: the auth secret is missing or too short");
  }
  return Buffer.from(hkdfSync("sha256", secret, "", INFO, 32));
}

export function encryptToken(plain: string, secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFrom(secret), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [
    VERSION,
    iv.toString("base64url"),
    body.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(".");
}

/** The token, or null when the value was tampered with or the key changed. */
export function decryptToken(sealed: string, secret: string): string | null {
  const [version, iv, body, tag] = sealed.split(".");
  if (version !== VERSION || !iv || !body || !tag) return null;
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      keyFrom(secret),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}
