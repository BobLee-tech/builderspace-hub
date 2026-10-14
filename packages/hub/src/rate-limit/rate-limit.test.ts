import { beforeEach, describe, expect, it } from "vitest";

import type { Db } from "../db";
import { hubRateLimits } from "../schema";
import { createHubTestDb } from "../testing/test-db";
import {
  consumeRateLimit,
  pruneRateLimits,
  rateLimitStorage,
} from "./rate-limit";

let db: Db;
const rule = { window: 60, max: 3 };
const t0 = 1_800_000_000_000;

beforeEach(async () => {
  db = await createHubTestDb();
});

describe("consumeRateLimit", () => {
  it("allows up to max requests in a window, then refuses with a wait", async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await consumeRateLimit(db, "hub:a", rule, t0 + i * 1000));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results[3]?.retryAfterSeconds).toBe(57);
  });

  it("starts a new window once the old one has passed", async () => {
    for (let i = 0; i < 4; i += 1)
      await consumeRateLimit(db, "hub:a", rule, t0);

    const later = await consumeRateLimit(db, "hub:a", rule, t0 + 60_000);
    expect(later.allowed).toBe(true);
  });

  it("counts every key on its own", async () => {
    for (let i = 0; i < 4; i += 1)
      await consumeRateLimit(db, "hub:a", rule, t0);

    expect((await consumeRateLimit(db, "hub:b", rule, t0)).allowed).toBe(true);
  });

  it("is not fooled by concurrent requests", async () => {
    const all = await Promise.all(
      Array.from({ length: 10 }, () => consumeRateLimit(db, "hub:c", rule, t0)),
    );
    expect(all.filter((r) => r.allowed)).toHaveLength(3);
  });
});

describe("rateLimitStorage (Better Auth)", () => {
  it("stores and reads back a record, overwriting on update", async () => {
    const storage = rateLimitStorage(db, { random: () => 1 });

    expect(await storage.get("1.2.3.4/sign-in/email")).toBeUndefined();
    await storage.set("1.2.3.4/sign-in/email", {
      key: "1.2.3.4/sign-in/email",
      count: 1,
      lastRequest: t0,
    });
    await storage.set("1.2.3.4/sign-in/email", {
      key: "1.2.3.4/sign-in/email",
      count: 2,
      lastRequest: t0 + 500,
    });

    expect(await storage.get("1.2.3.4/sign-in/email")).toEqual({
      key: "1.2.3.4/sign-in/email",
      count: 2,
      lastRequest: t0 + 500,
    });
  });

  it("reports failures to onError without throwing", async () => {
    const errors: unknown[] = [];
    const broken = {
      select: () => {
        throw new Error("connection lost");
      },
      insert: () => {
        throw new Error("connection lost");
      },
    } as unknown as Db;
    const storage = rateLimitStorage(broken, {
      onError: (error) => errors.push(error),
    });

    expect(await storage.get("k")).toBeUndefined();
    await storage.set("k", { key: "k", count: 1, lastRequest: t0 });
    expect(errors).toHaveLength(2);
  });

  it("prunes day-old counters now and then", async () => {
    await db
      .insert(hubRateLimits)
      .values({ key: "old", count: 1, lastRequest: t0 - 2 * 86_400_000 });
    const storage = rateLimitStorage(db, { random: () => 0 });

    await storage.set("new", { key: "new", count: 1, lastRequest: t0 });

    expect(await storage.get("old")).toBeUndefined();
    expect(await storage.get("new")).toBeDefined();
  });
});

describe("pruneRateLimits", () => {
  it("removes only counters idle for over a day", async () => {
    await db.insert(hubRateLimits).values([
      { key: "stale", count: 5, lastRequest: t0 - 86_400_001 },
      { key: "fresh", count: 5, lastRequest: t0 - 1000 },
    ]);

    expect(await pruneRateLimits(db, t0)).toBe(1);
  });
});
