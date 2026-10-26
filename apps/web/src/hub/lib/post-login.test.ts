import { describe, expect, it } from "vitest";

import { resolvePostLoginTarget } from "./post-login";

const FALLBACK = "/boards";

describe("resolvePostLoginTarget", () => {
  it.each([
    "/boards",
    "/boards/abc123def456",
    "/cards/abc123def456?tab=activity#comment-2",
    "/invite/abc123def456",
    "/",
  ])("keeps the in-app path %j", (next) => {
    expect(resolvePostLoginTarget(next, FALLBACK)).toBe(next);
  });

  it("keeps the MCP consent page with its whole authorization request", () => {
    const next = `/mcp/authorize?response_type=code&client_id=mcp_${"a".repeat(24)}&redirect_uri=${encodeURIComponent("http://127.0.0.1:61234/oauth/callback")}&code_challenge=${"c".repeat(43)}&code_challenge_method=S256&state=${"s".repeat(300)}&resource=${encodeURIComponent("https://builderspace-hub.vercel.app/api/hub/mcp")}`;
    expect(next.length).toBeGreaterThan(512);
    expect(resolvePostLoginTarget(next, FALLBACK)).toBe(next);
  });

  it.each([
    ["nothing", null],
    ["an empty string", ""],
    ["an absolute URL", "https://evil.example/login"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash trick", "/\\evil.example"],
    ["a script URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a relative path", "boards"],
    ["a path with a control character", "/boards\n/evil"],
    ["an encoded protocol-relative URL", "/%2F%2Fevil.example"],
    ["a path that is absurdly long", `/${"a".repeat(2100)}`],
  ])("falls back for %s", (_, next) => {
    expect(resolvePostLoginTarget(next, FALLBACK)).toBe(FALLBACK);
  });

  it("falls back for non-strings", () => {
    expect(resolvePostLoginTarget(undefined, FALLBACK)).toBe(FALLBACK);
    expect(resolvePostLoginTarget(["/a", "/b"], FALLBACK)).toBe(FALLBACK);
  });
});
