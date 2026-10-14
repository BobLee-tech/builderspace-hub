import type { NextApiRequest, NextApiResponse } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

import { clientIp, withHubRateLimit } from "./rate-limit";

const request = (headers: Record<string, string | string[]>, remote?: string) =>
  ({ headers, socket: { remoteAddress: remote } }) as unknown as NextApiRequest;

describe("clientIp", () => {
  it("takes the first X-Forwarded-For address", () => {
    expect(
      clientIp(request({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })),
    ).toBe("203.0.113.7");
    expect(clientIp(request({ "x-forwarded-for": ["198.51.100.2"] }))).toBe(
      "198.51.100.2",
    );
  });

  it("falls back to the socket, then to a shared bucket", () => {
    expect(clientIp(request({ "x-forwarded-for": " " }, "192.0.2.1"))).toBe(
      "192.0.2.1",
    );
    expect(clientIp(request({}))).toBe("unknown");
  });
});

describe("withHubRateLimit", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("goes straight to the handler when DISABLE_RATE_LIMIT is set", async () => {
    vi.stubEnv("DISABLE_RATE_LIMIT", "true");
    const handler = vi.fn(() => Promise.resolve());
    const route = withHubRateLimit("test", { window: 60, max: 0 }, handler);

    await route(request({}), {} as NextApiResponse);
    expect(handler).toHaveBeenCalledOnce();
  });
});
