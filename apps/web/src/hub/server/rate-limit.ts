import type { NextApiRequest, NextApiResponse } from "next";

import type { RateLimitRule } from "@kan/hub/rate-limit";
import { consumeRateLimit } from "@kan/hub/rate-limit";

import { getHubDb } from "./db";

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
 */
export function withHubRateLimit<T>(
  name: string,
  rule: RateLimitRule,
  handler: (req: NextApiRequest, res: NextApiResponse<T>) => Promise<void>,
) {
  return async (req: NextApiRequest, res: NextApiResponse<T>) => {
    const decision = await consumeRateLimit(
      getHubDb(),
      `hub:${name}:${clientIp(req)}`,
      rule,
    );
    if (!decision.allowed) {
      res.setHeader("Retry-After", String(decision.retryAfterSeconds));
      res.status(429).end();
      return;
    }
    await handler(req, res);
  };
}
