import type { NextApiRequest } from "next";

import { createNextApiContext } from "@kan/api/trpc-context";
import { getAccessFacts } from "@kan/hub/accounts";

import { env } from "~/env";
import { getHubDb } from "./db";

/**
 * The signed-in, non-suspended person behind a browser request to one of the
 * GitHub routes, or null. Mirrors what hubProcedure checks for tRPC.
 */
export async function hubUserFromRequest(
  req: NextApiRequest,
): Promise<{ userId: string; email: string } | null> {
  const { user } = await createNextApiContext(req);
  if (!user) return null;
  const facts = await getAccessFacts(getHubDb(), user.id);
  if (facts.status === "suspended") return null;
  return { userId: user.id, email: user.email };
}

/** Cookies are marked Secure whenever the app is served over https. */
export function isSecureRequest(req: NextApiRequest): boolean {
  return (
    req.headers["x-forwarded-proto"] === "https" ||
    (env.NEXT_PUBLIC_BASE_URL ?? "").startsWith("https://")
  );
}

/** Where the GitHub routes send people when they are done. */
export const GITHUB_PAGE = "/me/github";
