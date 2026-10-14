import { describe, expect, it } from "vitest";

import { HubError, isHubError } from "./errors";

describe("HubError", () => {
  it("carries a machine-readable code and a message for people", () => {
    const error = new HubError("NOT_FOUND", "找不到这条注册许可");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("HubError");
    expect(error.code).toBe("NOT_FOUND");
    expect(error.message).toBe("找不到这条注册许可");
  });

  it("is recognised by isHubError, and nothing else is", () => {
    expect(isHubError(new HubError("CONFLICT", "x"))).toBe(true);
    expect(isHubError(new Error("x"))).toBe(false);
    expect(isHubError({ code: "CONFLICT", message: "x" })).toBe(false);
    expect(isHubError(null)).toBe(false);
  });
});
