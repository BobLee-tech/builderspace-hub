import type { NextApiRequest, NextApiResponse } from "next";

import { authorizationServerMetadata } from "@kan/hub/mcp";

import {
  allowCors,
  handledMethod,
  requireMcpUrls,
} from "~/hub/server/oauth-http";

/**
 * RFC 8414 metadata: how an MCP client signs someone in to this Hub. Clients
 * look for it at `/.well-known/oauth-authorization-server` on the site's
 * origin, which next.config.js rewrites to here.
 */
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  allowCors(res, "GET");
  if (handledMethod(req, res, "GET")) return;
  const urls = requireMcpUrls(res);
  if (!urls) return;
  res.setHeader("Cache-Control", "public, max-age=300");
  res.status(200).json(authorizationServerMetadata(urls));
}
