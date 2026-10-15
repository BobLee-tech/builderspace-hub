import type { NextApiRequest, NextApiResponse } from "next";

import type { dbClient } from "@kan/db/client";
import type { AdminActor } from "@kan/hub/accounts";
import { createNextApiContext } from "@kan/api/trpc-context";
import { getAccessFacts } from "@kan/hub/accounts";
import { isHubError } from "@kan/hub/shared";

export interface DocumentRequestContext {
  db: dbClient;
  actor: AdminActor;
}

const STATUS = {
  INVALID_INPUT: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  FORBIDDEN: 403,
  UNAVAILABLE: 503,
} as const;

/**
 * Who is calling a document route, or a refusal already written to `res`.
 * Like the tRPC procedures, these routes are for the web app: a browser
 * session works, an API key does not. Suspended accounts are turned away.
 */
export async function authenticateDocumentRequest(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<DocumentRequestContext | null> {
  if (
    req.headers["x-api-key"] ||
    /^bearer\s/i.test(String(req.headers.authorization ?? ""))
  ) {
    res.status(403).json({ error: "文档只能在网页里使用，不接受 API key" });
    return null;
  }

  const { user, db } = await createNextApiContext(req);
  if (!user) {
    res.status(401).json({ error: "请先登录" });
    return null;
  }

  const facts = await getAccessFacts(db, user.id);
  if (facts.status === "suspended") {
    res.status(403).json({ error: "这个账号已被停用" });
    return null;
  }
  return {
    db,
    actor: { userId: user.id, email: user.email, role: facts.role },
  };
}

/**
 * Who is calling the document API, or a refusal already written to `res`.
 *
 * This one is for the command line and takes an API key only. A browser
 * session is deliberately not accepted here: cookies ride along on requests
 * any page can make, and nothing on this API needs them. The cookie header is
 * dropped before the key is looked up, so a request that has both is judged by
 * its key alone. The same goes for an Authorization header, which the auth
 * library would otherwise prefer over `x-api-key`.
 */
export async function authenticateDocumentApiRequest(
  req: NextApiRequest,
  res: NextApiResponse,
): Promise<DocumentRequestContext | null> {
  if (typeof req.headers["x-api-key"] !== "string" || !req.headers["x-api-key"]) {
    res.status(401).json({ message: "需要 API key（x-api-key 请求头）" });
    return null;
  }

  let context;
  try {
    context = await createNextApiContext({
      ...req,
      headers: { ...req.headers, cookie: undefined, authorization: undefined },
    } as NextApiRequest);
  } catch (error) {
    // The auth library throws APIError for a key it will not accept: unknown,
    // disabled, expired, or used too often. None of these is a server fault.
    const e = error as { name?: string; body?: { code?: string } };
    if (e.name === "APIError") {
      if (e.body?.code === "RATE_LIMITED") {
        res.status(429).json({ message: "这个 API key 请求太频繁，稍后再试" });
      } else {
        res.status(401).json({ message: "API key 无效或已停用" });
      }
      return null;
    }
    throw error;
  }

  const { user, db } = context;
  if (!user) {
    res.status(401).json({ message: "API key 无效或已停用" });
    return null;
  }
  const facts = await getAccessFacts(db, user.id);
  if (facts.status === "suspended") {
    res.status(403).json({ message: "这个账号已被停用" });
    return null;
  }
  return {
    db,
    actor: { userId: user.id, email: user.email, role: facts.role },
  };
}

/** Writes a use case's expected failure as JSON; anything else is re-thrown. */
export function respondWithHubError(
  res: NextApiResponse,
  error: unknown,
): void {
  if (!isHubError(error)) throw error;
  res.status(STATUS[error.code]).json({ error: error.message });
}
