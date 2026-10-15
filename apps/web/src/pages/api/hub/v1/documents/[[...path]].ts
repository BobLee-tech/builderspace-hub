import type { NextApiRequest, NextApiResponse } from "next";

import { createLogger } from "@kan/logger";
import {
  getDocumentStorage,
  handleDocumentsRest,
  statusOfHubError,
} from "@kan/hub/documents";
import { isHubError } from "@kan/hub/shared";

import { authenticateDocumentApiRequest } from "~/hub/server/documents-auth";
import { withHubRateLimit } from "~/hub/server/rate-limit";

const log = createLogger("hub-documents-api");

/** Text documents go up to 1 MB; JSON escaping needs some room on top. */
export const config = { api: { bodyParser: { sizeLimit: "2mb" } } };

/**
 * The document library for the command line: `GET/POST /api/hub/v1/documents`
 * and what hangs off it (see docs/hub/ARCHITECTURE.md and the CLI repository's
 * HUB_DOCUMENTS_API.md). The rules are the same use cases the web app calls;
 * this file only does the HTTP: API key in, rate limit, JSON out.
 *
 * Not offered, on purpose: deleting, and handing out or deciding edit rights.
 */
export default withHubRateLimit(
  "document-api",
  { window: 60, max: 300 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    let auth;
    try {
      auth = await authenticateDocumentApiRequest(req, res);
    } catch (error) {
      log.error({ err: error }, "Document API authentication failed");
      res.status(500).json({ message: "服务出错了，请稍后再试" });
      return;
    }
    if (!auth) return;

    const path = req.query.path;
    const segments = Array.isArray(path) ? path : path ? [path] : [];
    const query: Record<string, string | undefined> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "path") query[key] = Array.isArray(value) ? value[0] : value;
    }

    try {
      const response = await handleDocumentsRest(
        auth.db,
        getDocumentStorage(auth.db),
        auth.actor,
        { method: req.method ?? "GET", segments, query, body: req.body },
      );
      res.status(response.status).json(response.body);
    } catch (error) {
      if (isHubError(error)) {
        res.status(statusOfHubError(error.code)).json({ message: error.message });
        return;
      }
      log.error({ err: error }, "Document API request failed");
      res.status(500).json({ message: "服务出错了，请稍后再试" });
    }
  },
);
