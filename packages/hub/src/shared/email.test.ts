import { describe, expect, it } from "vitest";

import { normalizeEmail } from "./email";

describe("normalizeEmail", () => {
  it("trims and lower-cases", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe(
      "ada.lovelace@example.com",
    );
  });

  it("returns the same value for addresses that only differ by case", () => {
    expect(normalizeEmail("A@b.co")).toBe(normalizeEmail("a@B.CO"));
  });

  it.each(["", "   ", "no-at-sign", "a@", "@b.co", "a b@c.co", "a@b"])(
    "rejects %j",
    (raw) => {
      expect(normalizeEmail(raw)).toBeNull();
    },
  );

  it("rejects addresses longer than the user table allows", () => {
    expect(normalizeEmail(`${"a".repeat(251)}@b.co`)).toBeNull();
  });

  it("rejects non-strings without throwing", () => {
    expect(normalizeEmail(undefined)).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});
