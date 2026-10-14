import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken } from "./token-crypto";

const secret = "test-secret-test-secret-test-secret-1234";
const token = "ghu_exampleTokenValue0123456789";

describe("token encryption", () => {
  it("round-trips and never stores the token in the clear", () => {
    const sealed = encryptToken(token, secret);
    expect(sealed).not.toContain(token);
    expect(decryptToken(sealed, secret)).toBe(token);
  });

  it("uses a fresh nonce every time", () => {
    expect(encryptToken(token, secret)).not.toBe(encryptToken(token, secret));
  });

  it("refuses a tampered value or a different key", () => {
    const sealed = encryptToken(token, secret);
    const [version, iv, body, tag] = sealed.split(".");
    const flipped = `${body?.startsWith("A") ? "B" : "A"}${body?.slice(1)}`;

    expect(decryptToken([version, iv, flipped, tag].join("."), secret)).toBeNull();
    expect(decryptToken(sealed, `${secret}-rotated`)).toBeNull();
    expect(decryptToken("not-a-sealed-value", secret)).toBeNull();
  });

  it("will not run without a real secret", () => {
    expect(() => encryptToken(token, "")).toThrow();
  });
});
