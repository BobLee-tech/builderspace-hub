import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import { exchangeToken, registerClient } from "@kan/hub/mcp";
import { createHubTestDb, seedUser } from "@kan/hub/testing";

import { createHubCaller } from "../test-helpers";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** RFC 7636 appendix B. */
const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
const redirectUri = "http://127.0.0.1:5000/callback";
const resource = "https://hub.example.test/api/hub/mcp";

let db: dbClient;
let me: { id: string; email: string };
let query: Record<string, string>;

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", "https://hub.example.test");
  db = await createHubTestDb();
  me = await seedUser(db, { email: "me@example.test" });
  const client = await registerClient(
    db,
    { client_name: "Cursor", redirect_uris: [redirectUri] },
    new Date(),
  );
  query = {
    response_type: "code",
    client_id: client.client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "s",
  };
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hub.mcp", () => {
  it("runs the consent page, then lists and disconnects the app", async () => {
    const hub = createHubCaller(db, me);
    expect(await hub.mcp.check(query)).toEqual({
      ok: true,
      clientName: "Cursor",
      returnTo: "127.0.0.1:5000",
    });

    const { redirectTo } = await hub.mcp.approve(query);
    const code = new URL(redirectTo).searchParams.get("code");
    await exchangeToken(
      db,
      {
        grant_type: "authorization_code",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
        client_id: query.client_id,
      },
      resource,
      new Date(),
    );

    const overview = await hub.mcp.overview();
    expect(overview.endpoint).toBe(resource);
    expect(overview.connections).toEqual([
      expect.objectContaining({ name: "Cursor", kind: "oauth" }),
    ]);

    await hub.mcp.disconnect({
      connectionPublicId: overview.connections[0]?.publicId ?? "",
    });
    expect((await hub.mcp.overview()).connections).toEqual([]);
  });

  it("generates a token once, lists it, and revokes it", async () => {
    const hub = createHubCaller(db, me);
    const created = await hub.mcp.createToken({ name: "Codex", days: 30 });
    expect(created.token).toMatch(/^bsh_pat_/);

    const [listed] = (await hub.mcp.overview()).connections;
    expect(listed).toMatchObject({ name: "Codex", kind: "token" });
    expect(JSON.stringify(listed)).not.toContain(created.token);

    await hub.mcp.disconnect({ connectionPublicId: created.publicId });
    expect((await hub.mcp.overview()).connections).toEqual([]);

    await expect(
      hub.mcp.createToken({ name: "x", days: 3 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("sends a refusal back to the app", async () => {
    const { redirectTo } = await createHubCaller(db, me).mcp.deny(query);
    expect(new URL(redirectTo).searchParams.get("error")).toBe("access_denied");
  });

  it("turns a bad request into a message for the page", async () => {
    await expect(
      createHubCaller(db, me).mcp.approve({
        ...query,
        client_id: "mcp_nobody",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("is for signed-in browsers only", async () => {
    await expect(
      createHubCaller(db, null).mcp.overview(),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      createHubCaller(db, me, { authorization: "Bearer bsh_at_x" }).mcp.approve(
        query,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("says what is missing when the Hub's address is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_URL", "");
    vi.stubEnv("BETTER_AUTH_URL", "");
    const hub = createHubCaller(db, me);
    expect((await hub.mcp.overview()).endpoint).toBeNull();
    await expect(hub.mcp.check(query)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});
