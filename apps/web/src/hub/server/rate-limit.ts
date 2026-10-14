import type { NextApiRequest, NextApiResponse } from "next";
import { env } from "next-runtime-env";

import type { RateLimitRule } from "@kan/hub/rate-limit";
import { consumeRateLimit } from "@kan/hub/rate-limit";
import { createLogger } from "@kan/logger";

import { getHubDb } from "./db";

const log = createLogger("hub-rate-limit");

/**
 * The client's IP as the hosting proxy reports it. Vercel overwrites
 * X-Forwarded-For with the real client address, so its first entry can be
 * trusted there; a self-hosted deployment must sit behind a proxy that does
 * the same (see SECURITY.md).
 */
export function clientIp(req: NextApiRequest): string {
  const forwarded = req.headers["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)
    ?.split(",")[0]
    ?.trim();
  if (first) return first;
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Wraps an API route in a per-IP limit counted in the database, so it holds
 * across every serverless instance. Over the limit: 429 with Retry-After.
 *
 * Fails open: if the counter cannot be read (say, a migration has not run
 * yet), the request goes through. Only use it where that is safe, that is
 * where the route is not the only thing standing between a guesser and an
 * account.
 *
 * DISABLE_RATE_LIMIT=true turns it off, like every other limit in the app.
 */
export function withHubRateLimit<T>(
  name: string,
  rule: RateLimitRule,
  handler: (req: NextApiRequest, res: NextApiResponse<T>) => Promise<void>,
) {
  return async (req: NextApiRequest, res: NextApiResponse<T>) => {
    if (env("DISABLE_RATE_LIMIT") === "true") return handler(req, res);
    const decision = await consumeRateLimit(
      getHubDb(),
      `hub:${name}:${clientIp(req)}`,
      rule,
    ).catch((error: unknown) => {
      log.error({ err: error, route: name }, "Rate limit check failed");
      return null;
    });
    if (decision && !decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).end();
      return;
    }
    await handler(req, res);
  };
}
