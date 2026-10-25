import { registerClient } from "@kan/hub/mcp";

import { getHubDb } from "~/hub/server/db";
import {
  allowCors,
  handledMethod,
  noStore,
  sendOAuthError,
} from "~/hub/server/oauth-http";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/**
 * Dynamic client registration (RFC 7591): an AI app introduces itself before
 * its first sign-in. Open to anyone, as MCP expects; a registered app can do
 * nothing until a person approves it. Limited per IP so nobody fills the
 * table.
 */
export default withHubRateLimit(
  "oauth-register",
  { window: 3600, max: 30 },
  async (req, res) => {
    allowCors(res, "POST");
    if (handledMethod(req, res, "POST")) return;
    noStore(res);
    try {
      const registered = await registerClient(getHubDb(), req.body, new Date());
      res.status(201).json(registered);
    } catch (error) {
      sendOAuthError(res, error, "register");
    }
  },
);
