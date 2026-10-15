import type { NextApiRequest, NextApiResponse } from "next";

import {
  findUpload,
  FsDocumentStorage,
  getPrimaryDocumentStorage,
} from "@kan/hub/documents";

import { authenticateDocumentRequest } from "~/hub/server/documents-auth";
import { withHubRateLimit } from "~/hub/server/rate-limit";

export const config = { api: { bodyParser: false } };

/**
 * Receives a file when documents are stored in a folder on disk, which is the
 * development setup. With bucket storage the browser sends the file to the
 * bucket directly and this route does not exist as far as callers can tell.
 *
 * Only the person the upload was prepared for can send to it, once, until it
 * expires, and only exactly as many bytes as were declared.
 */
export default withHubRateLimit(
  "document-upload",
  { window: 60, max: 60 },
  async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader("Cache-Control", "no-store");

    const storage = getPrimaryDocumentStorage();
    if (!(storage instanceof FsDocumentStorage)) {
      res.status(404).end();
      return;
    }
    if (req.method !== "PUT") {
      res.setHeader("Allow", "PUT");
      res.status(405).end();
      return;
    }

    const auth = await authenticateDocumentRequest(req, res);
    if (!auth) return;

    const uploadId = req.query.uploadId;
    const upload =
      typeof uploadId === "string" && uploadId.length <= 32
        ? await findUpload(auth.db, uploadId)
        : null;
    if (
      !upload ||
      upload.userId !== auth.actor.userId ||
      upload.consumedAt ||
      upload.expiresAt.getTime() < Date.now()
    ) {
      res.status(404).json({ error: "找不到这次上传，请重新选择文件" });
      return;
    }

    if (Number(req.headers["content-length"]) !== upload.size) {
      res.status(400).json({ error: "文件大小对不上" });
      return;
    }

    try {
      await storage.writeStream(upload.storageKey, req, upload.size);
    } catch {
      res.status(400).json({ error: "上传失败，请重试" });
      return;
    }
    res.status(204).end();
  },
);
