import { pipeline } from "node:stream/promises";
import type { NextApiRequest, NextApiResponse } from "next";

import { getDocumentStorage, openDocument } from "@kan/hub/documents";

import {
  authenticateDocumentRequest,
  respondWithHubError,
} from "~/hub/server/documents-auth";
import { withHubRateLimit } from "~/hub/server/rate-limit";

/**
 * Shows or downloads one document, for a signed-in person who may read it.
 *
 * `?mode=download` saves the file; the default shows it in the page. With
 * bucket storage this checks the person's right and then redirects to a
 * signed link that lives for a minute, so the bytes never pass through this
 * function (which could not carry a large file anyway). With disk storage
 * (development) it streams the file itself.
 *
 * The response is never cached: the right to read can be taken away, and a
 * cached copy or redirect would outlive it.
 */
export default withHubRateLimit(
  "document-file",
  { window: 60, max: 120 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Referrer-Policy", "no-referrer");

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      res.status(405).end();
      return;
    }

    const auth = await authenticateDocumentRequest(req, res);
    if (!auth) return;

    const publicId = req.query.publicId;
    if (typeof publicId !== "string" || publicId.length > 32) {
      res.status(400).json({ error: "文档编号不对" });
      return;
    }

    try {
      const opened = await openDocument(
        auth.db,
        getDocumentStorage(),
        auth.actor,
        {
          documentPublicId: publicId,
          mode: req.query.mode === "download" ? "download" : "view",
        },
      );

      if (opened.source.kind === "redirect") {
        res.redirect(302, opened.source.url);
        return;
      }

      res.setHeader("Content-Type", opened.contentType);
      res.setHeader("Content-Disposition", opened.disposition);
      res.setHeader("Content-Length", String(opened.source.size));
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (opened.mode === "view" && opened.ext.startsWith("htm")) {
        // Served from our own origin, so scripts in an uploaded page must not
        // be able to reach it: an opaque origin cannot read our cookies or API.
        res.setHeader("Content-Security-Policy", "sandbox allow-scripts");
      }
      await pipeline(opened.source.body, res);
    } catch (error) {
      respondWithHubError(res, error);
    }
  },
);
