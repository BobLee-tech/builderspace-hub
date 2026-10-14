import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import type * as HubAccess from "@kan/hub/access";
import { users, workspaceMembers } from "@kan/db/schema";
import { issueGrant } from "@kan/hub/access";
import { hubAccessGrants } from "@kan/hub/schema";
import { createHubTestDb, seedProject, seedUser } from "@kan/hub/testing";

import type * as AuthModule from "./auth";

/**
 * Runs the real Better Auth instance Kan builds, on an in-memory Postgres, and
 * drives it over HTTP. It pins down the behaviour the gate depends on: what a
 * database hook receives and what a refusal looks like to a client.
 */

const BASE_URL = "http://localhost:3000";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

vi.mock("@kan/hub/access", async (importOriginal) => {
  const actual = await importOriginal<typeof HubAccess>();
  return { ...actual, provisionUser: vi.fn(actual.provisionUser) };
});

let initAuth: typeof AuthModule.initAuth;
let provisionUser: ReturnType<typeof vi.fn>;

beforeAll(async () => {
  vi.stubEnv("NEXT_PUBLIC_BASE_URL", BASE_URL);
  vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-test-secret-test-secret-1234");
  vi.stubEnv("NEXT_PUBLIC_ALLOW_CREDENTIALS", "true");
  vi.stubEnv("DISABLE_RATE_LIMIT", "true");
  // Kan's own switch must be off: with it on, Kan additionally demands a
  // pending workspace invitation and a registration link alone is refused.
  vi.stubEnv("NEXT_PUBLIC_DISABLE_SIGN_UP", "");

  ({ initAuth } = await import("./auth"));
  provisionUser = (await import("@kan/hub/access"))
    .provisionUser as unknown as ReturnType<typeof vi.fn>;
});

let db: dbClient;
let auth: ReturnType<typeof initAuth>;
let project: { id: number; publicId: string };
let token: string;

const INVITED = "new@example.test";

beforeEach(async () => {
  provisionUser.mockClear();
  db = await createHubTestDb();
  auth = initAuth(db);

  const admin = await seedUser(db, { email: "admin@example.test" });
  project = await seedProject(db, admin);
  ({ token } = await issueGrant(
    db,
    { userId: admin.id, email: admin.email },
    {
      email: INVITED,
      source: "direct",
      projects: [{ projectPublicId: project.publicId, role: "member" }],
    },
  ));
});

const signUp = (email: string, grantToken?: string) =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-up/email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        ...(grantToken ? { "x-hub-grant": grantToken } : {}),
      },
      body: JSON.stringify({
        name: "New Member",
        email,
        password: "correct-horse-battery",
      }),
    }),
  );

const userByEmail = async (email: string) => {
  const [user] = await db.select().from(users).where(eq(users.email, email));
  return user;
};

describe("registration gate on the real sign-up endpoint", () => {
  it("refuses sign-up without a registration link", async () => {
    const response = await signUp(INVITED);

    expect(response.status).toBe(400);
    expect(await userByEmail(INVITED)).toBeUndefined();
  });

  it("refuses a different address even with a real link", async () => {
    const response = await signUp("thief@example.test", token);

    expect(response.status).toBe(400);
    expect(await userByEmail("thief@example.test")).toBeUndefined();
  });

  it("refuses a made-up token", async () => {
    const response = await signUp(INVITED, "a".repeat(43));

    expect(response.status).toBe(400);
    expect(await userByEmail(INVITED)).toBeUndefined();
  });

  it("creates the account, signs it in and adds it to its projects", async () => {
    const response = await signUp(INVITED, token);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("kan.session_token");

    const user = await userByEmail(INVITED);
    expect(user).toBeDefined();

    const memberships = await db
      .select()
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user?.id ?? ""));
    expect(memberships).toMatchObject([
      { workspaceId: project.id, role: "member", status: "active" },
    ]);

    const [grant] = await db.select().from(hubAccessGrants);
    expect(grant?.consumedBy).toBe(user?.id);
  });

  it("accepts the invited address in any capitalisation", async () => {
    const response = await signUp("New@Example.TEST", token);

    expect(response.status).toBe(200);
    expect(await userByEmail(INVITED)).toBeDefined();
  });

  it("works only once", async () => {
    await signUp(INVITED, token);

    const again = await signUp("second@example.test", token);

    expect(again.status).toBe(400);
    expect(await userByEmail("second@example.test")).toBeUndefined();
  });

  it("refuses an expired link", async () => {
    await db
      .update(hubAccessGrants)
      .set({ expiresAt: new Date(Date.now() - 1000) });

    const response = await signUp(INVITED, token);

    expect(response.status).toBe(400);
    expect(await userByEmail(INVITED)).toBeUndefined();
  });

  it("still completes sign-up when provisioning fails, leaving the grant for a retry", async () => {
    provisionUser.mockRejectedValueOnce(new Error("database went away"));

    const response = await signUp(INVITED, token);

    expect(response.status).toBe(200);
    expect(await userByEmail(INVITED)).toBeDefined();
    const [grant] = await db.select().from(hubAccessGrants);
    expect(grant?.consumedAt).toBeNull();
  });
});
