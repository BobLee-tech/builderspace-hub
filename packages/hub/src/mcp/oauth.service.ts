import { randomBytes } from "node:crypto";
import { z } from "zod";

import { generateUID } from "@kan/shared/utils";

import type { AccountFacts } from "../accounts/account.repo";
import type { Db } from "../db";
import type { McpUrls } from "./catalog";
import type { ClientRow, TokenHashes } from "./oauth.repo";
import { getAccessFacts } from "../accounts/account.service";
import { recordAudit, withAudit } from "../audit/audit";
import { findSessionUser, findUsersByIds } from "../kan/users.gateway";
import { HubError } from "../shared/errors";
import { generateGrantToken, hashGrantToken } from "../shared/token";
import {
  MAX_MCP_TOKENS,
  MCP_TOKEN_DAYS,
  MCP_TOKEN_NAME_MAX,
  mcpUrls,
} from "./catalog";
import {
  ACCESS_TOKEN_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS,
  bearerToken,
  clientOfRequest,
  CODE_TTL_SECONDS,
  isOurResource,
  isTokenShape,
  matchesRegisteredRedirect,
  MCP_TOKEN_PREFIX,
  OAuthError,
  parseClientRegistration,
  readAuthorizeParams,
  redirectWith,
  REFRESH_TOKEN_PREFIX,
  REFRESH_TOKEN_TTL_SECONDS,
  registrationResponse,
  tokenResponse,
  verifyPkce,
} from "./oauth.policy";
import {
  countLiveTokens,
  deleteClientConnections,
  deleteConnection,
  deleteDeadConnections,
  deleteExpiredCodes,
  findClient,
  findConnectionByToken,
  findLiveConnection,
  findUserConnection,
  insertClient,
  insertCode,
  insertConnection,
  listLiveConnections,
  rotateConnection,
  takeCode,
  touchConnection,
} from "./oauth.repo";

/**
 * MCP sign-in, as use cases: an AI app registers, a signed-in person approves
 * it on the consent page, the app trades the code for tokens and calls the
 * MCP endpoint with them. The rules are in `oauth.policy.ts`; this file does
 * the storage and the order of checks.
 *
 * The OAuth endpoints fail with `OAuthError` (their wire format); the pages'
 * use cases (listing and disconnecting) fail with `HubError` like every other.
 */

type Query = Record<string, string | string[] | undefined>;

/** Where this Hub is reachable, from the same variables the mail links use; null if unset. */
export function hubMcpUrls(
  env: Record<string, string | undefined> = process.env,
): McpUrls | null {
  const baseUrl = env.NEXT_PUBLIC_BASE_URL ?? env.BETTER_AUTH_URL;
  if (!baseUrl) return null;
  try {
    return mcpUrls(baseUrl);
  } catch {
    return null;
  }
}

/** How often a token's use is written down; every call would be a write per request. */
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const CODE_PREFIX = "bsh_code_";

const seconds = (now: Date, count: number) =>
  new Date(now.getTime() + count * 1000);

function newTokens(now: Date) {
  const accessToken = `${ACCESS_TOKEN_PREFIX}${generateGrantToken()}`;
  const refreshToken = `${REFRESH_TOKEN_PREFIX}${generateGrantToken()}`;
  const hashes: TokenHashes = {
    accessTokenHash: hashGrantToken(accessToken),
    accessExpiresAt: seconds(now, ACCESS_TOKEN_TTL_SECONDS),
    refreshTokenHash: hashGrantToken(refreshToken),
    refreshExpiresAt: seconds(now, REFRESH_TOKEN_TTL_SECONDS),
  };
  return { tokens: { accessToken, refreshToken }, hashes };
}

