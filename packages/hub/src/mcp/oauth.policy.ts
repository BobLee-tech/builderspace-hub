import { createHash } from "node:crypto";

import type { McpUrls } from "./catalog";

/**
 * Pure rules for MCP sign-in: OAuth 2.1 with PKCE, public clients that
 * register themselves (RFC 7591), and the two discovery documents MCP clients
 * read first (RFC 8414, RFC 9728). No IO.
 *
 * Deliberately narrow: one grant (authorization code, then refresh), one
 * challenge method (S256), no client secrets, one scope. Every MCP client in
 * use speaks this subset, and each thing left out is a thing that cannot be
 * misconfigured.
 */

/** The one scope. A token can do what its person can do in the web app. */
export const HUB_MCP_SCOPE = "hub";

export const CODE_TTL_SECONDS = 5 * 60;
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** Each refresh starts this over, so a connection used once a month stays. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

export const DEFAULT_CLIENT_NAME = "未命名的 AI 应用";
const CLIENT_NAME_MAX = 80;
const MAX_REDIRECT_URIS = 10;
const REDIRECT_URI_MAX = 2000;
const STATE_MAX = 1000;

export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied"
  | "invalid_redirect_uri"
  | "invalid_client_metadata";

/**
 * An OAuth refusal, in the shape the specs want on the wire
 * (`{ error, error_description }`). The description is for whoever reads the
 * client's log or screen, so it is plain Chinese like every Hub message.
 */
export class OAuthError extends Error {
  readonly error: OAuthErrorCode;
  readonly status: number;

  constructor(error: OAuthErrorCode, description: string, status = 400) {
    super(description);
    this.name = "OAuthError";
    this.error = error;
    this.status = status;
  }

  toJSON(): { error: OAuthErrorCode; error_description: string } {
    return { error: this.error, error_description: this.message };
  }
}

export function isOAuthError(value: unknown): value is OAuthError {
  return value instanceof OAuthError;
}

// --- Discovery ----------------------------------------------------------------

/** RFC 8414: what an MCP client fetches to learn how to sign someone in. */
export function authorizationServerMetadata(urls: McpUrls) {
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorize,
    token_endpoint: urls.token,
    registration_endpoint: urls.register,
    revocation_endpoint: urls.revoke,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [HUB_MCP_SCOPE],
    service_documentation: urls.guide,
  };
}

/** RFC 9728: what the MCP endpoint points a client to when it has no token. */
export function protectedResourceMetadata(urls: McpUrls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    scopes_supported: [HUB_MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "BuilderSpace Hub",
    resource_documentation: urls.guide,
  };
}

// --- Registration -------------------------------------------------------------

/**
 * Schemes a browser would run or read locally rather than hand to an app.
 * Everything else that is not plain http may be a native app's own scheme
 * (`cursor://…`, `vscode://…`), which RFC 8252 allows.
 */
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "file:",
  "blob:",
  "about:",
  "vbscript:",
  "filesystem:",
  "view-source:",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/**
 * Where an app may ask to be sent back to: https anywhere, plain http only to
 * this computer (RFC 8252 loopback), or an app's own scheme. Never a fragment,
 * since the code is added to the query.
 */
export function isAllowedRedirectUri(raw: string): boolean {
  if (raw.length === 0 || raw.length > REDIRECT_URI_MAX) return false;
  if (raw.includes("#") || /\s/.test(raw)) return false;
  const url = parseUrl(raw);
  if (!url) return false;
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return false;
  if (url.username || url.password) return false;
  if (url.protocol === "https:") return url.hostname.length > 0;
  if (url.protocol === "http:") return LOOPBACK_HOSTS.has(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol);
}

/** What an app calls itself, made safe to show: no control or direction characters. */
export function sanitizeClientName(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_CLIENT_NAME;
  const cleaned = raw
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return DEFAULT_CLIENT_NAME;
  return [...cleaned].slice(0, CLIENT_NAME_MAX).join("");
}

export interface ClientRegistration {
  name: string;
  redirectUris: string[];
}

const stringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;

/**
 * Reads an RFC 7591 registration request. Only what matters is checked; the
 * answer then states what was actually registered (a public client using the
 * authorization code grant), which compliant clients follow.
 */
export function parseClientRegistration(body: unknown): ClientRegistration {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new OAuthError("invalid_client_metadata", "请求体要是 JSON 对象");
  }
  const input = body as Record<string, unknown>;

  const redirectUris = stringArray(input.redirect_uris);
  if (!redirectUris || redirectUris.length === 0) {
    throw new OAuthError("invalid_redirect_uri", "至少要有一个 redirect_uris");
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    throw new OAuthError(
      "invalid_redirect_uri",
      `redirect_uris 最多 ${MAX_REDIRECT_URIS} 个`,
    );
  }
  const bad = redirectUris.find((uri) => !isAllowedRedirectUri(uri));
  if (bad !== undefined) {
    throw new OAuthError(
      "invalid_redirect_uri",
      "redirect_uris 只能是 https 地址、本机的 http 地址或应用自己的协议",
    );
  }

  if (input.grant_types !== undefined) {
    const grants = stringArray(input.grant_types);
    if (!grants?.includes("authorization_code")) {
      throw new OAuthError(
        "invalid_client_metadata",
        "只支持 authorization_code（以及 refresh_token）",
      );
    }
  }
  if (input.response_types !== undefined) {
    const types = stringArray(input.response_types);
    if (!types?.includes("code")) {
      throw new OAuthError(
        "invalid_client_metadata",
        "只支持 response_type=code",
      );
    }
  }

  return {
    name: sanitizeClientName(input.client_name),
    redirectUris: [...new Set(redirectUris)],
  };
}

