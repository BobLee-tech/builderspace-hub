import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { hubAuditLog, hubMcpConnections, hubOauthCodes } from "../schema";
import { HubError } from "../shared/errors";
import { createHubTestDb, seedHubAccount, seedUser } from "../testing/test-db";
import { mcpUrls } from "./catalog";
import { OAuthError } from "./oauth.policy";
import {
  approveAuthorization,
  authenticateMcpRequest,
  checkAuthorizeRequest,
  denyAuthorization,
  describeRedirect,
  disconnectMcp,
  exchangeToken,
  hubMcpUrls,
  listMcpConnections,
  registerClient,
  revokeToken,
} from "./oauth.service";

const { resource } = mcpUrls("https://hub.example.test");
const now = new Date("2026-10-25T02:00:00Z");
const later = (ms: number) => new Date(now.getTime() + ms);
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** RFC 7636 appendix B. */
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const redirectUri = "http://127.0.0.1:5000/callback";

let db: Db;
let me: { id: string; email: string };
let clientId: string;

async function oauthErrorOf(work: Promise<unknown>): Promise<OAuthError> {
  const error = await work.then(
    () => null,
    (cause: unknown) => cause,
  );
  if (error instanceof OAuthError) return error;
  throw new Error(`expected an OAuthError, got ${String(error)}`);
}

const authorizeQuery = (
  overrides: Record<string, string | undefined> = {},
) => ({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "state-1",
  resource,
  ...overrides,
});

/** Approves as `me` and returns the code the app receives. */
async function approve(query = authorizeQuery(), at = now): Promise<string> {
  const { redirectTo } = await approveAuthorization(
    db,
    { userId: me.id },
    query,
    resource,
    at,
  );
  const code = new URL(redirectTo).searchParams.get("code");
  if (!code) throw new Error("no code in the redirect");
  return code;
}

async function connect(at = now) {
  const code = await approve(authorizeQuery(), at);
  return exchangeToken(
    db,
    {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
      resource,
    },
    resource,
    at,
  );
}

beforeEach(async () => {
  db = await createHubTestDb();
  me = await seedUser(db, { email: "me@example.test", name: "Me" });
  const registered = await registerClient(
    db,
    {
      client_name: "Claude Code",
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
    },
    now,
  );
  clientId = registered.client_id;
});

describe("registerClient", () => {
  it("registers a public client under a new random id", async () => {
    const other = await registerClient(
      db,
      { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] },
      now,
    );
    expect(clientId).toMatch(/^mcp_[A-Za-z0-9_-]{24}$/);
    expect(other.client_id).not.toBe(clientId);
    expect(other).toMatchObject({
      client_name: "未命名的 AI 应用",
      token_endpoint_auth_method: "none",
    });
  });

  it("refuses a registration it cannot honour", async () => {
    const error = await oauthErrorOf(
      registerClient(db, { redirect_uris: ["http://evil.example/cb"] }, now),
    );
    expect(error.error).toBe("invalid_redirect_uri");
  });
});