/** A form field as one string; the token endpoint takes form or JSON bodies. */
function field(form: unknown, name: string): string | null {
  if (typeof form !== "object" || form === null) return null;
  const value = (form as Record<string, unknown>)[name];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// --- Registration -------------------------------------------------------------

export async function registerClient(db: Db, body: unknown, now: Date) {
  const registration = parseClientRegistration(body);
  const clientId = `mcp_${randomBytes(18).toString("base64url")}`;
  await insertClient(db, { clientId, ...registration });
  return registrationResponse(clientId, registration, now);
}

// --- Consent ------------------------------------------------------------------

/**
 * The app and the address it wants to be sent back to, both checked against
 * its registration. Until this passes nothing may be sent to that address:
 * a failure is shown on the page instead (RFC 6749 §4.1.2.1).
 */
async function genuineClient(
  db: Db,
  query: Query,
): Promise<{ client: ClientRow; redirectUri: string }> {
  const { clientId, redirectUri } = clientOfRequest(query);
  const client = await findClient(db, clientId);
  if (!client) {
    throw new OAuthError(
      "invalid_client",
      "不认识这个 AI 应用，请回到应用里重新连接",
    );
  }
  if (!matchesRegisteredRedirect(redirectUri, client.redirectUris)) {
    throw new OAuthError(
      "invalid_request",
      "回跳地址和这个应用登记的不一致，为了安全没有继续",
    );
  }
  return { client, redirectUri };
}

export type AuthorizeCheck =
  | {
      ok: true;
      clientName: string;
      /** Where the person is sent once they decide, as shown to them. */
      returnTo: string;
    }
  | {
      ok: false;
      message: string;
      /** Where to send the person with the error, when that is safe. */
      redirectTo: string | null;
    };

/** What the consent page shows before anyone clicks. */
export async function checkAuthorizeRequest(
  db: Db,
  query: Query,
  resource: string,
): Promise<AuthorizeCheck> {
  let genuine;
  try {
    genuine = await genuineClient(db, query);
  } catch (error) {
    if (error instanceof OAuthError) {
      return { ok: false, message: error.message, redirectTo: null };
    }
    throw error;
  }
  try {
    readAuthorizeParams(query, resource);
  } catch (error) {
    if (error instanceof OAuthError) {
      return {
        ok: false,
        message: error.message,
        redirectTo: redirectWith(genuine.redirectUri, {
          error: error.error,
          error_description: error.message,
          state: typeof query.state === "string" ? query.state : null,
        }),
      };
    }
    throw error;
  }
  return {
    ok: true,
    clientName: genuine.client.name,
    returnTo: describeRedirect(genuine.redirectUri),
  };
}

/** `localhost:8123`, `cursor://anysphere.cursor-retrieval`, `claude.ai`: enough to recognise. */
export function describeRedirect(redirectUri: string): string {
  const url = new URL(redirectUri);
  if (url.protocol === "http:" || url.protocol === "https:") return url.host;
  return `${url.protocol}//${url.host}`;
}

/**
 * 允许: issues a one-time code for this person and sends them back to the app.
 * Everything is checked again; the page's earlier check proves nothing.
 */
export async function approveAuthorization(
  db: Db,
  person: { userId: string },
  query: Query,
  resource: string,
  now: Date,
): Promise<{ redirectTo: string }> {
  const { client, redirectUri } = await genuineClient(db, query).catch(
    (error: unknown) => {
      throw asHubError(error);
    },
  );
  let params;
  try {
    params = readAuthorizeParams(query, resource);
  } catch (error) {
    throw asHubError(error);
  }

  const code = `${CODE_PREFIX}${generateGrantToken()}`;
  await deleteExpiredCodes(db, now);
  await insertCode(db, {
    codeHash: hashGrantToken(code),
    clientId: client.id,
    userId: person.userId,
    redirectUri,
    codeChallenge: params.codeChallenge,
    expiresAt: seconds(now, CODE_TTL_SECONDS),
    createdAt: now,
  });
  return {
    redirectTo: redirectWith(redirectUri, { code, state: params.state }),
  };
}

/** 拒绝: sends the person back to the app with `access_denied`. */
export async function denyAuthorization(
  db: Db,
  query: Query,
): Promise<{ redirectTo: string }> {
  const { redirectUri } = await genuineClient(db, query).catch(
    (error: unknown) => {
      throw asHubError(error);
    },
  );
  return {
    redirectTo: redirectWith(redirectUri, {
      error: "access_denied",
      error_description: "用户拒绝了授权",
      state: typeof query.state === "string" ? query.state : null,
    }),
  };
}

function asHubError(error: unknown): unknown {
  return error instanceof OAuthError
    ? new HubError("INVALID_INPUT", error.message)
    : error;
}

// --- Tokens -------------------------------------------------------------------

/** The token endpoint (RFC 6749 §3.2): a code or a refresh token in, tokens out. */
export async function exchangeToken(
  db: Db,
  form: unknown,
  resource: string,
  now: Date,
) {
  const requested = field(form, "resource");
  if (requested !== null && !isOurResource(requested, resource)) {
    throw new OAuthError("invalid_target", "resource 不是这个 Hub 的 MCP 地址");
  }
  const grantType = field(form, "grant_type");
  if (grantType === "authorization_code") return redeemCode(db, form, now);
  if (grantType === "refresh_token") return refresh(db, form, now);
  throw new OAuthError(
    "unsupported_grant_type",
    "只支持 authorization_code 和 refresh_token",
  );
}

async function clientOfForm(db: Db, form: unknown): Promise<ClientRow> {
  const clientId = field(form, "client_id");
  const client = clientId ? await findClient(db, clientId) : null;
  if (!client) {
    throw new OAuthError("invalid_client", "不认识这个 client_id", 401);
  }
  return client;
}

async function refuseSuspended(db: Db, userId: string): Promise<void> {
  const facts = await getAccessFacts(db, userId);
  if (facts.status === "suspended") {
    throw new OAuthError("invalid_grant", "这个账号已被停用");
  }
}

async function redeemCode(db: Db, form: unknown, now: Date) {
  const code = field(form, "code");
  const verifier = field(form, "code_verifier");
  const redirectUri = field(form, "redirect_uri");
  if (!code || !verifier || !redirectUri) {
    throw new OAuthError(
      "invalid_request",
      "需要 code、code_verifier 和 redirect_uri",
    );
  }
  const client = await clientOfForm(db, form);

  // Taken (deleted) before it is checked: a code that fails a check is gone too.
  const stored = code.startsWith(CODE_PREFIX)
    ? await takeCode(db, hashGrantToken(code))
    : null;
  if (
    !stored ||
    stored.expiresAt <= now ||
    stored.clientId !== client.id ||
    stored.redirectUri !== redirectUri ||
    !verifyPkce(verifier, stored.codeChallenge)
  ) {
    throw new OAuthError("invalid_grant", "授权码无效、已过期或已用过");
  }
  await refuseSuspended(db, stored.userId);

  const [user] = await findUsersByIds(db, [stored.userId]);
  if (!user) throw new OAuthError("invalid_grant", "账号不存在");

  const { tokens, hashes } = newTokens(now);
  const publicId = generateUID();
  await withAudit(
    db,
    async (tx) => {
      await deleteClientConnections(tx, stored.userId, client.id);
      await deleteDeadConnections(tx, stored.userId, now);
      await insertConnection(tx, {
        ...hashes,
        publicId,
        clientId: client.id,
        userId: stored.userId,
        now,
      });
    },
    () => ({
      actor: { userId: user.id, email: user.email },
      action: "mcp.connected",
      entityType: "mcp_connection",
      entityId: publicId,
      summary: `用 MCP 连接了「${client.name}」`,
    }),
  );
  return tokenResponse(tokens);
}

async function refresh(db: Db, form: unknown, now: Date) {
  const refreshToken = field(form, "refresh_token");
  if (!refreshToken) {
    throw new OAuthError("invalid_request", "需要 refresh_token");
  }
  const client = await clientOfForm(db, form);
  if (!isTokenShape(refreshToken, REFRESH_TOKEN_PREFIX)) {
    throw new OAuthError("invalid_grant", "刷新令牌无效或已过期，请重新登录");
  }

  const { tokens, hashes } = newTokens(now);
  const rotated = await rotateConnection(db, {
    refreshTokenHash: hashGrantToken(refreshToken),
    clientId: client.id,
    now,
    next: hashes,
  });
  if (!rotated) {
    throw new OAuthError("invalid_grant", "刷新令牌无效或已过期，请重新登录");
  }
  await refuseSuspended(db, rotated.userId);
  return tokenResponse(tokens);
}

/**
 * Token revocation (RFC 7009): an app signing out ends its connection. Answers
 * the same whether or not the token was live, as the RFC asks.
 */
export async function revokeToken(db: Db, form: unknown): Promise<void> {
  const token = field(form, "token");
  if (!token) throw new OAuthError("invalid_request", "需要 token");
  const client = await clientOfForm(db, form);
  if (
    !isTokenShape(token, ACCESS_TOKEN_PREFIX) &&
    !isTokenShape(token, REFRESH_TOKEN_PREFIX)
  ) {
    return;
  }
  const connection = await findConnectionByToken(
    db,
    hashGrantToken(token),
    client.id,
  );
  if (!connection) return;
  const [user] = await findUsersByIds(db, [connection.userId]);
  await db.transaction(async (tx) => {
    await deleteConnection(tx, connection.id);
    await recordAudit(tx, {
      actor: { userId: connection.userId, email: user?.email ?? "" },
      action: "mcp.disconnected",
      entityType: "mcp_connection",
      entityId: connection.publicId,
      summary: `「${client.name}」退出了 MCP 连接`,
    });
  });
}

// --- Calls to the MCP endpoint ------------------------------------------------

export interface McpCaller {
  /** As Kan's request context carries a user. */
  user: NonNullable<Awaited<ReturnType<typeof findSessionUser>>>;
  role: AccountFacts["role"];
  siteAccess: AccountFacts["siteAccess"];
  connectionPublicId: string;
  clientName: string;
}

/**
 * Whose call this is, from `Authorization: Bearer …`, or null: no token, an
 * expired or disconnected one, or a suspended account.
 */
export async function authenticateMcpRequest(
  db: Db,
  authorization: string | undefined,
  now: Date,
): Promise<McpCaller | null> {
  const token = bearerToken(authorization);
  if (
    !token ||
    !(
      isTokenShape(token, ACCESS_TOKEN_PREFIX) ||
      isTokenShape(token, MCP_TOKEN_PREFIX)
    )
  ) {
    return null;
  }
  const connection = await findLiveConnection(db, hashGrantToken(token), now);
  if (!connection) return null;

  const [facts, user] = await Promise.all([
    getAccessFacts(db, connection.userId),
    findSessionUser(db, connection.userId),
  ]);
  if (!user || facts.status === "suspended") return null;

  if (now.getTime() - connection.lastUsedAt.getTime() > TOUCH_EVERY_MS) {
    await touchConnection(db, connection.id, now);
  }
  return {
    user,
    role: facts.role,
    siteAccess: facts.siteAccess,
    connectionPublicId: connection.publicId,
    clientName: connection.clientName,
  };
}

// --- The MCP page -------------------------------------------------------------

export interface McpConnection {
  publicId: string;
  /** The app's name (OAuth) or the label the person gave the token. */
  name: string;
  kind: "oauth" | "token";
  createdAt: Date;
  lastUsedAt: Date;
  /** When it stops working unless used: the refresh token's end, or the token's. */
  expiresAt: Date;
}

/** The AI apps and tokens that can act as me right now. */
export async function listMcpConnections(
  db: Db,
  userId: string,
  now: Date,
): Promise<McpConnection[]> {
  const rows = await listLiveConnections(db, userId, now);
  return rows.map((row) => ({
    publicId: row.publicId,
    name: row.name,
    kind: row.clientId === null ? "token" : "oauth",
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    expiresAt: row.refreshExpiresAt ?? row.accessExpiresAt,
  }));
}

const tokenInput = z.object({
  name: z
    .string()
    .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, "").trim())
    .pipe(
      z
        .string()
        .min(1, "给令牌起个名字，比如用在哪个应用上")
        .max(MCP_TOKEN_NAME_MAX, `名字最多 ${MCP_TOKEN_NAME_MAX} 个字`),
    ),
  days: z
    .number()
    .refine(
      (value): value is (typeof MCP_TOKEN_DAYS)[number] =>
        (MCP_TOKEN_DAYS as readonly number[]).includes(value),
      `有效期只能选 ${MCP_TOKEN_DAYS.join(" / ")} 天`,
    ),
});

