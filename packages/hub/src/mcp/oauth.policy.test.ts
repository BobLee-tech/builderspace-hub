import { describe, expect, it } from "vitest";

import { mcpUrls } from "./catalog";
import {
  ACCESS_TOKEN_PREFIX,
  authorizationServerMetadata,
  bearerToken,
  clientOfRequest,
  DEFAULT_CLIENT_NAME,
  isAllowedRedirectUri,
  isOAuthError,
  isOurResource,
  isTokenShape,
  matchesRegisteredRedirect,
  OAuthError,
  parseClientRegistration,
  protectedResourceMetadata,
  readAuthorizeParams,
  redirectWith,
  registrationResponse,
  sanitizeClientName,
  single,
  tokenResponse,
  verifyPkce,
} from "./oauth.policy";

const urls = mcpUrls("https://hub.example.test/some/page");
const resource = urls.resource;

/** RFC 7636 appendix B. */
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

function oauthErrorOf(work: () => unknown): OAuthError {
  try {
    work();
  } catch (error) {
    if (error instanceof OAuthError) return error;
    throw error;
  }
  throw new Error("expected an OAuthError");
}

describe("mcpUrls", () => {
  it("hangs everything off the origin, whatever path the base URL has", () => {
    expect(urls).toEqual({
      issuer: "https://hub.example.test",
      resource: "https://hub.example.test/api/hub/mcp",
      resourceMetadata:
        "https://hub.example.test/.well-known/oauth-protected-resource/api/hub/mcp",
      authorize: "https://hub.example.test/mcp/authorize",
      token: "https://hub.example.test/api/hub/oauth/token",
      register: "https://hub.example.test/api/hub/oauth/register",
      revoke: "https://hub.example.test/api/hub/oauth/revoke",
      guide: "https://hub.example.test/mcp",
    });
  });
});