describe("the consent page", () => {
  it("shows the app's name and where the person goes back to", async () => {
    expect(await checkAuthorizeRequest(db, authorizeQuery(), resource)).toEqual(
      {
        ok: true,
        clientName: "Claude Code",
        returnTo: "127.0.0.1:5000",
      },
    );
  });

  it("never sends anyone to an unknown app or an unregistered address", async () => {
    expect(
      await checkAuthorizeRequest(
        db,
        authorizeQuery({ client_id: "mcp_nobody" }),
        resource,
      ),
    ).toMatchObject({
      ok: false,
      message: "不认识这个 AI 应用，请回到应用里重新连接",
      redirectTo: null,
    });
    expect(
      await checkAuthorizeRequest(
        db,
        authorizeQuery({ redirect_uri: "https://evil.example/cb" }),
        resource,
      ),
    ).toMatchObject({
      ok: false,
      message: "回跳地址和这个应用登记的不一致，为了安全没有继续",
      redirectTo: null,
    });
  });

  it("sends a malformed request back to a genuine app with the error", async () => {
    const check = await checkAuthorizeRequest(
      db,
      authorizeQuery({ code_challenge_method: "plain" }),
      resource,
    );
    expect(check.ok).toBe(false);
    if (check.ok || !check.redirectTo) throw new Error("expected a redirect");
    const back = new URL(check.redirectTo);
    expect(back.origin + back.pathname).toBe(redirectUri);
    expect(back.searchParams.get("error")).toBe("invalid_request");
    expect(back.searchParams.get("state")).toBe("state-1");
  });

  it("describes app schemes and web addresses by their host", () => {
    expect(describeRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(
      "claude.ai",
    );
    expect(describeRedirect("cursor://anysphere.cursor-retrieval/cb")).toBe(
      "cursor://anysphere.cursor-retrieval",
    );
  });

  it("approves with a one-time code and the app's state", async () => {
    const { redirectTo } = await approveAuthorization(
      db,
      { userId: me.id },
      authorizeQuery({ redirect_uri: "http://127.0.0.1:61000/callback" }),
      resource,
      now,
    );
    const back = new URL(redirectTo);
    expect(back.host).toBe("127.0.0.1:61000");
    expect(back.searchParams.get("code")).toMatch(/^bsh_code_/);
    expect(back.searchParams.get("state")).toBe("state-1");

    // Only the hash is kept.
    const [row] = await db.select().from(hubOauthCodes);
    expect(row?.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.codeHash).not.toBe(back.searchParams.get("code"));
  });

  it("checks everything again when the person approves", async () => {
    await expect(
      approveAuthorization(
        db,
        { userId: me.id },
        authorizeQuery({ redirect_uri: "https://evil.example/cb" }),
        resource,
        now,
      ),
    ).rejects.toBeInstanceOf(HubError);
    await expect(
      approveAuthorization(
        db,
        { userId: me.id },
        authorizeQuery({ code_challenge: undefined }),
        resource,
        now,
      ),
    ).rejects.toBeInstanceOf(HubError);
    expect(await db.select().from(hubOauthCodes)).toHaveLength(0);
  });

  it("clears out codes nobody used", async () => {
    await approve(authorizeQuery(), now);
    await approve(authorizeQuery(), later(HOUR));
    expect(await db.select().from(hubOauthCodes)).toHaveLength(1);
  });

  it("sends a refusal back as access_denied", async () => {
    const { redirectTo } = await denyAuthorization(db, authorizeQuery());
    const back = new URL(redirectTo);
    expect(back.searchParams.get("error")).toBe("access_denied");
    expect(back.searchParams.get("state")).toBe("state-1");
    await expect(
      denyAuthorization(db, authorizeQuery({ client_id: "mcp_nobody" })),
    ).rejects.toBeInstanceOf(HubError);
  });
});

describe("trading a code for tokens", () => {
  it("connects the app and writes it in the log", async () => {
    const tokens = await connect();
    expect(tokens).toMatchObject({
      token_type: "Bearer",
      expires_in: 3600,
      scope: "hub",
    });
    expect(tokens.access_token).toMatch(/^bsh_at_/);
    expect(tokens.refresh_token).toMatch(/^bsh_rt_/);

    const [connection] = await db.select().from(hubMcpConnections);
    expect(connection?.accessTokenHash).not.toContain(tokens.access_token);
    expect(await listMcpConnections(db, me.id)).toEqual([
      {
        publicId: connection?.publicId,
        clientName: "Claude Code",
        createdAt: now,
        lastUsedAt: now,
      },
    ]);

    const [entry] = await db.select().from(hubAuditLog);
    expect(entry).toMatchObject({
      action: "mcp.connected",
      actorEmail: me.email,
      entityId: connection?.publicId,
    });
  });

  it("takes a code once", async () => {
    const code = await approve();
    const form = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    };
    await exchangeToken(db, form, resource, now);
    const again = await oauthErrorOf(exchangeToken(db, form, resource, now));
    expect(again.error).toBe("invalid_grant");
  });

  it.each([
    ["the wrong verifier", { code_verifier: `${verifier.slice(0, -1)}A` }],
    [
      "another redirect address",
      { redirect_uri: "http://127.0.0.1:5001/callback" },
    ],
  ])("refuses %s, and the code is gone", async (_label, change) => {
    const code = await approve();
    const form = {
      grant_type: "authorization_code",
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      client_id: clientId,
    };
    const error = await oauthErrorOf(
      exchangeToken(db, { ...form, ...change }, resource, now),
    );
    expect(error.error).toBe("invalid_grant");
    const retry = await oauthErrorOf(exchangeToken(db, form, resource, now));
    expect(retry.error).toBe("invalid_grant");
    expect(await db.select().from(hubMcpConnections)).toHaveLength(0);
  });

  it("refuses a code issued to another app", async () => {
    const code = await approve();
    const other = await registerClient(
      db,
      { redirect_uris: [redirectUri] },
      now,
    );
    const error = await oauthErrorOf(
      exchangeToken(
        db,
        {
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: other.client_id,
        },
        resource,
        now,
      ),
    );
    expect(error.error).toBe("invalid_grant");
  });

  it("refuses a code after five minutes", async () => {
    const code = await approve();
    const error = await oauthErrorOf(
      exchangeToken(
        db,
        {
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: clientId,
        },
        resource,
        later(5 * MINUTE),
      ),
    );
    expect(error.error).toBe("invalid_grant");
  });

  it("refuses a suspended account", async () => {
    const code = await approve();
    await seedHubAccount(db, me.id, { status: "suspended" });
    const error = await oauthErrorOf(
      exchangeToken(
        db,
        {
          grant_type: "authorization_code",
          code,
          code_verifier: verifier,
          redirect_uri: redirectUri,
          client_id: clientId,
        },
        resource,
        now,
      ),
    );
    expect(error.message).toContain("停用");
  });

  it.each([
    ["no grant type", {}, "unsupported_grant_type"],
    ["another grant", { grant_type: "password" }, "unsupported_grant_type"],
    [
      "another resource",
      { grant_type: "authorization_code", resource: "https://x.example" },
      "invalid_target",
    ],
    ["missing fields", { grant_type: "authorization_code" }, "invalid_request"],
    [
      "an unknown app",
      {
        grant_type: "authorization_code",
        code: "bsh_code_x",
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: "mcp_nobody",
      },
      "invalid_client",
    ],
    [
      "a code of another shape",
      {
        grant_type: "authorization_code",
        code: "abc",
        code_verifier: verifier,
        redirect_uri: redirectUri,
      },
      "invalid_grant",
    ],
  ])("refuses %s", async (_label, form, code) => {
    const withClient =
      "client_id" in form ? form : { ...form, client_id: clientId };
    const error = await oauthErrorOf(
      exchangeToken(db, withClient, resource, now),
    );
    expect(error.error).toBe(code);
  });
});

