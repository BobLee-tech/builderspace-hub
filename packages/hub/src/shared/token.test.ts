import { describe, expect, it } from "vitest";

import { generateGrantToken, hashGrantToken, isGrantTokenShape } from "./token";

describe("generateGrantToken", () => {
  it("is URL-safe and carries 256 bits", () => {
    const token = generateGrantToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 200 }, generateGrantToken));
    expect(tokens.size).toBe(200);
  });
});

describe("hashGrantToken", () => {
  it("is a stable SHA-256 hex digest", () => {
    expect(hashGrantToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("differs for different tokens and never contains the token", () => {
    const token = generateGrantToken();
    const hash = hashGrantToken(token);
    expect(hash).toHaveLength(64);
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(hashGrantToken(generateGrantToken()));
  });
});

describe("isGrantTokenShape", () => {
  it("accepts generated tokens", () => {
    expect(isGrantTokenShape(generateGrantToken())).toBe(true);
  });

  it.each([
    "",
    "short",
    "a".repeat(42),
    "a".repeat(44),
    `${"a".repeat(42)}/`,
    `${"a".repeat(42)} `,
  ])("rejects %j before it reaches the database", (value) => {
    expect(isGrantTokenShape(value)).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isGrantTokenShape(null)).toBe(false);
    expect(isGrantTokenShape(undefined)).toBe(false);
  });
});
