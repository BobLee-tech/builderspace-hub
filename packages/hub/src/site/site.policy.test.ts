import { describe, expect, it } from "vitest";

import { canOnSite } from "./site.policy";

describe("canOnSite", () => {
  it("gives nothing to someone without website access", () => {
    expect(canOnSite(null, "site.people")).toBe(false);
    expect(canOnSite(null, "site.review")).toBe(false);
  });

  it("lets 名单 work the lists but not review projects", () => {
    expect(canOnSite("people", "site.people")).toBe(true);
    expect(canOnSite("people", "site.review")).toBe(false);
  });

  it("lets 管理 do both", () => {
    expect(canOnSite("manage", "site.people")).toBe(true);
    expect(canOnSite("manage", "site.review")).toBe(true);
  });
});
