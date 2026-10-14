import type { NextApiRequest, NextApiResponse } from "next";

import { describeGrantForJoin } from "@kan/hub/access";
import { HUB_GRANT_HEADER } from "@kan/hub/public";

import type { JoinStatus } from "~/hub/features/auth/join-status";
import { getHubDb } from "~/hub/server/db";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/**
 * Tells the registration page whether its link is still good, and for which
 * address. The token arrives in a header, never in the URL, so it stays out of
 * access logs. A plain API route rather than tRPC, because Kan's tRPC logging
 * records every procedure's input.
 *
 * Link tokens are 256 bits, so guessing one is hopeless; the limit (counted in
 * the database, across all instances) keeps the endpoint from being hammered.
 */
export default withHubRateLimit(
  "join-status",
  { window: 60, max: 30 },
  async (req: NextApiRequest, res: NextApiResponse<JoinStatus>) => {
    res.setHeader("Cache-Control", "no-store");

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).end();
      return;
    }

    const status = await describeGrantForJoin(
      getHubDb(),
      req.headers[HUB_GRANT_HEADER],
      new Date(),
    );

    res
      .status(200)
      .json(
        status.state === "valid"
          ? { state: "valid", email: status.email }
          : { state: status.state },
      );
  },
);