/**
 * 生成令牌: for an AI app that cannot sign in with OAuth. The token is shown
 * once and only its hash is kept; it can do exactly what an OAuth connection
 * can (and only at the MCP endpoint), until it expires or is revoked.
 */
export async function createMcpToken(
  db: Db,
  actor: { userId: string; email: string },
  rawInput: unknown,
  now: Date,
): Promise<{ token: string; publicId: string; expiresAt: Date }> {
  const parsed = tokenInput.safeParse(rawInput);
  if (!parsed.success) {
    throw new HubError(
      "INVALID_INPUT",
      parsed.error.issues[0]?.message ?? "输入不正确",
    );
  }
  const { name, days } = parsed.data;
  if ((await countLiveTokens(db, actor.userId, now)) >= MAX_MCP_TOKENS) {
    throw new HubError(
      "CONFLICT",
      `最多同时有 ${MAX_MCP_TOKENS} 个有效令牌，先撤销不用的`,
    );
  }

  const token = `${MCP_TOKEN_PREFIX}${generateGrantToken()}`;
  const publicId = generateUID();
  const expiresAt = seconds(now, days * 24 * 60 * 60);
  await withAudit(
    db,
    async (tx) => {
      await deleteDeadConnections(tx, actor.userId, now);
      await insertConnection(tx, {
        publicId,
        userId: actor.userId,
        name,
        accessTokenHash: hashGrantToken(token),
        accessExpiresAt: expiresAt,
        now,
      });
    },
    () => ({
      actor,
      action: "mcp.connected",
      entityType: "mcp_connection",
      entityId: publicId,
      summary: `生成了 MCP 令牌「${name}」，${days} 天有效`,
    }),
  );
  return { token, publicId, expiresAt };
}

/** 断开 / 撤销: the app's or the token's access stops at once. */
export async function disconnectMcp(
  db: Db,
  actor: { userId: string; email: string },
  publicId: string,
): Promise<void> {
  const connection = await findUserConnection(db, actor.userId, publicId);
  if (!connection) throw new HubError("NOT_FOUND", "这个连接已经不在了");
  await withAudit(
    db,
    (tx) => deleteConnection(tx, connection.id),
    () => ({
      actor,
      action: "mcp.disconnected",
      entityType: "mcp_connection",
      entityId: connection.publicId,
      summary:
        connection.clientId === null
          ? `撤销了 MCP 令牌「${connection.clientName}」`
          : `断开了「${connection.clientName}」的 MCP 连接`,
    }),
  );
}