describe("refreshing", () => {
  const refreshForm = (token: string) => ({
    grant_type: "refresh_token",
    refresh_token: token,
    client_id: clientId,
  });

  it("swaps both tokens; the old ones stop working", async () => {
    const first = await connect();
    const second = await exchangeToken(
      db,
      refreshForm(first.refresh_token),
      resource,
      later(2 * HOUR),
    );
    expect(second.access_token).not.toBe(first.access_token);

    expect(
      await authenticateMcpRequest(
        db,
        `Bearer ${first.access_token}`,
        later(2 * HOUR),
      ),
    ).toBeNull();
    expect(
      await authenticateMcpRequest(
        db,
        `Bearer ${second.access_token}`,
        later(2 * HOUR),
      ),
    ).toMatchObject({ user: { id: me.id }, clientName: "Claude Code" });

    const reused = await oauthErrorOf(
      exchangeToken(
        db,
        refreshForm(first.refresh_token),
        resource,
        later(2 * HOUR),
      ),
    );
    expect(reused.error).toBe("invalid_grant");
  });

  it("refuses a refresh token after thirty days without use", async () => {
    const first = await connect();
    const error = await oauthErrorOf(
      exchangeToken(
        db,
        refreshForm(first.refresh_token),
        resource,
        later(31 * DAY),
      ),
    );
    expect(error.error).toBe("invalid_grant");
  });

  it("refuses another app's refresh token and junk", async () => {
    const first = await connect();
    const other = await registerClient(
      db,
      { redirect_uris: [redirectUri] },
      now,
    );
    const stolen = await oauthErrorOf(
      exchangeToken(
        db,
        { ...refreshForm(first.refresh_token), client_id: other.client_id },
        resource,
        now,
      ),
    );
    expect(stolen.error).toBe("invalid_grant");
    const junk = await oauthErrorOf(
      exchangeToken(db, refreshForm("nonsense"), resource, now),
    );
    expect(junk.error).toBe("invalid_grant");
    const missing = await oauthErrorOf(
      exchangeToken(
        db,
        { grant_type: "refresh_token", client_id: clientId },
        resource,
        now,
      ),
    );
    expect(missing.error).toBe("invalid_request");
  });

  it("refuses a suspended account", async () => {
    const first = await connect();
    await seedHubAccount(db, me.id, { status: "suspended" });
    const error = await oauthErrorOf(
      exchangeToken(db, refreshForm(first.refresh_token), resource, now),
    );
    expect(error.error).toBe("invalid_grant");
  });
});

