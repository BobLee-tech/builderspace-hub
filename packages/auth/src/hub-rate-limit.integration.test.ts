import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { dbClient } from "@kan/db/client";
import * as schema from "@kan/db/schema";
import { hubRateLimits } from "@kan/hub/schema";
import { createHubTestDb } from "@kan/hub/testing";

import { HUB_AUTH_RATE_LIMITS, hubAuthPlugin } from "./hub-plugin";

// Each test boots an in-memory Postgres and applies every migration.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/**
 * The plugin's rate limiting on a real Better Auth instance. Better Auth only
 * limits in production unless told otherwise, so this instance turns it on
 * explicitly; everything else is the plugin's own contribution.
 */

const BASE_URL = "http://localhost:3000";
let db: dbClient;
let auth: ReturnType<typeof betterAuth>;

beforeEach(async () => {
  db = await createHubTestDb();
  auth = betterAuth({
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: BASE_URL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { ...schema, user: schema.users },
    }),
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: true },
    plugins: [hubAuthPlugin(db)],
  });
});

const signIn = () =>
  auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({
        email: "guess@example.test",
        password: "not-the-password",
      }),
    }),
  );

describe("sign-in rate limiting", () => {
  it("refuses the sixth attempt within a minute, counting in the database", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await signIn()).status);

    expect(statuses.slice(0, 5).every((status) => status !== 429)).toBe(true);
    expect(statuses[5]).toBe(429);

    const rows = await db.select().from(hubRateLimits);
    expect(rows.map((row) => row.key)).toContainEqual(
      expect.stringContaining("/sign-in/email"),
    );
  });
});

describe("the plugin's rules", () => {
  const ruleFor = (path: string) =>
    HUB_AUTH_RATE_LIMITS.find((rule) => rule.pathMatcher(path));

  it("covers sign-in, sign-up and password reset, and nothing else", () => {
    expect(ruleFor("/sign-in/email")).toMatchObject({ window: 60, max: 5 });
    expect(ruleFor("/sign-up/email")).toMatchObject({ window: 600, max: 5 });
    expect(ruleFor("/request-password-reset")).toMatchObject({ max: 3 });
    expect(ruleFor("/get-session")).toBeUndefined();
  });
});