/** The registration answer (RFC 7591 §3.2.1): what the client is now. */
export function registrationResponse(
  clientId: string,
  registration: ClientRegistration,
  issuedAt: Date,
) {
  return {
    client_id: clientId,
    client_id_issued_at: Math.floor(issuedAt.getTime() / 1000),
    client_name: registration.name,
    redirect_uris: registration.redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: HUB_MCP_SCOPE,
  };
}

// --- Authorization ------------------------------------------------------------

function isLoopback(url: URL): boolean {
  return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
}

/**
 * Does the requested redirect match one the app registered? Exactly, except
 * that a loopback address may use any port (RFC 8252 §7.3): desktop apps
 * listen on whatever port is free when someone signs in.
 */
export function matchesRegisteredRedirect(
  requested: string,
  registered: readonly string[],
): boolean {
  if (registered.includes(requested)) return true;
  const want = parseUrl(requested);
  if (!want || !isLoopback(want)) return false;
  return registered.some((candidate) => {
    const have = parseUrl(candidate);
    return (
      have !== null &&
      isLoopback(have) &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

type Query = Record<string, string | string[] | undefined>;

/** One value of a query parameter; a repeated parameter counts as missing. */
export function single(query: Query, name: string): string | null {
  const value = query[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The two parameters checked before anything can be sent back to the app. */
export function clientOfRequest(query: Query): {
  clientId: string;
  redirectUri: string;
} {
  const clientId = single(query, "client_id");
  const redirectUri = single(query, "redirect_uri");
  if (!clientId || clientId.length > 64) {
    throw new OAuthError("invalid_request", "缺少 client_id");
  }
  if (!redirectUri) {
    throw new OAuthError("invalid_request", "缺少 redirect_uri");
  }
  return { clientId, redirectUri };
}

/** A resource indicator (RFC 8707) names us when it is this endpoint, slash or not. */
export function isOurResource(value: string, resource: string): boolean {
  return value.replace(/\/+$/, "") === resource;
}

const CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface AuthorizeParams {
  codeChallenge: string;
  state: string | null;
}

/**
 * The rest of an authorization request, once the app and its redirect are
 * known to be genuine: failures here go back to the app (RFC 6749 §4.1.2.1).
 * `scope` is not read: there is one scope, and it is always the one granted.
 */
export function readAuthorizeParams(
  query: Query,
  resource: string,
): AuthorizeParams {
  if (single(query, "response_type") !== "code") {
    throw new OAuthError(
      "unsupported_response_type",
      "只支持 response_type=code",
    );
  }
  const codeChallenge = single(query, "code_challenge");
  if (!codeChallenge || !CHALLENGE_PATTERN.test(codeChallenge)) {
    throw new OAuthError(
      "invalid_request",
      "需要 PKCE：缺少或不正确的 code_challenge",
    );
  }
  if (single(query, "code_challenge_method") !== "S256") {
    throw new OAuthError(
      "invalid_request",
      "code_challenge_method 只支持 S256",
    );
  }
  const state = single(query, "state");
  if (state !== null && state.length > STATE_MAX) {
    throw new OAuthError("invalid_request", "state 太长");
  }
  const requested = single(query, "resource");
  if (requested !== null && !isOurResource(requested, resource)) {
    throw new OAuthError("invalid_target", "resource 不是这个 Hub 的 MCP 地址");
  }
  return { codeChallenge, state };
}

/** The redirect back to the app, with the code or the error added to its query. */
export function redirectWith(
  redirectUri: string,
  params: Record<string, string | null>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

// --- Tokens -------------------------------------------------------------------

const VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;

/** PKCE (RFC 7636): does this verifier hash to the challenge sent at the start? */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!VERIFIER_PATTERN.test(verifier)) return false;
  return (
    createHash("sha256").update(verifier).digest("base64url") === challenge
  );
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
}

/** The token endpoint's answer (RFC 6749 §5.1). */
export function tokenResponse(tokens: IssuedTokens) {
  return {
    access_token: tokens.accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: tokens.refreshToken,
    scope: HUB_MCP_SCOPE,
  };
}

export const ACCESS_TOKEN_PREFIX = "bsh_at_";
export const REFRESH_TOKEN_PREFIX = "bsh_rt_";
/** A token generated on the MCP page; works like an access token, for longer. */
export const MCP_TOKEN_PREFIX = "bsh_pat_";

/** Cheap shape check so junk never reaches a query. */
export function isTokenShape(value: string, prefix: string): boolean {
  return (
    value.startsWith(prefix) &&
    /^[A-Za-z0-9_-]{43}$/.test(value.slice(prefix.length))
  );
}

/** The value of `Authorization: Bearer …`, or null. */
export function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return match?.[1] ?? null;
}
