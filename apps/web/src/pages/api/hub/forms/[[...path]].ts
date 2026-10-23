import type { NextApiRequest, NextApiResponse } from "next";

import type { FormsRestRequest } from "@kan/hub/forms";
import { createNextApiContext } from "@kan/api/trpc-context";
import {
  formViewerFor,
  handleFormsRest,
  IMAGE_MAX_BYTES,
} from "@kan/hub/forms";
import { FORM_TOKEN_HEADER, FORM_VOTER_HEADER } from "@kan/hub/public";
import { createLogger } from "@kan/logger";

import { withHubRateLimit } from "~/hub/server/rate-limit";

const log = createLogger("hub-forms-api");

/** The body is read here: raw bytes for an upload, JSON for the rest. */
export const config = { api: { bodyParser: false } };

/** 60 long answers, escaped, fit well within this. */
const MAX_JSON_BYTES = 1024 * 1024;

type Handler = (req: NextApiRequest, res: NextApiResponse) => Promise<void>;

class BodyTooLarge extends Error {}

async function readBody(req: NextApiRequest, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > limit) throw new BodyTooLarge();
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

const header = (req: NextApiRequest, name: string) => {
  const value = req.headers[name];
  return typeof value === "string" ? value : null;
};

/**
 * Forms for the people answering them: `/api/hub/forms/…` (see
 * `packages/hub/src/forms/rest.ts` for the routes). Works without signing in
 * for public forms; a browser session is used when present. API keys are
 * refused, like on every Hub page.
 *
 * Writes must say what they send (`application/json`, or the picture's
 * type): a page on another site can only send those after a CORS check, so
 * it cannot submit answers in someone's name.
 */
const handle: Handler = async (req, res) => {
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (
    header(req, "x-api-key") ||
    /^bearer\s/i.test(header(req, "authorization") ?? "")
  ) {
    res.status(403).json({ message: "表单只能在网页里填写，不接受 API key" });
    return;
  }

  const path = req.query.path;
  const segments = Array.isArray(path) ? path : path ? [path] : [];
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(req.query)) {
    if (key !== "path") query[key] = Array.isArray(value) ? value[0] : value;
  }
  const method = req.method ?? "GET";
  const isUpload = method === "POST" && segments[1] === "images";
  const contentType = (header(req, "content-type") ?? "").toLowerCase();

  let body: unknown = null;
  let bytes: Uint8Array | undefined;
  try {
    if (isUpload) {
      if (!contentType.startsWith("image/")) {
        res.status(415).json({ message: "请直接上传图片文件" });
        return;
      }
      bytes = await readBody(req, IMAGE_MAX_BYTES);
    } else if (method !== "GET" && method !== "HEAD") {
      if (!contentType.startsWith("application/json")) {
        res.status(415).json({ message: "请求格式不对" });
        return;
      }
      const raw = await readBody(req, MAX_JSON_BYTES);
      body = raw.length > 0 ? JSON.parse(raw.toString("utf8")) : null;
    }
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      res.status(413).json({
        message: isUpload ? "图片太大，请换一张小一点的" : "内容太多了",
      });
      return;
    }
    if (error instanceof SyntaxError) {
      res.status(400).json({ message: "请求内容不是有效的 JSON" });
      return;
    }
    throw error;
  }

  try {
    const { user, db } = await createNextApiContext(req);
    const viewer = await formViewerFor(db, user ?? null);
    const request: FormsRestRequest = {
      method,
      segments,
      query,
      body,
      bytes,
      secrets: {
        editToken: header(req, FORM_TOKEN_HEADER),
        browserKey: header(req, FORM_VOTER_HEADER),
      },
    };
    const response = await handleFormsRest(db, viewer, request);

    if ("file" in response) {
      const { file } = response;
      res.setHeader("Content-Type", file.contentType);
      res.setHeader("Content-Length", String(file.body.length));
      res.setHeader("Content-Disposition", "inline");
      // Even if a browser were tricked into reading it as a page, it could do nothing.
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      // Never served from a cache without asking again: a manager can take
      // the form off the open web or remove the picture at any time.
      res.setHeader(
        "Cache-Control",
        file.cacheable ? "private, no-cache" : "private, no-store",
      );
      res.status(response.status).end(file.body);
      return;
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.status(response.status).json(response.body);
  } catch (error) {
    log.error({ err: error, method, segments }, "Forms API request failed");
    res.status(500).json({ message: "服务出错了，请稍后再试" });
  }
};

// Each kind of request has its own limit, counted per IP across all instances.
// One page of the wall can show a couple of hundred pictures, hence theirs.
const reads = withHubRateLimit("form-read", { window: 60, max: 240 }, handle);
const images = withHubRateLimit("form-image", { window: 60, max: 900 }, handle);
const submits = withHubRateLimit(
  "form-submit",
  { window: 60, max: 20 },
  handle,
);
const uploads = withHubRateLimit(
  "form-upload",
  { window: 600, max: 60 },
  handle,
);
const likes = withHubRateLimit("form-like", { window: 60, max: 60 }, handle);

export default function formsApi(req: NextApiRequest, res: NextApiResponse) {
  const path = req.query.path;
  const segments = Array.isArray(path) ? path : [];
  if (req.method === "GET") {
    return segments[0] === "images" ? images(req, res) : reads(req, res);
  }
  if (segments[1] === "images") return uploads(req, res);
  if (segments[3] === "like") return likes(req, res);
  return submits(req, res);
}
