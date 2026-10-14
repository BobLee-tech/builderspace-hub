import type { NextApiRequest, NextApiResponse } from "next";

import {
  clearedStateCookie,
  completeConnect,
  gitHubAppConfig,
  gitHubDeps,
  STATE_COOKIE,
  statesMatch,
} from "@kan/hub/github";
import { isHubError } from "@kan/hub/shared";
import { createLogger } from "@kan/logger";

import { getHubDb } from "~/hub/server/db";
import {
  GITHUB_PAGE,
  hubUserFromRequest,
  isSecureRequest,
} from "~/hub/server/github-session";
import { withHubRateLimit } from "~/hub/server/rate-limit";

const log = createLogger("hub-github");

/**
 * Where GitHub sends people back after they authorise (or decline). Checks the
 * state against the cookie set by /connect, then stores the connection for
 * the person signed in to this browser. Always lands back on the GitHub tab
 * with an outcome the page can explain.
 */
export default withHubRateLimit(
  "github-callback",
  { window: 60, max: 20 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "no-store");
    const secure = isSecureRequest(req);
    const back = (outcome: string) => {
      res.setHeader("Set-Cookie", clearedStateCookie(secure));
      res.redirect(302, `${GITHUB_PAGE}?github=${outcome}`);
    };

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).end();
      return;
    }
    if (req.query.error) {
      back("denied");
      return;
    }
    if (!statesMatch(req.cookies[STATE_COOKIE], req.query.state)) {
      back("expired");
      return;
    }

    const user = await hubUserFromRequest(req);
    if (!user) {
      res.redirect(302, "/login");
      return;
    }
    const config = gitHubAppConfig();
    const code = req.query.code;
    if (!config || typeof code !== "string" || !code) {
      back("failed");
      return;
    }

    try {
      await completeConnect(
        getHubDb(),
        user,
        { code, redirectUri: config.callbackUrl, now: new Date() },
        gitHubDeps(config),
      );
      back("connected");
    } catch (error) {
      if (!isHubError(error)) {
        log.error({ err: error }, "Connecting GitHub failed");
      }
      back("failed");
    }
  },
);
