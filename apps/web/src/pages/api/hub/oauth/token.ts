import { exchangeToken } from "@kan/hub/mcp";

import { getHubDb } from "~/hub/server/db";
import {
  allowCors,
  handledMethod,
  noStore,
  requireMcpUrls,
  sendOAuthError,
} from "~/hub/server/oauth-http";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/**
 * The token endpoint: an authorization code or a refresh token in, a new
 * access token and refresh token out. Takes a form or JSON body; Next parses
 * both into an object.
 */
export default withHubRateLimit(
  "oauth-token",
  { window: 60, max: 60 },
  async (req, res) => {
    allowCors(res, "POST");
    if (handledMethod(req, res, "POST")) return;
    noStore(res);
    const urls = requireMcpUrls(res);
    if (!urls) return;
    try {
      const tokens = await exchangeToken(
        getHubDb(),
        req.body,
        urls.resource,
        new Date(),
      );
      res.status(200).json(tokens);
    } catch (error) {
      sendOAuthError(res, error, "token");
    }
  },
);
