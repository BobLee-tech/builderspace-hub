import { revokeToken } from "@kan/hub/mcp";

import { getHubDb } from "~/hub/server/db";
import {
  allowCors,
  handledMethod,
  noStore,
  sendOAuthError,
} from "~/hub/server/oauth-http";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/** Token revocation (RFC 7009): an AI app signing out ends its connection. */
export default withHubRateLimit(
  "oauth-revoke",
  { window: 60, max: 30 },
  async (req, res) => {
    allowCors(res, "POST");
    if (handledMethod(req, res, "POST")) return;
    noStore(res);
    try {
      await revokeToken(getHubDb(), req.body);
      res.status(200).end();
    } catch (error) {
      sendOAuthError(res, error, "revoke");
    }
  },
);
