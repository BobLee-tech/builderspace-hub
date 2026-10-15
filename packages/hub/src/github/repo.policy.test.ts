import { describe, expect, it } from "vitest";

import { parseRepo, repoUrl } from "./repo.policy";

const ok = (fullName: string) => ({ ok: true, fullName });

describe("parseRepo", () => {
  it("accepts owner/name and lower-cases it", () => {
    expect(parseRepo("EdwinjJ1/Builderspace-Hub")).toEqual(
      ok("edwinjj1/builderspace-hub"),
    );
    expect(parseRepo("  org/app.web  ")).toEqual(ok("org/app.web"));
  });

  it("accepts pasted GitHub links in their usual shapes", () => {
    for (const input of [
      "https://github.com/org/app",
      "http://github.com/org/app/",
      "github.com/org/app.git",
      "https://www.github.com/org/app/tree/main/src",
    ]) {
      expect(parseRepo(input)).toEqual(ok("org/app"));
    }
  });

  it("refuses other hosts with a reason of their own", () => {
    const result = parseRepo("https://gitlab.com/org/app");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("github.com");
  });

  it("refuses names GitHub would not allow", () => {
    for (const input of [
      "",
      "org",
      "org/",
      "/app",
      "-org/app",
      "org-/app",
      "or--g/app",
      "o".repeat(40) + "/app",
      "org/" + "a".repeat(101),
      "org/..",
      "org/.",
      "org/app name",
    ]) {
      expect(parseRepo(input).ok, input).toBe(false);
    }
  });
});

describe("repoUrl", () => {
  it("links to the repository on GitHub", () => {
    expect(repoUrl("org/app")).toBe("https://github.com/org/app");
  });
});
