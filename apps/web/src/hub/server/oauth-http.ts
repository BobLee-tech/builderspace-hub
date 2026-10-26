import type { NextApiRequest, NextApiResponse } from "next";

import type { McpUrls } from "@kan/hub/mcp";
import { hubMcpUrls, isOAuthError } from "@kan/hub/mcp";
import { createLogger } from "@kan/logger";

const log = createLogger("hub-oauth");

/**
 * HTTP plumbing shared by the MCP sign-in routes: CORS, OAuth's error format,
 * and the Hub's own address.
 *
 * CORS is open (`*`): these routes take no cookies, only what the request
 * itself carries (a body or a bearer token), so another site calling them
 * gains nothing it could not do from a server. Browser-based MCP clients
 * need it.
 */
export function allowCors(
  res: NextApiResponse,
  methods: string,
  exposeHeaders?: string,
): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", `${methods}, OPTIONS`);
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  );
  if (exposeHeaders) {
    res.setHeader("Access-Control-Expose-Headers", exposeHeaders);
  }
  res.setHeader("Access-Control-Max-Age", "86400");
}

/** Answers a preflight or a wrong method; true when the request is handled. */
export function handledMethod(
  req: NextApiRequest,
  res: NextApiResponse,
  method: "GET" | "POST",
): boolean {
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  if (req.method !== method) {
    res.setHeader("Allow", `${method}, OPTIONS`);
    res
      .status(405)
      .json({
        error: "invalid_request",
        error_description: `只接受 ${method}`,
      });
    return true;
  }
  return false;
}

/** The Hub's MCP addresses, or a 500 already written when the base URL is unset. */
export function requireMcpUrls(res: NextApiResponse): McpUrls | null {
  const urls = hubMcpUrls();
  if (!urls) {
    log.error("NEXT_PUBLIC_BASE_URL is not set; MCP sign-in is unavailable");
    res
      .status(500)
      .json({ error: "server_error", error_description: "Hub 的地址没有配置" });
  }
  return urls;
}

/** Writes an OAuthError in its wire format; anything else is logged and hidden. */
export function sendOAuthError(
  res: NextApiResponse,
  error: unknown,
  route: string,
): void {
  if (isOAuthError(error)) {
    res.status(error.status).json(error.toJSON());
    return;
  }
  log.error({ err: error, route }, "OAuth request failed");
  res
    .status(500)
    .json({
      error: "server_error",
      error_description: "服务出错了，请稍后再试",
    });
}

/** Tokens and their answers are never cached anywhere (RFC 6749 §5.1). */
export function noStore(res: NextApiResponse): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
}
