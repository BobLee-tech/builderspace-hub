import type { NextApiRequest, NextApiResponse } from "next";

import { handleBoardsRest } from "@kan/hub/private-boards";
import { isHubError, statusOfHubError } from "@kan/hub/shared";
import { createLogger } from "@kan/logger";

import { authenticateDocumentApiRequest } from "~/hub/server/documents-auth";
import { withHubRateLimit } from "~/hub/server/rate-limit";

const log = createLogger("hub-boards-api");

/**
 * Who can see a board, for the command line:
 * `GET/PUT /api/hub/v1/boards/{publicId}/audience`. The rules are the use
 * cases the board page calls; this file only does the HTTP. It takes an API
 * key the same way the document API does (and only an API key).
 */
export default withHubRateLimit(
  "board-api",
  { window: 60, max: 120 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    let auth;
    try {
      auth = await authenticateDocumentApiRequest(req, res);
    } catch (error) {
      log.error({ err: error }, "Board API authentication failed");
      res.status(500).json({ message: "服务出错了，请稍后再试" });
      return;
    }
    if (!auth) return;

    const path = req.query.path;
    const segments = Array.isArray(path) ? path : path ? [path] : [];

    try {
      const response = await handleBoardsRest(auth.db, auth.actor, {
        method: req.method ?? "GET",
        segments,
        query: {},
        body: req.body,
      });
      res.status(response.status).json(response.body);
    } catch (error) {
      if (isHubError(error)) {
        res
          .status(statusOfHubError(error.code))
          .json({ message: error.message });
        return;
      }
      log.error({ err: error }, "Board API request failed");
      res.status(500).json({ message: "服务出错了，请稍后再试" });
    }
  },
);
