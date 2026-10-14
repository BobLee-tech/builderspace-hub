import type { NextApiRequest, NextApiResponse } from "next";

import {
  authorizeUrl,
  gitHubAppConfig,
  newState,
  stateCookie,
} from "@kan/hub/github";

import {
  GITHUB_PAGE,
  hubUserFromRequest,
  isSecureRequest,
} from "~/hub/server/github-session";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/**
 * The 连接 GitHub button: remembers a random state in a cookie only the
 * GitHub routes receive, then sends the person to GitHub to authorise the
 * Hub's GitHub App.
 */
export default withHubRateLimit(
  "github-connect",
  { window: 60, max: 20 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).end();
      return;
    }

    if (!(await hubUserFromRequest(req))) {
      res.redirect(302, "/login");
      return;
    }
    const config = gitHubAppConfig();
    if (!config) {
      res.redirect(302, `${GITHUB_PAGE}?github=not_configured`);
      return;
    }

    const state = newState();
    res.setHeader("Set-Cookie", stateCookie(state, isSecureRequest(req)));
    res.redirect(302, authorizeUrl(config, state));
  },
);
