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

/** Writes a use case's expected failure as JSON; anything else is re-thrown. */
export function respondWithHubError(
  res: NextApiResponse,
  error: unknown,
): void {
  if (!isHubError(error)) throw error;
  res.status(STATUS[error.code]).json({ error: error.message });
}
