import type { NextApiRequest, NextApiResponse } from "next";

import { protectedResourceMetadata } from "@kan/hub/mcp";

import {
  allowCors,
  handledMethod,
  requireMcpUrls,
} from "~/hub/server/oauth-http";

/**
 * RFC 9728 metadata for the MCP endpoint: which authorization server issues
 * its tokens. next.config.js rewrites both places clients look to here:
 * `/.well-known/oauth-protected-resource` and the same with the endpoint's
 * path appended.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  allowCors(res, "GET");
  if (handledMethod(req, res, "GET")) return;
  const urls = requireMcpUrls(res);
  if (!urls) return;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json(protectedResourceMetadata(urls));
}