describe("authenticateMcpRequest", () => {
  it("knows the caller for an hour", async () => {
    const tokens = await connect();
    const header = `Bearer ${tokens.access_token}`;
    const caller = await authenticateMcpRequest(db, header, later(59 * MINUTE));
    expect(caller).toMatchObject({
      user: { id: me.id, email: me.email, name: "Me" },
      role: null,
      siteAccess: null,
      clientName: "Claude Code",
    });
    expect(caller?.connectionPublicId).toMatch(/^[A-Za-z0-9]{12}$/);
    expect(await authenticateMcpRequest(db, header, later(HOUR))).toBeNull();
  });

  it("carries the person's back-office role and turns away a suspended account", async () => {
    const tokens = await connect();
    const header = `Bearer ${tokens.access_token}`;
    await seedHubAccount(db, me.id, { role: "admin", siteAccess: "people" });
    expect(await authenticateMcpRequest(db, header, now)).toMatchObject({
      role: "admin",
      siteAccess: "people",
    });
    await seedHubAccount(db, me.id, { status: "suspended" });
    expect(await authenticateMcpRequest(db, header, now)).toBeNull();
  });

  it("ignores missing, malformed and unknown tokens", async () => {
    await connect();
    expect(await authenticateMcpRequest(db, undefined, now)).toBeNull();
    expect(await authenticateMcpRequest(db, "Bearer junk", now)).toBeNull();
    expect(
      await authenticateMcpRequest(db, `Bearer bsh_at_${"a".repeat(43)}`, now),
    ).toBeNull();
  });

  it("writes down when it was last used, at most every few minutes", async () => {
    const tokens = await connect();
    const header = `Bearer ${tokens.access_token}`;
    await authenticateMcpRequest(db, header, later(MINUTE));
    const [unchanged] = await listMcpConnections(db, me.id);
    expect(unchanged?.lastUsedAt).toEqual(now);

    await authenticateMcpRequest(db, header, later(10 * MINUTE));
    const [touched] = await listMcpConnections(db, me.id);
    expect(touched?.lastUsedAt).toEqual(later(10 * MINUTE));
  });
});

describe("ending a connection", () => {
  it("disconnects from the MCP page, with a log entry", async () => {
    const tokens = await connect();
    const [connection] = await listMcpConnections(db, me.id);
    if (!connection) throw new Error("no connection");

    await disconnectMcp(
      db,
      { userId: me.id, email: me.email },
      connection.publicId,
    );
    expect(await listMcpConnections(db, me.id)).toEqual([]);
    expect(
      await authenticateMcpRequest(db, `Bearer ${tokens.access_token}`, now),
    ).toBeNull();
    const actions = await db
      .select({ action: hubAuditLog.action })
      .from(hubAuditLog)
      .where(eq(hubAuditLog.entityId, connection.publicId));
    expect(actions.map((row) => row.action)).toEqual([
      "mcp.connected",
      "mcp.disconnected",
    ]);
  });

  it("cannot disconnect someone else's app", async () => {
    await connect();
    const [connection] = await listMcpConnections(db, me.id);
    const stranger = await seedUser(db);
    await expect(
      disconnectMcp(
        db,
        { userId: stranger.id, email: stranger.email },
        connection?.publicId ?? "",
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await listMcpConnections(db, me.id)).toHaveLength(1);
  });

  it("lets the app sign out with either of its tokens", async () => {
    const tokens = await connect();
    await revokeToken(db, { token: tokens.refresh_token, client_id: clientId });
    expect(await listMcpConnections(db, me.id)).toEqual([]);
    const [entry] = await db
      .select()
      .from(hubAuditLog)
      .where(eq(hubAuditLog.action, "mcp.disconnected"));
    expect(entry?.actorEmail).toBe(me.email);
  });

  it("answers revocation the same for tokens it does not know", async () => {
    const tokens = await connect();
    const other = await registerClient(
      db,
      { redirect_uris: [redirectUri] },
      now,
    );
    await revokeToken(db, {
      token: tokens.access_token,
      client_id: other.client_id,
    });
    await revokeToken(db, { token: "junk", client_id: clientId });
    await revokeToken(db, {
      token: `bsh_at_${"b".repeat(43)}`,
      client_id: clientId,
    });
    expect(await listMcpConnections(db, me.id)).toHaveLength(1);

    const missing = await oauthErrorOf(
      revokeToken(db, { client_id: clientId }),
    );
    expect(missing.error).toBe("invalid_request");
    const unknown = await oauthErrorOf(
      revokeToken(db, { token: tokens.access_token, client_id: "mcp_nobody" }),
    );
    expect(unknown.error).toBe("invalid_client");
  });
});

describe("hubMcpUrls", () => {
  it("reads the Hub's address the way the mail links do", () => {
    expect(
      hubMcpUrls({ NEXT_PUBLIC_BASE_URL: "https://hub.example.test/" })
        ?.resource,
    ).toBe(resource);
    expect(
      hubMcpUrls({ BETTER_AUTH_URL: "https://hub.example.test" })?.issuer,
    ).toBe("https://hub.example.test");
    expect(hubMcpUrls({})).toBeNull();
    expect(hubMcpUrls({ NEXT_PUBLIC_BASE_URL: "not a url" })).toBeNull();
  });
});