describe("discovery documents", () => {
  it("offers only PKCE S256, public clients and the one scope", () => {
    const metadata = authorizationServerMetadata(urls);
    expect(metadata.issuer).toBe(urls.issuer);
    expect(metadata.registration_endpoint).toBe(urls.register);
    expect(metadata.code_challenge_methods_supported).toEqual(["S256"]);
    expect(metadata.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(metadata.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(metadata.scopes_supported).toEqual(["hub"]);
  });

  it("points the MCP endpoint at this site as its authorization server", () => {
    expect(protectedResourceMetadata(urls)).toMatchObject({
      resource: urls.resource,
      authorization_servers: [urls.issuer],
      bearer_methods_supported: ["header"],
    });
  });
});

describe("isAllowedRedirectUri", () => {
  it.each([
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:51234/callback",
    "http://127.0.0.1:33418/",
    "http://[::1]:8080/cb",
    "cursor://anysphere.cursor-retrieval/oauth/user-hub/callback",
    "vscode://vscode.github-authentication/did-authenticate",
  ])("accepts %s", (uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(true);
  });

  it.each([
    ["plain http to another computer", "http://evil.example/cb"],
    ["a script", "javascript:alert(1)"],
    ["a data URL", "data:text/html,hi"],
    ["a local file", "file:///etc/passwd"],
    ["a fragment", "https://app.example/cb#frag"],
    ["credentials", "https://user:pass@app.example/cb"],
    ["whitespace", "https://app.example/c b"],
    ["nothing", ""],
    ["not a URL", "not a url"],
    ["a huge URL", `https://app.example/${"a".repeat(2000)}`],
  ])("refuses %s", (_label, uri) => {
    expect(isAllowedRedirectUri(uri)).toBe(false);
  });
});

describe("sanitizeClientName", () => {
  it("drops control and direction characters and squeezes spaces", () => {
    expect(sanitizeClientName("  Claude‮\u0007   Code \n")).toBe("Claude Code");
  });

  it("falls back to a neutral name", () => {
    expect(sanitizeClientName(undefined)).toBe(DEFAULT_CLIENT_NAME);
    expect(sanitizeClientName(42)).toBe(DEFAULT_CLIENT_NAME);
    expect(sanitizeClientName(" ​ ")).toBe(DEFAULT_CLIENT_NAME);
  });

  it("keeps at most 80 characters", () => {
    expect([...sanitizeClientName("字".repeat(200))]).toHaveLength(80);
  });
});

describe("parseClientRegistration", () => {
  const valid = {
    client_name: "Claude Code",
    redirect_uris: ["http://localhost:5000/cb", "http://localhost:5000/cb"],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };

  it("keeps the name and the distinct redirect addresses", () => {
    expect(parseClientRegistration(valid)).toEqual({
      name: "Claude Code",
      redirectUris: ["http://localhost:5000/cb"],
    });
  });

  it.each([
    ["not an object", [], "invalid_client_metadata"],
    ["no redirect", { client_name: "x" }, "invalid_redirect_uri"],
    ["empty redirects", { redirect_uris: [] }, "invalid_redirect_uri"],
    [
      "too many redirects",
      {
        redirect_uris: Array.from(
          { length: 11 },
          (_, i) => `https://a.example/${i}`,
        ),
      },
      "invalid_redirect_uri",
    ],
    [
      "a forbidden redirect",
      { redirect_uris: ["http://evil.example/cb"] },
      "invalid_redirect_uri",
    ],
    [
      "no authorization code grant",
      { ...valid, grant_types: ["client_credentials"] },
      "invalid_client_metadata",
    ],
    [
      "no code response",
      { ...valid, response_types: ["token"] },
      "invalid_client_metadata",
    ],
  ])("refuses %s", (_label, body, code) => {
    expect(oauthErrorOf(() => parseClientRegistration(body)).error).toBe(code);
  });

  it("answers with what was registered: a public client", () => {
    const answer = registrationResponse(
      "mcp_abc",
      { name: "X", redirectUris: ["https://a.example/cb"] },
      new Date("2026-10-25T00:00:10Z"),
    );
    expect(answer).toMatchObject({
      client_id: "mcp_abc",
      client_id_issued_at: 1792886410,
      token_endpoint_auth_method: "none",
      redirect_uris: ["https://a.example/cb"],
    });
    expect(answer).not.toHaveProperty("client_secret");
  });
});

describe("matchesRegisteredRedirect", () => {
  const registered = ["http://127.0.0.1:5000/callback", "https://a.example/cb"];

  it("matches exactly", () => {
    expect(matchesRegisteredRedirect("https://a.example/cb", registered)).toBe(
      true,
    );
  });

  it("lets a loopback address change its port, nothing else", () => {
    expect(
      matchesRegisteredRedirect("http://127.0.0.1:61000/callback", registered),
    ).toBe(true);
    expect(
      matchesRegisteredRedirect("http://127.0.0.1:61000/other", registered),
    ).toBe(false);
    expect(
      matchesRegisteredRedirect("http://localhost:5000/callback", registered),
    ).toBe(false);
  });

  it("never relaxes a non-loopback address", () => {
    expect(
      matchesRegisteredRedirect("https://a.example:444/cb", registered),
    ).toBe(false);
    expect(matchesRegisteredRedirect("not a url", registered)).toBe(false);
  });
});

describe("reading an authorization request", () => {
  const query = {
    response_type: "code",
    client_id: "mcp_abc",
    redirect_uri: "http://localhost:5000/cb",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "xyz",
    resource,
    scope: "openid hub something-else",
  };

  it("takes one value of each parameter", () => {
    expect(single({ a: ["1", "2"] }, "a")).toBeNull();
    expect(single({ a: "" }, "a")).toBeNull();
    expect(single({ a: "1" }, "a")).toBe("1");
  });

  it("needs a client and a redirect before anything else", () => {
    expect(clientOfRequest(query)).toEqual({
      clientId: "mcp_abc",
      redirectUri: "http://localhost:5000/cb",
    });
    expect(oauthErrorOf(() => clientOfRequest({})).error).toBe(
      "invalid_request",
    );
    expect(
      oauthErrorOf(() => clientOfRequest({ client_id: "x".repeat(65) })).error,
    ).toBe("invalid_request");
    expect(
      oauthErrorOf(() => clientOfRequest({ client_id: "mcp_abc" })).message,
    ).toContain("redirect_uri");
  });

  it("accepts a PKCE request for this resource, whatever the scope", () => {
    expect(readAuthorizeParams(query, resource)).toEqual({
      codeChallenge: challenge,
      state: "xyz",
    });
    expect(
      readAuthorizeParams(
        { ...query, resource: `${resource}/`, state: undefined },
        resource,
      ),
    ).toEqual({ codeChallenge: challenge, state: null });
  });

  it.each([
    [
      "another response type",
      { response_type: "token" },
      "unsupported_response_type",
    ],
    ["no challenge", { code_challenge: undefined }, "invalid_request"],
    ["a malformed challenge", { code_challenge: "short" }, "invalid_request"],
    ["the plain method", { code_challenge_method: "plain" }, "invalid_request"],
    ["a huge state", { state: "s".repeat(1001) }, "invalid_request"],
    [
      "another resource",
      { resource: "https://other.example/mcp" },
      "invalid_target",
    ],
  ])("refuses %s", (_label, change, code) => {
    expect(
      oauthErrorOf(() => readAuthorizeParams({ ...query, ...change }, resource))
        .error,
    ).toBe(code);
  });

  it("recognises our resource with or without a trailing slash", () => {
    expect(isOurResource(`${resource}//`, resource)).toBe(true);
    expect(isOurResource("https://hub.example.test", resource)).toBe(false);
  });
});

describe("redirectWith", () => {
  it("adds to the query, keeping what is there and skipping nulls", () => {
    expect(
      redirectWith("https://a.example/cb?x=1", { code: "c d", state: null }),
    ).toBe("https://a.example/cb?x=1&code=c+d");
  });

  it("works for an app's own scheme", () => {
    expect(
      redirectWith("cursor://anysphere.cursor-retrieval/cb", { code: "c" }),
    ).toBe("cursor://anysphere.cursor-retrieval/cb?code=c");
  });
});

describe("tokens", () => {
  it("checks PKCE the way RFC 7636 does", () => {
    expect(verifyPkce(verifier, challenge)).toBe(true);
    expect(verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(verifyPkce("too-short", challenge)).toBe(false);
  });

  it("answers with a bearer token, a refresh token and the one scope", () => {
    expect(tokenResponse({ accessToken: "a", refreshToken: "r" })).toEqual({
      access_token: "a",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "r",
      scope: "hub",
    });
  });

  it("knows a token by its prefix and length", () => {
    const token = `${ACCESS_TOKEN_PREFIX}${"a".repeat(43)}`;
    expect(isTokenShape(token, ACCESS_TOKEN_PREFIX)).toBe(true);
    expect(isTokenShape(`${token}a`, ACCESS_TOKEN_PREFIX)).toBe(false);
    expect(isTokenShape("a".repeat(50), ACCESS_TOKEN_PREFIX)).toBe(false);
  });

  it("reads a bearer header", () => {
    expect(bearerToken("Bearer abc")).toBe("abc");
    expect(bearerToken("bearer   abc  ")).toBe("abc");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe("OAuthError", () => {
  it("serialises the way the specs want", () => {
    const error = new OAuthError("invalid_grant", "过期了");
    expect(isOAuthError(error)).toBe(true);
    expect(isOAuthError(new Error("x"))).toBe(false);
    expect(error.status).toBe(400);
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      error: "invalid_grant",
      error_description: "过期了",
    });
  });
});
